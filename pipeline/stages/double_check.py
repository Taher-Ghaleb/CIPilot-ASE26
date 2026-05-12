"""
Double-Check Stage - Semantic verification using LLM
"""
import sys
from pathlib import Path

# Add backend to path for imports
BACKEND_PATH = Path(__file__).parent.parent.parent / "backend"
sys.path.insert(0, str(BACKEND_PATH))

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import DoubleCheckResult, StageStatus
from config import PipelineConfig


def semantic_double_check(
    source_yaml: str,
    migrated_yaml: str,
    source_ci: str,
    target_ci: str,
    config: PipelineConfig,
    retries: int = 3,
    retry_delay: int = 5
) -> DoubleCheckResult:
    """
    Perform semantic verification that migration preserves functionality.
    
    Reuses backend/llm_converter.py → semantic_verify_migration()
    """
    result = DoubleCheckResult()
    
    # Import from backend
    try:
        from llm_converter import semantic_verify_migration
    except ImportError as e:
        result.status = StageStatus.FAILED
        result.error = f"Failed to import backend llm_converter: {e}"
        return result
    
    for attempt in range(retries):
        try:
            verification = semantic_verify_migration(
                provider=config.llm_provider,
                model=config.llm_model,
                source_config=source_yaml,
                generated_config=migrated_yaml,
                source_ci=source_ci,
                target_ci=target_ci,
                base_url=config.llm_base_url,
                api_key=config.llm_api_key,
            )
            
            result.passed = verification.get("passed", False)
            result.reasons = verification.get("reasons", [])
            result.missing_features = verification.get("missing_features", [])
            result.hallucinated_steps = verification.get("hallucinated_steps", [])
            result.confidence = verification.get("confidence", 0.0)
            
            result.status = StageStatus.SUCCESS if result.passed else StageStatus.FAILED
            return result
            
        except Exception as e:
            result.error = str(e)
            if attempt < retries - 1:
                import time
                time.sleep(retry_delay)
                continue
    
    result.status = StageStatus.FAILED
    return result
