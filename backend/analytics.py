"""
Analytics service for tracking migrations and user activity.

This service handles all analytics asynchronously to not impact
the main application performance.

Usage:
    from analytics import analytics_service
    
    # In your endpoint:
    await analytics_service.log_migration_async(...)
"""
import asyncio
from typing import Optional, List
from datetime import datetime
from user_agents import parse as parse_user_agent
from database import SQLiteRepository, BaseRepository
from database.models import UserRecord, SessionRecord, MigrationLogRecord, AnalyticsEvent, DetectionLogRecord

# Session timeout in minutes - after this period of inactivity, a new session is created
SESSION_TIMEOUT_MINUTES = 30


class AnalyticsService:
    """
    Analytics service with async logging.
    
    All logging operations are fire-and-forget to not block the main request.
    """
    
    def __init__(self):
        self._repository: Optional[BaseRepository] = None
        self._initialized = False
        self._init_lock = asyncio.Lock()
    
    async def initialize(self, repository: Optional[BaseRepository] = None) -> None:
        """Initialize the analytics service"""
        async with self._init_lock:
            if self._initialized:
                return
            
            # Use provided repository or default to SQLite
            self._repository = repository or SQLiteRepository()
            
            try:
                await self._repository.initialize()
                self._initialized = True
                print("[ANALYTICS] Service initialized successfully")
            except Exception as e:
                print(f"[ANALYTICS] Failed to initialize: {e}")
                # Don't crash the app if analytics fails
                self._initialized = False
    
    async def close(self) -> None:
        """Close the analytics service"""
        if self._repository:
            await self._repository.close()
            self._initialized = False
    
    def _parse_user_agent(self, user_agent: Optional[str]) -> dict:
        """Parse user agent string into components"""
        if not user_agent:
            return {}
        
        try:
            ua = parse_user_agent(user_agent)
            return {
                'browser_name': ua.browser.family,
                'browser_version': ua.browser.version_string,
                'os_name': ua.os.family,
                'os_version': ua.os.version_string,
                'device_type': 'mobile' if ua.is_mobile else ('tablet' if ua.is_tablet else 'desktop'),
            }
        except Exception:
            return {}
    
    async def get_or_create_user(self, user_id: str) -> Optional[UserRecord]:
        """Get or create anonymous user"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            return await self._repository.get_or_create_user(user_id)
        except Exception as e:
            print(f"[ANALYTICS] Error getting/creating user: {e}")
            return None
    
    async def create_session(
        self,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        country: Optional[str] = None,
        city: Optional[str] = None,
        region: Optional[str] = None,
        timezone: Optional[str] = None,
        referrer: Optional[str] = None,
    ) -> Optional[int]:
        """Create a new session for tracking"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            # Parse user agent
            ua_info = self._parse_user_agent(user_agent)
            
            session = SessionRecord(
                user_id=user_id,
                ip_address=ip_address,
                user_agent=user_agent,
                browser_name=ua_info.get('browser_name'),
                browser_version=ua_info.get('browser_version'),
                os_name=ua_info.get('os_name'),
                os_version=ua_info.get('os_version'),
                device_type=ua_info.get('device_type'),
                country=country,
                city=city,
                region=region,
                timezone=timezone,
                referrer=referrer,
            )
            
            session_id = await self._repository.create_session(session)
            
            # Update user last seen
            await self._repository.update_user_last_seen(user_id)
            
            return session_id
        except Exception as e:
            print(f"[ANALYTICS] Error creating session: {e}")
            return None
    
    async def get_or_create_active_session(
        self,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        country: Optional[str] = None,
        city: Optional[str] = None,
        region: Optional[str] = None,
        timezone: Optional[str] = None,
        referrer: Optional[str] = None,
    ) -> Optional[int]:
        """
        Get existing active session or create a new one.
        
        A session is considered active if the user has had activity
        within the last SESSION_TIMEOUT_MINUTES (default 30 min).
        
        This ensures that detection → migration → retry all use
        the same session_id when done within the timeout period.
        """
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            # First ensure user exists
            await self.get_or_create_user(user_id)
            
            # Check for an active session within the timeout
            active_session = await self._repository.get_active_session(
                user_id, SESSION_TIMEOUT_MINUTES
            )
            
            if active_session:
                # Update the session's last activity time
                await self._repository.update_session_activity(active_session.id)
                return active_session.id
            
            # No active session found, create a new one
            return await self.create_session(
                user_id=user_id,
                ip_address=ip_address,
                user_agent=user_agent,
                country=country,
                city=city,
                region=region,
                timezone=timezone,
                referrer=referrer,
            )
        except Exception as e:
            print(f"[ANALYTICS] Error getting/creating active session: {e}")
            return None
    
    async def update_session_activity(self, session_id: int) -> bool:
        """Update session's last activity timestamp"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return False
        
        try:
            await self._repository.update_session_activity(session_id)
            return True
        except Exception as e:
            print(f"[ANALYTICS] Error updating session activity: {e}")
            return False
    
    async def log_migration(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_branch: Optional[str] = None,
        source_ci_services: Optional[List[str]] = None,
        target_platform: Optional[str] = None,
        source_yaml: Optional[str] = None,
        converted_yaml: Optional[str] = None,
        provider_used: Optional[str] = None,
        model_used: Optional[str] = None,
        attempts: int = 1,
        validation_yaml_ok: Optional[bool] = None,
        validation_lint_ok: Optional[bool] = None,
        validation_double_check_ok: Optional[bool] = None,
        final_status: Optional[str] = None,
        processing_time_ms: Optional[int] = None,
        reviewer_id: Optional[str] = None,
    ) -> Optional[int]:
        """Log a migration operation"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            log = MigrationLogRecord(
                user_id=user_id,
                session_id=session_id,
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_branch=repo_branch,
                repo_full_name=f"{repo_owner}/{repo_name}" if repo_owner and repo_name else None,
                source_ci_services=source_ci_services,
                target_platform=target_platform,
                source_yaml=source_yaml,
                converted_yaml=converted_yaml,
                provider_used=provider_used,  # Just provider name, no API key
                model_used=model_used,
                attempts=attempts,
                validation_yaml_ok=validation_yaml_ok,
                validation_lint_ok=validation_lint_ok,
                validation_double_check_ok=validation_double_check_ok,
                final_status=final_status,
                processing_time_ms=processing_time_ms,
                reviewer_id=reviewer_id,
            )
            
            return await self._repository.log_migration(log)
        except Exception as e:
            print(f"[ANALYTICS] Error logging migration: {e}")
            return None
    
    def log_migration_background(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_branch: Optional[str] = None,
        source_ci_services: Optional[List[str]] = None,
        target_platform: Optional[str] = None,
        source_yaml: Optional[str] = None,
        converted_yaml: Optional[str] = None,
        provider_used: Optional[str] = None,
        model_used: Optional[str] = None,
        attempts: int = 1,
        validation_yaml_ok: Optional[bool] = None,
        validation_lint_ok: Optional[bool] = None,
        validation_double_check_ok: Optional[bool] = None,
        final_status: Optional[str] = None,
        processing_time_ms: Optional[int] = None,
    ) -> None:
        """
        Log migration in background - fire and forget.
        This won't block the main request.
        """
        asyncio.create_task(
            self.log_migration(
                user_id=user_id,
                session_id=session_id,
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_branch=repo_branch,
                source_ci_services=source_ci_services,
                target_platform=target_platform,
                source_yaml=source_yaml,
                converted_yaml=converted_yaml,
                provider_used=provider_used,
                model_used=model_used,
                attempts=attempts,
                validation_yaml_ok=validation_yaml_ok,
                validation_lint_ok=validation_lint_ok,
                validation_double_check_ok=validation_double_check_ok,
                final_status=final_status,
                processing_time_ms=processing_time_ms,
            )
        )
    
    async def log_event(
        self,
        event_type: str,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        event_data: Optional[dict] = None,
    ) -> Optional[int]:
        """Log a generic analytics event"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            event = AnalyticsEvent(
                user_id=user_id,
                session_id=session_id,
                event_type=event_type,
                event_data=event_data,
            )
            return await self._repository.log_event(event)
        except Exception as e:
            print(f"[ANALYTICS] Error logging event: {e}")
            return None
    
    def log_event_background(
        self,
        event_type: str,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        event_data: Optional[dict] = None,
    ) -> None:
        """Log event in background - fire and forget"""
        asyncio.create_task(
            self.log_event(event_type, user_id, session_id, event_data)
        )
    
    async def log_detection(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_branch: Optional[str] = None,
        detected_services: Optional[List[str]] = None,
        detection_count: int = 0,
        detection_source: Optional[str] = None,  # 'api', 'extension', 'web'
        detection_data: Optional[dict] = None,
    ) -> Optional[int]:
        """Log a CI/CD detection event to the detection_logs table"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return None
        
        try:
            log = DetectionLogRecord(
                user_id=user_id,
                session_id=session_id,
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_branch=repo_branch,
                repo_full_name=f"{repo_owner}/{repo_name}" if repo_owner and repo_name else None,
                detected_services=detected_services,
                detection_count=detection_count,
                detection_source=detection_source,
                detection_data=detection_data,
            )
            
            # Update session activity if we have a session
            if session_id:
                await self._repository.update_session_activity(session_id)
            
            return await self._repository.log_detection(log)
        except Exception as e:
            print(f"[ANALYTICS] Error logging detection: {e}")
            return None
    
    def log_detection_background(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[int] = None,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_branch: Optional[str] = None,
        detected_services: Optional[List[str]] = None,
        detection_count: int = 0,
        detection_source: Optional[str] = None,
        detection_data: Optional[dict] = None,
    ) -> None:
        """
        Log detection in background - fire and forget.
        This won't block the main request.
        """
        asyncio.create_task(
            self.log_detection(
                user_id=user_id,
                session_id=session_id,
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_branch=repo_branch,
                detected_services=detected_services,
                detection_count=detection_count,
                detection_source=detection_source,
                detection_data=detection_data,
            )
        )
    
    async def get_user_detections(self, user_id: str, limit: int = 50) -> List[DetectionLogRecord]:
        """Get detection logs for a user"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return []
        
        try:
            return await self._repository.get_user_detections(user_id, limit)
        except Exception as e:
            print(f"[ANALYTICS] Error getting user detections: {e}")
            return []
    
    async def get_session_detections(self, session_id: int) -> List[DetectionLogRecord]:
        """Get detection logs for a session"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return []
        
        try:
            return await self._repository.get_session_detections(session_id)
        except Exception as e:
            print(f"[ANALYTICS] Error getting session detections: {e}")
            return []
    
    async def get_user_migrations(self, user_id: str, limit: int = 50) -> List[MigrationLogRecord]:
        """Get migrations for a user"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return []
        
        try:
            return await self._repository.get_user_migrations(user_id, limit)
        except Exception as e:
            print(f"[ANALYTICS] Error getting user migrations: {e}")
            return []
    
    async def get_stats(self) -> dict:
        """Get aggregated statistics"""
        if not self._initialized:
            await self.initialize()
        
        if not self._initialized:
            return {}
        
        try:
            return await self._repository.get_migration_stats()
        except Exception as e:
            print(f"[ANALYTICS] Error getting stats: {e}")
            return {}
    
    async def health_check(self) -> bool:
        """Check if analytics service is healthy"""
        if not self._initialized:
            return False
        
        try:
            return await self._repository.health_check()
        except Exception:
            return False


# Global singleton instance
analytics_service = AnalyticsService()
