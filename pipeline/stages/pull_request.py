"""
Pull Request Stage - Create migration PR via fork

This module provides three main entry points:
1. push_to_fork() - Push workflow to fork (for GHA verification first)
2. create_pr_only() - Create PR from already-pushed branch
3. create_pull_request() - Combined push + PR (original flow, still supported)
4. update_fork_file() - Update file in fork (for GHA fix retries)
"""
import requests
import time
import asyncio
import base64
from dataclasses import dataclass
from typing import Optional, Tuple, List

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import RepoInput, PullRequestResult, StageStatus


@dataclass
class PushToForkResult:
    """Result of pushing workflow to fork (before GHA verification)"""
    success: bool = False
    fork_owner: Optional[str] = None
    fork_url: Optional[str] = None
    branch_name: Optional[str] = None
    branch_sha: Optional[str] = None
    workflow_path: str = ".github/workflows/ci.yml"
    error: Optional[str] = None


def create_pull_request(
    repo: RepoInput,
    migrated_yaml: str,
    source_ci: str,
    github_pat: str,
    branch_prefix: str = "cipilot/migrated",
    retries: int = 3,
    retry_delay: int = 5,
    dry_run: bool = False,
    yaml_valid: bool = True,
    lint_valid: bool = True,
    lint_errors: Optional[List[str]] = None,
) -> PullRequestResult:
    """
    Create a PR with migrated workflow:
    1. Fork the repository (if not already forked)
    2. Create a new branch
    3. Add/update the workflow file
    4. Create PR from fork to original
    
    Reuses same logic as backend GitHub API calls.
    """
    result = PullRequestResult()
    
    if dry_run:
        result.status = StageStatus.SKIPPED
        result.skipped_reason = "Dry run mode - PR not created"
        timestamp = int(time.time() * 1000)
        result.branch_name = f"{branch_prefix}-{source_ci}-to-gha-{timestamp}"
        return result
    
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    # Get authenticated user
    user_resp = requests.get("https://api.github.com/user", headers=headers, timeout=30)
    if user_resp.status_code != 200:
        result.status = StageStatus.FAILED
        result.error = f"Failed to get authenticated user: {user_resp.text}"
        return result
    
    username = user_resp.json().get("login")
    
    for attempt in range(retries):
        try:
            # Step 1: Fork the repository
            fork_owner, fork_error = _ensure_fork(repo, username, headers)
            if not fork_owner:
                result.status = StageStatus.FAILED
                result.error = fork_error
                return result
            
            result.fork_url = f"https://github.com/{fork_owner}/{repo.name}"
            
            # Step 2: Get default branch SHA
            branch_sha, branch_error = _get_branch_sha(repo, fork_owner, repo.target_branch, headers)
            if not branch_sha:
                result.status = StageStatus.FAILED
                result.error = branch_error
                return result
            
            # Step 3: Create new branch
            timestamp = int(time.time() * 1000)
            branch_name = f"{branch_prefix}-{source_ci}-to-gha-{timestamp}"
            result.branch_name = branch_name
            
            branch_created, branch_err = _create_branch(
                fork_owner, repo.name, branch_name, branch_sha, headers
            )
            if not branch_created:
                result.status = StageStatus.FAILED
                result.error = branch_err
                return result
            
            # Step 4: Create/update workflow file
            workflow_path = ".github/workflows/ci.yml"
            file_created, file_err = _create_or_update_file(
                fork_owner, repo.name, branch_name, workflow_path, migrated_yaml, headers
            )
            if not file_created:
                result.status = StageStatus.FAILED
                result.error = file_err
                return result
            
            # Step 5: Create PR
            pr_url, pr_number, pr_err = _create_pr(
                repo, fork_owner, username, branch_name, source_ci, headers,
                yaml_valid=yaml_valid, lint_valid=lint_valid, lint_errors=lint_errors,
            )
            if not pr_url:
                result.status = StageStatus.FAILED
                result.error = pr_err
                return result
            
            result.status = StageStatus.SUCCESS
            result.pr_url = pr_url
            result.pr_number = pr_number
            return result
            
        except Exception as e:
            result.error = str(e)
            if attempt < retries - 1:
                time.sleep(retry_delay)
                continue
    
    result.status = StageStatus.FAILED
    return result


def _ensure_fork(
    repo: RepoInput,
    username: str,
    headers: dict
) -> Tuple[Optional[str], Optional[str]]:
    """Ensure fork exists, create if needed. Returns (fork_owner, error)"""
    
    # Check if fork already exists under username/repo.name
    fork_url = f"https://api.github.com/repos/{username}/{repo.name}"
    resp = requests.get(fork_url, headers=headers, timeout=30)

    if resp.status_code == 200:
        fork_data = resp.json()
        # Accept existing fork regardless of whether parent full_name matches exactly
        # (repo may have been renamed/transferred since the fork was created)
        if fork_data.get("fork"):
            print(f"[PR] Using existing fork: {username}/{repo.name}")
            return username, None
        # Repo exists but is NOT a fork — name collision, try with organisation suffix
        print(f"[PR] {username}/{repo.name} exists but is not a fork, will attempt fresh fork creation")

    # Create fork
    print(f"[PR] Creating fork of {repo.full_name}...")
    create_url = f"https://api.github.com/repos/{repo.full_name}/forks"
    resp = requests.post(create_url, headers=headers, timeout=60)

    if resp.status_code in (200, 202):
        # Fork creation is async (202). Poll until the fork repo is actually accessible,
        # then verify the default branch is synced before returning.
        print(f"[PR] Fork creation accepted, waiting for GitHub to sync...")
        deadline = time.monotonic() + 90  # up to 90 seconds
        while time.monotonic() < deadline:
            time.sleep(5)
            check = requests.get(fork_url, headers=headers, timeout=30)
            if check.status_code == 200 and check.json().get("fork"):
                print(f"[PR] Fork is ready: {username}/{repo.name}")
                return username, None
        print(f"[PR] Fork sync timed out after 90s, proceeding anyway...")
        return username, None

    # 403 "cannot fork at this time" usually means the fork already exists but the
    # earlier GET check missed it (e.g. parent name mismatch after a repo rename).
    # Try one more GET to confirm the fork is actually there.
    if resp.status_code == 403:
        retry_resp = requests.get(fork_url, headers=headers, timeout=30)
        if retry_resp.status_code == 200 and retry_resp.json().get("fork"):
            print(f"[PR] Fork already exists (confirmed after 403): {username}/{repo.name}")
            return username, None

    return None, f"Failed to create fork: {resp.text}"


def _get_branch_sha(
    repo: RepoInput,
    fork_owner: str,
    branch: str,
    headers: dict
) -> Tuple[Optional[str], Optional[str]]:
    """Get SHA of branch. Returns (sha, error)"""
    
    # Try ORIGINAL repo first (always reliable), then fork
    # New forks may not have branches synced immediately
    for owner in [repo.owner, fork_owner]:
        url = f"https://api.github.com/repos/{owner}/{repo.name}/git/refs/heads/{branch}"
        resp = requests.get(url, headers=headers, timeout=30)
        
        if resp.status_code == 200:
            sha = resp.json().get("object", {}).get("sha")
            if sha:
                print(f"[PR] Got branch SHA from {owner}/{repo.name}: {sha[:8]}...")
                return sha, None
    
    return None, f"Branch '{branch}' not found in {repo.owner}/{repo.name} or {fork_owner}/{repo.name}"


def _create_branch(
    owner: str,
    repo_name: str,
    branch_name: str,
    sha: str,
    headers: dict
) -> Tuple[bool, Optional[str]]:
    """Create a new branch. Returns (success, error)"""
    
    # Check if branch already exists
    check_url = f"https://api.github.com/repos/{owner}/{repo_name}/git/refs/heads/{branch_name}"
    resp = requests.get(check_url, headers=headers, timeout=30)
    
    if resp.status_code == 200:
        # Branch exists, delete and recreate
        print(f"[PR] Branch {branch_name} exists, deleting...")
        requests.delete(check_url, headers=headers, timeout=30)
    
    # Create branch
    print(f"[PR] Creating branch {branch_name} on {owner}/{repo_name} from SHA {sha[:8]}...")
    create_url = f"https://api.github.com/repos/{owner}/{repo_name}/git/refs"
    data = {
        "ref": f"refs/heads/{branch_name}",
        "sha": sha
    }
    resp = requests.post(create_url, headers=headers, json=data, timeout=30)
    
    if resp.status_code in (200, 201):
        print(f"[PR] Branch created successfully")
        return True, None
    
    return False, f"Failed to create branch: {resp.text}"


def _create_or_update_file(
    owner: str,
    repo_name: str,
    branch: str,
    file_path: str,
    content: str,
    headers: dict
) -> Tuple[bool, Optional[str]]:
    """Create or update file in repo. Returns (success, error)"""
    
    url = f"https://api.github.com/repos/{owner}/{repo_name}/contents/{file_path}"
    
    # Check if file exists (to get sha for update)
    existing_sha = None
    resp = requests.get(url, headers=headers, params={"ref": branch}, timeout=30)
    if resp.status_code == 200:
        existing_sha = resp.json().get("sha")
    
    # Create/update file - use same commit message as web CIPilot
    data = {
        "message": "ci: add GitHub Actions workflow (migrated by CIPilot)",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": branch
    }
    if existing_sha:
        data["sha"] = existing_sha
    
    # Retry the PUT a few times — fork/branch can be in transient state right after creation
    for attempt in range(4):
        resp = requests.put(url, headers=headers, json=data, timeout=30)
        if resp.status_code in (200, 201):
            return True, None
        if resp.status_code == 404 and attempt < 3:
            print(f"[PR] File create 404 (attempt {attempt+1}/4), retrying in 5s...")
            time.sleep(5)
            continue
        break

    return False, f"Failed to create file: {resp.text}"


def _build_gha_section(
    yaml_valid: bool,
    lint_valid: bool,
    lint_errors: List[str],
    gha_status: str,
    gha_error_type: str,
    gha_fix_attempts: int,
    gha_run_url: Optional[str],
    llm_suggestions: Optional[List[str]] = None,
) -> str:
    """Build the GitHub Actions Verification section including the validation checklist."""
    run_link = f" ([view run]({gha_run_url}))" if gha_run_url else ""

    # ── Checklist ──────────────────────────────────────────────────────────
    yaml_check = "✅ YAML syntax: valid" if yaml_valid else "❌ YAML syntax: invalid"
    lint_check = "✅ actionlint: passed" if lint_valid else "❌ actionlint: failed"
    if gha_status == "success":
        gha_check = f"✅ GHA run: passed{run_link}"
    elif gha_status == "failed":
        gha_check = f"❌ GHA run: failed (`{gha_error_type}`){run_link}"
    elif gha_status == "skipped":
        gha_check = "⏭️ GHA run: skipped (fix validation errors first)"
    else:
        gha_check = "— GHA run: not attempted"

    checklist = f"- {yaml_check}\n- {lint_check}\n- {gha_check}"

    # ── Success path ───────────────────────────────────────────────────────
    if gha_status == "success":
        return f"""
## 🚀 GitHub Actions Verification

✅ **The migrated workflow has been tested in GitHub Actions and passed successfully!**

**What CIPilot did:**
- Validated YAML syntax ✅
- Ran actionlint schema validation ✅
- Pushed to a fork and triggered a GHA run ✅ — passed{run_link}
"""

    # ── Failure / skipped path ─────────────────────────────────────────────
    if not yaml_valid:
        headline = "⚠️ **Workflow could not be fully verified — YAML syntax is invalid.**"
    elif not lint_valid:
        headline = "⚠️ **Workflow could not be fully verified — actionlint validation failed.**"
    elif gha_status == "skipped":
        headline = "⏭️ **GitHub Actions cloud verification was skipped.**"
    else:
        headline = f"⚠️ **GitHub Actions run failed** (`{gha_error_type}`){run_link}."

    # ── What CIPilot did ───────────────────────────────────────────────────
    cipilot_did: List[str] = []
    cipilot_did.append(f"Validated YAML syntax — {'✅ passed' if yaml_valid else '❌ failed'}")
    cipilot_did.append(f"Ran actionlint schema validation — {'✅ passed' if lint_valid else '❌ failed'}")
    if yaml_valid and lint_valid:
        if gha_status == "skipped":
            cipilot_did.append("Skipped cloud GHA run (fix lint errors above first)")
        elif gha_status == "failed":
            cipilot_did.append(f"Pushed to a fork and triggered a GHA run — ❌ failed{run_link}")
            if gha_fix_attempts > 0:
                cipilot_did.append(f"Attempted **{gha_fix_attempts} automated LLM fix(es)** — run still failing")

    # ── Suggestions ────────────────────────────────────────────────────────
    if llm_suggestions:
        fix_items = llm_suggestions
    else:
        fix_items = _fallback_suggestions(
            yaml_valid, lint_valid, lint_errors, gha_status, gha_error_type, gha_run_url
        )

    # ── Assemble ───────────────────────────────────────────────────────────
    lines = [
        "",
        "## ⚠️ GitHub Actions Verification",
        "",
        headline,
        "",
        "**What CIPilot did:**",
    ]
    lines += [f"- {s}" for s in cipilot_did]
    if fix_items:
        lines += ["", "**Recommended Next Steps:**"]
        lines += [f"- {s}" for s in fix_items]
    lines.append("")
    return "\n".join(lines)


def _fallback_suggestions(
    yaml_valid: bool,
    lint_valid: bool,
    lint_errors: List[str],
    gha_status: str,
    gha_error_type: str,
    gha_run_url: Optional[str],
) -> List[str]:
    """Rule-based fallback suggestions when LLM call is unavailable."""
    logs = f"[view logs]({gha_run_url})" if gha_run_url else ""

    if not yaml_valid:
        items = ["Fix the YAML syntax error in `.github/workflows/ci.yml`:"]
        items += [f"  - `{e}`" for e in lint_errors[:3]]
        return items

    if not lint_valid:
        items = ["Correct the actionlint schema errors:"]
        items += [f"  - `{e}`" for e in lint_errors[:5]]
        items.append("Re-run CIPilot or push a fix to the branch")
        return items

    if gha_status == "failed":
        if gha_error_type == "secret_error":
            return [
                "Add the missing secret(s) under **Settings → Secrets and variables → Actions**",
                "Re-run the workflow after adding the secret(s)",
            ]
        if gha_error_type == "dependency_error":
            return [
                "Verify package/module names are available on `ubuntu-22.04`",
                "Check the required language version is supported on the runner",
            ]
        if gha_error_type == "trigger_error":
            return ["Ensure `workflow_dispatch:` is present in the `on:` block"]
        if gha_error_type == "build_error":
            return [
                "This is likely a pre-existing build/test failure in the repository",
                "Fix the underlying build issue — the migration itself is likely correct",
            ]
        if gha_error_type == "timeout_error":
            return ["Add `timeout-minutes:` to long-running steps to prevent runner timeouts"]
        if logs:
            return [f"Review the run logs to diagnose the failure: {logs}"]

    return []


def build_pr_body(
    source_ci: str,
    branch_name: str,
    yaml_valid: bool = True,
    lint_valid: bool = True,
    lint_errors: Optional[List[str]] = None,
    gha_status: str = "none",
    gha_error_type: str = "none",
    gha_fix_attempts: int = 0,
    gha_run_url: Optional[str] = None,
    llm_suggestions: Optional[List[str]] = None,
) -> str:
    """Build the full PR body with a dynamic GHA verification + validation section."""
    ci_name = source_ci.replace("-", " ").title()
    lint_errors = lint_errors or []

    gha_section = _build_gha_section(
        yaml_valid, lint_valid, lint_errors,
        gha_status, gha_error_type, gha_fix_attempts, gha_run_url,
        llm_suggestions=llm_suggestions,
    )

    return f"""## Summary

This pull request migrates the existing CI/CD configuration to GitHub Actions.

**Source CI:** {ci_name}
{gha_section}
## Changes

- Added `.github/workflows/ci.yml` with the migrated workflow configuration
- The new workflow preserves the original pipeline's functionality while leveraging GitHub Actions' native integration with GitHub

## About This Migration

This migration was generated using [CIPilot](https://cipilot.com), an **experimental research tool** developed as part of academic research into automated CI/CD migration.

**How it works:** CIPilot uses an agentic AI system powered by Large Language Models (LLMs) to analyze your existing CI/CD configuration and convert it to an equivalent GitHub Actions workflow. The AI agents iteratively refine the output through automated syntax and schema validation, using feedback loops to improve accuracy.

> **Note:** This tool is currently experimental and part of ongoing research. While we strive for accuracy, please review the generated workflow carefully before merging.

## Before You Merge

- Verify that environment variables and secrets are correctly referenced
- Test the workflow in a feature branch before merging
- Adjust any project-specific settings as needed

Learn more about this research project at [cipilot.com](https://cipilot.com).

---

*Generated by [CIPilot](https://cipilot.com) — Experimental Agentic AI for CI/CD migration*"""


def _create_pr(
    repo: RepoInput,
    fork_owner: str,
    username: str,
    branch_name: str,
    source_ci: str,
    headers: dict,
    yaml_valid: bool = True,
    lint_valid: bool = True,
    lint_errors: Optional[List[str]] = None,
) -> Tuple[Optional[str], Optional[int], Optional[str]]:
    """Create PR from fork to original. Returns (pr_url, pr_number, error)"""
    url = f"https://api.github.com/repos/{repo.full_name}/pulls"
    ci_name = source_ci.replace("-", " ").title()

    data = {
        "title": f"[CIPilot] Migrate {ci_name} to GitHub Actions",
        "body": build_pr_body(
            source_ci=source_ci,
            branch_name=branch_name,
            yaml_valid=yaml_valid,
            lint_valid=lint_valid,
            lint_errors=lint_errors,
        ),
        "head": f"{fork_owner}:{branch_name}",
        "base": repo.target_branch,
    }

    resp = requests.post(url, headers=headers, json=data, timeout=30)

    if resp.status_code in (200, 201):
        pr_data = resp.json()
        return pr_data.get("html_url"), pr_data.get("number"), None

    if resp.status_code == 422 and "already exists" in resp.text.lower():
        return None, None, "PR already exists for this branch"

    return None, None, f"Failed to create PR: {resp.text}"


# ============================================================================
# NEW FUNCTIONS FOR GHA VERIFICATION FLOW
# ============================================================================

def push_to_fork(
    repo: RepoInput,
    migrated_yaml: str,
    source_ci: str,
    github_pat: str,
    branch_prefix: str = "cipilot/migrated",
    workflow_path: str = ".github/workflows/ci.yml",
    retries: int = 3,
    retry_delay: int = 5,
) -> PushToForkResult:
    """
    Push workflow to fork WITHOUT creating PR.
    Used when cloud_gha_verify is enabled to test workflow before PR.
    
    Args:
        repo: Repository input
        migrated_yaml: Migrated workflow YAML content
        source_ci: Source CI type (for branch naming)
        github_pat: GitHub Personal Access Token
        branch_prefix: Prefix for branch name
        workflow_path: Path for workflow file
        retries: Number of retry attempts
        retry_delay: Delay between retries
        
    Returns:
        PushToForkResult with fork details
    """
    result = PushToForkResult(workflow_path=workflow_path)
    
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    # Get authenticated user
    user_resp = requests.get("https://api.github.com/user", headers=headers, timeout=30)
    if user_resp.status_code != 200:
        result.error = f"Failed to get authenticated user: {user_resp.text}"
        return result
    
    username = user_resp.json().get("login")
    
    for attempt in range(retries):
        try:
            # Step 1: Fork the repository
            fork_owner, fork_error = _ensure_fork(repo, username, headers)
            if not fork_owner:
                result.error = fork_error
                return result
            
            result.fork_owner = fork_owner
            result.fork_url = f"https://github.com/{fork_owner}/{repo.name}"
            
            # Step 2: Get default branch SHA
            branch_sha, branch_error = _get_branch_sha(repo, fork_owner, repo.target_branch, headers)
            if not branch_sha:
                result.error = branch_error
                return result
            
            result.branch_sha = branch_sha
            
            # Step 3: Create new branch
            timestamp = int(time.time() * 1000)
            branch_name = f"{branch_prefix}-{source_ci}-to-gha-{timestamp}"
            result.branch_name = branch_name
            
            branch_created, branch_err = _create_branch(
                fork_owner, repo.name, branch_name, branch_sha, headers
            )
            if not branch_created:
                result.error = branch_err
                return result
            
            # Step 4: Create/update workflow file
            file_created, file_err = _create_or_update_file(
                fork_owner, repo.name, branch_name, workflow_path, migrated_yaml, headers
            )
            if not file_created:
                result.error = file_err
                return result
            
            result.success = True
            return result
            
        except Exception as e:
            result.error = str(e)
            if attempt < retries - 1:
                time.sleep(retry_delay)
                continue
    
    return result


def create_pr_only(
    repo: RepoInput,
    fork_owner: str,
    branch_name: str,
    source_ci: str,
    github_pat: str,
    # validation state
    yaml_valid: bool = True,
    lint_valid: bool = True,
    lint_errors: Optional[List[str]] = None,
    # GHA state
    gha_status: str = "none",
    gha_error_type: str = "none",
    gha_fix_attempts: int = 0,
    gha_run_url: Optional[str] = None,
    llm_suggestions: Optional[List[str]] = None,
) -> PullRequestResult:
    """Create PR from already-pushed fork branch (used after GHA verification)."""
    result = PullRequestResult()
    result.fork_url = f"https://github.com/{fork_owner}/{repo.name}"
    result.branch_name = branch_name

    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }

    user_resp = requests.get("https://api.github.com/user", headers=headers, timeout=30)
    if user_resp.status_code != 200:
        result.status = StageStatus.FAILED
        result.error = f"Failed to get authenticated user: {user_resp.text}"
        return result

    username = user_resp.json().get("login")
    ci_name = source_ci.replace("-", " ").title()

    try:
        body = build_pr_body(
            source_ci=source_ci,
            branch_name=branch_name,
            yaml_valid=yaml_valid,
            lint_valid=lint_valid,
            lint_errors=lint_errors,
            gha_status=gha_status,
            gha_error_type=gha_error_type,
            gha_fix_attempts=gha_fix_attempts,
            gha_run_url=gha_run_url,
            llm_suggestions=llm_suggestions,
        )
        data = {
            "title": f"[CIPilot] Migrate {ci_name} to GitHub Actions",
            "body": body,
            "head": f"{fork_owner}:{branch_name}",
            "base": repo.target_branch,
        }
        url = f"https://api.github.com/repos/{repo.full_name}/pulls"
        resp = requests.post(url, headers=headers, json=data, timeout=30)

        if resp.status_code in (200, 201):
            pr_data = resp.json()
            result.status = StageStatus.SUCCESS
            result.pr_url = pr_data.get("html_url")
            result.pr_number = pr_data.get("number")
            return result

        if resp.status_code == 422 and "already exists" in resp.text.lower():
            result.status = StageStatus.FAILED
            result.error = "PR already exists for this branch"
            return result

        result.status = StageStatus.FAILED
        result.error = f"Failed to create PR: {resp.text}"
        return result

    except Exception as e:
        result.status = StageStatus.FAILED
        result.error = str(e)
        return result


async def update_fork_file(
    fork_owner: str,
    repo_name: str,
    branch_name: str,
    file_path: str,
    content: str,
    commit_message: str,
    github_pat: str,
) -> Tuple[bool, Optional[str]]:
    """
    Update a file in the fork (for GHA fix retries).
    
    Args:
        fork_owner: Owner of the fork
        repo_name: Repository name
        branch_name: Branch to update
        file_path: Path to file
        content: New file content
        commit_message: Commit message
        github_pat: GitHub PAT
        
    Returns:
        Tuple of (success, error_message)
    """
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/contents/{file_path}"
    
    try:
        # Get existing file SHA
        loop = asyncio.get_event_loop()
        
        def get_sha():
            resp = requests.get(url, headers=headers, params={"ref": branch_name}, timeout=30)
            if resp.status_code == 200:
                return resp.json().get("sha")
            return None
        
        existing_sha = await loop.run_in_executor(None, get_sha)
        
        if not existing_sha:
            return False, "File not found in fork - cannot update"
        
        # Update file
        def update_file():
            data = {
                "message": commit_message,
                "content": base64.b64encode(content.encode()).decode(),
                "branch": branch_name,
                "sha": existing_sha,
            }
            resp = requests.put(url, headers=headers, json=data, timeout=30)
            return resp
        
        resp = await loop.run_in_executor(None, update_file)
        
        if resp.status_code in (200, 201):
            return True, None
        
        return False, f"Failed to update file: {resp.text}"
        
    except Exception as e:
        return False, f"Error updating file: {str(e)}"


