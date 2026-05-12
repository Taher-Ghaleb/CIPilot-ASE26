"""
SQLite implementation of the repository.
Uses aiosqlite for async operations.

For Render.com deployment:
- Set DATABASE_PATH env var to a path on the persistent disk
- e.g., DATABASE_PATH=/var/data/cipilot.db
"""
import os
import json
import aiosqlite
from datetime import datetime
from typing import Optional, List
from .base_repository import BaseRepository
from .models import UserRecord, SessionRecord, MigrationLogRecord, DetectionLogRecord, AnalyticsEvent

# Default path - override with DATABASE_PATH env var
DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'cipilot_analytics.db')

# Session timeout in minutes
SESSION_TIMEOUT_MINUTES = 30


class SQLiteRepository(BaseRepository):
    """SQLite implementation with async support"""
    
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.getenv('DATABASE_PATH', DEFAULT_DB_PATH)
        self._connection: Optional[aiosqlite.Connection] = None
        
    async def initialize(self) -> None:
        """Initialize database and create tables"""
        # Ensure directory exists
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            print(f"[DATABASE] Created directory: {db_dir}")
        
        # Check if database file already exists
        db_exists = os.path.exists(self.db_path)
        db_size = os.path.getsize(self.db_path) if db_exists else 0
        
        print(f"[DATABASE] Initializing at: {self.db_path}")
        print(f"[DATABASE] Directory exists: {os.path.exists(db_dir)}")
        print(f"[DATABASE] Database file exists: {db_exists}")
        print(f"[DATABASE] Database file size: {db_size} bytes")
        print(f"[DATABASE] Directory permissions: {oct(os.stat(db_dir).st_mode)[-3:] if os.path.exists(db_dir) else 'N/A'}")
        
        self._connection = await aiosqlite.connect(self.db_path)
        self._connection.row_factory = aiosqlite.Row
        
        # Enable WAL mode for better concurrent access
        await self._connection.execute("PRAGMA journal_mode=WAL")
        
        # Create tables
        await self._create_tables()
        await self._run_migrations()
        await self._connection.commit()
        
        # Log table count after initialization
        async with self._connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ) as cursor:
            table_count = (await cursor.fetchone())[0]
        
        print(f"[DATABASE] Initialization complete: {table_count} tables created")
        print(f"[DATABASE] Final file size: {os.path.getsize(self.db_path)} bytes")
    
    async def _create_tables(self) -> None:
        """Create database schema"""
        
        # Users table
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TIMESTAMP
            )
        """)
        
        # Sessions table (with last_activity_at for timeout tracking)
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                browser_name TEXT,
                browser_version TEXT,
                os_name TEXT,
                os_version TEXT,
                device_type TEXT,
                country TEXT,
                city TEXT,
                region TEXT,
                timezone TEXT,
                referrer TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Migration logs table
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS migration_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                session_id INTEGER,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT,
                repo_full_name TEXT,
                source_ci_services TEXT,
                target_platform TEXT,
                source_yaml TEXT,
                converted_yaml TEXT,
                provider_used TEXT,
                model_used TEXT,
                attempts INTEGER DEFAULT 1,
                validation_yaml_ok BOOLEAN,
                validation_lint_ok BOOLEAN,
                validation_double_check_ok BOOLEAN,
                final_status TEXT,
                processing_time_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (session_id) REFERENCES user_sessions(id)
            )
        """)
        
        # Generic analytics events table
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                session_id INTEGER,
                event_type TEXT NOT NULL,
                event_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (session_id) REFERENCES user_sessions(id)
            )
        """)
        
        # Detection logs table - separate from migration_logs
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS detection_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                session_id INTEGER,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT,
                repo_full_name TEXT,
                detected_services TEXT,
                detection_count INTEGER DEFAULT 0,
                detection_source TEXT,
                detection_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (session_id) REFERENCES user_sessions(id)
            )
        """)
        
        # Ratings table - user feedback/ratings for the tool
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
                feedback TEXT,
                session_id TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Reviewer sessions table - tracks reviewer access
        await self._connection.execute("""
            CREATE TABLE IF NOT EXISTS reviewer_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reviewer_id TEXT UNIQUE NOT NULL,
                reviewer_name TEXT,
                token_hash TEXT,
                ip_address TEXT,
                user_agent TEXT,
                access_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP
            )
        """)
        
        # Create indexes for common queries
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_migrations_user_id ON migration_logs(user_id)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_migrations_created_at ON migration_logs(created_at)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(event_type)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_detections_session_id ON detection_logs(session_id)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_detections_user_id ON detection_logs(user_id)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON user_sessions(user_id, last_activity_at)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_ratings_session_id ON ratings(session_id)"
        )
        await self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_reviewer_sessions_id ON reviewer_sessions(reviewer_id)"
        )
    
    async def _run_migrations(self) -> None:
        """Run database migrations to add new columns to existing tables"""
        # Check if source_yaml column exists, if not add it
        async with self._connection.execute(
            "PRAGMA table_info(migration_logs)"
        ) as cursor:
            columns = await cursor.fetchall()
            column_names = [col[1] for col in columns]
        
        # Add source_yaml and converted_yaml columns if they don't exist
        if 'source_yaml' not in column_names:
            await self._connection.execute(
                "ALTER TABLE migration_logs ADD COLUMN source_yaml TEXT"
            )
            print("[DATABASE] Added source_yaml column to migration_logs")
        
        if 'converted_yaml' not in column_names:
            await self._connection.execute(
                "ALTER TABLE migration_logs ADD COLUMN converted_yaml TEXT"
            )
            print("[DATABASE] Added converted_yaml column to migration_logs")
        
        # Check if last_activity_at column exists in user_sessions
        async with self._connection.execute(
            "PRAGMA table_info(user_sessions)"
        ) as cursor:
            session_columns = await cursor.fetchall()
            session_column_names = [col[1] for col in session_columns]
        
        if 'last_activity_at' not in session_column_names:
            await self._connection.execute(
                "ALTER TABLE user_sessions ADD COLUMN last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            )
            # Initialize existing sessions with created_at as last_activity_at
            await self._connection.execute(
                "UPDATE user_sessions SET last_activity_at = created_at WHERE last_activity_at IS NULL"
            )
            print("[DATABASE] Added last_activity_at column to user_sessions")
        
        # Add reviewer_id to migration_logs if not exists
        if 'reviewer_id' not in column_names:
            await self._connection.execute(
                "ALTER TABLE migration_logs ADD COLUMN reviewer_id TEXT"
            )
            print("[DATABASE] Added reviewer_id column to migration_logs")
        
        # Add reviewer_id to detection_logs if not exists
        async with self._connection.execute(
            "PRAGMA table_info(detection_logs)"
        ) as cursor:
            detection_columns = await cursor.fetchall()
            detection_column_names = [col[1] for col in detection_columns]
        
        if 'reviewer_id' not in detection_column_names:
            await self._connection.execute(
                "ALTER TABLE detection_logs ADD COLUMN reviewer_id TEXT"
            )
            print("[DATABASE] Added reviewer_id column to detection_logs")
        
        # Add reviewer_id to analytics_events if not exists
        async with self._connection.execute(
            "PRAGMA table_info(analytics_events)"
        ) as cursor:
            event_columns = await cursor.fetchall()
            event_column_names = [col[1] for col in event_columns]
        
        if 'reviewer_id' not in event_column_names:
            await self._connection.execute(
                "ALTER TABLE analytics_events ADD COLUMN reviewer_id TEXT"
            )
            print("[DATABASE] Added reviewer_id column to analytics_events")
    
    async def close(self) -> None:
        """Close database connection"""
        if self._connection:
            await self._connection.close()
            self._connection = None
    
    async def get_or_create_user(self, user_id: str) -> UserRecord:
        """Get existing user or create new one"""
        async with self._connection.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            
        if row:
            return UserRecord(
                id=row['id'],
                username=row['username'],
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
                last_seen_at=datetime.fromisoformat(row['last_seen_at']) if row['last_seen_at'] else None,
            )
        
        # Create new user
        now = datetime.utcnow()
        await self._connection.execute(
            "INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)",
            (user_id, now.isoformat(), now.isoformat())
        )
        await self._connection.commit()
        
        return UserRecord(id=user_id, created_at=now, last_seen_at=now)
    
    async def update_user_last_seen(self, user_id: str) -> None:
        """Update user's last seen timestamp"""
        await self._connection.execute(
            "UPDATE users SET last_seen_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), user_id)
        )
        await self._connection.commit()
    
    async def update_username(self, user_id: str, username: str) -> None:
        """Update username"""
        await self._connection.execute(
            "UPDATE users SET username = ? WHERE id = ?",
            (username, user_id)
        )
        await self._connection.commit()
    
    async def create_session(self, session: SessionRecord) -> int:
        """Create a new session record"""
        cursor = await self._connection.execute(
            """INSERT INTO user_sessions 
               (user_id, ip_address, user_agent, browser_name, browser_version,
                os_name, os_version, device_type, country, city, region, timezone, referrer, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session.user_id,
                session.ip_address,
                session.user_agent,
                session.browser_name,
                session.browser_version,
                session.os_name,
                session.os_version,
                session.device_type,
                session.country,
                session.city,
                session.region,
                session.timezone,
                session.referrer,
                session.created_at.isoformat(),
            )
        )
        await self._connection.commit()
        return cursor.lastrowid
    
    async def get_session(self, session_id: int) -> Optional[SessionRecord]:
        """Get session by ID"""
        async with self._connection.execute(
            "SELECT * FROM user_sessions WHERE id = ?", (session_id,)
        ) as cursor:
            row = await cursor.fetchone()
            
        if not row:
            return None
            
        return SessionRecord(
            id=row['id'],
            user_id=row['user_id'],
            ip_address=row['ip_address'],
            user_agent=row['user_agent'],
            browser_name=row['browser_name'],
            browser_version=row['browser_version'],
            os_name=row['os_name'],
            os_version=row['os_version'],
            device_type=row['device_type'],
            country=row['country'],
            city=row['city'],
            region=row['region'],
            timezone=row['timezone'],
            referrer=row['referrer'],
            created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            last_activity_at=datetime.fromisoformat(row['last_activity_at']) if row.get('last_activity_at') else None,
        )
    
    async def get_active_session(self, user_id: str, timeout_minutes: int = SESSION_TIMEOUT_MINUTES) -> Optional[SessionRecord]:
        """Get active session for user if last activity was within timeout period"""
        async with self._connection.execute(
            """SELECT * FROM user_sessions 
               WHERE user_id = ? 
               AND datetime(last_activity_at) > datetime('now', ?)
               ORDER BY last_activity_at DESC 
               LIMIT 1""",
            (user_id, f'-{timeout_minutes} minutes')
        ) as cursor:
            row = await cursor.fetchone()
            
        if not row:
            return None
            
        return SessionRecord(
            id=row['id'],
            user_id=row['user_id'],
            ip_address=row['ip_address'],
            user_agent=row['user_agent'],
            browser_name=row['browser_name'],
            browser_version=row['browser_version'],
            os_name=row['os_name'],
            os_version=row['os_version'],
            device_type=row['device_type'],
            country=row['country'],
            city=row['city'],
            region=row['region'],
            timezone=row['timezone'],
            referrer=row['referrer'],
            created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            last_activity_at=datetime.fromisoformat(row['last_activity_at']) if row.get('last_activity_at') else None,
        )
    
    async def update_session_activity(self, session_id: int) -> None:
        """Update session's last activity timestamp"""
        await self._connection.execute(
            "UPDATE user_sessions SET last_activity_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), session_id)
        )
        await self._connection.commit()
    
    async def log_migration(self, log: MigrationLogRecord) -> int:
        """Log a migration operation"""
        source_services_json = json.dumps(log.source_ci_services) if log.source_ci_services else None
        
        cursor = await self._connection.execute(
            """INSERT INTO migration_logs 
               (user_id, session_id, reviewer_id, repo_owner, repo_name, repo_branch, repo_full_name,
                source_ci_services, target_platform, source_yaml, converted_yaml,
                provider_used, model_used, attempts, validation_yaml_ok, validation_lint_ok,
                validation_double_check_ok, final_status, processing_time_ms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                log.user_id,
                log.session_id,
                log.reviewer_id,
                log.repo_owner,
                log.repo_name,
                log.repo_branch,
                log.repo_full_name,
                source_services_json,
                log.target_platform,
                log.source_yaml,
                log.converted_yaml,
                log.provider_used,
                log.model_used,
                log.attempts,
                log.validation_yaml_ok,
                log.validation_lint_ok,
                log.validation_double_check_ok,
                log.final_status,
                log.processing_time_ms,
                log.created_at.isoformat(),
            )
        )
        await self._connection.commit()
        return cursor.lastrowid
    
    async def get_user_migrations(self, user_id: str, limit: int = 50) -> List[MigrationLogRecord]:
        """Get recent migrations for a user"""
        async with self._connection.execute(
            """SELECT * FROM migration_logs 
               WHERE user_id = ? 
               ORDER BY created_at DESC 
               LIMIT ?""",
            (user_id, limit)
        ) as cursor:
            rows = await cursor.fetchall()
        
        migrations = []
        for row in rows:
            migrations.append(MigrationLogRecord(
                id=row['id'],
                user_id=row['user_id'],
                session_id=row['session_id'],
                repo_owner=row['repo_owner'],
                repo_name=row['repo_name'],
                repo_branch=row['repo_branch'],
                repo_full_name=row['repo_full_name'],
                source_ci_services=json.loads(row['source_ci_services']) if row['source_ci_services'] else None,
                target_platform=row['target_platform'],
                source_yaml=row['source_yaml'] if 'source_yaml' in row.keys() else None,
                converted_yaml=row['converted_yaml'] if 'converted_yaml' in row.keys() else None,
                provider_used=row['provider_used'],
                model_used=row['model_used'],
                attempts=row['attempts'],
                validation_yaml_ok=row['validation_yaml_ok'],
                validation_lint_ok=row['validation_lint_ok'],
                validation_double_check_ok=row['validation_double_check_ok'],
                final_status=row['final_status'],
                processing_time_ms=row['processing_time_ms'],
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            ))
        
        return migrations
    
    async def get_migration_stats(self) -> dict:
        """Get aggregated migration statistics"""
        stats = {}
        
        # Total migrations
        async with self._connection.execute(
            "SELECT COUNT(*) as total FROM migration_logs"
        ) as cursor:
            row = await cursor.fetchone()
            stats['total_migrations'] = row['total']
        
        # Successful migrations
        async with self._connection.execute(
            "SELECT COUNT(*) as total FROM migration_logs WHERE final_status = 'success'"
        ) as cursor:
            row = await cursor.fetchone()
            stats['successful_migrations'] = row['total']
        
        # Unique users
        async with self._connection.execute(
            "SELECT COUNT(DISTINCT user_id) as total FROM migration_logs"
        ) as cursor:
            row = await cursor.fetchone()
            stats['unique_users'] = row['total']
        
        # Popular source CI services
        async with self._connection.execute(
            """SELECT source_ci_services, COUNT(*) as count 
               FROM migration_logs 
               WHERE source_ci_services IS NOT NULL
               GROUP BY source_ci_services 
               ORDER BY count DESC 
               LIMIT 10"""
        ) as cursor:
            rows = await cursor.fetchall()
            stats['popular_sources'] = [
                {'services': json.loads(row['source_ci_services']), 'count': row['count']}
                for row in rows if row['source_ci_services']
            ]
        
        # Popular LLM providers
        async with self._connection.execute(
            """SELECT provider_used, COUNT(*) as count 
               FROM migration_logs 
               WHERE provider_used IS NOT NULL
               GROUP BY provider_used 
               ORDER BY count DESC"""
        ) as cursor:
            rows = await cursor.fetchall()
            stats['providers'] = {row['provider_used']: row['count'] for row in rows}
        
        return stats
    
    async def log_detection(self, log: DetectionLogRecord) -> int:
        """Log a CI detection operation"""
        detected_services_json = json.dumps(log.detected_services) if log.detected_services else None
        detection_data_json = json.dumps(log.detection_data) if log.detection_data else None
        
        cursor = await self._connection.execute(
            """INSERT INTO detection_logs 
               (user_id, session_id, reviewer_id, repo_owner, repo_name, repo_branch, repo_full_name,
                detected_services, detection_count, detection_source, detection_data, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                log.user_id,
                log.session_id,
                log.reviewer_id,
                log.repo_owner,
                log.repo_name,
                log.repo_branch,
                log.repo_full_name,
                detected_services_json,
                log.detection_count,
                log.detection_source,
                detection_data_json,
                log.created_at.isoformat(),
            )
        )
        await self._connection.commit()
        return cursor.lastrowid
    
    async def get_user_detections(self, user_id: str, limit: int = 50) -> List[DetectionLogRecord]:
        """Get recent detections for a user"""
        async with self._connection.execute(
            """SELECT * FROM detection_logs 
               WHERE user_id = ? 
               ORDER BY created_at DESC 
               LIMIT ?""",
            (user_id, limit)
        ) as cursor:
            rows = await cursor.fetchall()
        
        detections = []
        for row in rows:
            detections.append(DetectionLogRecord(
                id=row['id'],
                user_id=row['user_id'],
                session_id=row['session_id'],
                repo_owner=row['repo_owner'],
                repo_name=row['repo_name'],
                repo_branch=row['repo_branch'],
                repo_full_name=row['repo_full_name'],
                detected_services=json.loads(row['detected_services']) if row['detected_services'] else None,
                detection_count=row['detection_count'],
                detection_source=row['detection_source'],
                detection_data=json.loads(row['detection_data']) if row['detection_data'] else None,
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            ))
        
        return detections
    
    async def get_session_detections(self, session_id: int) -> List[DetectionLogRecord]:
        """Get all detections for a session"""
        async with self._connection.execute(
            """SELECT * FROM detection_logs 
               WHERE session_id = ? 
               ORDER BY created_at ASC""",
            (session_id,)
        ) as cursor:
            rows = await cursor.fetchall()
        
        detections = []
        for row in rows:
            detections.append(DetectionLogRecord(
                id=row['id'],
                user_id=row['user_id'],
                session_id=row['session_id'],
                repo_owner=row['repo_owner'],
                repo_name=row['repo_name'],
                repo_branch=row['repo_branch'],
                repo_full_name=row['repo_full_name'],
                detected_services=json.loads(row['detected_services']) if row['detected_services'] else None,
                detection_count=row['detection_count'],
                detection_source=row['detection_source'],
                detection_data=json.loads(row['detection_data']) if row['detection_data'] else None,
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            ))
        
        return detections

    async def log_event(self, event: AnalyticsEvent) -> int:
        """Log a generic analytics event"""
        event_data_json = json.dumps(event.event_data) if event.event_data else None
        
        cursor = await self._connection.execute(
            """INSERT INTO analytics_events 
               (user_id, session_id, event_type, event_data, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                event.user_id,
                event.session_id,
                event.event_type,
                event_data_json,
                event.created_at.isoformat(),
            )
        )
        await self._connection.commit()
        return cursor.lastrowid
    
    async def health_check(self) -> bool:
        """Check if database is accessible"""
        try:
            async with self._connection.execute("SELECT 1") as cursor:
                await cursor.fetchone()
            return True
        except Exception:
            return False

    # ============================================================================
    # Rating Methods
    # ============================================================================
    
    async def get_rating_stats(self) -> dict:
        """Get aggregate rating statistics"""
        try:
            # Get total votes and average
            async with self._connection.execute(
                "SELECT COUNT(*), COALESCE(AVG(score), 0) FROM ratings"
            ) as cursor:
                row = await cursor.fetchone()
                total_votes = row[0]
                average = row[1]
            
            # Get distribution
            async with self._connection.execute(
                """SELECT score, COUNT(*) as count 
                   FROM ratings 
                   GROUP BY score 
                   ORDER BY score"""
            ) as cursor:
                distribution = {i: 0 for i in range(1, 6)}
                async for row in cursor:
                    distribution[row[0]] = row[1]
            
            return {
                "average": round(average, 1) if total_votes > 0 else 0,
                "total_votes": total_votes,
                "distribution": distribution
            }
        except Exception as e:
            return {
                "average": 0,
                "total_votes": 0,
                "distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                "error": str(e)
            }
    
    async def submit_rating(self, score: int, feedback: str | None, session_id: str) -> dict:
        """Submit or update a rating"""
        try:
            # Check if this session already submitted a rating
            async with self._connection.execute(
                "SELECT id, score FROM ratings WHERE session_id = ?", (session_id,)
            ) as cursor:
                existing = await cursor.fetchone()
            
            if existing:
                # Update existing rating
                await self._connection.execute(
                    """UPDATE ratings 
                       SET score = ?, feedback = ?, created_at = CURRENT_TIMESTAMP
                       WHERE session_id = ?""",
                    (score, feedback, session_id)
                )
                message = "Rating updated successfully"
            else:
                # Insert new rating
                await self._connection.execute(
                    """INSERT INTO ratings (score, feedback, session_id)
                       VALUES (?, ?, ?)""",
                    (score, feedback, session_id)
                )
                message = "Rating submitted successfully"
            
            await self._connection.commit()
            return {"success": True, "message": message}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def check_user_rating(self, session_id: str) -> dict:
        """Check if a session has already submitted a rating"""
        try:
            async with self._connection.execute(
                "SELECT score, feedback FROM ratings WHERE session_id = ?", (session_id,)
            ) as cursor:
                result = await cursor.fetchone()
            
            if result:
                return {
                    "has_rated": True,
                    "score": result[0],
                    "feedback": result[1]
                }
            return {"has_rated": False}
        except Exception as e:
            return {"has_rated": False, "error": str(e)}

    # ============================================================================
    # Reviewer Session Methods
    # ============================================================================
    
    async def create_or_update_reviewer_session(
        self,
        reviewer_id: str,
        reviewer_name: str,
        token_hash: str,
        ip_address: str,
        user_agent: str,
        expires_at: str
    ) -> dict:
        """Create or update a reviewer session"""
        try:
            # Check if reviewer session exists
            async with self._connection.execute(
                "SELECT id, access_count FROM reviewer_sessions WHERE reviewer_id = ?",
                (reviewer_id,)
            ) as cursor:
                existing = await cursor.fetchone()
            
            now = datetime.utcnow().isoformat()
            
            if existing:
                # Update existing session
                await self._connection.execute(
                    """UPDATE reviewer_sessions 
                       SET ip_address = ?, user_agent = ?, access_count = access_count + 1,
                           last_activity_at = ?, token_hash = ?, expires_at = ?
                       WHERE reviewer_id = ?""",
                    (ip_address, user_agent, now, token_hash, expires_at, reviewer_id)
                )
                access_count = existing[1] + 1
            else:
                # Insert new session
                await self._connection.execute(
                    """INSERT INTO reviewer_sessions 
                       (reviewer_id, reviewer_name, token_hash, ip_address, user_agent, 
                        access_count, created_at, last_activity_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                    (reviewer_id, reviewer_name, token_hash, ip_address, user_agent,
                     now, now, expires_at)
                )
                access_count = 1
            
            await self._connection.commit()
            return {
                "success": True,
                "reviewer_id": reviewer_id,
                "reviewer_name": reviewer_name,
                "access_count": access_count
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def get_reviewer_session(self, reviewer_id: str) -> dict | None:
        """Get reviewer session info"""
        try:
            async with self._connection.execute(
                """SELECT reviewer_id, reviewer_name, ip_address, access_count,
                          created_at, last_activity_at, expires_at
                   FROM reviewer_sessions WHERE reviewer_id = ?""",
                (reviewer_id,)
            ) as cursor:
                row = await cursor.fetchone()
            
            if row:
                return {
                    "reviewer_id": row[0],
                    "reviewer_name": row[1],
                    "ip_address": row[2],
                    "access_count": row[3],
                    "created_at": row[4],
                    "last_activity_at": row[5],
                    "expires_at": row[6]
                }
            return None
        except Exception:
            return None
    
    async def update_reviewer_activity(self, reviewer_id: str, ip_address: str = None) -> None:
        """Update reviewer's last activity timestamp"""
        try:
            now = datetime.utcnow().isoformat()
            if ip_address:
                await self._connection.execute(
                    """UPDATE reviewer_sessions 
                       SET last_activity_at = ?, ip_address = ?
                       WHERE reviewer_id = ?""",
                    (now, ip_address, reviewer_id)
                )
            else:
                await self._connection.execute(
                    "UPDATE reviewer_sessions SET last_activity_at = ? WHERE reviewer_id = ?",
                    (now, reviewer_id)
                )
            await self._connection.commit()
        except Exception:
            pass
    
    async def get_all_reviewer_sessions(self) -> list:
        """Get all reviewer sessions for admin view"""
        try:
            async with self._connection.execute(
                """SELECT reviewer_id, reviewer_name, ip_address, access_count,
                          created_at, last_activity_at, expires_at
                   FROM reviewer_sessions ORDER BY last_activity_at DESC"""
            ) as cursor:
                rows = await cursor.fetchall()
            
            return [
                {
                    "reviewer_id": row[0],
                    "reviewer_name": row[1],
                    "ip_address": row[2],
                    "access_count": row[3],
                    "created_at": row[4],
                    "last_activity_at": row[5],
                    "expires_at": row[6]
                }
                for row in rows
            ]
        except Exception:
            return []
    
    async def get_reviewer_stats(self, reviewer_id: str) -> dict:
        """Get statistics for a specific reviewer"""
        try:
            # Get migration count
            async with self._connection.execute(
                "SELECT COUNT(*) FROM migration_logs WHERE reviewer_id = ?",
                (reviewer_id,)
            ) as cursor:
                migration_count = (await cursor.fetchone())[0]
            
            # Get detection count
            async with self._connection.execute(
                "SELECT COUNT(*) FROM detection_logs WHERE reviewer_id = ?",
                (reviewer_id,)
            ) as cursor:
                detection_count = (await cursor.fetchone())[0]
            
            # Get session info
            session = await self.get_reviewer_session(reviewer_id)
            
            return {
                "reviewer_id": reviewer_id,
                "migration_count": migration_count,
                "detection_count": detection_count,
                "access_count": session.get("access_count", 0) if session else 0,
                "last_activity": session.get("last_activity_at") if session else None
            }
        except Exception as e:
            return {"error": str(e)}