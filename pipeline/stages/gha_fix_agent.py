"""
GHA Fix Agent - LLM-based workflow error fixing

Uses LLM to analyze GHA workflow errors and generate fixes.
"""
import re
import subprocess
import tempfile
import os
from typing import Optional, Tuple, List

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import PipelineConfig


FIX_SYSTEM_PROMPT = """You are an expert at fixing GitHub Actions workflow files for any language or ecosystem \
(Python, Node.js, Java, Go, C#/.NET, Ruby, Rust, C/C++, Swift, and others).
Given a workflow YAML and actionlint/GHA run error logs, produce a corrected workflow.

Current correct action versions — use EXACTLY these (as of 2025):
  Core:     actions/checkout@v4, actions/cache@v4, actions/upload-artifact@v4,
            actions/download-artifact@v4, actions/github-script@v7
  Language: actions/setup-python@v5  (NOT @v4 — actionlint flags v4 as too old),
            actions/setup-node@v4, actions/setup-java@v4, actions/setup-go@v5,
            actions/setup-dotnet@v4, ruby/setup-ruby@v1, dtolnay/rust-toolchain@stable
  Docker:   docker/setup-buildx-action@v3, docker/login-action@v3, docker/build-push-action@v6
  Cloud:    aws-actions/configure-aws-credentials@v4, azure/login@v2, google-github-actions/auth@v2
  For any action NOT listed above, use the highest available version tag.

Deprecated runner labels — always replace:
  ubuntu-16.04 → ubuntu-22.04,  ubuntu-18.04 → ubuntu-22.04,  ubuntu-20.04 → ubuntu-22.04
  macos-11 → macos-14,  macos-12 → macos-14
  windows-2016 → windows-2022,  windows-2019 → windows-2022

EOL runtime versions not available on ubuntu-22.04 — replace with minimum supported:
  Python: 2.6/2.7 → 3.9,  3.3/3.4/3.5 → 3.8,  3.6+ keep as-is
  Node.js: < 12 → 18,  12/14 → 18,  16+ keep as-is
  Ruby: < 2.5 → 3.2,  2.5+ keep as-is
  Go: < 1.13 → 1.21,  1.13+ keep as-is
  When replacing in a matrix, deduplicate entries.

Trigger issues — if workflow has branch filters blocking runs:
  Add 'workflow_dispatch:' to the 'on:' block.
  Remove 'branches:' filters from push/pull_request so it triggers on all branches.

Shell script permission errors ('Permission denied' or 'not found'):
  Replace: run: ./script.sh
  With:    run: chmod +x script.sh && ./script.sh
  Or:      run: bash script.sh

Common actionlint error → fix:
  "too old to run on GitHub Actions"   → upgrade to the version listed above
  "label X is not available"           → replace with a current runner label from above
  "unexpected key"                     → remove the invalid YAML key
  "input X is not defined for action"  → remove or replace the unknown input parameter
  YAML syntax / indentation errors     → fix indentation or quoting

Rules:
1. Fix ONLY what the error logs indicate — do not rewrite unrelated parts of the file
2. Preserve all job logic, steps, environment variables, and secrets references
3. Output ONLY raw YAML — no markdown fences, no explanations, no comments"""


FIX_USER_PROMPT = """The following GitHub Actions workflow failed with this error:

### Error Logs:
```
{error_logs}
```

### Original Workflow YAML:
```yaml
{workflow_yaml}
```

Please provide the corrected workflow YAML that fixes this error."""


def _actionlint_check(yaml_content: str) -> Tuple[bool, list]:
    """Run actionlint on yaml_content; return (passed, error_lines)."""
    try:
        subprocess.run(["actionlint", "--version"], capture_output=True, check=True, timeout=10)
    except Exception:
        return True, []  # actionlint not available — skip check

    config_path = Path(__file__).parent.parent / ".actionlint.yaml"
    cmd = ["actionlint", "-shellcheck", ""]
    if config_path.exists():
        cmd += ["-config-file", str(config_path)]

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
        f.write(yaml_content)
        tmp = f.name
    try:
        proc = subprocess.run(cmd + [tmp], capture_output=True, text=True, timeout=30)
        errors = [
            line.replace(tmp, "workflow.yml")
            for line in (proc.stdout + proc.stderr).strip().splitlines()
            if line.strip()
        ]
        return proc.returncode == 0, errors
    except Exception:
        return True, []  # on error, don't block the fix
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass


def fix_workflow_from_error(
    workflow_yaml: str,
    error_logs: str,
    config: PipelineConfig,
    retries: int = 3,
    retry_delay: float = 2.0,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Use LLM to fix a workflow based on error logs.
    
    Args:
        workflow_yaml: The original workflow YAML that failed
        error_logs: Relevant portion of error logs from GHA run
        config: Pipeline configuration with LLM settings
        retries: Number of retry attempts
        retry_delay: Delay between retries in seconds
        
    Returns:
        Tuple of (fixed_yaml, error_message) - fixed_yaml is None on failure
    """
    import time
    from openai import OpenAI
    
    # Longer timeout for reasoning models (they need more time to think)
    api_timeout = 300.0  # 5 minutes
    
    # Initialize LLM client based on provider
    if config.llm_provider == "openai":
        client = OpenAI(api_key=config.llm_api_key, timeout=api_timeout)
    elif config.llm_provider == "azure":
        from openai import AzureOpenAI
        client = AzureOpenAI(
            api_key=config.llm_api_key,
            api_version="2024-02-01",
            azure_endpoint=config.llm_base_url,
            timeout=api_timeout,
        )
    elif config.llm_provider == "xai":
        client = OpenAI(
            api_key=config.llm_api_key,
            base_url="https://api.x.ai/v1",
            timeout=api_timeout,
        )
    else:
        # Generic OpenAI-compatible provider
        client = OpenAI(
            api_key=config.llm_api_key,
            base_url=config.llm_base_url,
            timeout=api_timeout,
        )
    
    print(f"[GHA Repair Agent] Using {config.llm_provider}/{config.llm_model}")
    
    # Take the LAST 4000 chars — errors appear at the end of GHA logs, not the start
    log_tail = error_logs[-4000:] if len(error_logs) > 4000 else error_logs
    user_prompt = FIX_USER_PROMPT.format(
        error_logs=log_tail,
        workflow_yaml=workflow_yaml,
    )
    
    last_error = None
    
    for attempt in range(retries):
        try:
            print(f"[GHA Repair Agent] Generating fix (attempt {attempt + 1}/{retries})...")
            # Use temperature=1 for gpt-5.5, otherwise use 0.1
            temp = 1 if config.llm_model and config.llm_model.startswith("gpt-5.5") else 0.1
            # Use correct tokens parameter for gpt-5.5
            llm_args = dict(
                model=config.llm_model,
                messages=[
                    {"role": "system", "content": FIX_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temp,
            )
            if config.llm_model and config.llm_model.startswith("gpt-5.5"):
                llm_args["max_completion_tokens"] = 4096
            else:
                llm_args["max_tokens"] = 4096
            response = client.chat.completions.create(**llm_args)
            
            fixed_yaml = response.choices[0].message.content
            print(f"[GHA Repair Agent] ✓ Received fix ({len(fixed_yaml) if fixed_yaml else 0} chars)")
            
            if not fixed_yaml:
                last_error = "LLM returned empty response"
                continue
            
            # Clean up the response
            fixed_yaml = clean_yaml_response(fixed_yaml)

            # Basic structural check
            if not validate_yaml_basic(fixed_yaml):
                last_error = "LLM response is not valid YAML"
                continue

            # Actionlint pre-check — reject fixes that introduce new lint errors
            lint_ok, lint_errors = _actionlint_check(fixed_yaml)
            if not lint_ok:
                lint_summary = "; ".join(lint_errors[:3])
                print(f"[GHA Repair Agent] ✗ Fix failed actionlint: {lint_summary}")
                last_error = f"Fix introduced lint errors: {lint_summary}"
                # Feed lint errors back into the next attempt's prompt
                user_prompt = FIX_USER_PROMPT.format(
                    error_logs=f"Previous fix attempt introduced these actionlint errors:\n{chr(10).join(lint_errors)}\n\nOriginal GHA error:\n{log_tail}",
                    workflow_yaml=fixed_yaml,
                )
                continue

            return fixed_yaml, None
            
        except Exception as e:
            last_error = str(e)
            if attempt < retries - 1:
                time.sleep(retry_delay)
    
    return None, f"Failed to fix workflow after {retries} attempts: {last_error}"


SUGGESTIONS_SYSTEM_PROMPT = """You are a CI/CD expert reviewing a failed GitHub Actions workflow run.
Given the error logs and the workflow YAML, produce 3-5 specific, actionable bullet points the developer must act on to make the workflow pass.

Rules:
- Read the error logs carefully — every bullet must name the exact error, file, package, version, or step that failed
- Never say "check the logs", "review the error", or "investigate" — be direct about the fix
- When a package/dependency fails: name the exact package and the fix (pin version, add apt install, use different image)
- When an action fails: name the exact action and the correct version or input
- When a build step fails: name the exact command and what needs changing
- When secrets are missing: name the exact secret key(s) to add
- Each bullet is one short sentence — no paragraphs
- Output ONLY the bullet points, each starting with "- "
- No introduction, no explanation, no markdown headers"""

SUGGESTIONS_USER_PROMPT = """Error type: {error_type}
Automated fix attempts by CIPilot: {fix_attempts}

Error logs (last portion of GHA run):
```
{error_logs}
```

Workflow YAML:
```yaml
{workflow_yaml}
```

Produce 3-5 specific bullet points the developer must act on to fix this failure."""


def generate_pr_suggestions(
    error_logs: str,
    workflow_yaml: str,
    error_type: str,
    fix_attempts: int,
    config: "PipelineConfig",
) -> Tuple[List[str], Optional[str]]:
    """
    Call LLM to generate specific, actionable PR suggestions based on actual error logs.
    Returns (suggestions, error_message). suggestions is empty list on failure.
    Retries once after a delay to handle transient rate-limit errors.
    """
    import time
    from openai import OpenAI

    # Reasoning models (gpt-5.5, o-series) need more time
    suggestion_timeout = 120.0 if config.llm_model and (
        config.llm_model.startswith("gpt-5.5") or config.llm_model.startswith("o")
    ) else 60.0

    if config.llm_provider == "openai":
        client = OpenAI(api_key=config.llm_api_key, timeout=suggestion_timeout)
    elif config.llm_provider == "azure":
        from openai import AzureOpenAI
        client = AzureOpenAI(
            api_key=config.llm_api_key,
            api_version="2024-02-01",
            azure_endpoint=config.llm_base_url,
            timeout=suggestion_timeout,
        )
    elif config.llm_provider == "xai":
        client = OpenAI(api_key=config.llm_api_key, base_url="https://api.x.ai/v1", timeout=suggestion_timeout)
    else:
        client = OpenAI(api_key=config.llm_api_key, base_url=config.llm_base_url, timeout=suggestion_timeout)

    log_tail = error_logs[-3000:] if len(error_logs) > 3000 else error_logs
    yaml_snippet = workflow_yaml[:2000] if len(workflow_yaml) > 2000 else workflow_yaml

    user_prompt = SUGGESTIONS_USER_PROMPT.format(
        error_type=error_type,
        fix_attempts=fix_attempts,
        error_logs=log_tail,
        workflow_yaml=yaml_snippet,
    )

    llm_args = dict(
        model=config.llm_model,
        messages=[
            {"role": "system", "content": SUGGESTIONS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=500,
        temperature=0.1,
    )
    if config.llm_model and config.llm_model.startswith("gpt-5.5"):
        llm_args.pop("max_tokens")
        llm_args["max_completion_tokens"] = 500
        llm_args["temperature"] = 1

    last_error: Optional[str] = None
    for attempt in range(2):
        try:
            response = client.chat.completions.create(**llm_args)
            raw = (response.choices[0].message.content or "").strip()
            suggestions = []
            for line in raw.splitlines():
                line = line.strip().lstrip("- ").strip()
                if line:
                    suggestions.append(line)
            return suggestions[:5], None
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            print(f"[PR Suggestions] Attempt {attempt + 1}/2 failed: {last_error}")
            if attempt == 0:
                time.sleep(8)  # wait before retry — rate limit window reset

    return [], last_error


def clean_yaml_response(response: str) -> str:
    """
    Clean up LLM response to extract pure YAML.
    
    Args:
        response: Raw LLM response
        
    Returns:
        Cleaned YAML content
    """
    # Remove markdown code blocks if present
    response = response.strip()
    
    # Remove ```yaml ... ``` blocks
    if response.startswith("```"):
        lines = response.split("\n")
        # Find start and end of code block
        start_idx = 0
        end_idx = len(lines)
        
        for i, line in enumerate(lines):
            if line.startswith("```") and i == 0:
                start_idx = 1
            elif line.startswith("```") and i > 0:
                end_idx = i
                break
        
        response = "\n".join(lines[start_idx:end_idx])
    
    return response.strip()


def validate_yaml_basic(yaml_content: str) -> bool:
    """
    Basic YAML validation without full parsing.
    
    Args:
        yaml_content: YAML content to validate
        
    Returns:
        True if content looks like valid YAML
    """
    if not yaml_content:
        return False
    
    # Must have some content
    if len(yaml_content.strip()) < 10:
        return False
    
    # Should have at least one key-value pattern
    if not re.search(r"^\s*[\w-]+:", yaml_content, re.MULTILINE):
        return False
    
    # For GHA workflows, should have 'on:' or 'name:'
    if not re.search(r"^\s*(on|name|jobs):", yaml_content, re.MULTILINE):
        return False
    
    return True


async def fix_and_push_workflow(
    fork_owner: str,
    repo_name: str,
    branch_name: str,
    workflow_path: str,
    current_yaml: str,
    error_logs: str,
    github_pat: str,
    config: PipelineConfig,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Fix a workflow and push the update to the fork.
    
    Args:
        fork_owner: Owner of the forked repository
        repo_name: Repository name
        branch_name: Branch to update
        workflow_path: Path to workflow file (e.g., ".github/workflows/ci.yml")
        current_yaml: Current workflow YAML content
        error_logs: Error logs from failed run
        github_pat: GitHub PAT
        config: Pipeline configuration
        
    Returns:
        Tuple of (fixed_yaml, error_message) - fixed_yaml is None on failure
    """
    # First, get the fix from LLM
    fixed_yaml, fix_error = fix_workflow_from_error(
        workflow_yaml=current_yaml,
        error_logs=error_logs,
        config=config,
        retries=config.max_retries,
        retry_delay=config.retry_delay_seconds,
    )
    
    if not fixed_yaml:
        return None, fix_error
    
    # If no changes, return original
    if fixed_yaml.strip() == current_yaml.strip():
        return None, "LLM fix resulted in no changes"
    
    # Import update_fork_file from pull_request module
    from stages.pull_request import update_fork_file
    
    # Push the fix to the fork
    success, push_error = await update_fork_file(
        fork_owner=fork_owner,
        repo_name=repo_name,
        branch_name=branch_name,
        file_path=workflow_path,
        content=fixed_yaml,
        commit_message="fix: Auto-fix workflow based on GHA error",
        github_pat=github_pat,
    )
    
    if not success:
        return None, push_error
    
    return fixed_yaml, None
