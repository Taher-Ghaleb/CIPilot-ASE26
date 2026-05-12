#!/usr/bin/env python3
"""
CIPilot Batch Pipeline - Mass-produce CI/CD migrations

Usage:
    python run.py --input repos.csv --output results.csv
    python run.py --input repos.csv --output results.csv --strictness permissive --pr-on-lint-fail
    python run.py --input repos.csv --output results.csv --dry-run
    python run.py --input repos.csv --output results.csv --resume
"""

import argparse
import sys
import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import PipelineConfig, StrictnessLevel
from runner import PipelineRunner


def parse_args():
    parser = argparse.ArgumentParser(
        description="CIPilot Batch Pipeline - Mass CI/CD migrations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage
  python run.py --input repos.csv --output results.csv

  # Permissive mode (always create PRs)
  python run.py --input repos.csv --output results.csv --strictness permissive

  # Create PRs even if validation fails (for user feedback)
  python run.py --input repos.csv --output results.csv --pr-on-lint-fail --pr-on-double-check-fail

  # Dry run (no PRs created)
  python run.py --input repos.csv --output results.csv --dry-run

  # Resume interrupted run
  python run.py --input repos.csv --output results.csv --resume

  # With custom LLM provider
  python run.py --input repos.csv --output results.csv --provider openai --model gpt-4 --api-key $OPENAI_API_KEY
        """
    )
    
    # Input/Output
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Input CSV or JSON file with repository URLs"
    )
    parser.add_argument(
        "--output", "-o",
        default="results.csv",
        help="Output CSV file for results (default: results.csv)"
    )
    
    # Strictness
    parser.add_argument(
        "--strictness", "-s",
        choices=["strict", "lint_only", "permissive", "dry_run"],
        default="strict",
        help="Strictness level (default: strict)"
    )
    parser.add_argument(
        "--pr-on-lint-fail",
        action="store_true",
        help="Create PR even if linting fails"
    )
    parser.add_argument(
        "--pr-on-double-check-fail",
        action="store_true",
        help="Create PR even if double-check fails"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Don't create PRs, just report what would happen"
    )
    
    # Processing
    parser.add_argument(
        "--concurrent", "-c",
        type=int,
        default=2,
        help="Number of concurrent repos to process (default: 2)"
    )
    parser.add_argument(
        "--retries", "-r",
        type=int,
        default=3,
        help="Number of retries on failure (default: 3)"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from previous run (skip already processed repos)"
    )
    
    # Cloud GHA Verification
    parser.add_argument(
        "--cloud-gha-verify",
        action="store_true",
        help="Verify migrated workflows in GitHub Actions before creating PRs"
    )
    parser.add_argument(
        "--cloud-gha-timeout",
        type=int,
        default=600,
        help="Max seconds to wait for GHA run completion (default: 600)"
    )
    parser.add_argument(
        "--cloud-gha-retries",
        type=int,
        default=3,
        help="Max LLM fix attempts for fixable GHA errors (default: 3)"
    )
    
    # LLM settings
    parser.add_argument(
        "--provider",
        default=os.getenv("LLM_PROVIDER", "xai"),
        help="LLM provider (default: xai)"
    )
    parser.add_argument(
        "--model",
        default=os.getenv("LLM_MODEL", "grok-4-1-fast-reasoning"),
        help="LLM model (default: grok-4-1-fast-reasoning)"
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("LLM_API_KEY", ""),
        help="LLM API key (or set LLM_API_KEY env var)"
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("LLM_BASE_URL"),
        help="LLM base URL (optional)"
    )
    
    # GitHub settings
    parser.add_argument(
        "--github-pats",
        default=os.getenv("GITHUB_PATS", os.getenv("GITHUB_PAT", "")),
        help="Comma-separated GitHub PATs for rotation (or set GITHUB_PATS env var)"
    )
    parser.add_argument(
        "--branch-prefix",
        default="cipilot/migrated",
        help="PR branch prefix (default: cipilot/migrated)"
    )
    
    return parser.parse_args()


def main():
    args = parse_args()
    
    # Validate input file
    if not Path(args.input).exists():
        print(f"❌ Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # Validate API key
    if not args.api_key and args.provider != "ollama":
        print(f"❌ Error: LLM API key required for provider '{args.provider}'")
        print("   Set --api-key or LLM_API_KEY environment variable")
        sys.exit(1)
    
    # Validate GitHub PATs
    pats = [p.strip() for p in args.github_pats.split(",") if p.strip()]
    if not pats:
        print("❌ Error: At least one GitHub PAT required")
        print("   Set --github-pats or GITHUB_PATS environment variable")
        sys.exit(1)
    
    # Build config
    config = PipelineConfig(
        input_file=args.input,
        output_file=args.output,
        strictness=StrictnessLevel.DRY_RUN if args.dry_run else StrictnessLevel(args.strictness),
        pr_on_lint_fail=args.pr_on_lint_fail,
        pr_on_double_check_fail=args.pr_on_double_check_fail,
        max_concurrent=args.concurrent,
        max_retries=args.retries,
        llm_provider=args.provider,
        llm_model=args.model,
        llm_api_key=args.api_key,
        llm_base_url=args.base_url,
        github_pats=pats,
        pr_branch_prefix=args.branch_prefix,
        resume=args.resume,
        cloud_gha_verify=args.cloud_gha_verify,
        cloud_gha_timeout=args.cloud_gha_timeout,
        cloud_gha_retries=args.cloud_gha_retries,
    )
    
    # Print configuration summary
    print("\n" + "=" * 60)
    print("  CIPilot Batch Pipeline")
    print("=" * 60)
    print(f"  Input:        {args.input}")
    print(f"  Output:       {args.output}")
    print(f"  Strictness:   {config.strictness.value}")
    print(f"  Concurrent:   {config.max_concurrent}")
    print(f"  Retries:      {config.max_retries}")
    print(f"  LLM:          {config.llm_provider}/{config.llm_model}")
    print(f"  GitHub PATs:  {len(pats)} configured")
    print(f"  Resume:       {config.resume}")
    if config.cloud_gha_verify:
        print(f"  GHA Verify:   enabled (timeout={config.cloud_gha_timeout}s, retries={config.cloud_gha_retries})")
    print("=" * 60 + "\n")
    
    # Create and run pipeline
    runner = PipelineRunner(config)
    
    try:
        # Load repos
        repos = runner.load_repos(args.input)
        print(f"📋 Loaded {len(repos)} repositories from {args.input}")
        
        if not repos:
            print("⚠️  No repositories to process")
            sys.exit(0)
        
        # Run pipeline
        results = runner.run(repos)
        
        # Get final stats from runner
        s = runner.progress.stats if runner.progress else None
        elapsed = timedelta(seconds=int(s.elapsed_seconds)) if s else timedelta(0)
        
        # Build final summary matching the progress display
        total = s.total if s else len(results)
        
        # GHA section (only show if cloud_gha_verify enabled)
        gha_section = ""
        if config.cloud_gha_verify and s:
            gha_section = f"""║  ──────────────────────────────────────────────────────────────────────  ║
║  🔄 GHA Pending:  {s.gha_pending:<6}  │  ✓ GHA Passed:      {s.gha_passed:<5}              ║
║  🤖 Agent Repaired:{s.gha_fixed:<5}  │  ✗ GHA Failed:      {s.gha_failed:<5}              ║
║  🔑 Secret Errs:  {s.gha_secret_error:<6}  │  ⏸ GHA Skipped:     {s.gha_skipped:<5}              ║
"""
        
        summary = f"""
╔══════════════════════════════════════════════════════════════════════════╗
║                        PIPELINE COMPLETE                                 ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Total Processed:     {total:<6}                                           ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  ✓ Detected:      {s.detected if s else 0:<6}  │  ✗ No CI Found:     {s.no_ci_found if s else 0:<6}              ║
║  ✓ Migrated:      {s.migrated if s else 0:<6}  │  ✗ Migration Failed: {s.migration_failed if s else 0:<5}              ║
║  ✓ Lint Passed:   {s.lint_passed if s else 0:<6}  │  ✗ Lint Failed:      {s.lint_failed if s else 0:<5}              ║
║  ✓ Double-Check:  {s.double_check_passed if s else 0:<6}  │  ✗ DC Failed:        {s.double_check_failed if s else 0:<5}              ║
{gha_section}║  ✓ PRs Created:   {s.prs_created if s else 0:<6}  │  ⏸ PRs Skipped:      {s.prs_skipped if s else 0:<5}              ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  ✓ Success:       {s.success if s else 0:<6}  │  ~ Partial:          {s.partial if s else 0:<5}              ║
║  ✗ Failed:        {s.failed if s else 0:<6}  │                                          ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  Total Time:      {str(elapsed):<12}                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
"""
        print(summary)
        print(f"✅ Results written to: {args.output}")
        
    except KeyboardInterrupt:
        print("\n\n⏹️  Pipeline interrupted by user")
        runner.stop()
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Pipeline error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
