"""
GitHub Actions Verification Stage

Verifies migrated workflows by running them in GitHub Actions on the forked repository.
Polls for completion, classifies errors, and supports LLM-based fixes for fixable errors.
"""
import re
import time
import asyncio
from datetime import datetime
from typing import Optional, Tuple, Dict, Any, List
import requests

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import GHAVerificationResult, GHAErrorType, StageStatus


# Patterns that indicate a secret/token error (not fixable by LLM)
SECRET_ERROR_PATTERNS = [
    r"secret.*not.*found",
    r"token.*not.*set",
    r"authentication.*failed",
    r"unauthorized",
    r"403.*forbidden",
    r"GITHUB_TOKEN.*invalid",
    r"npm.*ERR!.*401",
    r"npm.*ERR!.*403",
    r"docker.*login.*failed",
    r"AWS_ACCESS_KEY_ID.*not.*set",
    r"AZURE_.*not.*configured",
    r"GCP_.*credentials",
    r"secrets\..*is empty",
    r"environment variable.*not set",
    r"\$\{\{.*secrets\.",  # Reference to secrets that are missing
]

WORKFLOW_SYNTAX_PATTERNS = [
    r"yaml.*syntax.*error",
    r"invalid.*workflow.*file",
    r"unexpected.*key",
    r"mapping values are not allowed",
    r"could not find.*action",
    r"uses.*invalid",
    r"invalid.*input",
    r"required.*input.*not.*provided",
    r"input .* is not defined for action",
    r"job.*not found",
    r"permission.*denied.*actions",
    r"runner of .* action is too old",
    r"too old to run on github actions",
    r"label .* is not available",
]

DEPENDENCY_PATTERNS = [
    r"unable to locate package",
    r"has no installation candidate",
    r"modulenotfounderror",
    r"importerror.*no module named",
    r"cannot find module",
    r"error: failed to solve",
    r"version .* not found",
    r"no such file or directory.*requirements",
    r"no such file or directory.*package\.json",
    r"no such file or directory.*pom\.xml",
    r"no such file or directory.*build\.gradle",
    r"could not find.*setup\.py",
]

TRIGGER_PATTERNS = [
    r"no workflow runs found",
]

BUILD_PATTERNS = [
    r"process completed with exit code [^0]",
    r"tests? (failed|errored)",
    r"build failed",
    r"compilation (failed|error)",
    r"make.*error",
    r"error: could not compile",
]


def _match_snippet(log_content: str, pattern: str, context: int = 500) -> str:
    match = re.search(pattern, log_content, re.IGNORECASE)
    if match:
        start = max(0, match.start() - context)
        end = min(len(log_content), match.end() + context)
        return log_content[start:end]
    return log_content[-1000:] if len(log_content) > 1000 else log_content


def classify_error(log_content: str) -> Tuple[GHAErrorType, str]:
    """
    Classify a GHA failure into a specific error category for reporting.

    Priority order:
      1. SECRET_ERROR          — missing credentials (fix agent skipped)
      2. WORKFLOW_SYNTAX_ERROR — YAML/action/runner structure issues
      3. DEPENDENCY_ERROR      — package/module install failures
      4. TRIGGER_ERROR         — workflow never triggered
      5. BUILD_ERROR           — compilation/test failures
      6. UNKNOWN_ERROR         — unrecognised (fix agent still attempted)

    All non-SECRET types are forwarded to the LLM fix agent by the runner.
    """
    if not log_content:
        return GHAErrorType.UNKNOWN_ERROR, "No log content available"

    log_lower = log_content.lower()

    for pattern in SECRET_ERROR_PATTERNS:
        if re.search(pattern, log_lower, re.IGNORECASE):
            return GHAErrorType.SECRET_ERROR, _match_snippet(log_content, pattern, 200)

    for pattern in WORKFLOW_SYNTAX_PATTERNS:
        if re.search(pattern, log_lower, re.IGNORECASE):
            return GHAErrorType.WORKFLOW_SYNTAX_ERROR, _match_snippet(log_content, pattern)

    for pattern in DEPENDENCY_PATTERNS:
        if re.search(pattern, log_lower, re.IGNORECASE):
            return GHAErrorType.DEPENDENCY_ERROR, _match_snippet(log_content, pattern)

    for pattern in TRIGGER_PATTERNS:
        if re.search(pattern, log_lower, re.IGNORECASE):
            return GHAErrorType.TRIGGER_ERROR, _match_snippet(log_content, pattern)

    for pattern in BUILD_PATTERNS:
        if re.search(pattern, log_lower, re.IGNORECASE):
            return GHAErrorType.BUILD_ERROR, _match_snippet(log_content, pattern)

    snippet = log_content[-1000:] if len(log_content) > 1000 else log_content
    return GHAErrorType.UNKNOWN_ERROR, snippet


def trigger_workflow(
    fork_owner: str,
    repo_name: str,
    branch_name: str,
    workflow_file: str,
    github_pat: str,
) -> Tuple[Optional[int], Optional[str]]:
    """
    Trigger a workflow_dispatch event to run the workflow.
    
    Note: workflow_dispatch must be enabled in the workflow file.
    If not available, we rely on push-triggered workflows.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        branch_name: Branch where workflow was pushed
        workflow_file: Workflow file name (e.g., "ci.yml")
        github_pat: GitHub Personal Access Token
        
    Returns:
        Tuple of (run_id, error_message) - run_id is None on failure
    """
    headers = {
        "Authorization": f"Bearer {github_pat}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    
    # Try to trigger workflow_dispatch
    dispatch_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/workflows/{workflow_file}/dispatches"
    
    payload = {"ref": branch_name}
    
    try:
        response = requests.post(dispatch_url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 204:
            # Dispatch successful, wait a moment then get the run ID
            time.sleep(3)
            run_id, error = get_latest_run_id(fork_owner, repo_name, branch_name, github_pat)
            return run_id, error
        elif response.status_code == 404:
            # workflow_dispatch not enabled, check for existing push-triggered run
            return get_latest_run_id(fork_owner, repo_name, branch_name, github_pat)
        else:
            return None, f"Failed to trigger workflow: {response.status_code} - {response.text}"
            
    except Exception as e:
        return None, f"Error triggering workflow: {str(e)}"


def get_latest_run_id(
    fork_owner: str,
    repo_name: str,
    branch_name: str,
    github_pat: str,
    max_wait: int = 60,
    check_interval: int = 5,
) -> Tuple[Optional[int], Optional[str]]:
    """
    Get the latest workflow run ID for a branch.
    Waits and retries since GHA needs time to start runs after a push.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        branch_name: Branch to check runs for
        github_pat: GitHub Personal Access Token
        max_wait: Maximum seconds to wait for a run to appear
        check_interval: Seconds between checks
        
    Returns:
        Tuple of (run_id, error_message) - run_id is None if not found
    """
    headers = {
        "Authorization": f"Bearer {github_pat}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    
    runs_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/runs"
    params = {"branch": branch_name, "per_page": 5}
    
    start_time = time.time()
    last_error = None
    
    while time.time() - start_time < max_wait:
        try:
            response = requests.get(runs_url, headers=headers, params=params, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                runs = data.get("workflow_runs", [])
                
                if runs:
                    # Return the most recent run
                    latest_run = runs[0]
                    print(f"[GHA] Found run {latest_run['id']} (status: {latest_run['status']})")
                    return latest_run["id"], None
                else:
                    # No runs yet, wait and retry
                    elapsed = int(time.time() - start_time)
                    print(f"[GHA] No runs found yet, waiting... ({elapsed}s/{max_wait}s)")
                    time.sleep(check_interval)
            else:
                last_error = f"Failed to fetch runs: {response.status_code} - {response.text}"
                time.sleep(check_interval)
                
        except Exception as e:
            last_error = f"Error fetching runs: {str(e)}"
            time.sleep(check_interval)
    
    return None, last_error or f"No workflow runs found after waiting {max_wait}s"


def poll_run_status(
    fork_owner: str,
    repo_name: str,
    run_id: int,
    github_pat: str,
    timeout_seconds: int = 600,
    poll_interval: int = 30,
) -> Tuple[str, str, Optional[str]]:
    """
    Poll the workflow run until it completes or times out.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        run_id: Workflow run ID to poll
        github_pat: GitHub Personal Access Token
        timeout_seconds: Max seconds to wait for completion
        poll_interval: Seconds between polls
        
    Returns:
        Tuple of (status, conclusion, error_message)
        - status: queued, in_progress, completed
        - conclusion: success, failure, cancelled, skipped, timed_out, action_required, stale, null
        - error_message: None on success
    """
    headers = {
        "Authorization": f"Bearer {github_pat}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    
    run_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/runs/{run_id}"
    
    start_time = time.time()
    
    while True:
        elapsed = time.time() - start_time
        
        if elapsed >= timeout_seconds:
            return "completed", "timed_out", f"Workflow timed out after {timeout_seconds}s"
        
        try:
            response = requests.get(run_url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status", "unknown")
                conclusion = data.get("conclusion")
                
                if status == "completed":
                    return status, conclusion or "unknown", None
                
                # Still running, wait and poll again
                time.sleep(poll_interval)
                
            else:
                return "error", "error", f"Failed to poll run: {response.status_code}"
                
        except Exception as e:
            return "error", "error", f"Error polling run: {str(e)}"


def fetch_run_logs(
    fork_owner: str,
    repo_name: str,
    run_id: int,
    github_pat: str,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Fetch logs from a workflow run.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        run_id: Workflow run ID
        github_pat: GitHub Personal Access Token
        
    Returns:
        Tuple of (log_content, error_message) - log_content is None on failure
    """
    headers = {
        "Authorization": f"Bearer {github_pat}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    
    # First, get the jobs for this run
    jobs_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/runs/{run_id}/jobs"
    
    try:
        response = requests.get(jobs_url, headers=headers, timeout=30)
        
        if response.status_code != 200:
            return None, f"Failed to fetch jobs: {response.status_code}"
        
        jobs_data = response.json()
        jobs = jobs_data.get("jobs", [])
        
        # Collect logs from failed jobs
        all_logs = []
        
        for job in jobs:
            if job.get("conclusion") == "failure":
                job_id = job["id"]
                job_name = job.get("name", "unknown")
                
                # Fetch logs for this job
                logs_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/jobs/{job_id}/logs"
                logs_response = requests.get(logs_url, headers=headers, timeout=60)
                
                if logs_response.status_code == 200:
                    all_logs.append(f"\n=== Job: {job_name} ===\n{logs_response.text}")
                else:
                    all_logs.append(f"\n=== Job: {job_name} ===\n(Could not fetch logs: {logs_response.status_code})")
        
        if not all_logs:
            # No failed jobs, get general run logs
            logs_url = f"https://api.github.com/repos/{fork_owner}/{repo_name}/actions/runs/{run_id}/logs"
            response = requests.get(logs_url, headers=headers, timeout=60)
            
            if response.status_code == 200:
                return response.text, None
            else:
                return None, f"Failed to fetch logs: {response.status_code}"
        
        return "\n".join(all_logs), None
        
    except Exception as e:
        return None, f"Error fetching logs: {str(e)}"


async def verify_gha_run(
    fork_owner: str,
    repo_name: str,
    branch_name: str,
    workflow_file: str,
    github_pat: str,
    timeout_seconds: int = 600,
    poll_interval: int = 30,
) -> GHAVerificationResult:
    """
    Main entry point for GHA verification.
    
    Triggers or finds the workflow run, polls for completion, and classifies any errors.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        branch_name: Branch where workflow was pushed
        workflow_file: Workflow file name
        github_pat: GitHub Personal Access Token
        timeout_seconds: Max seconds to wait
        poll_interval: Seconds between polls
        
    Returns:
        GHAVerificationResult with status, error type, and logs
    """
    result = GHAVerificationResult(status=StageStatus.RUNNING)
    
    try:
        # Wait for the push-triggered workflow run (GHA needs time after push)
        print(f"[GHA] Looking for workflow run on {fork_owner}/{repo_name} branch {branch_name}...")
        run_id, error = get_latest_run_id(
            fork_owner, repo_name, branch_name, github_pat,
            max_wait=60,  # Wait up to 60s for run to appear
            check_interval=5,
        )
        
        if not run_id:
            result.status = StageStatus.FAILED
            result.error = error or "Could not find workflow run after push"
            result.error_type = GHAErrorType.UNKNOWN_ERROR
            return result
        
        result.run_id = run_id
        result.run_url = f"https://github.com/{fork_owner}/{repo_name}/actions/runs/{run_id}"
        
        # Poll for completion (run in executor to not block)
        loop = asyncio.get_event_loop()
        status, conclusion, poll_error = await loop.run_in_executor(
            None,
            lambda: poll_run_status(
                fork_owner, repo_name, run_id, github_pat,
                timeout_seconds, poll_interval
            )
        )
        
        result.run_conclusion = conclusion
        
        if poll_error:
            result.status = StageStatus.FAILED
            result.error = poll_error
            if conclusion == "timed_out":
                result.error_type = GHAErrorType.TIMEOUT_ERROR
            else:
                result.error_type = GHAErrorType.UNKNOWN_ERROR
            return result
        
        # Check conclusion
        if conclusion == "success":
            result.status = StageStatus.SUCCESS
            result.error_type = GHAErrorType.NONE
            return result
        
        # Workflow failed - fetch logs and classify error
        log_content, log_error = await loop.run_in_executor(
            None,
            lambda: fetch_run_logs(fork_owner, repo_name, run_id, github_pat)
        )
        
        if log_content:
            result.error_type, result.error_logs = classify_error(log_content)
        else:
            result.error_type = GHAErrorType.UNKNOWN_ERROR
            result.error_logs = log_error or "Could not fetch logs"
        
        result.status = StageStatus.FAILED
        result.error = f"Workflow failed with conclusion: {conclusion}"
        
        return result
        
    except Exception as e:
        result.status = StageStatus.FAILED
        result.error = str(e)
        result.error_type = GHAErrorType.UNKNOWN_ERROR
        return result


def get_workflow_file_from_path(target_path: str) -> str:
    """
    Extract workflow filename from target path.
    
    Args:
        target_path: Path like ".github/workflows/ci.yml"
        
    Returns:
        Workflow filename like "ci.yml"
    """
    return Path(target_path).name
