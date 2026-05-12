"""
Abstract base repository for database operations.
This allows easy switching between SQLite, PostgreSQL, etc.
"""
from abc import ABC, abstractmethod
from typing import Optional, List
from .models import UserRecord, SessionRecord, MigrationLogRecord, DetectionLogRecord, AnalyticsEvent


class BaseRepository(ABC):
    """
    Abstract repository interface.
    
    To switch databases:
    1. Implement a new repository (e.g., PostgreSQLRepository)
    2. Change the instantiation in analytics.py
    
    Example for PostgreSQL migration:
    - Install: pip install asyncpg databases
    - Create: postgresql_repository.py
    - Update: DATABASE_URL env var to postgres://...
    """
    
    @abstractmethod
    async def initialize(self) -> None:
        """Initialize database connection and create tables if needed"""
        pass
    
    @abstractmethod
    async def close(self) -> None:
        """Close database connection"""
        pass
    
    # User operations
    @abstractmethod
    async def get_or_create_user(self, user_id: str) -> UserRecord:
        """Get existing user or create new one"""
        pass
    
    @abstractmethod
    async def update_user_last_seen(self, user_id: str) -> None:
        """Update user's last seen timestamp"""
        pass
    
    @abstractmethod
    async def update_username(self, user_id: str, username: str) -> None:
        """Update username (for future login feature)"""
        pass
    
    # Session operations
    @abstractmethod
    async def create_session(self, session: SessionRecord) -> int:
        """Create a new session record, returns session_id"""
        pass
    
    @abstractmethod
    async def get_session(self, session_id: int) -> Optional[SessionRecord]:
        """Get session by ID"""
        pass
    
    @abstractmethod
    async def get_active_session(self, user_id: str, timeout_minutes: int = 30) -> Optional[SessionRecord]:
        """Get active session for user (within timeout period)"""
        pass
    
    @abstractmethod
    async def update_session_activity(self, session_id: int) -> None:
        """Update session's last activity timestamp"""
        pass
    
    # Migration log operations
    @abstractmethod
    async def log_migration(self, log: MigrationLogRecord) -> int:
        """Log a migration operation, returns log_id"""
        pass
    
    @abstractmethod
    async def get_user_migrations(self, user_id: str, limit: int = 50) -> List[MigrationLogRecord]:
        """Get recent migrations for a user"""
        pass
    
    @abstractmethod
    async def get_migration_stats(self) -> dict:
        """Get aggregated migration statistics"""
        pass
    
    # Detection log operations
    @abstractmethod
    async def log_detection(self, log: DetectionLogRecord) -> int:
        """Log a CI detection operation, returns log_id"""
        pass
    
    @abstractmethod
    async def get_user_detections(self, user_id: str, limit: int = 50) -> List[DetectionLogRecord]:
        """Get recent detections for a user"""
        pass
    
    @abstractmethod
    async def get_session_detections(self, session_id: int) -> List[DetectionLogRecord]:
        """Get all detections for a session"""
        pass
    
    # Analytics events
    @abstractmethod
    async def log_event(self, event: AnalyticsEvent) -> int:
        """Log a generic analytics event"""
        pass
    
    # Health check
    @abstractmethod
    async def health_check(self) -> bool:
        """Check if database is accessible"""
        pass
