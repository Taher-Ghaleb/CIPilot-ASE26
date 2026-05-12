"""
LangGraph-based Agentic Pipeline for CI/CD Migration

This module implements a state machine using LangGraph for the conversion
and validation workflow with automatic retry capabilities.

Flow:
    START → convert → validate_yaml → validate_lint → double_check → END
                ↑           ↓              ↓              ↓
                └───────── retry ←─────────┴──────────────┘
"""

from typing import TypedDict, Literal, Optional, List, Any
from langgraph.graph import StateGraph, END

# Import existing functions from the codebase
from llm_converter import convert_pipeline, semantic_verify_migration


class PipelineState(TypedDict):
    """State that flows through the agentic pipeline"""
    # Input
    source_config: str
    source_ci: str
    target_ci: str
    provider: str
    model: str
    base_url: Optional[str]
    api_key: Optional[str]
    
    # Generated output
    generated_yaml: str
    
    # Validation results
    yaml_ok: bool
    yaml_error: Optional[str]
    actionlint_ok: bool
    actionlint_output: Optional[str]
    double_check_ok: Optional[bool]
    double_check_reasons: List[str]
    double_check_skipped: bool
    
    # Control flow
    attempts: int
    max_attempts: int
    feedback: str
    should_retry: bool
    current_stage: str  # For observability


def node_convert(state: PipelineState) -> PipelineState:
    """Node: Generate GitHub Actions YAML from source CI config"""
    print(f"[LANGGRAPH] Convert node - Attempt {state['attempts']}")
    
    feedback = state.get('feedback') if state['attempts'] > 1 else None
    
    generated = convert_pipeline(
        provider=state['provider'],
        model=state['model'],
        source_ci=state['source_ci'],
        target_ci=state['target_ci'],
        content=state['source_config'],
        base_url=state.get('base_url'),
        api_key=state.get('api_key'),
        validation_feedback=feedback,
    )
    
    return {
        **state,
        'generated_yaml': generated,
        'current_stage': 'converted',
    }


def node_validate_yaml(state: PipelineState) -> PipelineState:
    """Node: Validate YAML syntax using PyYAML"""
    print(f"[LANGGRAPH] YAML validation node")
    
    try:
        import yaml
        yaml.safe_load(state['generated_yaml'])
        return {
            **state,
            'yaml_ok': True,
            'yaml_error': None,
            'current_stage': 'yaml_validated',
        }
    except Exception as e:
        return {
            **state,
            'yaml_ok': False,
            'yaml_error': str(e),
            'current_stage': 'yaml_failed',
        }


def node_validate_lint(state: PipelineState) -> PipelineState:
    """Node: Validate using actionlint"""
    print(f"[LANGGRAPH] Actionlint validation node")
    
    import tempfile
    import subprocess
    
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=True) as f:
            f.write(state['generated_yaml'])
            f.flush()
            proc = subprocess.run(
                ["actionlint", f.name],
                capture_output=True,
                text=True,
                timeout=30,
            )
        
        output = (proc.stdout or "") + (proc.stderr or "")
        
        # Analyze severity - determine what's a hard failure vs a soft warning
        if output:
            # Check for actual breaking errors (these must ALWAYS fail)
            has_syntax_error = '[syntax-check]' in output
            has_expression_error = '[expression]' in output
            has_type_error = '[type-check]' in output
            has_runner_label_error = '[runner-label]' in output  # Invalid runner names like "ubunt"
            has_action_error = '[action]' in output  # Actual action errors (not just warnings)
            
            # Check for non-blocking warnings ONLY
            is_action_too_old = 'action is too old' in output.lower() or 'is too old to run' in output.lower()
            is_only_shellcheck_info = (
                ':info:' in output.lower() and 
                '[shellcheck]' in output
            )
            
            # Non-blocking ONLY if it's "action is too old" OR "shellcheck info"
            # AND no actual errors are present
            has_blocking_errors = (
                has_syntax_error or
                has_expression_error or
                has_type_error or
                has_runner_label_error or
                (has_action_error and not is_action_too_old)  # [action] is error unless it's just "too old"
            )
            
            is_non_blocking = (
                (is_only_shellcheck_info or is_action_too_old) and
                not has_blocking_errors
            )
            
            if is_non_blocking:
                return {
                    **state,
                    'actionlint_ok': True,
                    'actionlint_output': output.strip() + "\n\n[Note: Non-blocking warnings. Consider updating action versions to @v4.]",
                    'current_stage': 'lint_passed',
                }
            
            # If there are blocking errors, fail
            if has_blocking_errors:
                return {
                    **state,
                    'actionlint_ok': False,
                    'actionlint_output': output.strip(),
                    'current_stage': 'lint_failed',
                }
        
        return {
            **state,
            'actionlint_ok': proc.returncode == 0,
            'actionlint_output': output.strip() or None,
            'current_stage': 'lint_passed' if proc.returncode == 0 else 'lint_failed',
        }
        
    except FileNotFoundError:
        return {
            **state,
            'actionlint_ok': False,
            'actionlint_output': "actionlint is not installed",
            'current_stage': 'lint_failed',
        }
    except Exception as e:
        return {
            **state,
            'actionlint_ok': False,
            'actionlint_output': str(e),
            'current_stage': 'lint_failed',
        }


def node_double_check(state: PipelineState) -> PipelineState:
    """Node: Semantic verification using LLM"""
    print(f"[LANGGRAPH] Double Check node")
    
    # Skip if YAML or lint failed
    if not state['yaml_ok'] or not state['actionlint_ok']:
        return {
            **state,
            'double_check_ok': None,
            'double_check_reasons': [],
            'double_check_skipped': True,
            'current_stage': 'double_check_skipped',
        }
    
    result = semantic_verify_migration(
        provider=state['provider'],
        model=state['model'],
        source_config=state['source_config'],
        generated_config=state['generated_yaml'],
        source_ci=state['source_ci'],
        target_ci=state['target_ci'],
        base_url=state.get('base_url'),
        api_key=state.get('api_key'),
    )
    
    passed = result.get("passed", False)
    reasons = result.get("reasons", [])
    missing = result.get("missing_features", [])
    hallucinated = result.get("hallucinated_steps", [])
    confidence = result.get("confidence", 0.0)
    
    # Filter out allowed additions that shouldn't be considered hallucinations
    allowed_additions = [
        'actions/checkout', 'checkout', 'actions/checkout@v4', 'actions/checkout@v3',
        'actions/setup-', 'setup-node', 'setup-python', 'setup-java', 'setup-go',
    ]
    filtered_hallucinated = [
        h for h in hallucinated 
        if not any(allowed.lower() in h.lower() for allowed in allowed_additions)
    ]
    
    # If hallucinations were filtered out, update passed status
    if hallucinated and not filtered_hallucinated:
        print(f"[LANGGRAPH] Filtered out allowed additions: {hallucinated}")
        passed = True
    
    # Check for significant missing features that MUST cause failure
    # These are critical features that fundamentally change how the job runs
    significant_missing_keywords = [
        'docker', 'container', 'image', 'service',  # Container/Docker features
        'environment', 'env',  # Environment settings
        'command', 'script', 'step',  # Core execution elements
    ]
    
    significant_missing = [
        m for m in missing
        if any(keyword in m.lower() for keyword in significant_missing_keywords)
    ]
    
    # If significant features are missing, this is a FAILURE even if LLM said "passed"
    if significant_missing:
        print(f"[LANGGRAPH] Significant features missing: {significant_missing}")
        passed = False
    
    # Build user-friendly reasons
    all_reasons = list(reasons)
    if filtered_hallucinated:
        all_reasons.append(f"Additional steps not in source: {', '.join(filtered_hallucinated)}")
    if significant_missing:
        all_reasons.append(f"CRITICAL: Missing significant features: {', '.join(significant_missing)}")
    elif missing:
        all_reasons.append(f"Missing features: {', '.join(missing)}")
    if confidence > 0:
        all_reasons.append(f"Confidence: {confidence:.0%}")
    
    return {
        **state,
        'double_check_ok': passed,
        'double_check_reasons': all_reasons,
        'double_check_skipped': False,
        'current_stage': 'double_check_passed' if passed else 'double_check_failed',
    }


def node_prepare_retry(state: PipelineState) -> PipelineState:
    """Node: Prepare feedback for retry attempt"""
    print(f"[LANGGRAPH] Prepare retry node - Will be attempt {state['attempts'] + 1}")
    
    feedback_parts = []
    
    if not state['yaml_ok']:
        feedback_parts.append(f"YAML parse error: {state['yaml_error']}")
    
    if not state['actionlint_ok']:
        feedback_parts.append(f"actionlint output: {state['actionlint_output']}")
    
    if state['double_check_ok'] is False and state['double_check_reasons']:
        feedback_parts.append(
            "SEMANTIC VERIFICATION FAILED:\n" +
            "\n".join(f"- {r}" for r in state['double_check_reasons'])
        )
    
    return {
        **state,
        'attempts': state['attempts'] + 1,
        'feedback': "\n\n".join(feedback_parts),
        'should_retry': True,
        'current_stage': 'preparing_retry',
    }


def should_retry(state: PipelineState) -> Literal["retry", "end"]:
    """Edge condition: Determine if we should retry or end"""
    
    # All passed - we're done
    if state['yaml_ok'] and state['actionlint_ok'] and state.get('double_check_ok', True):
        print(f"[LANGGRAPH] All validations passed - ending")
        return "end"
    
    # Max attempts reached - end even with failures
    if state['attempts'] >= state['max_attempts']:
        print(f"[LANGGRAPH] Max attempts ({state['max_attempts']}) reached - ending")
        return "end"
    
    # Something failed and we have retries left
    print(f"[LANGGRAPH] Validation failed, will retry (attempt {state['attempts']}/{state['max_attempts']})")
    return "retry"


def build_conversion_graph() -> StateGraph:
    """Build the LangGraph state machine for CI/CD conversion"""
    
    # Create the graph
    graph = StateGraph(PipelineState)
    
    # Add nodes
    graph.add_node("convert", node_convert)
    graph.add_node("validate_yaml", node_validate_yaml)
    graph.add_node("validate_lint", node_validate_lint)
    graph.add_node("double_check", node_double_check)
    graph.add_node("prepare_retry", node_prepare_retry)
    
    # Add edges - linear flow
    graph.add_edge("convert", "validate_yaml")
    graph.add_edge("validate_yaml", "validate_lint")
    graph.add_edge("validate_lint", "double_check")
    
    # Conditional edge after double_check
    graph.add_conditional_edges(
        "double_check",
        should_retry,
        {
            "retry": "prepare_retry",
            "end": END,
        }
    )
    
    # Retry loops back to convert
    graph.add_edge("prepare_retry", "convert")
    
    # Set entry point
    graph.set_entry_point("convert")
    
    return graph.compile()


# Singleton compiled graph
_compiled_graph = None


def get_conversion_graph():
    """Get or create the compiled conversion graph"""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_conversion_graph()
    return _compiled_graph


def run_conversion_pipeline(
    *,
    source_config: str,
    source_ci: str,
    target_ci: str,
    provider: str,
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
    max_attempts: int = 3,
) -> dict:
    """
    Run the full conversion pipeline using LangGraph.
    
    Returns a dict with:
        - generated_yaml: The final generated YAML
        - yaml_ok: Whether YAML validation passed
        - yaml_error: YAML error message if any
        - actionlint_ok: Whether actionlint passed
        - actionlint_output: Actionlint output if any
        - double_check_ok: Whether semantic check passed
        - double_check_reasons: List of semantic check reasons
        - double_check_skipped: Whether double check was skipped
        - attempts: Number of attempts made
    """
    print(f"[LANGGRAPH] Starting conversion pipeline with max {max_attempts} attempts")
    
    # Initial state
    initial_state: PipelineState = {
        'source_config': source_config,
        'source_ci': source_ci,
        'target_ci': target_ci,
        'provider': provider,
        'model': model,
        'base_url': base_url,
        'api_key': api_key,
        'generated_yaml': '',
        'yaml_ok': False,
        'yaml_error': None,
        'actionlint_ok': False,
        'actionlint_output': None,
        'double_check_ok': None,
        'double_check_reasons': [],
        'double_check_skipped': True,
        'attempts': 1,
        'max_attempts': max_attempts,
        'feedback': '',
        'should_retry': False,
        'current_stage': 'start',
    }
    
    # Run the graph
    graph = get_conversion_graph()
    final_state = graph.invoke(initial_state)
    
    print(f"[LANGGRAPH] Pipeline completed after {final_state['attempts']} attempts")
    print(f"[LANGGRAPH] Final stage: {final_state['current_stage']}")
    
    return {
        'generated_yaml': final_state['generated_yaml'],
        'yaml_ok': final_state['yaml_ok'],
        'yaml_error': final_state['yaml_error'],
        'actionlint_ok': final_state['actionlint_ok'],
        'actionlint_output': final_state['actionlint_output'],
        'double_check_ok': final_state['double_check_ok'],
        'double_check_reasons': final_state['double_check_reasons'],
        'double_check_skipped': final_state['double_check_skipped'],
        'attempts': final_state['attempts'],
    }
