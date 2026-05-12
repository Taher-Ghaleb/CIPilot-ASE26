"""
Migration Stage - Convert CI/CD configuration using LLM
"""
import sys
from pathlib import Path
from typing import Optional

# Add backend to path for imports
BACKEND_PATH = Path(__file__).parent.parent.parent / "backend"
sys.path.insert(0, str(BACKEND_PATH))

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import MigrationResult, StageStatus
from config import PipelineConfig


def migrate_ci(
    source_yaml: str,
    source_ci: str,
    target_ci: str,
    config: PipelineConfig,
    retries: int = 3,
    retry_delay: int = 5
) -> MigrationResult:
    """
    Convert CI/CD configuration using LLM.
    
    Reuses backend/llm_converter.py
    """
    result = MigrationResult()
    result.source_ci = source_ci
    result.target_ci = target_ci
    
    # Import from backend
    try:
        from llm_converter import convert_pipeline
    except ImportError as e:
        result.status = StageStatus.FAILED
        result.error = f"Failed to import backend llm_converter: {e}"
        return result
    
    for attempt in range(retries):
        result.attempts = attempt + 1
        try:
            print(f"[Migration Agent] Converting {source_ci} → {target_ci} (attempt {attempt + 1}/{retries})")
            migrated_yaml = convert_pipeline(
                provider=config.llm_provider,
                model=config.llm_model,
                source_ci=source_ci,
                target_ci=target_ci,
                content=source_yaml,
                base_url=config.llm_base_url,
                api_key=config.llm_api_key,
            )
            
            if migrated_yaml and migrated_yaml.strip():
                result.status = StageStatus.SUCCESS
                result.migrated_yaml = migrated_yaml
                return result
            else:
                result.error = "LLM returned empty response"
                
        except Exception as e:
            result.error = str(e)
            if attempt < retries - 1:
                import time
                time.sleep(retry_delay)
                continue
    
    result.status = StageStatus.FAILED
    return result
