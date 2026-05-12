# CIPilot: Automated End-to-End CI/CD Migration via LLMs

> **Replication Package** for the CIPilot tool paper entitled *"CIPilot: Automated End-to-End CI/CD Migration via LLMs"*, submitted to ASE 2026.  
> CIPilot detects CI/CD configurations in GitHub repositories and uses LLMs to migrate them to GitHub Actions, with automated validation and pull-request creation.

**Live Demo:** [https://cipilot.com](https://cipilot.com)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start (Local Development)](#quick-start-local-development)
   - [Backend Setup](#1-backend-setup)
   - [Web Application Setup](#2-web-application-setup)
   - [Chrome Extension Setup](#3-chrome-extension-setup-optional)
5. [Batch Pipeline](#batch-pipeline)
6. [Configuration](#configuration)
   - [LLM Providers](#llm-providers)
   - [Environment Variables](#environment-variables)
7. [Usage Guide](#usage-guide)
   - [Web Application Workflow](#web-application-workflow)
   - [Chrome Extension Workflow](#chrome-extension-workflow)
8. [Deployment](#deployment)
   - [Option A — Render.com (Recommended)](#option-a--rendercom)
   - [Option B — Docker Compose (Self-Hosted)](#option-b--docker-compose-self-hosted)
   - [Option C — Manual Deployment](#option-c--manual-deployment)
9. [Project Structure](#project-structure)
10. [Supported CI/CD Platforms](#supported-cicd-platforms)
11. [Troubleshooting](#troubleshooting)
12. [License](#license)

---

## Overview

CIPilot is an AI-powered tool that:

1. **Detects** existing CI/CD configurations in any public GitHub repository (Travis CI, CircleCI, GitLab CI, Jenkins, and 15+ others).
2. **Converts** detected configurations to GitHub Actions using configurable LLM providers (Groq, OpenAI, Anthropic, Google Gemini, xAI, or local Ollama).
3. **Validates** the generated GitHub Actions YAML using PyYAML parsing and [actionlint](https://github.com/rhysd/actionlint).
4. **Retries** conversion automatically (or manually) with validation feedback if errors are found.
5. **Creates Pull Requests** on the target repository with the migrated workflow (via fork or direct branch, depending on user permissions).
6. **Verifies in GitHub Actions** (optional, batch pipeline) by running the migrated workflow on a fork and auto-repairing errors with an LLM fix agent.

CIPilot ships as **four components**:

| Component | Technology | Purpose |
|-----------|-----------|----------|
| **Web Application** | React 18 + TypeScript + Vite + Tailwind CSS | Primary user interface for CI/CD migration |
| **Backend API** | Python 3.11 + FastAPI + actionlint | LLM orchestration, YAML validation, conversion logic |
| **Batch Pipeline** | Python CLI | Mass migration of thousands of repositories |
| **Chrome Extension** | Manifest V3 | Detects CI/CD directly on GitHub pages (optional) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Web Application                           │
│              (React + TypeScript + Vite + Tailwind)              │
│                                                                  │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────┐     │
│  │  HomePage    │  │ ConversionPanel│  │  Settings/History │     │
│  │ - Repo input │  │ - Side-by-side │  │  - LLM config     │     │
│  │ - CI detect  │  │ - Validation   │  │  - API keys       │     │
│  │ - Service UI │  │ - Retry/Edit   │  │  - GitHub PAT     │     │
│  └──────┬───────┘  └───────┬────────┘  └───────────────────┘     │
│         │                  │                                     │
└─────────┼──────────────────┼─────────────────────────────────────┘
          │  GitHub API      │  Backend API
          ▼                  ▼
┌─────────────────┐  ┌─────────────────────────────────────────────┐
│   GitHub API    │  │              FastAPI Backend                │
│ (repo browsing, │  │           (Python 3.11 + Docker)            │
│  PR creation)   │  │                                             │
└─────────────────┘  │  POST /convert-cicd     → LLM conversion    │
                     │  POST /retry-conversion  → Retry with fixes │
                     │  POST /validate-github-actions → Validation │
                     │                                             │
                     │  ┌─────────────┐  ┌──────────────────────┐  │
                     │  │ LLM Router  │  │   Validation Engine  │  │
                     │  │ - Groq      │  │   - PyYAML parsing   │  │
                     │  │ - OpenAI    │  │   - actionlint       │  │
                     │  │ - Anthropic │  │     (Go binary)      │  │
                     │  │ - Google    │  └──────────────────────┘  │
                     │  │ - xAI       │                            │
                     │  │ - Ollama    │                            │
                     │  └─────────────┘                            │
                     └─────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Purpose | Required? |
|------------|---------|---------|-----------|
| **Python** | 3.11+ | Backend API server | ✅ Yes |
| **Node.js** | 18+ | Web application build | ✅ Yes |
| **npm** | 9+ | Package management | ✅ Yes |
| **Git** | 2.x+ | Source control | ✅ Yes |
| **actionlint** | 1.6+ | GitHub Actions YAML linting | ✅ Yes (auto-installed in Docker) |
| **Docker** | 20+ | Containerised deployment | Optional (for Docker-based setup) |
| **Ollama** | latest | Local LLM inference | Optional (for local LLM only) |
| **Google Chrome** | latest | Chrome extension | Optional (for extension only) |

### Installing actionlint locally

```bash
# macOS
brew install actionlint

# Linux (amd64)
curl -sSfL https://github.com/rhysd/actionlint/releases/download/v1.6.26/actionlint_1.6.26_linux_amd64.tar.gz \
  | sudo tar xz -C /usr/local/bin

# Windows (with Go installed)
go install github.com/rhysd/actionlint/cmd/actionlint@latest

# Verify installation
actionlint -version
```

---

## Quick Start (Local Development)

### Clone the repository

```bash
git clone https://github.com/Taher-Ghaleb/CIPilot-ASE26.git
cd CIPilot-ASE26
```

### 1. Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

# Install Python dependencies
pip install -r requirements.txt

# (Optional) Set a server-side GitHub PAT so users can create PRs without their own token
echo "GITHUB_PAT=ghp_your_token_here" > .env

# Start the backend server
python main.py
```

The API server starts at **http://localhost:5200**.  
Interactive API docs are available at **http://localhost:5200/docs** (Swagger UI).

**Verify it works:**

```bash
curl http://localhost:5200/
# Expected: {"message":"CI/CD Converter API","version":"1.0.0",...}
```

### 2. Web Application Setup

Open a **new terminal**:

```bash
cd web

# Install Node dependencies
npm install

# Create environment file (optional for local dev)
cp .env.example .env

# Start the development server
npm run dev
```

The web app starts at **http://localhost:3000**.  
The Vite dev server automatically proxies `/api` requests to the backend at `http://localhost:5200`.

### 3. Chrome Extension Setup (Optional)

The Chrome extension integrates directly into GitHub pages:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `extension/` directory from this repository
5. Pin the extension for easy access (click the puzzle piece icon in Chrome's toolbar)
6. **Configure for local backend:** right-click the extension icon → **Options** → set **Backend URL** to `http://localhost:5200`. Leave it as `prod` to use the live cipilot.com backend instead.

> The extension defaults to the production backend (`cipilot.com`). Set the backend URL to `http://localhost:5200` in Options only if you want to run against your local backend.

---

## Batch Pipeline

For mass migration of thousands of repositories, use the standalone batch pipeline:

```bash
cd pipeline
pip install -r requirements.txt

# Basic usage
python run.py --input repos.csv --output results.csv

# With all options
python run.py \
  --input repos.csv \
  --output results.csv \
  --strictness permissive \
  --github-pats "$PAT1,$PAT2" \
  --provider xai \
  --model grok-4-1-fast-reasoning
```

**Features:**
- Processes CSV/JSON input with repo URLs
- Detects ALL CI configs per repo (creates separate PR for each)
- GitHub PAT rotation for rate limit management
- Configurable strictness: `strict`, `lint_only`, `permissive`, `dry_run`
- **Cloud GHA Verification** (`--cloud-gha-verify`): Runs migrated workflows in GitHub Actions to verify they work before creating PRs
- **LLM Fix Agent**: Automatically repairs failing workflows using error log analysis
- Real-time progress dashboard
- Detailed CSV output with validation results

See [pipeline/README.md](pipeline/README.md) for full documentation.

---

## Configuration

### LLM Providers

CIPilot supports multiple LLM providers. Configure your preferred provider in the web app's **Settings** page (gear icon in the header).

| Provider | Model Examples | API Key Required | Base URL | Notes |
|----------|---------------|-----------------|----------|-------|
| **Groq** | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` | ✅ Yes ([free tier](https://console.groq.com/)) | `https://api.groq.com/openai` | Fast inference, recommended for quick testing |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | ✅ Yes | `https://api.openai.com` | High quality conversions |
| **Anthropic** | `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022` | ✅ Yes | `https://api.anthropic.com` | Excellent at structured output |
| **Google** | `gemini-2.0-flash`, `gemini-1.5-pro` | ✅ Yes ([free tier](https://aistudio.google.com/)) | `https://generativelanguage.googleapis.com` | Google AI Studio |
| **xAI** | `grok-2`, `grok-beta` | ✅ Yes | `https://api.x.ai` | Grok models |
| **Ollama** | `gemma3:12b`, `llama3:8b`, `codellama:13b` | ❌ No (local) | `http://localhost:11434` | Fully local — requires [Ollama](https://ollama.ai/) installed. **Not available in deployed version.** |
| **Generic** | Any OpenAI-compatible model | ✅ Yes | Custom URL | For self-hosted or API-compatible endpoints |

#### Obtaining API Keys

| Provider | How to get a key |
|----------|-----------------|
| Groq | [console.groq.com](https://console.groq.com/) → API Keys |
| OpenAI | [platform.openai.com](https://platform.openai.com/) → API Keys |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) → API Keys |
| Google | [aistudio.google.com](https://aistudio.google.com/) → Get API Key |
| xAI | [console.x.ai](https://console.x.ai/) → API Keys |

> **🔒 Security:** API keys are stored **only** in your browser's local storage (IndexedDB). They are sent per-request to the CIPilot backend for LLM calls but are **never** stored server-side. Each user configures their own keys.

### Environment Variables

#### Backend (`backend/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_PAT` | _(optional)_ | **Server-side GitHub Personal Access Token** for fork/PR creation. If set, users can create PRs without configuring their own GitHub token. Users can override this by setting their own PAT in Settings. Required scopes: `repo` + `workflow` |
| `DATABASE_PATH` | `./data/cipilot.db` | Path to SQLite database for analytics storage (used in production with persistent disk) |

> **💡 Note:** All LLM API keys are passed per-request from the client and are **never** stored server-side.

#### Web Application (`web/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | _(empty — uses Vite dev proxy)_ | Backend API URL. Set for production builds (e.g., `https://cipilot-api.onrender.com`) |

Create a `.env` file in `web/` if needed:

```bash
cp web/.env.example web/.env
# Edit web/.env to set VITE_API_URL for production builds
```

---

## Usage Guide

### Web Application Workflow

1. **Open the app** at `http://localhost:3000` (or your deployed URL).

2. **Enter a GitHub repository URL** in the input field.  
   Example: `https://github.com/checkstyle/checkstyle`  
   The app scans the repository for CI/CD configuration files via the GitHub API.

3. **Review detected CI/CD services.** Each detected service is shown as a chip with its configuration files listed.

4. **Select a target platform** (default: GitHub Actions) and click **Convert**.  
   The backend calls the configured LLM to generate the converted workflow.

5. **Review the conversion** in the side-by-side panel:
   - **Left pane:** Original CI/CD configuration (read-only)
   - **Right pane:** Generated GitHub Actions YAML (editable, with syntax highlighting via Monaco Editor)
   - **Validation badges:** Show YAML parse status ✅/❌, actionlint status ✅/❌, and attempt count

6. **Iterate if needed:**
   - **Edit** the generated YAML directly in the Monaco editor
   - Click **Validate** to re-run PyYAML + actionlint validation on your edits
   - Click **Retry** to send validation errors as feedback and get an improved conversion from the LLM

7. **Export the result:**
   - **Copy** — copies the generated YAML to clipboard
   - **Create PR** — creates a pull request on the GitHub repository:
     - Uses **CIPilot's server-side GitHub account** by default (no PAT configuration needed!)
     - Users can optionally configure their own GitHub PAT in Settings to use their personal account
     - If you have push access → creates a branch and opens a PR directly
     - If you don't have push access → forks the repo, creates a branch, and opens a cross-fork PR
     - **GitHub PAT scopes (if using your own):** `repo` + `workflow` (classic PAT) or Contents + Workflows read/write (fine-grained PAT)

8. **View history:** Past migrations are saved locally in IndexedDB and accessible from the **History** page in the sidebar.

### Chrome Extension Workflow

1. **Navigate to any GitHub repository** in Chrome.
2. **Click the CIPilot extension icon** in the toolbar to see detected CI/CD services.
3. If non-GitHub-Actions CI is detected, a **banner** appears at the top of the page offering conversion.
4. Click **Convert to GitHub Actions** to trigger the LLM conversion.
5. Review the result in the modal overlay with validation status, editing, and copy/PR options.
6. **Configure LLM settings** via the extension's Options/Settings page (right-click extension → Options).

> The Chrome extension defaults to the hosted CIPilot backend (`prod`). Switch to `http://localhost:5200` in extension options only when testing with your local backend.

---

## Deployment

### Option A — Render.com

Deploy backend (Docker web service) and frontend (static site) separately on Render:

1. **Backend** — create a new **Web Service** → select **Docker** runtime → point to the `backend/` directory. Set environment variable `GITHUB_PAT` in the Render dashboard if needed.
2. **Frontend** — create a new **Static Site** → build command `npm run build` (root: `web/`) → publish directory `dist/`. Set env var `VITE_API_URL` to your backend's Render URL before building.
3. **Custom domain:** Render dashboard → Service → Custom Domains → add domain + CNAME record.

**CORS:** if you use a custom domain, add it to `allow_origins` in `backend/main.py`:

```python
allow_origins=[
    "https://your-custom-domain.com",
    "http://localhost:3000",
],
```

> Free tier: backend sleeps after 15 min of inactivity (first request takes ~30 s). Upgrade to a paid plan or use a keep-alive ping service for always-on.

### Option B — Docker Compose (Self-Hosted)

Deploy both services with a single command:

```bash
# Build and start both services
docker compose up --build -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | `http://localhost:3000` |
| Backend | 5200 | `http://localhost:5200` |

The frontend Nginx configuration proxies `/api/*` requests to the backend container automatically, so no CORS configuration is needed.

#### Using Ollama with Docker

To use Ollama (running on the host machine) from inside Docker containers:

```bash
# Create a .env file in the project root
echo 'OLLAMA_HOST=http://host.docker.internal:11434' > .env

# Then start with Docker Compose
docker compose up --build -d
```

### Option C — Manual Deployment

Deploy each component independently to any cloud provider or server.

#### Backend

```bash
cd backend

# Option 1: Docker (recommended — includes actionlint)
docker build -t cipilot-api .
docker run -p 5200:5200 cipilot-api

# Option 2: Direct Python (requires manual actionlint installation)
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 5200
```

> ⚠️ If deploying **without Docker**, you must install `actionlint` manually on the host (see [Prerequisites](#prerequisites)).

#### Frontend

```bash
cd web

# Set the backend URL before building
export VITE_API_URL=https://your-backend-url.com

# Build the static site
npm install
npm run build

# Deploy the dist/ folder to any static hosting:
# - Netlify, Vercel, Cloudflare Pages, AWS S3+CloudFront, etc.
# - Configure SPA routing: rewrite all paths to /index.html
```

---

## Project Structure

```
cipilot/
│
├── README.md                     # This file (replication package)
├── docker-compose.yml            # Docker Compose for self-hosted deployment
│
├── backend/                      # ── FastAPI Backend (Python 3.11) ──
│   ├── Dockerfile                # Docker image: Python 3.11 + actionlint binary
│   ├── main.py                   # FastAPI app: endpoints, validation, CORS
│   ├── llm_converter.py          # Multi-provider LLM integration
│   │                               (Groq, OpenAI, Anthropic, Google, xAI, Ollama)
│   ├── models.py                 # Pydantic request/response schemas
│   ├── analytics.py              # Usage analytics (SQLite, opt-in)
│   ├── agentic_pipeline.py       # Experimental LangGraph agentic flow
│   ├── reviewer_utils.py         # Workflow review helpers
│   ├── database/                 # DB schema and migrations
│   └── requirements.txt          # Python dependencies
│
├── pipeline/                     # ── Batch Pipeline (Python CLI) ──
│   ├── README.md                 # Pipeline documentation
│   ├── run.py                    # CLI entry point
│   ├── runner.py                 # Pipeline orchestration
│   ├── config.py                 # Configuration and strictness levels
│   ├── models.py                 # Data models for pipeline results
│   ├── requirements.txt          # Python dependencies
│   ├── stages/                   # Pipeline stages
│   │   ├── detect.py             #   CI detection (all platforms)
│   │   ├── migrate.py            #   LLM-based migration
│   │   ├── validate.py           #   YAML + actionlint validation
│   │   ├── double_check.py       #   Semantic verification
│   │   ├── pull_request.py       #   Fork-based PR creation
│   │   ├── gha_verify.py         #   Cloud GHA workflow verification
│   │   └── gha_fix_agent.py      #   LLM-based workflow error repair
│   ├── reporters/                # Output handlers
│   │   ├── csv_reporter.py       #   CSV result writer
│   │   └── console_progress.py   #   Real-time progress display
│   ├── input/                    # Sample input files
│   └── output/                   # Generated results
│
├── web/                          # ── React Web Application ──
│   ├── Dockerfile                # Multi-stage build: Node 20 → Nginx
│   ├── nginx.conf                # Production Nginx config (SPA routing, proxy)
│   ├── package.json              # Dependencies and npm scripts
│   ├── vite.config.ts            # Vite bundler config (dev proxy, aliases)
│   ├── tsconfig.json             # TypeScript compiler options
│   ├── tailwind.config.js        # Tailwind CSS configuration
│   ├── .env.example              # Example environment variables
│   ├── index.html                # HTML entry point
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Root component with React Router
│       ├── index.css             # Global styles (Tailwind directives)
│       │
│       ├── api/                  # API client layer
│       │   ├── client.ts         #   Axios HTTP client with base URL config
│       │   ├── cicd.ts           #   CI/CD conversion & validation API calls
│       │   └── github.ts         #   GitHub API (repo info, file fetching)
│       │
│       ├── components/
│       │   ├── common/           # Reusable UI components
│       │   │   ├── Button.tsx, Card.tsx, Modal.tsx, Spinner.tsx,
│       │   │   │   Toast.tsx, Input.tsx, Select.tsx, Chip.tsx,
│       │   │   │   ThemeToggle.tsx
│       │   │   └── index.ts
│       │   ├── layout/           # App shell (header, sidebar)
│       │   │   ├── AppLayout.tsx, Header.tsx, Sidebar.tsx
│       │   │   └── index.ts
│       │   ├── migration/        # Migration-specific components
│       │   │   ├── ConversionPanel.tsx    # Side-by-side editor + validation
│       │   │   ├── RepoInput.tsx          # Repo URL input with suggestions
│       │   │   ├── ValidationStatus.tsx   # Validation badge display
│       │   │   ├── PRCreationDialog.tsx   # GitHub PR creation modal
│       │   │   ├── RetryDialog.tsx        # Retry conversion dialog
│       │   │   ├── DiffViewer.tsx         # Diff visualisation
│       │   │   ├── CIServiceChips.tsx     # Detected service tags
│       │   │   └── index.ts
│       │   └── settings/         # Settings UI
│       │       ├── SettingsModal.tsx, ExportImportPanel.tsx
│       │       └── index.ts
│       │
│       ├── context/              # React Contexts (global state)
│       │   ├── MigrationContext.tsx   # Migration state
│       │   ├── SettingsContext.tsx     # LLM & GitHub settings
│       │   ├── ThemeContext.tsx        # Dark/light theme
│       │   └── ToastContext.tsx        # Toast notifications
│       │
│       ├── hooks/                # Custom React hooks
│       │   ├── useLocalStorage.ts
│       │   ├── useMigrationHistory.ts
│       │   ├── useExportImport.ts
│       │   └── useMediaQuery.ts
│       │
│       ├── pages/                # Route pages
│       │   ├── HomePage.tsx          # Main migration page
│       │   ├── HistoryPage.tsx       # Past migrations
│       │   └── NotFoundPage.tsx      # 404
│       │
│       ├── store/                # Persistence layer
│       │   ├── indexedDB.ts          # IndexedDB for migration history
│       │   └── localStorage.ts       # LocalStorage for settings
│       │
│       ├── types/                # TypeScript type definitions
│       │   ├── api.ts, migration.ts, settings.ts, github.ts
│       │   └── index.ts
│       │
│       └── utils/                # Utility functions
│           ├── clipboard.ts, dateFormat.ts
│           └── index.ts
│
└── extension/                    # ── Chrome Extension (Manifest V3) ──
    ├── manifest.json             # Extension manifest (permissions, content scripts)
    ├── background.js             # Service worker (GitHub API, fork/branch/PR)
    ├── content.js                # GitHub page integration (banner, modal, migration UI)
    ├── ciDetection.js            # CI/CD file detection algorithms
    ├── banner.js                 # Banner notification system
    ├── utils.js                  # Shared utilities
    ├── icons/                    # Extension icons (16px, 48px, 128px)
    ├── popup/                    # Extension popup UI
    │   ├── popup.html, popup.css, popup.js
    ├── options/                  # Extension settings page
    │   ├── options.html, options.css, options.js
    └── utils/                    # Extended utility modules
        ├── ciCheck.js, ciConfigs.js, ciDetection.js, utils.js
```

---

## Supported CI/CD Platforms

CIPilot can **detect** configurations from all of the following platforms and **convert** them to GitHub Actions:

| Platform | Config File(s) | Detection |
|----------|----------------|-----------|
| GitHub Actions | `.github/workflows/*.yml` | ✅ |
| Travis CI | `.travis.yml` | ✅ |
| CircleCI | `.circleci/config.yml` | ✅ |
| GitLab CI | `.gitlab-ci.yml` | ✅ |
| Jenkins | `Jenkinsfile` | ✅ |
| Azure Pipelines | `azure-pipelines.yml` | ✅ |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` | ✅ |
| AppVeyor | `.appveyor.yml`, `appveyor.yml` | ✅ |
| Cirrus CI | `.cirrus.yml` | ✅ |
| Semaphore | `.semaphore/semaphore.yml` | ✅ |
| Buildkite | `.buildkite/pipeline.yml` | ✅ |
| Codeship | `codeship-services.yml` | ✅ |
| Wercker | `wercker.yml` | ✅ |
| Bitrise | `bitrise.yml` | ✅ |
| GoCD | `.gocd.yaml` | ✅ |
| Codemagic | `codemagic.yaml` | ✅ |
| Bamboo | `bamboo.yml` | ✅ |
| Scrutinizer | `.scrutinizer.yml` | ✅ |

**Primary conversion target:** GitHub Actions.  
**Reverse conversion:** When a repository already uses GitHub Actions, CIPilot offers conversion to Travis CI.

### Example Repositories for Testing

| Repository | CI/CD Platform(s) |
|-----------|-------------------|
| [checkstyle/checkstyle](https://github.com/checkstyle/checkstyle) | Travis CI + GitHub Actions |
| [rails/rails](https://github.com/rails/rails) | GitHub Actions + Buildkite |
| [pallets/flask](https://github.com/pallets/flask) | GitHub Actions |

---

## Troubleshooting

### Backend Issues

| Problem | Solution |
|---------|----------|
| `actionlint is not installed or not on PATH` | Install actionlint (see [Prerequisites](#prerequisites)). In Docker, it is installed automatically. |
| `ModuleNotFoundError: No module named 'yaml'` | Run `pip install pyyaml` or `pip install -r requirements.txt` |
| Backend won't start | Ensure port 5200 is free: `lsof -i :5200`. Check Python version ≥ 3.11. |
| CORS errors in browser console | Add your frontend's origin to `allow_origins` in `backend/main.py` |
| LLM returns wrong format (Travis CI instead of GitHub Actions) | The backend auto-detects and rejects wrong-format output. Try a different model or provider. |
| `429 Too Many Requests` from LLM | Provider rate limit hit. Wait a few minutes, switch to a different provider, or use Ollama locally. |

### Web Application Issues

| Problem | Solution |
|---------|----------|
| API calls return `Network Error` | Ensure the backend is running. Check that `VITE_API_URL` is set correctly for production builds. |
| GitHub API rate limit (403) | Add a GitHub Personal Access Token in Settings → raises limit from 60 to 5,000 requests/hour. |
| Page shows 404 after refresh | Ensure SPA routing is configured: all paths should rewrite to `/index.html`. |
| Settings not persisting | Check that browser localStorage / IndexedDB is not blocked (private/incognito mode may restrict this). |
| Monaco Editor not loading | Clear browser cache. Ensure no ad-blocker is blocking CDN resources. |

### Chrome Extension Issues

| Problem | Solution |
|---------|----------|
| Extension not detecting CI files | Ensure you are on a GitHub repository page (not a profile or org page). Refresh the page. |
| Conversion not working | Verify the backend is running at `http://localhost:5200`. Check browser console (F12 → Console). |
| PR creation fails with "Not Found" | Ensure your GitHub PAT has `repo` + `workflow` scopes. Check the token hasn't expired. |

### Docker / Docker Compose Issues

| Problem | Solution |
|---------|----------|
| Cannot connect to Ollama from Docker | Set `OLLAMA_HOST=http://host.docker.internal:11434`. Ollama must be running on the host. |
| Build fails with npm errors | Ensure Node 18+ is being used. Try `docker compose build --no-cache`. |
| Port conflicts | Change port mappings in `docker-compose.yml` if 3000 or 5200 are in use. |

### Render.com Issues

| Problem | Solution |
|---------|----------|
| Backend sleeps / slow first request | Free tier sleeps after 15 min. Use a paid plan or ping service (e.g., UptimeRobot). |
| Cannot change service runtime type | Render does not allow changing an existing service's runtime. Delete and recreate the service. |
| Build fails on Render | Check build logs in Render dashboard. Ensure the Dockerfile path and Docker context are set correctly in the service settings. |
| Frontend can't reach backend | Set `VITE_API_URL` environment variable on the Static Site service before triggering a new build. |

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Citation

If you use CIPilot in your research, please cite:

```bibtex
@unpublished{cipilot2026,
  title     = {CIPilot: Automated End-to-End CI/CD Migration via LLMs},
  author    = {Md Nazmul Hossain and Taher A. Ghaleb},
  note      = {Submitted to ASE 2026},
  year      = {2026}
}
```

---

## Acknowledgments

- [FastAPI](https://fastapi.tiangolo.com/) — high-performance Python web framework
- [actionlint](https://github.com/rhysd/actionlint) — static checker for GitHub Actions workflow files
- [Vite](https://vitejs.dev/) — fast frontend build tool
- [React](https://react.dev/) — UI component library
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — VS Code's editor component for YAML editing
- [Tailwind CSS](https://tailwindcss.com/) — utility-first CSS framework
- [Ollama](https://ollama.ai/) — local LLM runtime
- [Render.com](https://render.com/) — cloud deployment platform
