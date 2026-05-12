"""
Pipeline Runner - Orchestrates the batch migration process

Supports optional Cloud GHA Verification:
- When --cloud-gha-verify is enabled, workflows are pushed to forks and tested in GHA
- GHA verification runs asynchronously via a task queue
- Results are streamed to CSV as each GHA task completes
- Graceful shutdown with configurable grace period
"""
import asyncio
import signal
import time
from dataclasses import dataclass, field
from time import monotonic
from datetime import datetime
from typing import List, Optional, Set, Dict, Any
from pathlib import Path
import threading
import sys

# Handle both module and script imports
if __name__ == "__main__" or "." not in __name__:
    from config import PipelineConfig, StrictnessLevel
    from models import (
        RepoInput, RepoResult, PipelineStats, StageStatus,
        DetectionResult, MigrationResult, ValidationResult,
        DoubleCheckResult, PullRequestResult, GHAVerificationResult, GHAErrorType
    )
    from stages.detect import detect_ci, check_rate_limit, get_default_branch
    from stages.migrate import migrate_ci
    from stages.validate import validate_yaml
    from stages.double_check import semantic_double_check
    from stages.pull_request import create_pull_request, push_to_fork, create_pr_only
    from stages.gha_verify import verify_gha_run, get_workflow_file_from_path
    from stages.gha_fix_agent import fix_and_push_workflow, generate_pr_suggestions
    from reporters.csv_reporter import CSVReporter
    from reporters.console_progress import ConsoleProgress
else:
    from .config import PipelineConfig, StrictnessLevel
    from .models import (
        RepoInput, RepoResult, PipelineStats, StageStatus,
        DetectionResult, MigrationResult, ValidationResult,
        DoubleCheckResult, PullRequestResult, GHAVerificationResult, GHAErrorType
    )
    from .stages import detect_ci, migrate_ci, validate_yaml, semantic_double_check, create_pull_request
    from .stages.detect import check_rate_limit, get_default_branch
    from .stages.pull_request import push_to_fork, create_pr_only
    from .stages.gha_verify import verify_gha_run, get_workflow_file_from_path
    from .stages.gha_fix_agent import fix_and_push_workflow, generate_pr_suggestions
    from .reporters import CSVReporter, ConsoleProgress


@dataclass
class GHAVerificationTask:
    """Task for async GHA verification queue"""
    result: RepoResult  # The repo result to update
    fork_owner: str
    repo_name: str
    branch_name: str
    workflow_path: str
    current_yaml: str  # Current workflow YAML for fix attempts
    source_ci: str
    fix_attempt: int = 0
    row_index: Optional[int] = None  # CSV row index for updates
    queued_at: float = field(default_factory=monotonic)  # Wall-clock stamp for timeout budget


def _check_pat_scopes(pat: str) -> List[str]:
    """Return list of OAuth scopes for a PAT, or [] on error."""
    import requests
    try:
        resp = requests.get(
            "https://api.github.com/user",
            headers={"Authorization": f"token {pat}"},
            timeout=10,
        )
        scopes_header = resp.headers.get("X-OAuth-Scopes", "")
        return [s.strip() for s in scopes_header.split(",") if s.strip()]
    except Exception:
        return []


def validate_pats_for_gha(pats: List[str]) -> List[str]:
    """
    Validate PATs have required scopes for GHA verification (repo + workflow).
    Prints warnings for invalid PATs and returns only the valid ones.
    """
    valid = []
    for pat in pats:
        scopes = _check_pat_scopes(pat)
        short = pat[:12] + "..."
        if not scopes:
            print(f"⚠️  PAT {short}: could not read scopes (invalid/expired) — skipping")
            continue
        missing = [s for s in ("repo", "workflow") if s not in scopes]
        if missing:
            print(f"⚠️  PAT {short}: missing scopes {missing} — cannot write .github/workflows/ — skipping")
            print(f"   Regenerate this PAT with 'repo' and 'workflow' scopes at https://github.com/settings/tokens")
        else:
            print(f"✅ PAT {short}: scopes OK ({', '.join(scopes)})")
            valid.append(pat)
    return valid


class PATRotator:
    """Manages multiple GitHub PATs with automatic rotation on rate limit"""

    def __init__(self, pats: List[str]):
        self.pats = pats
        self.current_index = 0
        self._lock = threading.Lock()
        self._rate_limited: Set[int] = set()
    
    def get_pat(self) -> Optional[str]:
        """Get current PAT, rotating if needed"""
        with self._lock:
            if not self.pats:
                return None
            
            # Find a non-rate-limited PAT
            attempts = 0
            while attempts < len(self.pats):
                if self.current_index not in self._rate_limited:
                    return self.pats[self.current_index]
                self.current_index = (self.current_index + 1) % len(self.pats)
                attempts += 1
            
            # All rate limited, clear and try again
            self._rate_limited.clear()
            return self.pats[self.current_index]
    
    def mark_rate_limited(self):
        """Mark current PAT as rate limited and rotate"""
        with self._lock:
            self._rate_limited.add(self.current_index)
            self.current_index = (self.current_index + 1) % len(self.pats)
    
    def check_and_rotate_if_needed(self) -> bool:
        """Check rate limit and rotate if low. Returns True if ok to proceed."""
        pat = self.get_pat()
        if not pat:
            return False
        
        remaining, reset_time = check_rate_limit(pat)
        
        if remaining < 100:  # Low on requests
            self.mark_rate_limited()
            # Check if we have another PAT
            new_pat = self.get_pat()
            if new_pat != pat:
                return True
            # All PATs are low, wait a bit
            wait_time = max(0, reset_time - time.time())
            if wait_time > 0 and wait_time < 3600:  # Max 1 hour wait
                print(f"\n⏳ Rate limit low, waiting {int(wait_time)}s...")
                time.sleep(min(wait_time, 60))  # Wait max 60s at a time
        
        return True


class PipelineRunner:
    """Main pipeline orchestrator"""
    
    def __init__(self, config: PipelineConfig):
        self.config = config

        # When GHA verification is enabled, validate PAT scopes and filter out
        # tokens that can't write .github/workflows/ (missing 'workflow' scope).
        pats = config.github_pats
        if config.cloud_gha_verify and pats:
            print("🔑 Validating GitHub PAT scopes for GHA verification...")
            pats = validate_pats_for_gha(pats)
            if not pats:
                raise ValueError(
                    "No valid GitHub PATs with 'repo' + 'workflow' scopes found.\n"
                    "Regenerate your PAT at https://github.com/settings/tokens and "
                    "ensure both 'repo' and 'workflow' scopes are checked."
                )

        self.pat_rotator = PATRotator(pats)
        self.csv_reporter: Optional[CSVReporter] = None
        self.progress: Optional[ConsoleProgress] = None
        self.results: List[RepoResult] = []
        self._stop_requested = False

        # GHA verification queue and state
        self._gha_queue: Optional[asyncio.Queue] = None
        self._gha_shutdown = asyncio.Event() if config.cloud_gha_verify else None
        self._gha_workers: List[asyncio.Task] = []
        self._gha_pending_count = 0
        self._gha_lock = threading.Lock()
    
    def load_repos(self, input_path: str) -> List[RepoInput]:
        """Load repositories from CSV or JSON file"""
        path = Path(input_path)
        
        if not path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")
        
        repos: List[RepoInput] = []
        
        if path.suffix.lower() == ".json":
            import json
            with open(path, "r") as f:
                data = json.load(f)
            
            for item in data:
                if isinstance(item, str):
                    repos.append(RepoInput(repo_url=item))
                elif isinstance(item, dict):
                    repos.append(RepoInput(
                        repo_url=item.get("repo_url", item.get("url", "")),
                        target_branch=item.get("target_branch", self.config.target_branch)
                    ))
        else:
            # Assume CSV
            import csv
            with open(path, "r", newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    repo_url = row.get("repo_url", row.get("url", row.get("repo", "")))
                    if repo_url:
                        repos.append(RepoInput(
                            repo_url=repo_url.strip(),
                            target_branch=row.get("target_branch", self.config.target_branch)
                        ))
        
        return repos
    
    def run(self, repos: List[RepoInput]) -> List[RepoResult]:
        """Run the pipeline on all repos, ensuring every input repo is represented in the output."""
        # Setup CSV reporter
        self.csv_reporter = CSVReporter(
            self.config.output_file,
            include_yaml_content=True
        )

        # Handle resume
        processed_repos: Set[str] = set()
        gha_pending_tasks: List[Dict[str, Any]] = []

        if self.config.resume:
            processed_repos = self.csv_reporter.load_processed_repos()
            print(f"📂 Resuming: {len(processed_repos)} repos already processed")

            # If GHA verify enabled, also load gha_pending tasks
            if self.config.cloud_gha_verify:
                gha_pending_tasks = self.csv_reporter.load_gha_pending()
                if gha_pending_tasks:
                    print(f"🔄 Found {len(gha_pending_tasks)} GHA pending tasks to resume")

            repos = [r for r in repos if r.repo_url not in processed_repos]

        if not repos and not gha_pending_tasks:
            print("✅ All repos already processed!")
            return []

        # Initialize CSV (creates headers if new file)
        self.csv_reporter.initialize()

        # Setup progress display
        total_count = len(repos) + len(gha_pending_tasks)
        self.progress = ConsoleProgress(total_count)

        # Setup GHA queue if enabled
        if self.config.cloud_gha_verify:
            asyncio.run(self._run_with_gha_verify(repos, gha_pending_tasks))
        else:
            # Original flow without GHA verify
            if self.config.max_concurrent > 1:
                asyncio.run(self._run_parallel(repos))
            else:
                self._run_sequential(repos)

        # After main processing, ensure every input repo is represented in the output
        all_input_urls = set(r.repo_url for r in repos)
        written_urls = set(r.input.repo_url for r in self.results)
        missing_urls = all_input_urls - written_urls
        if missing_urls:
            for repo in repos:
                if repo.repo_url in missing_urls:
                    from models import RepoResult
                    skipped_result = RepoResult(input=repo)
                    skipped_result.overall_status = "skipped"
                    skipped_result.skip_reason = "Not processed (skipped by pipeline)"
                    self.csv_reporter.write_result(skipped_result)
                    self.results.append(skipped_result)

        # Show final summary
        if self.progress:
            self.progress.finish()

        return self.results
    
    def _run_sequential(self, repos: List[RepoInput]):
        """Process repos one at a time"""
        for repo in repos:
            if self._stop_requested:
                break
            
            # _process_repo now returns a LIST (one result per detected CI)
            results_for_repo = self._process_repo(repo)
            self.results.extend(results_for_repo)
            
            # CSV writing is now done inside _process_repo per CI config
            # Update progress for each result
            if self.progress:
                for result in results_for_repo:
                    self.progress.complete_repo(result.overall_status)
    
    async def _run_parallel(self, repos: List[RepoInput]):
        """Process repos in parallel with concurrency limit"""
        semaphore = asyncio.Semaphore(self.config.max_concurrent)
        
        async def process_with_semaphore(repo: RepoInput) -> List[RepoResult]:
            async with semaphore:
                # Run in thread pool to not block
                loop = asyncio.get_event_loop()
                results_for_repo = await loop.run_in_executor(None, self._process_repo, repo)
                
                # CSV writing is done inside _process_repo
                # Update progress for each result
                if self.progress:
                    for result in results_for_repo:
                        self.progress.complete_repo(result.overall_status)
                
                return results_for_repo
        
        tasks = [process_with_semaphore(repo) for repo in repos]
        nested_results = await asyncio.gather(*tasks)
        # Flatten list of lists
        self.results = [r for results_list in nested_results for r in results_list]
    
    async def _run_with_gha_verify(self, repos: List[RepoInput], resume_tasks: List[Dict[str, Any]]):
        """
        Process repos with GHA verification enabled.
        Main pipeline continues while GHA verification runs asynchronously.
        """
        # Setup GHA queue
        self._gha_queue = asyncio.Queue()
        self._gha_shutdown = asyncio.Event()
        self._pending_gha_tasks = []  # Thread-safe task staging area
        
        # Setup signal handlers for graceful shutdown
        loop = asyncio.get_event_loop()
        
        def handle_shutdown(signum, frame):
            if self._stop_requested:
                # Second Ctrl+C — force immediate exit
                print("\n\n💀 Forced exit.")
                import os
                os._exit(1)
            print(f"\n\n🛑 Shutdown signal received. Graceful shutdown in {self.config.cloud_gha_grace_period}s... (Ctrl+C again to force quit)")
            self._stop_requested = True
            # Schedule the shutdown
            loop.call_soon_threadsafe(self._initiate_graceful_shutdown)
        
        # Register signal handlers
        original_sigint = signal.signal(signal.SIGINT, handle_shutdown)
        original_sigterm = signal.signal(signal.SIGTERM, handle_shutdown)
        
        try:
            # Start GHA worker tasks
            for i in range(self.config.max_concurrent):
                worker = asyncio.create_task(self._gha_worker(i))
                self._gha_workers.append(worker)
            
            # Start task feeder (moves tasks from thread-safe list to async queue)
            feeder = asyncio.create_task(self._gha_task_feeder())
            
            # Resume any pending GHA tasks first
            for task_data in resume_tasks:
                await self._resume_gha_task(task_data)
            
            # Process repos (this will enqueue GHA tasks)
            semaphore = asyncio.Semaphore(self.config.max_concurrent)
            
            async def process_with_semaphore(repo: RepoInput) -> List[RepoResult]:
                async with semaphore:
                    if self._stop_requested:
                        return []
                    loop = asyncio.get_event_loop()
                    results_for_repo = await loop.run_in_executor(
                        None, self._process_repo_with_gha, repo
                    )
                    return results_for_repo
            
            # Process all repos
            tasks = [process_with_semaphore(repo) for repo in repos]
            nested_results = await asyncio.gather(*tasks)
            self.results = [r for results_list in nested_results for r in results_list]

            # Repos that failed/skipped before a GHA task was queued never reach
            # the GHA worker's finally block, so complete_repo is never called for them.
            # Call it now for every result that isn't still gha_pending.
            if self.progress:
                for result in self.results:
                    if result.overall_status != "gha_pending":
                        self.progress.complete_repo(result.overall_status)
            
            # Wait for ALL in-flight GHA tasks to finish before declaring completion.
            # _gha_shutdown only stops new task intake; it must not abandon queued tasks.
            # Per-task timeouts (enforced inside verify_gha_run) prevent infinite blocking.
            print(f"\n⏳ Main pipeline complete. Waiting for {self._gha_pending_count} GHA verifications...")

            while self._gha_pending_count > 0:
                await asyncio.sleep(1)
            
            # Stop the task feeder
            feeder.cancel()
            try:
                await feeder
            except asyncio.CancelledError:
                pass
            
            # Signal workers to stop
            for _ in self._gha_workers:
                await self._gha_queue.put(None)
            
            # Wait for workers to finish
            await asyncio.gather(*self._gha_workers, return_exceptions=True)
            
        finally:
            # Restore original signal handlers
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)
    
    def _initiate_graceful_shutdown(self):
        """Initiate graceful shutdown with countdown"""
        async def shutdown_countdown():
            for remaining in range(self.config.cloud_gha_grace_period, 0, -1):
                if self._gha_pending_count == 0:
                    break
                print(f"   Graceful shutdown in {remaining}s... ({self._gha_pending_count} GHA tasks remaining)")
                await asyncio.sleep(1)
            
            print("   Shutting down GHA workers...")
            self._gha_shutdown.set()
        
        asyncio.create_task(shutdown_countdown())
    
    async def _gha_task_feeder(self):
        """
        Continuously moves tasks from the thread-safe pending list to the async queue.
        This bridges the gap between sync thread pool execution and async workers.
        """
        while True:
            try:
                # Check for pending tasks
                tasks_to_queue = []
                with self._gha_lock:
                    if hasattr(self, '_pending_gha_tasks') and self._pending_gha_tasks:
                        tasks_to_queue = self._pending_gha_tasks[:]
                        self._pending_gha_tasks.clear()
                
                # Add tasks to async queue
                for task in tasks_to_queue:
                    await self._gha_queue.put(task)
                
                # Small sleep to prevent busy-waiting
                await asyncio.sleep(0.1)
                
            except asyncio.CancelledError:
                # Handle remaining tasks before exit
                with self._gha_lock:
                    if hasattr(self, '_pending_gha_tasks') and self._pending_gha_tasks:
                        for task in self._pending_gha_tasks:
                            await self._gha_queue.put(task)
                        self._pending_gha_tasks.clear()
                raise
    
    async def _gha_worker(self, worker_id: int):
        """Worker coroutine that processes GHA verification tasks.

        Shutdown (_gha_shutdown) only stops new task intake; workers must drain
        the queue fully before exiting so no task is silently abandoned.
        """
        while True:
            try:
                # Get next task; timeout lets us loop and stay responsive
                try:
                    task = await asyncio.wait_for(
                        self._gha_queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                if task is None:  # Explicit shutdown sentinel from main loop
                    break

                # Process the GHA verification task
                await self._process_gha_task(task, worker_id)

            except Exception as e:
                print(f"[GHA Worker {worker_id}] Error: {e}")
    
    async def _process_gha_task(self, task: GHAVerificationTask, worker_id: int):
        """Process a single GHA verification task"""
        result = task.result
        
        print(f"[GHA Worker {worker_id}] Processing task for {result.input.full_name}, row_index={task.row_index}")
        
        try:
            if self.progress:
                self.progress.update_current(
                    f"{result.input.full_name} ({task.source_ci})",
                    f"GHA verify (attempt {task.fix_attempt + 1})"
                )
            
            # Get PAT
            pat = self.pat_rotator.get_pat()

            # Honour wall-clock budget from when the task was first queued so a
            # task that waited in the queue still respects the 30-min total limit.
            elapsed_since_queue = int(monotonic() - task.queued_at)
            remaining_timeout = max(60, self.config.cloud_gha_timeout - elapsed_since_queue)

            # Run GHA verification
            gha_result = await verify_gha_run(
                fork_owner=task.fork_owner,
                repo_name=task.repo_name,
                branch_name=task.branch_name,
                workflow_file=get_workflow_file_from_path(task.workflow_path),
                github_pat=pat,
                timeout_seconds=remaining_timeout,
                poll_interval=self.config.cloud_gha_poll_interval,
            )
            
            result.gha_verification = gha_result
            
            print(f"[GHA Worker] Result for {result.input.full_name}: status={gha_result.status}, conclusion={gha_result.run_conclusion}, error_type={gha_result.error_type}")
            if gha_result.run_id:
                print(f"[GHA Worker]   Run ID: {gha_result.run_id}, URL: https://github.com/{task.fork_owner}/{task.repo_name}/actions/runs/{gha_result.run_id}")
            
            # Handle result based on error type
            if gha_result.status == StageStatus.SUCCESS:
                # GHA passed! Create PR
                print(f"[GHA Worker] ✅ GHA PASSED - Creating PR")
                await self._complete_gha_success(task, result)
                
            elif gha_result.error_type == GHAErrorType.SECRET_ERROR:
                # Secret errors - mark as passed (user needs to add secrets), create PR
                print(f"[GHA Worker] 🔑 SECRET ERROR - Creating PR (user needs to configure secrets)")
                await self._complete_gha_secret_error(task, result)
                
            else:
                # All non-secret errors — attempt LLM fix regardless of error category
                if task.fix_attempt < self.config.cloud_gha_retries:
                    print(f"[GHA Worker] 🔧 {gha_result.error_type.value.upper()} - Attempting LLM fix (attempt {task.fix_attempt + 1}/{self.config.cloud_gha_retries})")
                    if gha_result.error_logs:
                        error_preview = "\n".join(gha_result.error_logs.split("\n")[:5])
                        print(f"[GHA Worker]   Error preview:\n{error_preview}")
                    await self._attempt_gha_fix(task, result)
                else:
                    print(f"[GHA Worker] ❌ MAX RETRIES REACHED ({gha_result.error_type.value}) - Completing with failure")
                    await self._complete_gha_max_retries(task, result)
            
        except Exception as e:
            result.gha_verification.status = StageStatus.FAILED
            result.gha_verification.error = str(e)
            result.overall_status = "failed"
            result.error_message = f"GHA verification error: {e}"
            
            # Update CSV
            if self.csv_reporter and task.row_index is not None:
                self.csv_reporter.update_result(task.row_index, result)
            
        finally:
            with self._gha_lock:
                self._gha_pending_count -= 1

            if self.progress:
                self.progress.increment_stat("gha_pending", -1)
                self.progress.complete_repo(result.overall_status)
    
    async def _complete_gha_success(self, task: GHAVerificationTask, result: RepoResult):
        """Complete GHA verification with success - create PR"""
        pat = self.pat_rotator.get_pat()
        
        # Preserve fix_attempts from the task
        result.gha_verification.fix_attempts = task.fix_attempt
        
        pr_result = create_pr_only(
            repo=result.input,
            fork_owner=task.fork_owner,
            branch_name=task.branch_name,
            source_ci=task.source_ci,
            github_pat=pat,
            gha_status="success",
            gha_run_url=result.gha_verification.run_url,
        )

        result.pull_request = pr_result
        result.overall_status = "success" if pr_result.status == StageStatus.SUCCESS else "partial"

        if self.progress:
            if pr_result.status == StageStatus.SUCCESS:
                self.progress.increment_stat("prs_created")
            self.progress.increment_stat("gha_passed")
        
        # Update CSV
        if self.csv_reporter and task.row_index is not None:
            self.csv_reporter.update_result(task.row_index, result)
    
    async def _complete_gha_secret_error(self, task: GHAVerificationTask, result: RepoResult):
        """Complete GHA with secret error - still create PR"""
        pat = self.pat_rotator.get_pat()
        print(f"[GHA Worker] Calling generate_pr_suggestions (secret_error): error_logs_len={len(result.gha_verification.error_logs or '')}")
        suggestions, suggestion_error = await asyncio.to_thread(
            generate_pr_suggestions,
            error_logs=result.gha_verification.error_logs or "",
            workflow_yaml=task.current_yaml,
            error_type="secret_error",
            fix_attempts=0,
            config=self.config,
        )
        print(f"[GHA Worker] generate_pr_suggestions returned {len(suggestions)} suggestion(s){f' | error: {suggestion_error}' if suggestion_error else ''}")
        result.gha_verification.llm_suggestions = suggestions
        result.gha_verification.llm_suggestions_error = suggestion_error

        pr_result = create_pr_only(
            repo=result.input,
            fork_owner=task.fork_owner,
            branch_name=task.branch_name,
            source_ci=task.source_ci,
            github_pat=pat,
            gha_status="failed",
            gha_error_type="secret_error",
            gha_fix_attempts=0,
            gha_run_url=result.gha_verification.run_url,
            llm_suggestions=suggestions or None,
        )
        
        result.pull_request = pr_result
        result.overall_status = "success" if pr_result.status == StageStatus.SUCCESS else "partial"
        
        if self.progress:
            if pr_result.status == StageStatus.SUCCESS:
                self.progress.increment_stat("prs_created")
            self.progress.increment_stat("gha_secret_error")
        
        # Update CSV
        if self.csv_reporter and task.row_index is not None:
            self.csv_reporter.update_result(task.row_index, result)
    
    async def _attempt_gha_fix(self, task: GHAVerificationTask, result: RepoResult):
        """Attempt to fix GHA error with LLM and re-queue"""
        pat = self.pat_rotator.get_pat()
        
        if self.progress:
            self.progress.update_current(
                f"{result.input.full_name} ({task.source_ci})",
                f"Repairing (attempt {task.fix_attempt + 1})"
            )
        
        # Try to fix the workflow
        fixed_yaml, fix_error = await fix_and_push_workflow(
            fork_owner=task.fork_owner,
            repo_name=task.repo_name,
            branch_name=task.branch_name,
            workflow_path=task.workflow_path,
            current_yaml=task.current_yaml,
            error_logs=result.gha_verification.error_logs or "",
            github_pat=pat,
            config=self.config,
        )
        
        if fixed_yaml:
            # Re-queue with updated YAML and incremented attempt
            result.gha_verification.fix_attempts = task.fix_attempt + 1
            result.gha_verification.fixed_yaml = fixed_yaml
            
            new_task = GHAVerificationTask(
                result=result,
                fork_owner=task.fork_owner,
                repo_name=task.repo_name,
                branch_name=task.branch_name,
                workflow_path=task.workflow_path,
                current_yaml=fixed_yaml,
                source_ci=task.source_ci,
                fix_attempt=task.fix_attempt + 1,
                row_index=task.row_index,
            )
            
            # Update CSV to show fix in progress
            if self.csv_reporter and task.row_index is not None:
                self.csv_reporter.update_result(task.row_index, result)
            
            # Re-queue (don't decrement pending count since we're re-queueing)
            with self._gha_lock:
                self._gha_pending_count += 1  # Will be decremented when this task completes
            await self._gha_queue.put(new_task)
            
            if self.progress:
                self.progress.increment_stat("gha_fixed")
        else:
            # Fix failed, complete with failure
            result.gha_verification.error = f"LLM fix failed: {fix_error}"
            await self._complete_gha_max_retries(task, result)
    
    async def _complete_gha_max_retries(self, task: GHAVerificationTask, result: RepoResult):
        """Complete GHA after max fix retries"""
        # Preserve fix_attempts from the task
        result.gha_verification.fix_attempts = task.fix_attempt
        
        # Check if we should still create PR based on strictness
        should_create_pr = self.config.should_create_pr_on_gha_fail(
            result.gha_verification.error_type.value,
            task.fix_attempt
        )
        
        if should_create_pr:
            pat = self.pat_rotator.get_pat()
            print(f"[GHA Worker] Calling generate_pr_suggestions (max_retries): error_type={result.gha_verification.error_type.value}, error_logs_len={len(result.gha_verification.error_logs or '')}")
            suggestions, suggestion_error = await asyncio.to_thread(
                generate_pr_suggestions,
                error_logs=result.gha_verification.error_logs or "",
                workflow_yaml=task.current_yaml,
                error_type=result.gha_verification.error_type.value,
                fix_attempts=task.fix_attempt,
                config=self.config,
            )
            print(f"[GHA Worker] generate_pr_suggestions returned {len(suggestions)} suggestion(s){f' | error: {suggestion_error}' if suggestion_error else ''}")
            result.gha_verification.llm_suggestions = suggestions
            result.gha_verification.llm_suggestions_error = suggestion_error
            pr_result = create_pr_only(
                repo=result.input,
                fork_owner=task.fork_owner,
                branch_name=task.branch_name,
                source_ci=task.source_ci,
                github_pat=pat,
                gha_status="failed",
                gha_error_type=result.gha_verification.error_type.value,
                gha_fix_attempts=task.fix_attempt,
                gha_run_url=result.gha_verification.run_url,
                llm_suggestions=suggestions or None,
            )

            result.pull_request = pr_result
            result.overall_status = "partial"

            if self.progress and pr_result.status == StageStatus.SUCCESS:
                self.progress.increment_stat("prs_created")
        else:
            result.pull_request.status = StageStatus.SKIPPED
            result.pull_request.skipped_reason = "GHA verification failed (strict mode)"
            result.overall_status = "failed"

            if self.progress:
                self.progress.increment_stat("prs_skipped")

        if self.progress:
            self.progress.increment_stat("gha_failed")

        # Update CSV
        if self.csv_reporter and task.row_index is not None:
            self.csv_reporter.update_result(task.row_index, result)

    async def _complete_gha_failure(self, task: GHAVerificationTask, result: RepoResult):
        """Complete GHA with unknown/timeout failure"""
        # Preserve fix_attempts from the task
        result.gha_verification.fix_attempts = task.fix_attempt

        should_create_pr = self.config.should_create_pr_on_gha_fail(
            result.gha_verification.error_type.value,
            task.fix_attempt
        )

        if should_create_pr:
            pat = self.pat_rotator.get_pat()
            print(f"[GHA Worker] Calling generate_pr_suggestions (failure): error_type={result.gha_verification.error_type.value}, error_logs_len={len(result.gha_verification.error_logs or '')}")
            suggestions, suggestion_error = await asyncio.to_thread(
                generate_pr_suggestions,
                error_logs=result.gha_verification.error_logs or "",
                workflow_yaml=task.current_yaml,
                error_type=result.gha_verification.error_type.value,
                fix_attempts=task.fix_attempt,
                config=self.config,
            )
            print(f"[GHA Worker] generate_pr_suggestions returned {len(suggestions)} suggestion(s){f' | error: {suggestion_error}' if suggestion_error else ''}")
            result.gha_verification.llm_suggestions = suggestions
            result.gha_verification.llm_suggestions_error = suggestion_error
            pr_result = create_pr_only(
                repo=result.input,
                fork_owner=task.fork_owner,
                branch_name=task.branch_name,
                source_ci=task.source_ci,
                github_pat=pat,
                gha_status="failed",
                gha_error_type=result.gha_verification.error_type.value,
                gha_fix_attempts=task.fix_attempt,
                gha_run_url=result.gha_verification.run_url,
                llm_suggestions=suggestions or None,
            )

            result.pull_request = pr_result
            result.overall_status = "partial"

            if self.progress and pr_result.status == StageStatus.SUCCESS:
                self.progress.increment_stat("prs_created")
        else:
            result.pull_request.status = StageStatus.SKIPPED
            result.pull_request.skipped_reason = "GHA verification failed"
            result.overall_status = "failed"
            
            if self.progress:
                self.progress.increment_stat("prs_skipped")
        
        if self.progress:
            self.progress.increment_stat("gha_failed")
        
        # Update CSV
        if self.csv_reporter and task.row_index is not None:
            self.csv_reporter.update_result(task.row_index, result)
    
    async def _resume_gha_task(self, task_data: Dict[str, Any]):
        """Resume a GHA pending task from CSV"""
        # Reconstruct RepoInput
        repo = RepoInput(
            repo_url=task_data.get("repo_url", ""),
            target_branch=task_data.get("target_branch", "main")
        )
        
        # Reconstruct RepoResult with minimal data
        result = RepoResult(input=repo, llm_provider=self.config.llm_provider, llm_model=self.config.llm_model)
        result.overall_status = "gha_pending"
        result.gha_fork_owner = task_data.get("gha_fork_owner")
        result.gha_branch_name = task_data.get("gha_branch_name")
        
        # Create GHA task
        task = GHAVerificationTask(
            result=result,
            fork_owner=task_data.get("gha_fork_owner", ""),
            repo_name=repo.name,
            branch_name=task_data.get("gha_branch_name", ""),
            workflow_path=".github/workflows/ci.yml",
            current_yaml=task_data.get("migrated_yaml", ""),
            source_ci=task_data.get("detected_ci", "unknown"),
            fix_attempt=task_data.get("gha_fix_attempts", 0),
            row_index=task_data.get("row_index"),
        )
        
        with self._gha_lock:
            self._gha_pending_count += 1
        
        await self._gha_queue.put(task)
    
    def _process_repo_with_gha(self, repo: RepoInput) -> List[RepoResult]:
        """
        Process repo with GHA verification flow.
        Pushes to fork, writes gha_pending to CSV, queues GHA verification.
        """
        results: List[RepoResult] = []
        
        try:
            # Same initial processing as _process_repo
            pat = self.pat_rotator.get_pat()
            if not pat:
                result = RepoResult(input=repo)
                result.started_at = datetime.now()
                result.overall_status = "failed"
                result.error_message = "No GitHub PAT available"
                return [self._finalize_result(result)]
            
            self.pat_rotator.check_and_rotate_if_needed()
            pat = self.pat_rotator.get_pat()
            
            # Stage 1: Detection
            if self.progress:
                self.progress.update_current(repo.full_name, "detecting")

            detection_result = detect_ci(
                repo=repo,
                github_pat=pat,
                retries=self.config.max_retries,
                retry_delay=self.config.retry_delay_seconds
            )

            if detection_result.status == StageStatus.FAILED:
                # Rate-limit during detection — wait for reset and retry once
                if detection_result.error and "rate limit" in detection_result.error.lower():
                    import re as _re
                    ts_match = _re.search(r"timestamp\s+(\d+)", detection_result.error)
                    if ts_match:
                        reset_ts = int(ts_match.group(1))
                        wait_secs = max(0, reset_ts - int(time.time())) + 5
                        if wait_secs < 120:  # Only wait if reset is very soon (< 2 min); otherwise fail fast
                            print(f"\n⏳ Rate limit hit during detection — waiting {wait_secs}s for reset...")
                            time.sleep(wait_secs)
                            self.pat_rotator.check_and_rotate_if_needed()
                            pat = self.pat_rotator.get_pat()
                            detection_result = detect_ci(
                                repo=repo,
                                github_pat=pat,
                                retries=self.config.max_retries,
                                retry_delay=self.config.retry_delay_seconds,
                            )
                if detection_result.status == StageStatus.FAILED:
                    if self.progress:
                        self.progress.increment_stat("detection_failed")
                    result = RepoResult(input=repo)
                    result.started_at = datetime.now()
                    result.detection = detection_result
                    result.overall_status = "failed"
                    result.error_message = detection_result.error
                    result = self._finalize_result(result)
                    if self.csv_reporter:
                        self.csv_reporter.write_result(result)
                    return [result]

            if not detection_result.detected_configs:
                if self.progress:
                    self.progress.increment_stat("no_ci_found")
                result = RepoResult(input=repo)
                result.started_at = datetime.now()
                result.detection = detection_result
                result.overall_status = "failed"
                result.error_message = "No CI configuration found"
                result = self._finalize_result(result)
                if self.csv_reporter:
                    self.csv_reporter.write_result(result)
                return [result]

            # Get correct default branch
            actual_default = get_default_branch(repo, pat)
            if actual_default and actual_default != repo.target_branch:
                repo.target_branch = actual_default
            
            num_configs = len(detection_result.detected_configs)
            if self.progress:
                self.progress.increment_stat("detected", num_configs)
            
            for config in detection_result.detected_configs:
                ci_result, gha_task = self._process_single_ci_with_gha(
                    repo=repo,
                    ci_config=config,
                    all_detected=[c.ci_type for c in detection_result.detected_configs]
                )
                results.append(ci_result)
                
                # Write to CSV (with gha_pending status)
                if self.csv_reporter:
                    row_index = self.csv_reporter.write_result(ci_result)
                    
                    # If GHA pending, update the task with row index
                    if ci_result.overall_status == "gha_pending" and gha_task is not None:
                        gha_task.row_index = row_index
            
            return results
            
        except Exception as e:
            result = RepoResult(input=repo)
            result.started_at = datetime.now()
            result.overall_status = "failed"
            result.error_message = str(e)
            return [self._finalize_result(result)]
    
    def _process_single_ci_with_gha(self, repo: RepoInput, ci_config, all_detected: List[str]) -> tuple:
        """
        Process single CI with GHA verification flow.
        
        Returns:
            Tuple of (RepoResult, Optional[GHAVerificationTask])
            The task is returned so the caller can set row_index after CSV write.
        """
        from models import DetectedConfig, DetectionResult
        gha_task = None  # Will be set if GHA verification is queued
        
        result = RepoResult(input=repo)
        result.started_at = datetime.now()
        result.all_detected_in_repo = all_detected
        
        result.detection = DetectionResult(
            status=StageStatus.SUCCESS,
            detected_configs=[ci_config]
        )
        
        try:
            # Stage 2: Migration
            if self.progress:
                self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "migrating")
            
            result.migration = migrate_ci(
                source_yaml=ci_config.source_yaml,
                source_ci=ci_config.ci_type,
                target_ci="github-actions",
                config=self.config,
                retries=self.config.max_retries,
                retry_delay=self.config.retry_delay_seconds
            )
            
            if result.migration.status == StageStatus.FAILED:
                if self.progress:
                    self.progress.increment_stat("migration_failed")
                result.overall_status = "failed"
                result.error_message = result.migration.error
                return self._finalize_result(result)
            
            if self.progress:
                self.progress.increment_stat("migrated")
            
            # Stage 3: Validation
            if self.progress:
                self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "validating")
            
            result.validation = validate_yaml(
                yaml_content=result.migration.migrated_yaml
            )
            
            lint_passed = result.validation.lint_valid
            if lint_passed:
                if self.progress:
                    self.progress.increment_stat("lint_passed")
            else:
                if self.progress:
                    self.progress.increment_stat("lint_failed")
            
            # Stage 4: Double-Check (if applicable)
            should_double_check = self.config.should_run_double_check(lint_passed)
            
            if should_double_check:
                if self.progress:
                    self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "double-check")
                
                result.double_check = semantic_double_check(
                    source_yaml=ci_config.source_yaml,
                    migrated_yaml=result.migration.migrated_yaml,
                    source_ci=ci_config.ci_type,
                    target_ci="github-actions",
                    config=self.config,
                    retries=self.config.max_retries,
                    retry_delay=self.config.retry_delay_seconds
                )
                
                if result.double_check.passed:
                    if self.progress:
                        self.progress.increment_stat("double_check_passed")
                else:
                    if self.progress:
                        self.progress.increment_stat("double_check_failed")
            else:
                result.double_check.status = StageStatus.SKIPPED
                if self.progress:
                    self.progress.increment_stat("double_check_skipped")
            
            # Check if we should proceed to GHA verification
            double_check_passed = result.double_check.passed or result.double_check.status == StageStatus.SKIPPED
            should_create_pr = self.config.should_create_pr(lint_passed, double_check_passed)
            
            if not should_create_pr:
                # Skip GHA verification if PR wouldn't be created anyway
                result.gha_verification.status = StageStatus.SKIPPED
                result.gha_verification.skipped_reason = "PR not eligible"
                result.pull_request.status = StageStatus.SKIPPED
                result.overall_status = "partial" if lint_passed else "failed"
                return self._finalize_result(result), None
            
            # Stage 5: Push to Fork (for GHA verification)
            if self.progress:
                self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "pushing to fork")
            
            pat = self.pat_rotator.get_pat()
            
            push_result = push_to_fork(
                repo=repo,
                migrated_yaml=result.migration.migrated_yaml,
                source_ci=ci_config.ci_type,
                github_pat=pat,
                branch_prefix=self.config.pr_branch_prefix,
                retries=self.config.max_retries,
                retry_delay=self.config.retry_delay_seconds,
            )
            
            if not push_result.success:
                result.gha_verification.status = StageStatus.FAILED
                result.gha_verification.error = push_result.error
                result.overall_status = "failed"
                result.error_message = f"Push to fork failed: {push_result.error}"
                return self._finalize_result(result), None
            
            # Store fork info for resume support
            result.gha_fork_owner = push_result.fork_owner
            result.gha_branch_name = push_result.branch_name
            result.pull_request.fork_url = push_result.fork_url
            result.pull_request.branch_name = push_result.branch_name
            
            # Mark as gha_pending and queue for verification
            result.overall_status = "gha_pending"
            result.gha_verification.status = StageStatus.RUNNING
            
            if self.progress:
                self.progress.increment_stat("gha_pending")
            
            # Queue GHA verification task
            gha_task = GHAVerificationTask(
                result=result,
                fork_owner=push_result.fork_owner,
                repo_name=repo.name,
                branch_name=push_result.branch_name,
                workflow_path=push_result.workflow_path,
                current_yaml=result.migration.migrated_yaml,
                source_ci=ci_config.ci_type,
                fix_attempt=0,
            )
            result.llm_provider = self.config.llm_provider
            result.llm_model = self.config.llm_model
            
            with self._gha_lock:
                self._gha_pending_count += 1
                # Store task for later queuing (will be picked up by main async loop)
                if not hasattr(self, '_pending_gha_tasks'):
                    self._pending_gha_tasks = []
                self._pending_gha_tasks.append(gha_task)
            
            return result, gha_task  # Return result and task for row_index update
            
        except Exception as e:
            result.overall_status = "failed"
            result.error_message = str(e)
        
        return self._finalize_result(result), gha_task
    
    def _process_repo(self, repo: RepoInput) -> List[RepoResult]:
        """
        Process a single repository through all stages.
        Returns a LIST of results - one per detected CI config.
        Each CI config gets its own migration and PR.
        """
        results: List[RepoResult] = []
        
        try:
            # Check PAT availability
            pat = self.pat_rotator.get_pat()
            if not pat:
                # Return single failure result
                result = RepoResult(input=repo)
                result.started_at = datetime.now()
                result.overall_status = "failed"
                result.error_message = "No GitHub PAT available"
                return [self._finalize_result(result)]
            
            # Check rate limit
            self.pat_rotator.check_and_rotate_if_needed()
            pat = self.pat_rotator.get_pat()
            
            # Stage 1: Detection (finds ALL CI configs)
            if self.progress:
                self.progress.update_current(repo.full_name, "detecting")

            detection_result = detect_ci(
                repo=repo,
                github_pat=pat,
                retries=self.config.max_retries,
                retry_delay=self.config.retry_delay_seconds
            )

            if detection_result.status == StageStatus.FAILED:
                # Rate-limit during detection — wait for reset and retry once
                if detection_result.error and "rate limit" in detection_result.error.lower():
                    import re as _re
                    ts_match = _re.search(r"timestamp\s+(\d+)", detection_result.error)
                    if ts_match:
                        reset_ts = int(ts_match.group(1))
                        wait_secs = max(0, reset_ts - int(time.time())) + 5
                        if wait_secs < 120:  # Only wait if reset is very soon (< 2 min); otherwise fail fast
                            print(f"\n⏳ Rate limit hit during detection — waiting {wait_secs}s for reset...")
                            time.sleep(wait_secs)
                            self.pat_rotator.check_and_rotate_if_needed()
                            pat = self.pat_rotator.get_pat()
                            detection_result = detect_ci(
                                repo=repo,
                                github_pat=pat,
                                retries=self.config.max_retries,
                                retry_delay=self.config.retry_delay_seconds,
                            )
                if detection_result.status == StageStatus.FAILED:
                    if self.progress:
                        self.progress.increment_stat("detection_failed")
                    result = RepoResult(input=repo)
                    result.started_at = datetime.now()
                    result.detection = detection_result
                    result.overall_status = "failed"
                    result.error_message = detection_result.error
                    result = self._finalize_result(result)
                    if self.csv_reporter:
                        self.csv_reporter.write_result(result)
                    return [result]

            if not detection_result.detected_configs:
                if self.progress:
                    self.progress.increment_stat("no_ci_found")
                result = RepoResult(input=repo)
                result.started_at = datetime.now()
                result.detection = detection_result
                result.overall_status = "failed"
                result.error_message = "No CI configuration found"
                result = self._finalize_result(result)
                if self.csv_reporter:
                    self.csv_reporter.write_result(result)
                return [result]

            # Get correct default branch from GitHub API if needed
            actual_default = get_default_branch(repo, pat)
            if actual_default and actual_default != repo.target_branch:
                print(f"[DETECT] Correcting branch: {repo.target_branch} → {actual_default}")
                repo.target_branch = actual_default
            
            # Found CI configs - process EACH one separately
            num_configs = len(detection_result.detected_configs)
            if self.progress:
                self.progress.increment_stat("detected", num_configs)
            
            for config in detection_result.detected_configs:
                ci_result = self._process_single_ci(
                    repo=repo,
                    ci_config=config,
                    all_detected=[c.ci_type for c in detection_result.detected_configs]
                )
                results.append(ci_result)
                
                # Write each result to CSV immediately
                if self.csv_reporter:
                    self.csv_reporter.write_result(ci_result)
            
            return results
            
        except Exception as e:
            result = RepoResult(input=repo)
            result.started_at = datetime.now()
            result.overall_status = "failed"
            result.error_message = str(e)
            return [self._finalize_result(result)]
    
    def _process_single_ci(self, repo: RepoInput, ci_config, all_detected: List[str]) -> RepoResult:
        """Process a single CI config for a repo through migrate → validate → double-check → PR"""
        from models import DetectedConfig, DetectionResult
        
        result = RepoResult(input=repo)
        result.started_at = datetime.now()
        
        # Store all detected CIs in this repo for CSV reference
        result.all_detected_in_repo = all_detected
        
        # Create detection result for this specific CI
        result.detection = DetectionResult(
            status=StageStatus.SUCCESS,
            detected_configs=[ci_config]
        )
        
        try:
            # Stage 2: Migration
            if self.progress:
                self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "migrating")
            
            result.migration = migrate_ci(
                source_yaml=ci_config.source_yaml,
                source_ci=ci_config.ci_type,
                target_ci="github-actions",
                config=self.config,
                retries=self.config.max_retries,
                retry_delay=self.config.retry_delay_seconds
            )
            
            if result.migration.status == StageStatus.FAILED:
                if self.progress:
                    self.progress.increment_stat("migration_failed")
                result.overall_status = "failed"
                result.error_message = result.migration.error
                return self._finalize_result(result)
            
            if self.progress:
                self.progress.increment_stat("migrated")
            
            # Stage 3: Validation (Linting)
            if self.progress:
                self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "validating")
            
            result.validation = validate_yaml(
                yaml_content=result.migration.migrated_yaml
            )
            
            lint_passed = result.validation.lint_valid
            if lint_passed:
                if self.progress:
                    self.progress.increment_stat("lint_passed")
            else:
                if self.progress:
                    self.progress.increment_stat("lint_failed")
            
            # Stage 4: Double-Check (if applicable)
            should_double_check = self.config.should_run_double_check(lint_passed)
            
            if should_double_check:
                if self.progress:
                    self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "double-check")
                
                result.double_check = semantic_double_check(
                    source_yaml=ci_config.source_yaml,
                    migrated_yaml=result.migration.migrated_yaml,
                    source_ci=ci_config.ci_type,
                    target_ci="github-actions",
                    config=self.config,
                    retries=self.config.max_retries,
                    retry_delay=self.config.retry_delay_seconds
                )
                
                if result.double_check.passed:
                    if self.progress:
                        self.progress.increment_stat("double_check_passed")
                else:
                    if self.progress:
                        self.progress.increment_stat("double_check_failed")
            else:
                result.double_check.status = StageStatus.SKIPPED
                if self.progress:
                    self.progress.increment_stat("double_check_skipped")
            
            # Stage 5: Pull Request (if applicable)
            # Branch name includes CI type to avoid conflicts: cipilot/migrated-travis-to-gha
            double_check_passed = result.double_check.passed or result.double_check.status == StageStatus.SKIPPED
            should_create_pr = self.config.should_create_pr(lint_passed, double_check_passed)
            
            if should_create_pr:
                if self.progress:
                    self.progress.update_current(f"{repo.full_name} ({ci_config.ci_type})", "creating PR")
                
                # Get fresh PAT
                pat = self.pat_rotator.get_pat()
                
                result.pull_request = create_pull_request(
                    repo=repo,
                    migrated_yaml=result.migration.migrated_yaml,
                    source_ci=ci_config.ci_type,
                    github_pat=pat,
                    branch_prefix=self.config.pr_branch_prefix,
                    retries=self.config.max_retries,
                    retry_delay=self.config.retry_delay_seconds,
                    dry_run=(self.config.strictness == StrictnessLevel.DRY_RUN),
                    yaml_valid=result.validation.yaml_valid,
                    lint_valid=result.validation.lint_valid,
                    lint_errors=result.validation.lint_errors,
                )
                
                if result.pull_request.status == StageStatus.SUCCESS:
                    if self.progress:
                        self.progress.increment_stat("prs_created")
                elif result.pull_request.status == StageStatus.SKIPPED:
                    if self.progress:
                        self.progress.increment_stat("prs_skipped")
                else:
                    if self.progress:
                        self.progress.increment_stat("prs_failed")
            else:
                result.pull_request.status = StageStatus.SKIPPED
                reason_parts = []
                if not lint_passed:
                    reason_parts.append("lint failed")
                if not double_check_passed:
                    reason_parts.append("double-check failed")
                if self.config.strictness == StrictnessLevel.DRY_RUN:
                    reason_parts.append("dry run mode")
                result.pull_request.skipped_reason = ", ".join(reason_parts) if reason_parts else "config"
                
                if self.progress:
                    self.progress.increment_stat("prs_skipped")
            
            # Determine overall status
            if result.pull_request.status == StageStatus.SUCCESS:
                result.overall_status = "success"
            elif lint_passed and (double_check_passed or not should_double_check):
                result.overall_status = "partial"  # Migration OK but no PR
            else:
                result.overall_status = "partial"
            
        except Exception as e:
            result.overall_status = "failed"
            result.error_message = str(e)
        
        return self._finalize_result(result)
    
    def _finalize_result(self, result: RepoResult) -> RepoResult:
        """Finalize result with timing"""
        result.completed_at = datetime.now()
        if result.started_at:
            result.duration_seconds = (result.completed_at - result.started_at).total_seconds()
        return result
    
    def stop(self):
        """Request pipeline stop"""
        self._stop_requested = True
