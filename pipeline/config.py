"""
Pipeline configuration and strictness levels
"""
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional
import os


class StrictnessLevel(Enum):
    STRICT = "strict"           # Lint + Double-check must pass → then PR
    LINT_ONLY = "lint_only"     # Only lint must pass → PR (skip double-check if lint fails)
    PERMISSIVE = "permissive"   # Always create PR (for user feedback collection)
    DRY_RUN = "dry_run"         # No PRs, just report what would happen


@dataclass
class PipelineConfig:
    """Configuration for the batch pipeline"""
    
    # Input/Output
    input_file: str = ""
    output_file: str = "results.csv"
    
    # Strictness settings
    strictness: StrictnessLevel = StrictnessLevel.STRICT
    pr_on_lint_fail: bool = False           # Create PR even if lint fails?
    pr_on_double_check_fail: bool = False   # Create PR even if double-check fails?
    skip_double_check_on_lint_fail: bool = True  # Don't waste LLM calls
    
    # Processing settings
    max_concurrent: int = 2                 # Parallel processing
    max_retries: int = 3                    # Retry on failure
    retry_delay_seconds: int = 5            # Delay between retries
    
    # LLM settings
    llm_provider: str = "xai"
    llm_model: str = "grok-4-1-fast-reasoning"
    llm_api_key: str = ""
    llm_base_url: Optional[str] = None
    
    # GitHub settings
    github_pats: List[str] = field(default_factory=list)  # Multiple PATs for rotation
    pr_branch_prefix: str = "cipilot/migrated"
    target_branch: str = "main"  # Default target branch for PRs
    
    # Resume settings
    resume: bool = False
    
    # Cloud GHA Verification (async verification of migrated workflows)
    cloud_gha_verify: bool = False  # Enable GHA verification before creating PR
    cloud_gha_timeout: int = 1800  # Max seconds to wait for GHA run (30 min)
    cloud_gha_retries: int = 3  # Max LLM fix attempts for fixable errors
    cloud_gha_poll_interval: int = 30  # Seconds between GHA status polls
    cloud_gha_grace_period: int = 30  # Seconds grace period on shutdown
    
    @classmethod
    def from_env(cls) -> "PipelineConfig":
        """Load configuration from environment variables"""
        config = cls()
        
        # LLM settings
        config.llm_provider = os.getenv("LLM_PROVIDER", "xai")
        config.llm_model = os.getenv("LLM_MODEL", "grok-4-1-fast-reasoning")
        config.llm_api_key = os.getenv("LLM_API_KEY", "")
        config.llm_base_url = os.getenv("LLM_BASE_URL")
        
        # GitHub PATs (comma-separated)
        pats_str = os.getenv("GITHUB_PATS", "")
        if pats_str:
            config.github_pats = [p.strip() for p in pats_str.split(",") if p.strip()]
        
        # Single PAT fallback
        single_pat = os.getenv("GITHUB_PAT", "")
        if single_pat and single_pat not in config.github_pats:
            config.github_pats.append(single_pat)
        
        return config
    
    def should_create_pr(self, lint_passed: bool, double_check_passed: bool) -> bool:
        """Determine if PR should be created based on strictness and results"""
        if self.strictness == StrictnessLevel.DRY_RUN:
            return False
        
        if self.strictness == StrictnessLevel.PERMISSIVE:
            return True
        
        if self.strictness == StrictnessLevel.LINT_ONLY:
            return lint_passed or self.pr_on_lint_fail
        
        # STRICT mode
        if not lint_passed:
            return self.pr_on_lint_fail
        if not double_check_passed:
            return self.pr_on_double_check_fail
        
        return True
    
    def should_run_double_check(self, lint_passed: bool) -> bool:
        """Determine if double-check should run"""
        if self.strictness == StrictnessLevel.DRY_RUN:
            return True  # Still run for reporting
        
        if not lint_passed and self.skip_double_check_on_lint_fail:
            return False
        
        return True
    
    def should_create_pr_on_gha_fail(self, error_type: str, fix_attempts: int) -> bool:
        """
        Determine if PR should be created when GHA verification fails.
        
        Args:
            error_type: GHAErrorType value (e.g. "secret_error", "dependency_error", "build_error", ...)
            fix_attempts: Number of LLM fix attempts made
        
        Returns:
            True if PR should be created despite GHA failure
        """
        # Secret errors always get PR (not fixable, user needs to add secrets)
        if error_type == "secret_error":
            return True
        
        # DRY_RUN never creates PRs
        if self.strictness == StrictnessLevel.DRY_RUN:
            return False
        
        # STRICT mode requires GHA pass (after exhausting retries)
        if self.strictness == StrictnessLevel.STRICT:
            return False
        
        # LINT_ONLY and PERMISSIVE create PR regardless of GHA status
        # (GHA verification is informational in these modes)
        return True


# Default CI detection patterns (same as backend)
CI_DETECTION_PATTERNS = {
    "circleci": [".circleci/config.yml", ".circleci/config.yaml"],
    "travis": [".travis.yml", ".travis.yaml"],
    "gitlab": [".gitlab-ci.yml", ".gitlab-ci.yaml"],
    "github-actions": [".github/workflows/"],
    "jenkins": ["Jenkinsfile", "jenkins/Jenkinsfile"],
    "azure-pipelines": ["azure-pipelines.yml", "azure-pipelines.yaml", ".azure-pipelines.yml"],
    "bitbucket": ["bitbucket-pipelines.yml"],
    "drone": [".drone.yml", ".drone.yaml"],
    "semaphore": [".semaphore/semaphore.yml"],
    "buildkite": [".buildkite/pipeline.yml", ".buildkite/pipeline.yaml"],
    "appveyor": ["appveyor.yml", ".appveyor.yml"],
    "codefresh": ["codefresh.yml", ".codefresh.yml"],
}
