"""
Data models for pipeline processing
"""
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class StageStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class RepoInput:
    """Input repository to process"""
    repo_url: str
    target_branch: str = "main"
    
    @property
    def owner(self) -> str:
        """Extract owner from repo URL"""
        url = self.repo_url.replace("https://github.com/", "").replace("http://github.com/", "")
        parts = url.strip("/").split("/")
        return parts[0] if len(parts) >= 2 else ""
    
    @property
    def name(self) -> str:
        """Extract repo name from repo URL"""
        url = self.repo_url.replace("https://github.com/", "").replace("http://github.com/", "")
        parts = url.strip("/").split("/")
        return parts[1] if len(parts) >= 2 else url
    
    @property
    def full_name(self) -> str:
        """Get owner/repo format"""
        return f"{self.owner}/{self.name}"


@dataclass
class DetectedConfig:
    """A single detected CI configuration"""
    ci_type: str
    source_yaml: str
    source_path: str


@dataclass
class DetectionResult:
    """Result of CI detection stage - may contain multiple CI configs"""
    status: StageStatus = StageStatus.PENDING
    detected_configs: List[DetectedConfig] = field(default_factory=list)  # All detected configs with content
    error: Optional[str] = None
    
    # Convenience properties for backward compatibility
    @property
    def detected_ci(self) -> Optional[str]:
        """Get primary (first) detected CI type"""
        return self.detected_configs[0].ci_type if self.detected_configs else None
    
    @property
    def source_yaml(self) -> Optional[str]:
        """Get primary (first) source YAML"""
        return self.detected_configs[0].source_yaml if self.detected_configs else None
    
    @property
    def source_path(self) -> Optional[str]:
        """Get primary (first) source path"""
        return self.detected_configs[0].source_path if self.detected_configs else None
    
    @property
    def all_detected(self) -> List[str]:
        """Get list of all detected CI types"""
        return [c.ci_type for c in self.detected_configs]


@dataclass
class MigrationResult:
    """Result of migration stage"""
    status: StageStatus = StageStatus.PENDING
    migrated_yaml: Optional[str] = None
    source_ci: Optional[str] = None
    target_ci: str = "github-actions"
    attempts: int = 0
    error: Optional[str] = None


@dataclass
class ValidationResult:
    """Result of validation (lint) stage"""
    status: StageStatus = StageStatus.PENDING
    yaml_valid: bool = False
    lint_valid: bool = False
    lint_errors: List[str] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class DoubleCheckResult:
    """Result of semantic double-check stage"""
    status: StageStatus = StageStatus.PENDING
    passed: bool = False
    reasons: List[str] = field(default_factory=list)
    missing_features: List[str] = field(default_factory=list)
    hallucinated_steps: List[str] = field(default_factory=list)
    confidence: float = 0.0
    error: Optional[str] = None


@dataclass
class PullRequestResult:
    """Result of PR creation stage"""
    status: StageStatus = StageStatus.PENDING
    pr_url: Optional[str] = None
    pr_number: Optional[int] = None
    fork_url: Optional[str] = None
    branch_name: Optional[str] = None
    error: Optional[str] = None
    skipped_reason: Optional[str] = None


class GHAErrorType(Enum):
    """Types of GHA workflow errors"""
    NONE                  = "none"                   # workflow succeeded
    SECRET_ERROR          = "secret_error"           # missing credentials — not fixable
    WORKFLOW_SYNTAX_ERROR = "workflow_syntax_error"  # YAML/action/runner structure issues
    DEPENDENCY_ERROR      = "dependency_error"       # package/module install failures
    TRIGGER_ERROR         = "trigger_error"          # workflow never triggered
    BUILD_ERROR           = "build_error"            # compilation/test failures
    TIMEOUT_ERROR         = "timeout_error"          # runner timed out
    UNKNOWN_ERROR         = "unknown_error"          # unrecognised — fix agent still attempted


@dataclass
class GHAVerificationResult:
    """Result of GHA workflow verification stage"""
    status: StageStatus = StageStatus.PENDING
    run_id: Optional[int] = None
    run_url: Optional[str] = None
    run_conclusion: Optional[str] = None  # success, failure, cancelled, timed_out
    error_type: GHAErrorType = GHAErrorType.NONE
    error_logs: Optional[str] = None  # Relevant portion of failure logs
    fix_attempts: int = 0  # Number of LLM fix attempts made
    fixed_yaml: Optional[str] = None  # YAML after fix (if any)
    llm_suggestions: List[str] = field(default_factory=list)  # LLM-generated PR suggestions
    llm_suggestions_error: Optional[str] = None  # Error if suggestion call failed
    error: Optional[str] = None
    skipped_reason: Optional[str] = None


@dataclass
class RepoResult:
    """Complete result for a single repository + CI config combination"""
    input: RepoInput
    detection: DetectionResult = field(default_factory=DetectionResult)
    migration: MigrationResult = field(default_factory=MigrationResult)
    validation: ValidationResult = field(default_factory=ValidationResult)
    double_check: DoubleCheckResult = field(default_factory=DoubleCheckResult)
    gha_verification: GHAVerificationResult = field(default_factory=GHAVerificationResult)
    pull_request: PullRequestResult = field(default_factory=PullRequestResult)

    # All detected CIs in this repo (for CSV reference)
    all_detected_in_repo: List[str] = field(default_factory=list)

    # GHA verification state (for resume support)
    gha_fork_owner: Optional[str] = None  # Fork owner for GHA verification
    gha_branch_name: Optional[str] = None  # Branch pushed to fork

    # Timing
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: float = 0.0

    # LLM info for output
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None

    # Skip reason for this repo (if skipped)
    skip_reason: Optional[str] = None

    # Overall status: pending, gha_pending, success, partial, failed
    overall_status: str = "pending"
    error_message: Optional[str] = None
    
    def to_csv_row(self) -> Dict[str, Any]:
        """Convert to CSV row dictionary"""
        # Get all detected CIs - either from explicit field or detection result
        all_detected = self.all_detected_in_repo if self.all_detected_in_repo else self.detection.all_detected
        
        row = {
            "repo_url": self.input.repo_url,
            "repo_full_name": self.input.full_name,
            "target_branch": self.input.target_branch,
            
            # Detection - this result is for ONE specific CI
            "detected_ci": self.detection.detected_ci or "",
            "all_detected_ci": ",".join(all_detected),  # All CIs found in repo
            "detection_status": self.detection.status.value,
            "source_path": self.detection.source_path or "",
            
            # Migration
            "migration_status": self.migration.status.value,
            "migration_attempts": self.migration.attempts,
            "source_yaml_length": len(self.detection.source_yaml or ""),
            "migrated_yaml_length": len(self.migration.migrated_yaml or ""),

            # LLM info
            "LLM_Provider": self.llm_provider or "",
            "LLM_Model": self.llm_model or "",
            
            # Validation
            "yaml_valid": self.validation.yaml_valid,
            "lint_valid": self.validation.lint_valid,
            "lint_errors": "; ".join(self.validation.lint_errors),
            "validation_status": self.validation.status.value,
            
            # Double Check
            "double_check_status": self.double_check.status.value,
            "double_check_passed": self.double_check.passed,
            "double_check_confidence": self.double_check.confidence,
            "double_check_reasons": "; ".join(self.double_check.reasons),
            "missing_features": "; ".join(self.double_check.missing_features),
            "hallucinated_steps": "; ".join(self.double_check.hallucinated_steps),
            
            # GHA Verification
            "gha_status": self.gha_verification.status.value,
            "gha_run_id": self.gha_verification.run_id or "",
            "gha_run_url": self.gha_verification.run_url or "",
            "gha_run_conclusion": self.gha_verification.run_conclusion or "",
            "gha_error_type": self.gha_verification.error_type.value,
            "gha_fix_attempts": self.gha_verification.fix_attempts,
            "gha_error": self.gha_verification.error or "",
            "gha_error_logs": self.gha_verification.error_logs or "",
            "gha_llm_suggestions": (
                " | ".join(self.gha_verification.llm_suggestions)
                if self.gha_verification.llm_suggestions
                else (f"[error: {self.gha_verification.llm_suggestions_error}]"
                      if self.gha_verification.llm_suggestions_error else "")
            ),
            "gha_skipped_reason": self.gha_verification.skipped_reason or "",
            "gha_fork_owner": self.gha_fork_owner or "",
            "gha_branch_name": self.gha_branch_name or "",
            
            # Pull Request
            "pr_status": self.pull_request.status.value,
            "pr_url": self.pull_request.pr_url or "",
            "pr_number": self.pull_request.pr_number or "",
            "fork_url": self.pull_request.fork_url or "",
            "branch_name": self.pull_request.branch_name or "",
            "pr_skipped_reason": self.pull_request.skipped_reason or "",
            "pr_error": self.pull_request.error or "",
            
            # Overall
            "overall_status": self.overall_status,
            "error_message": self.error_message or "",
            "duration_seconds": round(self.duration_seconds, 2),
            "started_at": self.started_at.isoformat() if self.started_at else "",
            "completed_at": self.completed_at.isoformat() if self.completed_at else "",
            
            # Full YAML content (for detailed analysis)
            "source_yaml": self.detection.source_yaml or "",
            "migrated_yaml": self.migration.migrated_yaml or "",
        }
        # Add skip_reason if present
        row["skip_reason"] = self.skip_reason or ""
        return row


@dataclass
class PipelineStats:
    """Aggregate statistics for the pipeline run"""
    total: int = 0
    processed: int = 0
    
    # Detection
    detected: int = 0
    no_ci_found: int = 0
    detection_failed: int = 0
    
    # Migration
    migrated: int = 0
    migration_failed: int = 0
    
    # Validation
    lint_passed: int = 0
    lint_failed: int = 0
    
    # Double Check
    double_check_passed: int = 0
    double_check_failed: int = 0
    double_check_skipped: int = 0
    
    # GHA Verification
    gha_pending: int = 0  # Queued for GHA verification
    gha_running: int = 0  # Currently running GHA verification
    gha_passed: int = 0  # GHA workflow succeeded
    gha_failed: int = 0  # GHA workflow failed (after all retries)
    gha_fixed: int = 0  # GHA workflow fixed by LLM agent
    gha_secret_error: int = 0  # GHA failed due to secrets (not fixable, still create PR)
    gha_skipped: int = 0  # GHA verification skipped
    
    # PRs
    prs_created: int = 0
    prs_skipped: int = 0
    prs_failed: int = 0
    
    # Overall
    success: int = 0
    partial: int = 0
    failed: int = 0
    
    # Timing
    start_time: Optional[datetime] = None
    elapsed_seconds: float = 0.0
    
    @property
    def remaining(self) -> int:
        return self.total - self.processed
    
    @property
    def progress_percent(self) -> float:
        if self.total == 0:
            return 0.0
        return (self.processed / self.total) * 100
