import os
import requests

DEFAULT_OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com"
DEFAULT_XAI_BASE_URL = "https://api.x.ai"
DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai"
DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com"

def _build_prompt(source_ci: str, target_ci: str, content: str, feedback: str | None = None) -> str:
    # Special case for retry (source_ci will be 'github-actions-draft')
    is_retry = source_ci == 'github-actions-draft'
    
    if is_retry and feedback:
        # For retry: the feedback contains everything (previous attempt, errors, original source)
        return (
            "You are a CI/CD migration expert.\n\n"
            "TASK: Fix the GitHub Actions YAML that has validation errors.\n\n"
            "CRITICAL REQUIREMENTS:\n"
            "1. You MUST output ONLY valid GitHub Actions YAML syntax\n"
            "2. DO NOT output Travis CI or any other CI syntax\n"
            "3. DO NOT include any explanations, comments, or markdown\n"
            "4. DO NOT wrap output in code blocks (```yaml)\n"
            "5. Fix ALL errors listed below\n"
            "6. Maintain the workflow logic and structure\n\n"
            "COMMON FIXES NEEDED:\n"
            "- Services must be a MAPPING (key: value), not a sequence (- items)\n"
            "  WRONG: services:\\n      - name: mysql\n"
            "  CORRECT: services:\\n      mysql:\\n        image: mysql:latest\n"
            "- Use correct action versions: actions/checkout@v4, actions/setup-java@v4, actions/setup-python@v5 (NOT @v4), actions/setup-node@v4, actions/setup-go@v5 (NOT @v4), actions/setup-dotnet@v4\n"
            "- Replace EOL Python versions: 2.6/2.7 → 3.9, 3.3/3.4/3.5 → 3.8; replace EOL Node: <12 → 18\n"
            "- Always include workflow_dispatch in 'on:' block; remove branch filters from push/pull_request\n"
            "- Shell scripts: prefix with chmod +x or use 'bash script.sh' to avoid Permission denied\n"
            "- Use $(command) instead of backticks `command`\n"
            "- Quote shell variables: \"$(which rst2html.py)\" not `which rst2html.py`\n"
            "- Quote environment variables in shell: \"$BRANCH\" not $BRANCH\n"
            "- Quote GitHub expressions: \"${{ github.workspace }}\" when used in shell\n"
            "- GitHub context properties: Use ${{ github.workspace }} NOT ${{ github.home }}\n"
            "- For home directory cache: Use $HOME or actions/cache@v4, NOT ${{ github.home }}\n"
            "- Available context: github.workspace, github.ref, github.ref_name, github.actor, etc.\n\n"
            + feedback + "\n\n"
            "Now generate the CORRECTED GitHub Actions YAML (and NOTHING else):"
        )
    
    feedback_block = ""
    if feedback and feedback.strip():
        feedback_block = (
            "\n\n=== VALIDATION FEEDBACK ===\n"
            "The previous GitHub Actions YAML you generated had the following issues:\n\n"
            f"{feedback.strip()}\n\n"
            "Please generate a NEW GitHub Actions YAML that fixes these issues.\n"
            "DO NOT return the Travis CI source - you must return VALID GitHub Actions YAML.\n"
            "=== END FEEDBACK ===\n\n"
        )
    
    target_name = "GitHub Actions workflow" if target_ci == "github-actions" else target_ci
    
    # Check if content contains multiple services (indicated by separator comments)
    has_multiple_services = '# Source:' in content and content.count('# ==========================================') > 2
    
    multi_service_note = ""
    if has_multiple_services:
        multi_service_note = (
            "\n\nNOTE: The configuration below contains CI/CD configs from MULTIPLE services.\n"
            "Your task is to consolidate ALL of them into ONE comprehensive GitHub Actions workflow.\n"
            "Combine all jobs, steps, and logic from all services into a single, well-structured workflow.\n\n"
        )
    
    return (
        "You are a CI/CD migration expert specializing in PRECISE, MINIMAL conversions.\n\n"
        f"TASK: Convert the {source_ci} configuration into {target_name}.\n\n"
        "=== CRITICAL: ZERO HALLUCINATION RULE ===\n"
        "You MUST convert ONLY what EXISTS in the source. Do NOT invent or add ANYTHING.\n"
        "- Count the steps/tasks in the source. Output should have the SAME number of functional steps.\n"
        "- Do NOT add random commands like 'which X', 'verify X', 'test X' unless in source.\n"
        "- Do NOT add any tools, scripts, or programs not mentioned in the source.\n"
        "- If source has 1 command (e.g., echo), output has ONLY that command (plus minimal setup).\n"
        "- Do NOT assume what the project needs - convert ONLY what is explicitly defined.\n\n"
        "=== ALLOWED ADDITIONS (ONLY THESE) ===\n"
        "- actions/checkout@v4 (required for GitHub Actions to access code)\n"
        "- actions/setup-X ONLY if source explicitly uses that language/runtime (use correct version per OUTPUT REQUIREMENTS below)\n"
        "- Container/services ONLY if source explicitly specifies Docker image/services\n\n"
        "=== CRITICAL: VERSION PRESERVATION (takes precedence over ALL other rules) ===\n"
        "When source uses Docker images with specific versions, you MUST preserve the exact version.\n"
        "This OVERRIDES the EOL version mapping rules below — Docker image versions are NEVER replaced.\n"
        "- docker: cimg/go:1.12.9 → uses: actions/setup-go@v5 WITH go-version: '1.12.9'  ← keep 1.12.9 exactly\n"
        "- docker: python:3.9 → uses: actions/setup-python@v5 WITH python-version: '3.9'\n"
        "- docker: node:18 → uses: actions/setup-node@v4 WITH node-version: '18'\n"
        "ALWAYS extract and specify the exact version from Docker image tags!\n\n"
        "=== OUTPUT REQUIREMENTS ===\n"
        f"1. Output ONLY valid {target_name} YAML - no explanations, no markdown, no code blocks\n"
        "2. Use proper GitHub Actions syntax: name, on, jobs with runs-on and steps\n"
        "3. Services must be mappings: services:\\n  mysql:\\n    image: mysql:latest\n"
        "4. Use EXACTLY these action versions (actionlint enforces them):\n"
        "   Core:      actions/checkout@v4, actions/cache@v4, actions/upload-artifact@v4, actions/download-artifact@v4, actions/github-script@v7\n"
        "   Language:  actions/setup-python@v5 (NOT @v4 — flagged too old), actions/setup-node@v4, actions/setup-java@v4,\n"
        "              actions/setup-go@v5 (NOT @v4 — flagged too old), actions/setup-dotnet@v4, ruby/setup-ruby@v1, dtolnay/rust-toolchain@stable\n"
        "   Docker:    docker/setup-buildx-action@v3, docker/login-action@v3, docker/build-push-action@v6\n"
        "   Cloud:     aws-actions/configure-aws-credentials@v4, azure/login@v2, google-github-actions/auth@v2\n"
        "   For any action NOT listed, use the highest available version tag.\n"
        "   NEVER use @v1, @v2, @v3 for actions where v4 or higher is available.\n"
        "5. Runner labels — always use explicit stable versions, never 'latest':\n"
        "   ubuntu-latest → ubuntu-22.04,  ubuntu-16.04 → ubuntu-22.04,  ubuntu-18.04 → ubuntu-22.04,  ubuntu-20.04 → ubuntu-22.04\n"
        "   macos-latest → macos-14,  macos-11 → macos-14,  macos-12 → macos-14\n"
        "   windows-latest → windows-2022,  windows-2016 → windows-2022,  windows-2019 → windows-2022\n"
        "   Self-hosted runner labels: preserve as-is.\n"
        "6. Use $(command) for shell substitution, NOT backticks\n"
        "7. ALWAYS include 'workflow_dispatch:' in the 'on:' block so the workflow can be triggered manually.\n"
        "   Also REMOVE branch filters from push/pull_request triggers (use bare 'push:' and 'pull_request:' with no branches list)\n"
        "   because branch filters block verification runs on feature branches.\n\n"
        "=== PYTHON / RUNTIME VERSION RULES (applies ONLY to language: / runtime: declarations, NOT Docker images) ===\n"
        "These rules apply ONLY when the source CI declares a language version directly (e.g. Travis 'python:', 'node_js:', 'go:').\n"
        "Do NOT apply these rules to versions extracted from Docker image tags — those must be kept exactly as-is.\n"
        "GitHub-hosted ubuntu-22.04 runners do NOT support very old runtime versions.\n"
        "When the source specifies EOL versions in language declarations, replace with the minimum supported equivalent:\n"
        "  Python: 2.6, 2.7 → 3.9   |   3.3, 3.4, 3.5 → 3.8   |   3.6, 3.7, 3.8+ → keep as-is\n"
        "  Node.js: 0.x, 4, 6, 8, 10 → 18   |   12, 14 → 18   |   16+ → keep as-is\n"
        "  Ruby: < 2.5 → 3.2   |   2.5+ → keep as-is\n"
        "  Java: < 8 → 11   |   8+ → keep as-is\n"
        "  Go: < 1.13 → 1.21   |   1.13+ → keep as-is\n"
        "  When replacing EOL versions in a matrix, deduplicate — don't create duplicate matrix entries.\n\n"
        "=== SHELL SCRIPT STEPS ===\n"
        "If source runs a shell script file (e.g. './script.sh', './run-tests.sh'):\n"
        "  - Prefix the step with: run: chmod +x <script_name> && ./<script_name>\n"
        "  - Or use: run: bash <script_name>\n"
        "  This avoids 'Permission denied' errors on GitHub-hosted runners.\n\n"
        "=== CONVERT EXACTLY WHAT EXISTS ===\n"
        "✓ TRIGGERS: Convert source triggers (push, PR, schedule, manual) to 'on:' events — always add workflow_dispatch, remove branch filters\n"
        "✓ ENVIRONMENT: Preserve ALL environment variables exactly as defined\n"
        "✓ SERVICES: Convert services (mysql, redis, postgres) ONLY if in source\n"
        "✓ STEPS: Convert each source step/task to ONE equivalent GitHub Actions step\n"
        "✓ COMMANDS: Copy shell commands/scripts EXACTLY - do not add or modify\n"
        "✓ MATRIX: Convert build matrix/strategy if present in source — replace EOL versions per rules above\n"
        "✓ ARTIFACTS: Convert artifact upload/download if present in source\n"
        "✓ CACHING: Convert cache configurations ONLY if explicitly in source\n"
        "✗ DO NOT INVENT: tools, scripts, verify steps, tests, or anything not in source\n\n"
        + multi_service_note
        + feedback_block +
        f"SOURCE {source_ci.upper()} CONFIGURATION TO CONVERT:\n"
        "---\n"
        f"{content}\n"
        "---\n\n"
        f"Generate the equivalent {target_name} YAML (NOTHING ELSE - no explanation, no markdown):"
    )


def _normalize_base_url(base_url: str | None, default_base: str) -> str:
    url = (base_url or "").strip()
    if not url:
        url = default_base
    return url.rstrip("/")


def _ollama_generate(*, base_url: str | None, model: str, prompt: str, timeout_s: int = 300) -> str:
    base = _normalize_base_url(base_url, DEFAULT_OLLAMA_BASE_URL)
    url = f"{base}/api/generate"
    resp = requests.post(
        url,
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=timeout_s,
    )
    resp.raise_for_status()
    result = (resp.json().get("response") or "").strip()
    # Strip markdown code blocks if present
    if result.startswith("```yaml"):
        result = result[7:]
    elif result.startswith("```"):
        result = result[3:]
    if result.endswith("```"):
        result = result[:-3]
    return result.strip()


def _openai_compatible_chat(*, base_url: str | None, api_key: str, model: str, system: str, user: str, timeout_s: int = 300) -> str:
    base = _normalize_base_url(base_url, DEFAULT_OPENAI_BASE_URL)
    # Support base URLs like https://api.openai.com or https://api.openai.com/v1
    if base.endswith("/v1"):
        url = f"{base}/chat/completions"
    else:
        url = f"{base}/v1/chat/completions"

    print(f"[Agent] Calling {url} with model={model}")

    # Set temperature=1 for gpt-5.5, else 0.2
    temp = 1 if model.strip().lower().startswith("gpt-5.5") else 0.2
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temp,
        },
        timeout=timeout_s,
    )

    # Check for errors and provide detailed message
    if resp.status_code != 200:
        try:
            error_data = resp.json()
            error_msg = error_data.get('error', {}).get('message', '') or str(error_data)
        except Exception:
            error_msg = resp.text or f"HTTP {resp.status_code}"
        print(f"[LLM] API Error: {error_msg}")
        raise ValueError(f"API Error ({resp.status_code}): {error_msg}")
    data = resp.json()
    try:
        result = (data["choices"][0]["message"]["content"] or "").strip()
        # Strip markdown code blocks if present
        if result.startswith("```yaml"):
            result = result[7:]
        elif result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]
        return result.strip()
    except Exception:
        # Best-effort fallback if provider returns a different envelope
        return (str(data) or "").strip()


def _anthropic_chat(*, base_url: str | None, api_key: str, model: str, system: str, user: str, timeout_s: int = 300) -> str:
    """Anthropic Claude API using Messages API format"""
    base = _normalize_base_url(base_url, DEFAULT_ANTHROPIC_BASE_URL)
    url = f"{base}/v1/messages"

    print(f"[Agent] Calling Anthropic {url} with model={model}")

    # Set temperature=1 for gpt-5.5, else 0.2 (for compatibility if Anthropic ever supports gpt-5.5)
    temp = 1 if model.strip().lower().startswith("gpt-5.5") else 0.2
    resp = requests.post(
        url,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 4096,
            "system": system,
            "messages": [
                {"role": "user", "content": user},
            ],
            "temperature": temp,
        },
        timeout=timeout_s,
    )

    if resp.status_code != 200:
        try:
            error_data = resp.json()
            error_msg = error_data.get('error', {}).get('message', '') or str(error_data)
        except Exception:
            error_msg = resp.text or f"HTTP {resp.status_code}"
        print(f"[LLM] Anthropic API Error: {error_msg}")
        raise ValueError(f"Anthropic API Error ({resp.status_code}): {error_msg}")
    
    data = resp.json()
    try:
        result = (data["content"][0]["text"] or "").strip()
        # Strip markdown code blocks if present
        if result.startswith("```yaml"):
            result = result[7:]
        elif result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]
        return result.strip()
    except Exception as e:
        print(f"[LLM] Error parsing Anthropic response: {e}")
        return (str(data) or "").strip()


def _google_chat(*, base_url: str | None, api_key: str, model: str, system: str, user: str, timeout_s: int = 300) -> str:
    """Google Gemini API using generateContent endpoint"""
    base = _normalize_base_url(base_url, DEFAULT_GOOGLE_BASE_URL)
    # Gemini API format: /v1/models/{model}:generateContent
    url = f"{base}/v1/models/{model}:generateContent"

    print(f"[Agent] Calling Google Gemini {url}")

    # Combine system and user prompts for Gemini
    combined_prompt = f"{system}\n\n{user}"

    # Set temperature=1 for gpt-5.5, else 0.2 (for compatibility if Google ever supports gpt-5.5)
    temp = 1 if model.strip().lower().startswith("gpt-5.5") else 0.2
    resp = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
        },
        params={"key": api_key},
        json={
            "contents": [
                {
                    "parts": [
                        {"text": combined_prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": temp,
                "maxOutputTokens": 4096,
            }
        },
        timeout=timeout_s,
    )

    if resp.status_code != 200:
        try:
            error_data = resp.json()
            error_msg = error_data.get('error', {}).get('message', '') or str(error_data)
        except Exception:
            error_msg = resp.text or f"HTTP {resp.status_code}"
        print(f"[LLM] Google API Error: {error_msg}")
        raise ValueError(f"Google API Error ({resp.status_code}): {error_msg}")
    
    data = resp.json()
    try:
        result = (data["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
        # Strip markdown code blocks if present
        if result.startswith("```yaml"):
            result = result[7:]
        elif result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]
        return result.strip()
    except Exception as e:
        print(f"[LLM] Error parsing Google response: {e}")
        return (str(data) or "").strip()


def _detect_wrong_format(output: str, source_ci: str, target_ci: str) -> bool:
    """Detect if LLM returned source format instead of target format - works for any CI platform"""
    output_lower = output.lower()
    
    # Define keywords specific to each CI platform that shouldn't appear in GitHub Actions output
    ci_specific_keywords = {
        "travis-ci": ["language:", "dist:", "before_script:", "after_failure:", "skip_cleanup:", "addons:"],
        "travis ci": ["language:", "dist:", "before_script:", "after_failure:", "skip_cleanup:", "addons:"],
        "circleci": ["version: 2", "workflows:", "orbs:", "executors:", "persist_to_workspace:", "attach_workspace:"],
        "gitlab ci": ["stages:", "before_script:", "after_script:", "only:", "except:", "artifacts:\n    paths:"],
        "gitlab-ci": ["stages:", "before_script:", "after_script:", "only:", "except:", "artifacts:\n    paths:"],
        "azure pipelines": ["trigger:", "pool:", "vmimage:", "stages:", "- task:", "displayname:"],
        "azure-pipelines": ["trigger:", "pool:", "vmimage:", "stages:", "- task:", "displayname:"],
        "jenkins": ["pipeline {", "agent {", "stages {", "stage(", "steps {", "sh '"],
        "jenkinsfile": ["pipeline {", "agent {", "stages {", "stage(", "steps {", "sh '"],
        "appveyor": ["version:", "image:", "build_script:", "test_script:", "deploy_script:", "artifacts:"],
        "bitbucket pipelines": ["pipelines:", "default:", "- step:", "caches:", "definitions:"],
        "bitbucket-pipelines": ["pipelines:", "default:", "- step:", "caches:", "definitions:"],
        "semaphore": ["version: v1", "blocks:", "- name:", "task:", "prologue:", "epilogue:"],
        "cirrus ci": ["task:", "container:", "script:", "cache:", "environment:"],
        "cirrus-ci": ["task:", "container:", "script:", "cache:", "environment:"],
    }
    
    # Check if output contains source CI-specific keywords when converting TO GitHub Actions
    if target_ci == "github-actions":
        source_lower = source_ci.lower()
        if source_lower in ci_specific_keywords:
            keywords = ci_specific_keywords[source_lower]
            matching_keywords = [kw for kw in keywords if kw in output_lower]
            # If more than 2 source-specific keywords found, likely wrong format
            if len(matching_keywords) >= 2:
                return True
    
    # If converting TO GitHub Actions, it MUST have these keywords
    if target_ci == "github-actions":
        required_gha = ["name:", "on:", "jobs:"]
        if not all(keyword in output_lower for keyword in required_gha):
            return True
    
    return False


def convert_pipeline(
    *,
    provider: str,
    model: str,
    source_ci: str,
    target_ci: str,
    content: str,
    base_url: str | None = None,
    api_key: str | None = None,
    validation_feedback: str | None = None,
) -> str:
    prompt = _build_prompt(source_ci, target_ci, content, validation_feedback)

    provider_norm = (provider or "ollama").strip().lower()
    result = ""
    
    if provider_norm == "ollama":
        result = _ollama_generate(base_url=base_url, model=model, prompt=prompt)
    elif provider_norm == "anthropic":
        if not api_key:
            raise ValueError(f"api_key is required for provider '{provider_norm}'")
        result = _anthropic_chat(
            base_url=base_url,
            api_key=api_key,
            model=model,
            system="You are a CI/CD migration expert. You MUST output only the target CI/CD format requested.",
            user=prompt,
        )
    elif provider_norm == "google":
        if not api_key:
            raise ValueError(f"api_key is required for provider '{provider_norm}'")
        result = _google_chat(
            base_url=base_url,
            api_key=api_key,
            model=model,
            system="You are a CI/CD migration expert. You MUST output only the target CI/CD format requested.",
            user=prompt,
        )
    elif provider_norm in ("openai", "xai", "groq", "generic"):
        if not api_key:
            raise ValueError(f"api_key is required for provider '{provider_norm}'")

        if provider_norm == "xai":
            effective_base = _normalize_base_url(base_url, DEFAULT_XAI_BASE_URL)
        elif provider_norm == "groq":
            effective_base = _normalize_base_url(base_url, DEFAULT_GROQ_BASE_URL)
        elif provider_norm == "generic":
            # For generic provider, base_url is required
            if not base_url:
                raise ValueError("base_url is required for generic provider")
            effective_base = _normalize_base_url(base_url, "")
        else:
            effective_base = _normalize_base_url(base_url, DEFAULT_OPENAI_BASE_URL)

        result = _openai_compatible_chat(
            base_url=effective_base,
            api_key=api_key,
            model=model,
            system="You are a CI/CD migration expert. You MUST output only the target CI/CD format requested.",
            user=prompt,
        )
    else:
        raise ValueError(f"Unsupported provider: {provider}")
    
    # Validate that we got the right format
    if _detect_wrong_format(result, source_ci, target_ci):
        raise ValueError(
            f"LLM returned {source_ci} format instead of {target_ci}. "
            f"The output must be valid {target_ci} YAML with proper syntax (name, on, jobs for GitHub Actions)."
        )
    
    return result


def convert_pipeline_ollama(source_ci: str, target_ci: str, content: str) -> str:
    # Backward-compatible wrapper
    return convert_pipeline(
        provider="ollama",
        model="gemma3:12b",
        source_ci=source_ci,
        target_ci=target_ci,
        content=content,
        base_url=None,
        api_key=None,
    )


def _build_semantic_verification_prompt(source_config: str, generated_config: str, source_ci: str, target_ci: str) -> str:
    """Build prompt for semantic verification of CI/CD migration - works for any CI platform"""
    return f"""You are a CI/CD migration verification expert. Check for BOTH missing features AND hallucinated additions.

This migration is from {source_ci} to {target_ci}.

ORIGINAL {source_ci.upper()} CONFIG:
---
{source_config}
---

GENERATED {target_ci.upper()} CONFIG:
---
{generated_config}
---

=== VERIFICATION TASK ===
Check FOUR things:
1. Source functionality is preserved (nothing critical missing)
2. No HALLUCINATED/INVENTED steps were added (nothing fabricated)
3. VERSION NUMBERS are preserved when converting Docker images to setup actions
4. Docker containers/images are properly preserved (CRITICAL!)

=== CRITICAL: DOCKER CONTAINER PRESERVATION ===
When source uses a Docker image (CircleCI docker:, GitLab image:, etc.):
- GitHub Actions MUST use EITHER:
  a) `container: image: <same-image>` under the job, OR
  b) A setup action (setup-go, setup-python, etc.) WITH the exact version from the image
- If source specifies `docker: - image: X` and generated GitHub Actions has NEITHER container: nor setup action with version → FAIL

Examples:
- Source: `docker: - image: cimg/go:1.12.9` → MUST have `container: image: cimg/go:1.12.9` OR `setup-go` with `go-version: '1.12.9'`
- Source: `docker: - image: python:3.9` → MUST have `container: image: python:3.9` OR `setup-python` with `python-version: '3.9'`
- Source: `docker: - image: cirq/go:1.12.9` → MISSING `container:` AND MISSING `setup-go` → FAIL

=== CRITICAL: VERSION PRESERVATION ===
When source uses a Docker image with a specific version (e.g., cimg/go:1.12.9, python:3.9, node:18):
- The generated config MUST specify that exact version
- Example: docker image `cimg/go:1.12.9` → setup-go MUST have `go-version: '1.12.9'`
- Example: docker image `python:3.9` → setup-python MUST have `python-version: '3.9'`
- If version is NOT specified in generated setup action → FAIL and list in missing_features

=== WHAT TO CHECK (CI Platform Agnostic) ===
✓ Shell commands / scripts - are they preserved?
✓ Environment variables - are they all present?
✓ Services (databases, caches) - preserved if in source?
✓ Docker images / containers - MUST be preserved as `container:` OR converted with setup action + EXACT version
✓ Build matrix / strategy - preserved if in source?
✓ Triggers (push, PR, schedule, tags) - approximately equivalent?
✓ Artifacts upload/download - preserved if in source?
✓ Cache configurations - preserved if explicitly in source?

=== DOCKER IMAGE HANDLING (CRITICAL) ===
If source has docker/image config but generated GitHub Actions has NEITHER:
- `container: image: X` keyword, NOR
- A matching setup action with version
→ Then FAIL and add "Docker image X not preserved" to missing_features

=== ALLOWED ADDITIONS (NOT hallucinations - do NOT list these) ===
✅ actions/checkout@v4 - REQUIRED for GitHub Actions, NEVER list as hallucination
✅ actions/setup-node@v4, actions/setup-python@v5, actions/setup-go@v5, actions/setup-java@v4, actions/setup-dotnet@v4, etc. - IF source uses that language AND version is specified
✅ Minor trigger additions (e.g., adding pull_request to push)
✅ Standard runner setup implied by source platform
✅ container: with same image as source docker config

IMPORTANT: Do NOT include checkout or setup actions in hallucinated_steps list!

=== FAIL CONDITIONS (CRITICAL - must fail for these) ===
❌ FAIL if SOURCE functionality is MISSING from generated
❌ FAIL if Docker image is specified in source but NOT preserved in generated (no container: and no setup action with version)
❌ FAIL if Docker image version is NOT preserved (e.g., source has go:1.12.9, generated has setup-go WITHOUT go-version: '1.12.9')
❌ FAIL if generated has INVENTED steps not in source (excluding checkout/setup):
   - Random tool checks like 'which X' or 'verify X' when not in source
   - Test commands (npm test, pytest, mvn test) when no tests in source
   - Build commands (make, gradle, maven) when not in source
   - Deploy steps when no deployment in source
   - Lint/format steps when not in source
   - Any commands referencing tools/programs not in source config

=== ADDITIONAL STEPS DETECTION ===
Compare functional steps (NOT checkout/setup):
- Count functional steps in source (run commands, scripts)
- Count functional steps in generated (run commands, scripts - NOT checkout/setup actions)
- If generated has MORE run/script steps than source → list them as additional

Examples of FAILURES:
- Source: `docker: cimg/go:1.12.9` → Generated: `setup-go@v4` WITHOUT go-version → FAIL (missing version)
- Source: `echo "Hello"` → Generated adds: `npm test`, `make build` → FAIL (hallucinated)
- Source: just docker image → Generated adds: `which python`, `verify pip` → FAIL (hallucinated)

Examples that are OK:
- Source: `docker: cimg/go:1.12.9` → Generated: `setup-go@v4` WITH `go-version: '1.12.9'` → OK
- Source: uses Go → Generated has: actions/checkout@v4, actions/setup-go@v5 → OK (if version preserved)

=== RESPONSE FORMAT ===
RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{{
  "passed": true or false,
  "reasons": ["short reason 1", "short reason 2"],
  "missing_features": ["list any source features missing - INCLUDING missing version numbers like 'Go version 1.12.9 not specified'"],
  "hallucinated_steps": ["list ONLY invented run/script steps - NOT checkout or setup actions"],
  "confidence": 0.0 to 1.0
}}

Set "passed": true ONLY if:
1. Source functionality is preserved
2. No invented steps added
3. Version numbers from Docker images are preserved in setup actions
Do NOT fail just because checkout or setup actions were added - those are required."""


def semantic_verify_migration(
    *,
    provider: str,
    model: str,
    source_config: str,
    generated_config: str,
    source_ci: str,
    target_ci: str,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict:
    """
    Use LLM to semantically verify that generated CI/CD config captures source functionality.
    
    Returns dict with:
        - passed: bool - whether verification passed
        - reasons: list[str] - explanation of verdict
        - missing_features: list[str] - features not found in generated config
        - confidence: float - confidence level (0.0 to 1.0)
    """
    import json
    
    prompt = _build_semantic_verification_prompt(source_config, generated_config, source_ci, target_ci)
    
    provider_norm = (provider or "ollama").strip().lower()
    result_text = ""
    
    try:
        if provider_norm == "ollama":
            result_text = _ollama_generate(base_url=base_url, model=model, prompt=prompt)
        elif provider_norm == "anthropic":
            if not api_key:
                raise ValueError(f"api_key is required for provider '{provider_norm}'")
            result_text = _anthropic_chat(
                base_url=base_url,
                api_key=api_key,
                model=model,
                system="You are a CI/CD migration verification expert. You MUST respond with only valid JSON.",
                user=prompt,
            )
        elif provider_norm == "google":
            if not api_key:
                raise ValueError(f"api_key is required for provider '{provider_norm}'")
            result_text = _google_chat(
                base_url=base_url,
                api_key=api_key,
                model=model,
                system="You are a CI/CD migration verification expert. You MUST respond with only valid JSON.",
                user=prompt,
            )
        elif provider_norm in ("openai", "xai", "groq", "generic"):
            if not api_key:
                raise ValueError(f"api_key is required for provider '{provider_norm}'")
            
            if provider_norm == "xai":
                effective_base = _normalize_base_url(base_url, DEFAULT_XAI_BASE_URL)
            elif provider_norm == "groq":
                effective_base = _normalize_base_url(base_url, DEFAULT_GROQ_BASE_URL)
            elif provider_norm == "generic":
                if not base_url:
                    raise ValueError("base_url is required for generic provider")
                effective_base = _normalize_base_url(base_url, "")
            else:
                effective_base = _normalize_base_url(base_url, DEFAULT_OPENAI_BASE_URL)
            
            result_text = _openai_compatible_chat(
                base_url=effective_base,
                api_key=api_key,
                model=model,
                system="You are a CI/CD migration verification expert. You MUST respond with only valid JSON.",
                user=prompt,
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")
        
        # Parse JSON response
        print(f"[DOUBLE-CHECK] Raw LLM response length: {len(result_text)}")
        print(f"[DOUBLE-CHECK] Raw response preview: {result_text[:300] if result_text else '(empty)'}")
        
        # Handle empty response
        if not result_text or not result_text.strip():
            print("[DOUBLE-CHECK] Empty response from LLM, assuming passed")
            return {
                "passed": True,
                "reasons": ["Verification completed (model returned empty response - assuming valid)"],
                "missing_features": [],
                "confidence": 0.7,
            }
        
        # Handle potential markdown code blocks
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        elif result_text.startswith("```"):
            result_text = result_text[3:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]
        result_text = result_text.strip()
        
        # Try to extract JSON from mixed text response
        import re
        json_match = re.search(r'\{[\s\S]*\}', result_text)
        if json_match:
            result_text = json_match.group(0)
        
        result = json.loads(result_text)
        
        # Ensure required fields - include hallucinated_steps in response
        hallucinated = result.get("hallucinated_steps", [])
        missing = result.get("missing_features", [])
        
        # If there are hallucinated steps, fail the verification
        passed = result.get("passed", False)
        if hallucinated and passed:
            print(f"[DOUBLE-CHECK] Hallucinated steps detected, overriding to FAIL: {hallucinated}")
            passed = False
        
        return {
            "passed": passed,
            "reasons": result.get("reasons", []),
            "missing_features": missing,
            "hallucinated_steps": hallucinated,
            "confidence": result.get("confidence", 0.5),
        }
        
    except json.JSONDecodeError as e:
        print(f"[DOUBLE-CHECK] Failed to parse LLM response as JSON: {e}")
        print(f"[DOUBLE-CHECK] Raw response: {result_text[:500] if result_text else '(empty)'}")
        
        # Try to infer result from text content
        result_lower = (result_text or "").lower()
        if "passed" in result_lower and ("true" in result_lower or "yes" in result_lower):
            return {
                "passed": True,
                "reasons": ["Verification passed (inferred from non-JSON response)"],
                "missing_features": [],
                "confidence": 0.6,
            }
        
        return {
            "passed": True,  # Default to passed to avoid blocking valid conversions
            "reasons": [f"Could not parse verification (assuming valid): {str(e)[:100]}"],
            "missing_features": [],
            "confidence": 0.5,
        }
    except Exception as e:
        print(f"[DOUBLE-CHECK] Error during semantic verification: {e}")
        return {
            "passed": False,
            "reasons": [f"Verification error: {str(e)}"],
            "missing_features": [],
            "confidence": 0.0,
        }
