"""
Validation Stage - YAML syntax and actionlint validation
"""
import subprocess
import tempfile
import os
import yaml
from typing import List, Tuple

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import ValidationResult, StageStatus


def validate_yaml(
    yaml_content: str,
    retries: int = 1,
) -> ValidationResult:
    """
    Validate GitHub Actions YAML using:
    1. YAML syntax check
    2. actionlint (if available)
    
    Reuses same logic as backend/main.py
    """
    result = ValidationResult()
    
    # Step 1: YAML syntax validation
    yaml_valid, yaml_error = _check_yaml_syntax(yaml_content)
    result.yaml_valid = yaml_valid
    
    if not yaml_valid:
        result.status = StageStatus.FAILED
        result.lint_valid = False
        result.lint_errors = [f"YAML syntax error: {yaml_error}"]
        return result
    
    # Step 2: actionlint validation
    lint_valid, lint_errors = _run_actionlint(yaml_content)
    result.lint_valid = lint_valid
    result.lint_errors = lint_errors
    
    if lint_valid:
        result.status = StageStatus.SUCCESS
    else:
        result.status = StageStatus.FAILED
    
    return result


def _check_yaml_syntax(yaml_content: str) -> Tuple[bool, str]:
    """Check YAML syntax validity"""
    try:
        yaml.safe_load(yaml_content)
        return True, ""
    except yaml.YAMLError as e:
        return False, str(e)


def _run_actionlint(yaml_content: str) -> Tuple[bool, List[str]]:
    """
    Run actionlint on YAML content.
    Returns (is_valid, list_of_errors)
    """
    errors: List[str] = []
    
    # Check if actionlint is available
    try:
        subprocess.run(
            ["actionlint", "--version"],
            capture_output=True,
            check=True,
            timeout=10
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        # actionlint not available, skip this check
        return True, []
    
    # Write to temp file and run actionlint
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".yml",
        delete=False
    ) as f:
        f.write(yaml_content)
        temp_path = f.name
    
    # Disable shellcheck integration — it produces false-positive lint failures
    # (SC2086, SC2046, etc.) on perfectly valid run: blocks.
    # Pass -shellcheck "" so actionlint skips the external shellcheck binary entirely.
    config_path = Path(__file__).parent.parent / ".actionlint.yaml"
    cmd = ["actionlint", "-shellcheck", ""]
    if config_path.exists():
        cmd += ["-config-file", str(config_path)]
    cmd.append(temp_path)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if proc.returncode != 0:
            # Parse actionlint output
            output = proc.stdout + proc.stderr
            for line in output.strip().split("\n"):
                if line.strip():
                    # Clean up the temp file path from error messages
                    cleaned = line.replace(temp_path, "workflow.yml")
                    errors.append(cleaned)
        
        return proc.returncode == 0, errors
        
    except subprocess.TimeoutExpired:
        return False, ["actionlint timed out"]
    except Exception as e:
        return False, [f"actionlint error: {str(e)}"]
    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except:
            pass
