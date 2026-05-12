# CIPilot Batch Pipeline

Mass CI/CD migrations for thousands of repositories with a single command.

## Features

- **Batch Processing**: Process thousands of repos from CSV/JSON input
- **Multi-CI Detection**: Detects ALL CI configs per repo, creates separate PR for each
- **Multi-PAT Support**: Rotate GitHub tokens from different accounts for higher rate limits
- **Configurable Strictness**: Control when PRs are created
- **Cloud GHA Verification**: Optionally run migrated workflows in GitHub Actions to verify they work
- **LLM Fix Agent**: Automatically repair failing workflows using LLM-based error analysis
- **Resume Capability**: Continue from where you left off (including GHA pending tasks)
- **Graceful Shutdown**: Configurable grace period for in-flight GHA verifications
- **Real-time Progress**: Live dashboard showing migration progress
- **Detailed Reporting**: CSV output with per-repo, per-CI status

## Installation

```bash
cd pipeline
pip install -r requirements.txt
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

```env
# GitHub PATs from DIFFERENT accounts for rate limit stacking (5000/hr each)
GITHUB_PATS=ghp_from_account1,ghp_from_account2

# LLM Configuration
LLM_PROVIDER=xai
LLM_MODEL=grok-4-1-fast-reasoning
LLM_API_KEY=your-api-key
```

> **Note:** Multiple PATs from the same account share the 5000/hr limit. Use PATs from different GitHub accounts for additive rate limits.

## Usage

### Basic Usage

```bash
python run.py --input repos.csv --output results.csv
```

### With Options

```bash
python run.py \
  --input repos.csv \
  --output results.csv \
  --strictness permissive \
  --github-pats "$PAT1,$PAT2" \
  --provider xai \
  --model grok-4-1-fast-reasoning \
  --concurrent 2 \
  --retries 3
```

### Paper Evaluation Runs (Cohort 2 + 3)

These are the exact commands used to produce the evaluation dataset for the ICSME 2026 paper. Both runs used `--cloud-gha-verify` with `--strictness lint_only` (PR created for any repo that passes actionlint, regardless of GHA outcome).

**Cohort 2** — repos 1001–1067 (104 repos with non-GHA CI):

```bash
python run.py \
  --input input/python-repos_1001-1067.csv \
  --output output/python_cloud_gha_verify-1001-1067_v01.csv \
  --strictness lint_only \
  --cloud-gha-verify \
  --cloud-gha-retries 3 \
  --cloud-gha-timeout 600 \
  --provider openai \
  --model gpt-4.5 \
  --github-pats "$PAT1,$PAT2,$PAT3" \
  --concurrent 3
```

**Cohort 3** — repos 1200–2000 (23 repos processed before GitHub API rate limit):

```bash
python run.py \
  --input input/python-repos_1200-2000.csv \
  --output output/python_cloud_gha_verify-1200-2000_v01.csv \
  --strictness lint_only \
  --cloud-gha-verify \
  --cloud-gha-retries 3 \
  --cloud-gha-timeout 600 \
  --provider openai \
  --model gpt-4.5 \
  --github-pats "$PAT1,$PAT2,$PAT3" \
  --concurrent 3
```

**Evaluated dataset** — 91 repos that passed both YAML validation and actionlint (the "good set"):

```bash
# After running the above, regenerate all stats, tables, and figures:
cd stat-analysis
python analyse.py
# Outputs: output/good_set_91_repos.csv, stat-analysis/tables/*.csv, stat-analysis/figures/*.png
```

### Dry Run (No PRs)

```bash
python run.py --input repos.csv --output results.csv --dry-run
```

### Resume Previous Run

```bash
python run.py --input repos.csv --output results.csv --resume
```

### Cloud GHA Verification

Verify migrated workflows by actually running them in GitHub Actions before creating PRs:

```bash
python run.py --input repos.csv --output results.csv --cloud-gha-verify
```

With custom timeout and fix retries:

```bash
python run.py \
  --input repos.csv \
  --output results.csv \
  --cloud-gha-verify \
  --cloud-gha-timeout 900 \
  --cloud-gha-retries 5
```

```
E.g.,
python run.py --input input/repos_sample.csv --output output/results_cloud_gha_verify.csv --cloud-gha-verify
```

See [Cloud GHA Verification](#cloud-gha-verification-1) for full details.

## Input Format

### CSV

```csv
repo_url,target_branch
owner/repo1,main
owner/repo2,master
```

> **Note:** If `target_branch` is incorrect, the pipeline auto-detects the actual default branch from GitHub.

### JSON

```json
[
  {"repo_url": "owner/repo1", "target_branch": "main"},
  {"repo_url": "owner/repo2"}
]
```

## Strictness Levels

| Level | Lint Must Pass | Double-Check Must Pass | PR Created When |
|-------|---------------|------------------------|-----------------|
| `strict` | ✅ | ✅ | Both pass |
| `lint_only` | ✅ | ❌ | Lint passes |
| `permissive` | ❌ | ❌ | Always (for feedback) |
| `dry_run` | N/A | N/A | Never |

## Cloud GHA Verification

When `--cloud-gha-verify` is enabled, the pipeline adds a real-world verification step: after migrating a workflow, it pushes the result to a fork and runs it in GitHub Actions to confirm it actually works.

### How It Works

```
Detect CI → Migrate → Validate (lint) → Double-Check → Push to Fork
    → GHA Verify → [If fixable error → LLM Fix Agent → Re-verify (up to N retries)]
    → Create PR (with GHA status in PR body)
```

1. **Push to Fork** — The migrated workflow is committed to a branch on a fork of the target repository.
2. **GHA Verification** — The pipeline waits for the push-triggered GitHub Actions run to complete, polling at a configurable interval.
3. **Error Classification** — If the workflow fails, logs are fetched and the error is classified:
   - **Secret Error** — Missing secrets/tokens (e.g., `NPM_TOKEN`, `AWS_ACCESS_KEY_ID`). Not fixable by LLM. PR is still created with a note that the user needs to configure secrets.
   - **Fixable Error** — Syntax, configuration, or build errors that the LLM can attempt to repair (e.g., wrong working directory, missing action inputs, build tool errors).
   - **Timeout Error** — The workflow exceeded the configured timeout.
   - **Unknown Error** — Unclassified failure.
4. **LLM Fix Agent** — For fixable errors, an LLM-based repair agent analyzes the error logs and generates a corrected workflow. The fix is pushed to the fork and GHA runs again. This repeats up to `--cloud-gha-retries` times.
5. **PR Creation** — Once GHA passes (or retries are exhausted), a PR is created based on strictness rules.

### Async Architecture

- The main pipeline continues processing new repositories while GHA verifications run asynchronously via a task queue.
- Multiple GHA worker coroutines process verification tasks concurrently.
- Results are streamed to CSV as each GHA task completes.
- Graceful shutdown with a configurable grace period (default: 30s) ensures in-flight GHA tasks can finish.

### Strictness Behavior with GHA Verification

| Strictness | GHA Passes | GHA Fails (fixable, retries exhausted) | GHA Fails (secret error) |
|------------|-----------|----------------------------------------|--------------------------|
| `strict` | ✅ PR created | ❌ No PR | ✅ PR created (with warning) |
| `lint_only` | ✅ PR created | ✅ PR created (informational) | ✅ PR created (with warning) |
| `permissive` | ✅ PR created | ✅ PR created (informational) | ✅ PR created (with warning) |
| `dry_run` | No PR | No PR | No PR |

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--cloud-gha-verify` | `false` | Enable GHA verification before creating PRs |
| `--cloud-gha-timeout` | `600` | Max seconds to wait for a GHA run to complete (10 min) |
| `--cloud-gha-retries` | `3` | Max LLM fix attempts for fixable GHA errors |

### Resume Support

GHA pending tasks are saved to CSV with `overall_status=gha_pending`. When using `--resume`, these tasks are automatically re-queued for verification.

```bash
# Start a run with GHA verify
python run.py --input repos.csv --output results.csv --cloud-gha-verify

# If interrupted, resume picks up GHA pending tasks
python run.py --input repos.csv --output results.csv --cloud-gha-verify --resume
```

## PR Format

PRs created by the pipeline use the same format as the web application:

- **Branch**: `{prefix}-{ci_type}-to-gha-{timestamp}`
- **Commit**: `ci: add GitHub Actions workflow (migrated by CIPilot)`
- **Title**: `[CIPilot] Migrate {CI Name} to GitHub Actions`
- **Body**: Full markdown with summary, changes, about, and validation sections

## Output Columns

| Column | Description |
|--------|-------------|
| `repo_url` | Input repository |
| `detected_ci` | circleci, travis, gitlab, etc. |
| `all_detected_ci` | All CIs found in repo |
| `migration_status` | success/failed/skipped |
| `lint_valid` | true/false |
| `lint_errors` | actionlint error messages |
| `double_check_passed` | true/false |
| `double_check_confidence` | 0.0-1.0 |
| `LLM_Provider` | LLM provider used for this run |
| `LLM_Model` | LLM model used for this run |
| `gha_status` | pending/running/success/failed/skipped (GHA verification) |
| `gha_run_id` | GitHub Actions run ID |
| `gha_run_url` | URL to the GHA run |
| `gha_run_conclusion` | success/failure/cancelled/timed_out |
| `gha_error_type` | none/secret_error/fixable_error/timeout_error/unknown_error |
| `gha_fix_attempts` | Number of LLM fix attempts made |
| `gha_error` | GHA verification error message |
| `pr_status` | success/skipped/failed |
| `pr_url` | GitHub PR URL |
| `pr_error` | Error message if PR failed |
| `overall_status` | success/partial/failed/gha_pending |

## Output Traceability

Every input repository is guaranteed to appear in the output CSV. If a repo is skipped (no CI detected, rate-limited, etc.), the row is still written with `overall_status=skipped` and a `skip_reason` explaining why. This ensures full auditability of pipeline results.
