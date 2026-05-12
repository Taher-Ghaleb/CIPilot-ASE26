"""
CI Detection Stage - Detect CI/CD configurations in a repository
"""
import requests
from typing import Optional, Tuple, List, Dict
import base64

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import RepoInput, DetectionResult, DetectedConfig, StageStatus
from config import CI_DETECTION_PATTERNS


def get_default_branch(repo: RepoInput, github_pat: str) -> Optional[str]:
    """Get the actual default branch from GitHub API"""
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    try:
        resp = requests.get(f"https://api.github.com/repos/{repo.full_name}", headers=headers, timeout=30)
        if resp.status_code == 200:
            return resp.json().get("default_branch")
    except:
        pass
    return None


def detect_ci(
    repo: RepoInput,
    github_pat: str,
    retries: int = 3,
    retry_delay: int = 5
) -> DetectionResult:
    """
    Detect ALL CI/CD configurations in a GitHub repository.
    
    Returns DetectionResult with ALL detected CI configs and their YAML content.
    Each detected CI will be migrated separately with its own PR.
    """
    result = DetectionResult()
    
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    detected_configs: List[DetectedConfig] = []
    seen_ci_types: set = set()  # Track which CI types we've already found
    
    for attempt in range(retries):
        try:
            # Check each CI pattern
            for ci_type, patterns in CI_DETECTION_PATTERNS.items():
                # Skip GitHub Actions - we're migrating TO it
                if ci_type == "github-actions":
                    continue

                # Skip if we already found this CI type
                if ci_type in seen_ci_types:
                    continue

                for pattern in patterns:
                    try:
                        if pattern.endswith("/"):
                            # It's a directory, list contents
                            dir_path = pattern.rstrip("/")
                            url = f"https://api.github.com/repos/{repo.full_name}/contents/{dir_path}"
                            resp = requests.get(url, headers=headers, timeout=30)

                            # Fail fast on auth / rate-limit errors — don't silently skip
                            if resp.status_code == 401:
                                result.status = StageStatus.FAILED
                                result.error = "GitHub PAT is invalid or expired (401 Unauthorized). Please regenerate your PAT."
                                return result
                            if resp.status_code in (403, 429):
                                import time
                                reset = int(resp.headers.get("X-RateLimit-Reset", 0))
                                remaining = resp.headers.get("X-RateLimit-Remaining", "?")
                                if remaining == "0" or resp.status_code == 429:
                                    result.status = StageStatus.FAILED
                                    result.error = f"GitHub API rate limit exceeded (PAT exhausted). Resets at timestamp {reset}."
                                    return result
                                result.status = StageStatus.FAILED
                                result.error = f"GitHub API returned 403 Forbidden for {repo.full_name}."
                                return result

                            if resp.status_code == 200:
                                files = resp.json()
                                for f in files:
                                    if f.get("name", "").endswith((".yml", ".yaml")):
                                        # Found a YAML file in the directory
                                        file_url = f.get("download_url")
                                        if file_url:
                                            file_resp = requests.get(file_url, headers=headers, timeout=30)
                                            if file_resp.status_code == 200:
                                                detected_configs.append(DetectedConfig(
                                                    ci_type=ci_type,
                                                    source_yaml=file_resp.text,
                                                    source_path=f"{dir_path}/{f.get('name')}"
                                                ))
                                                seen_ci_types.add(ci_type)
                                                break  # Found config for this CI type, move to next CI
                        else:
                            # It's a file
                            url = f"https://api.github.com/repos/{repo.full_name}/contents/{pattern}"
                            resp = requests.get(url, headers=headers, timeout=30)

                            # Fail fast on auth / rate-limit errors
                            if resp.status_code == 401:
                                result.status = StageStatus.FAILED
                                result.error = "GitHub PAT is invalid or expired (401 Unauthorized). Please regenerate your PAT."
                                return result
                            if resp.status_code in (403, 429):
                                import time
                                remaining = resp.headers.get("X-RateLimit-Remaining", "?")
                                reset = int(resp.headers.get("X-RateLimit-Reset", 0))
                                if remaining == "0" or resp.status_code == 429:
                                    result.status = StageStatus.FAILED
                                    result.error = f"GitHub API rate limit exceeded (PAT exhausted). Resets at timestamp {reset}."
                                    return result
                                result.status = StageStatus.FAILED
                                result.error = f"GitHub API returned 403 Forbidden for {repo.full_name}."
                                return result

                            if resp.status_code == 200:
                                content_data = resp.json()
                                content_b64 = content_data.get("content", "")
                                if content_b64:
                                    content = base64.b64decode(content_b64).decode("utf-8")
                                    detected_configs.append(DetectedConfig(
                                        ci_type=ci_type,
                                        source_yaml=content,
                                        source_path=pattern
                                    ))
                                    seen_ci_types.add(ci_type)
                                    break  # Found config for this CI type, move to next CI

                    except Exception as e:
                        # Individual file check failed, continue to next pattern
                        continue

            # If we found something, return success
            if detected_configs:
                result.status = StageStatus.SUCCESS
                result.detected_configs = detected_configs
                return result

            # No CI found
            result.status = StageStatus.SUCCESS  # Detection succeeded, just nothing found
            result.error = "No CI configuration found"
            return result

        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                import time
                time.sleep(retry_delay)
                continue
            result.status = StageStatus.FAILED
            result.error = f"GitHub API error after {retries} attempts: {str(e)}"
            return result
        except Exception as e:
            result.status = StageStatus.FAILED
            result.error = f"Detection error: {str(e)}"
            return result
    
    return result


def check_rate_limit(github_pat: str) -> Tuple[int, int]:
    """
    Check GitHub API rate limit.
    Returns (remaining, reset_timestamp)
    """
    headers = {
        "Authorization": f"token {github_pat}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    try:
        resp = requests.get("https://api.github.com/rate_limit", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            core = data.get("resources", {}).get("core", {})
            return core.get("remaining", 0), core.get("reset", 0)
    except:
        pass
    
    return 0, 0
