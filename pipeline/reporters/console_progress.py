"""
Console Progress - Real-time progress display
"""
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from models import PipelineStats


class ConsoleProgress:
    """Real-time console progress display"""
    
    def __init__(self, total: int):
        self.stats = PipelineStats(total=total)
        self.stats.start_time = datetime.now()
        self.current_repo: str = ""
        self.current_stage: str = ""
        self._last_update = 0.0
        self._update_interval = 0.5  # Update every 500ms
    
    def update_current(self, repo: str, stage: str):
        """Update current processing status"""
        self.current_repo = repo
        self.current_stage = stage
        self._maybe_refresh()
    
    def increment_stat(self, stat_name: str, value: int = 1):
        """Increment a statistic"""
        current = getattr(self.stats, stat_name, 0)
        setattr(self.stats, stat_name, current + value)
        self._maybe_refresh()
    
    def complete_repo(self, status: str):
        """Mark a repo as complete"""
        self.stats.processed += 1
        if status == "success":
            self.stats.success += 1
        elif status == "partial":
            self.stats.partial += 1
        else:
            self.stats.failed += 1
        self._refresh()
    
    def _maybe_refresh(self):
        """Refresh display if enough time has passed"""
        now = time.time()
        if now - self._last_update >= self._update_interval:
            self._refresh()
            self._last_update = now
    
    def _refresh(self):
        """Refresh the console display"""
        # Calculate elapsed time
        if self.stats.start_time:
            elapsed = datetime.now() - self.stats.start_time
            self.stats.elapsed_seconds = elapsed.total_seconds()
        
        # Calculate ETA
        eta_str = self._calculate_eta()
        
        # Build display
        output = self._build_display(eta_str)
        
        # Clear and redraw
        sys.stdout.write("\033[H\033[J")  # Clear screen
        sys.stdout.write(output)
        sys.stdout.flush()
    
    def _calculate_eta(self) -> str:
        """Calculate estimated time remaining"""
        if self.stats.processed == 0:
            return "calculating..."
        
        elapsed = self.stats.elapsed_seconds
        rate = self.stats.processed / elapsed if elapsed > 0 else 0
        remaining = self.stats.remaining
        
        if rate > 0:
            eta_seconds = remaining / rate
            eta = timedelta(seconds=int(eta_seconds))
            return str(eta)
        
        return "unknown"
    
    def _build_display(self, eta_str: str) -> str:
        """Build the progress display string"""
        s = self.stats
        
        # Progress bar
        bar_width = 40
        filled = int(bar_width * s.progress_percent / 100) if s.total > 0 else 0
        bar = "█" * filled + "░" * (bar_width - filled)
        
        # Elapsed time formatting
        elapsed = timedelta(seconds=int(s.elapsed_seconds))
        
        # GHA section (only show if any GHA activity)
        gha_section = ""
        if s.gha_pending > 0 or s.gha_passed > 0 or s.gha_failed > 0:
            gha_section = f"""║  ──────────────────────────────────────────────────────────────────────  ║
║  🔄 GHA Pending:  {s.gha_pending:<6}  │  ✓ GHA Passed:      {s.gha_passed:<5}              ║
║  🤖 Agent Repaired:{s.gha_fixed:<5}  │  ✗ GHA Failed:      {s.gha_failed:<5}              ║
║  🔑 Secret Errs:  {s.gha_secret_error:<6}  │  ⏸ GHA Skipped:     {s.gha_skipped:<5}              ║
"""
        
        display = f"""
╔══════════════════════════════════════════════════════════════════════════╗
║  CIPilot Batch Pipeline - Processing {s.total:,} repositories{' ' * (26 - len(f'{s.total:,}'))}║
╠══════════════════════════════════════════════════════════════════════════╣
║  Progress: [{bar}] {s.processed:,}/{s.total:,} ({s.progress_percent:.1f}%){' ' * max(0, 10 - len(f'{s.processed:,}/{s.total:,}'))}║
║  ──────────────────────────────────────────────────────────────────────  ║
║  ✓ Detected:      {s.detected:<6}  │  ✗ No CI Found:     {s.no_ci_found:<6}              ║
║  ✓ Migrated:      {s.migrated:<6}  │  ✗ Migration Failed: {s.migration_failed:<5}              ║
║  ✓ Lint Passed:   {s.lint_passed:<6}  │  ✗ Lint Failed:      {s.lint_failed:<5}              ║
║  ✓ Double-Check:  {s.double_check_passed:<6}  │  ✗ DC Failed:        {s.double_check_failed:<5}              ║
{gha_section}║  ✓ PRs Created:   {s.prs_created:<6}  │  ⏸ PRs Skipped:      {s.prs_skipped:<5}              ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  Current: {self._truncate(self.current_repo, 40):<40} ({self.current_stage:<12})    ║
║  ETA: {eta_str:<15} │ Elapsed: {str(elapsed):<15}                          ║
╚══════════════════════════════════════════════════════════════════════════╝
"""
        return display
    
    def _truncate(self, text: str, max_len: int) -> str:
        """Truncate text with ellipsis"""
        if len(text) <= max_len:
            return text
        return text[:max_len-3] + "..."
    
    def finish(self):
        """Show final summary"""
        s = self.stats
        elapsed = timedelta(seconds=int(s.elapsed_seconds))
        
        summary = f"""
╔══════════════════════════════════════════════════════════════════════════╗
║                        PIPELINE COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Total Processed:  {s.processed:>6}                                                  ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  ✓ Success:        {s.success:>6}  ({s.success/s.processed*100 if s.processed else 0:.1f}%)                                      ║
║  ~ Partial:        {s.partial:>6}  ({s.partial/s.processed*100 if s.processed else 0:.1f}%)                                      ║
║  ✗ Failed:         {s.failed:>6}  ({s.failed/s.processed*100 if s.processed else 0:.1f}%)                                      ║
║  ──────────────────────────────────────────────────────────────────────  ║
║  PRs Created:      {s.prs_created:>6}                                                  ║
║  Total Time:       {str(elapsed):<15}                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
"""
        sys.stdout.write("\033[H\033[J")  # Clear screen
        sys.stdout.write(summary)
        sys.stdout.flush()


class SimpleProgress:
    """Simple line-by-line progress for non-interactive environments"""
    
    def __init__(self, total: int):
        self.total = total
        self.processed = 0
        self.start_time = datetime.now()
    
    def update(self, repo: str, stage: str, status: str = ""):
        """Print progress update"""
        self.processed += 1
        elapsed = datetime.now() - self.start_time
        print(f"[{self.processed}/{self.total}] {repo} - {stage}: {status} (elapsed: {elapsed})")
    
    def finish(self):
        """Print final summary"""
        elapsed = datetime.now() - self.start_time
        print(f"\n=== COMPLETE: {self.processed}/{self.total} processed in {elapsed} ===")
