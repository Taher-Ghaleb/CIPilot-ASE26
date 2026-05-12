"""
Pydantic models for analytics data.
These are separate from API models - used for database operations.
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class UserRecord(BaseModel):
    """Anonymous user record"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: Optional[str] = None  # For future login feature
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: Optional[datetime] = None


class SessionRecord(BaseModel):
    """User session/visit record with activity tracking"""
    id: Optional[int] = None  # Auto-generated
    user_id: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    browser_name: Optional[str] = None
    browser_version: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    device_type: Optional[str] = None  # desktop, mobile, tablet
    country: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    timezone: Optional[str] = None
    referrer: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity_at: datetime = Field(default_factory=datetime.utcnow)  # For 30-min timeout


class MigrationLogRecord(BaseModel):
    """Migration operation log"""
    id: Optional[int] = None  # Auto-generated
    user_id: Optional[str] = None
    session_id: Optional[int] = None
    reviewer_id: Optional[str] = None  # For reviewer access tracking
    
    # Repository info
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    repo_branch: Optional[str] = None
    repo_full_name: Optional[str] = None  # owner/name
    
    # Migration details
    source_ci_services: Optional[List[str]] = None  # e.g., ["Travis CI", "CircleCI"]
    target_platform: Optional[str] = None  # e.g., "github-actions"
    
    # Source and converted YAML content
    source_yaml: Optional[str] = None  # Original CI config(s)
    converted_yaml: Optional[str] = None  # Generated target CI config
    
    # LLM info (no credentials!)
    provider_used: Optional[str] = None  # e.g., "groq", "openai" - NO API KEYS
    model_used: Optional[str] = None  # e.g., "llama-3.3-70b-versatile"
    
    # Results
    attempts: int = 1
    validation_yaml_ok: Optional[bool] = None
    validation_lint_ok: Optional[bool] = None
    validation_double_check_ok: Optional[bool] = None
    final_status: Optional[str] = None  # "success", "partial", "failed"
    
    # Timing
    processing_time_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DetectionLogRecord(BaseModel):
    """CI platform detection log"""
    id: Optional[int] = None  # Auto-generated
    user_id: Optional[str] = None
    session_id: Optional[int] = None  # Links to user_sessions - same session for detect→migrate→retry
    reviewer_id: Optional[str] = None  # For reviewer access tracking
    
    # Repository context
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    repo_branch: Optional[str] = None
    repo_full_name: Optional[str] = None  # owner/name combined
    
    # Detection details
    detected_services: Optional[List[str]] = None  # e.g., ["Travis CI", "CircleCI"]
    detection_count: int = 0  # Number of CI platforms detected
    detection_source: Optional[str] = None  # 'api', 'extension', 'web'
    detection_data: Optional[dict] = None  # JSON for flexible data (file_path, yaml_length, etc.)
    
    # Timing
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnalyticsEvent(BaseModel):
    """Generic analytics event for extensibility"""
    id: Optional[int] = None
    user_id: Optional[str] = None
    session_id: Optional[int] = None
    reviewer_id: Optional[str] = None  # For reviewer access tracking
    event_type: str  # e.g., "page_view", "conversion_started", "validation_clicked"
    event_data: Optional[dict] = None  # JSON blob for flexible data
    created_at: datetime = Field(default_factory=datetime.utcnow)
