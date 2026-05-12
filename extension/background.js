const CI_FILES = [
    '.github/workflows',
    '.travis.yml',
    'circle.yml',
    '.circleci/config.yml',
    '.gitlab-ci.yml',
    '.appveyor.yml',
    'appveyor.yml',
    'azure-pipelines.yml',
    'bitbucket-pipelines.yml',
    '.cirrus.yml',
    '.scrutinizer.yml',
    'codeship-services.yml',
    '.semaphore/semaphore.yml',
    'wercker.yml',
    'bitrise.yml',
    'bamboo.yml',
    '.gocd.yaml',
    'codemagic.yaml',
    '.buildkite/pipeline.yml',
    'Jenkinsfile.yml',
];

chrome.runtime.onInstalled.addListener(() => {
    console.log('CIPilot Extension installed');
});

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGitHubToken() {
    const stored = await chrome.storage.local.get(['llmSettings']);
    const settings = stored.llmSettings || {};
    return (settings.githubToken || '').trim();
}

async function ghFetch(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
    };
    if (token) {
        const classicPrefixes = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
        const authScheme = classicPrefixes.some(prefix => token.startsWith(prefix)) ? 'token' : 'Bearer';
        headers['Authorization'] = `${authScheme} ${token}`;
    }
    const resp = await fetch(url, { ...options, headers });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { resp, json, text };
}

function base64FromUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function getViewerLogin(token) {
    const { resp, json } = await ghFetch('/user', token);
    if (!resp.ok) throw new Error('GitHub token is invalid or missing required scopes.');
    return json.login;
}

async function getRepo(token, owner, repo) {
    const { resp, json } = await ghFetch(`/repos/${owner}/${repo}`, token);
    if (!resp.ok) {
        console.error(`❌ Failed to get repo ${owner}/${repo}:`, resp.status, json);
        throw new Error(`Cannot access repo ${owner}/${repo}. Status: ${resp.status}`);
    }
    return json;
}

async function ensureFork(token, upstreamOwner, upstreamRepo, viewerLogin) {
    // If fork exists, reuse it.
    const existing = await ghFetch(`/repos/${viewerLogin}/${upstreamRepo}`, token);
    if (existing.resp.ok) {
        console.log('✅ Fork already exists, verifying base branch is synced...');
        // Verify the fork has the default branch synced
        const forkData = existing.json;
        const baseBranch = forkData.default_branch || 'main';
        
        // Check if the base branch exists in the fork
        for (let i = 0; i < 5; i++) {
            const branchCheck = await ghFetch(`/repos/${viewerLogin}/${upstreamRepo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
            if (branchCheck.resp.ok) {
                console.log(`✅ Fork base branch '${baseBranch}' is synced`);
                return { owner: viewerLogin, name: upstreamRepo, created: false };
            }
            console.log(`⏳ Fork base branch not ready yet, waiting... (${i + 1}/5)`);
            await sleep(2000);
        }
        console.warn('⚠️ Fork exists but base branch not synced, proceeding anyway...');
        return { owner: viewerLogin, name: upstreamRepo, created: false };
    }

    // Create fork
    console.log('🍴 Creating new fork...');
    const created = await ghFetch(`/repos/${upstreamOwner}/${upstreamRepo}/forks`, token, { method: 'POST' });
    if (!created.resp.ok && created.resp.status !== 202) {
        throw new Error('Failed to create fork.');
    }

    // Wait for fork to be ready
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const check = await ghFetch(`/repos/${viewerLogin}/${upstreamRepo}`, token);
        if (check.resp.ok) {
            console.log('✅ New fork created, verifying base branch...');
            const forkData = check.json;
            const baseBranch = forkData.default_branch || 'main';
            
            // Wait for base branch to be synced
            for (let j = 0; j < 10; j++) {
                const branchCheck = await ghFetch(`/repos/${viewerLogin}/${upstreamRepo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
                if (branchCheck.resp.ok) {
                    console.log(`✅ Fork base branch '${baseBranch}' is ready`);
                    return { owner: viewerLogin, name: upstreamRepo, created: true };
                }
                console.log(`⏳ Waiting for fork base branch to sync... (${j + 1}/10)`);
                await sleep(2000);
            }
            console.warn('⚠️ Fork created but base branch sync timeout, proceeding anyway...');
            return { owner: viewerLogin, name: upstreamRepo, created: true };
        }
    }
    throw new Error('Fork creation is taking too long. Please try again.');
}

async function getBranchSha(token, owner, repo, branch) {
    const { resp, json } = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    if (!resp.ok) {
        console.error(`❌ Failed to get branch ${branch} in ${owner}/${repo}:`, resp.status, json);
        throw new Error(`Cannot read branch ${branch} in ${owner}/${repo}. Status: ${resp.status}`);
    }
    return json.object.sha;
}

async function createBranch(token, owner, repo, newBranch, baseSha) {
    const { resp } = await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha })
    });
    if (resp.ok) return;
    // If branch exists, ignore
    if (resp.status === 422) return;
    console.error(`❌ Failed to create branch ${newBranch} in ${owner}/${repo}:`, resp.status);
    throw new Error(`Failed to create branch in ${owner}/${repo}. Status: ${resp.status}`);
}

async function upsertFile(token, owner, repo, path, contentText, branch, message) {
    console.log(`📝 upsertFile: ${owner}/${repo}/${path} on branch ${branch}`);
    
    // Check if file exists to include sha
    const checkUrl = `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
    console.log(`🔍 Checking if file exists: ${checkUrl}`);
    const existing = await ghFetch(checkUrl, token);
    const sha = existing.resp.ok && existing.json && existing.json.sha ? existing.json.sha : undefined;
    console.log(`📌 File exists:`, existing.resp.ok, 'SHA:', sha);

    const payload = {
        message,
        content: base64FromUtf8(contentText),
        branch,
    };
    if (sha) payload.sha = sha;

    const putUrl = `/repos/${owner}/${repo}/contents/${path}`;
    console.log(`💾 Committing to:`, putUrl, 'Payload:', { ...payload, content: `[${payload.content.length} chars]` });
    
    // Retry logic for newly forked repos (GitHub needs time to sync)
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const { resp, json } = await ghFetch(putUrl, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        console.log(`📤 Commit response (attempt ${attempt}):`, resp.status, json);
        
        if (resp.ok) {
            console.log('✅ File committed successfully');
            return;
        }
        
        // If 404 and it's a fork, retry after a delay
        if (resp.status === 404 && attempt < 3) {
            console.log(`⏳ Fork may still be syncing, waiting 2 seconds before retry ${attempt + 1}...`);
            await sleep(2000);
            lastError = json;
            continue;
        }
        
        // Other errors or final attempt - fail immediately
        const errorMsg = json && json.message ? json.message : 'Failed to commit workflow file.';
        console.error('❌ Failed to commit file:', errorMsg, 'Full response:', json);
        throw new Error(errorMsg);
    }
    
    // If we get here, all retries failed
    const errorMsg = lastError && lastError.message ? lastError.message : 'Failed to commit workflow file after retries.';
    throw new Error(errorMsg);
}

async function createPullRequest(token, upstreamOwner, upstreamRepo, title, body, head, base) {
    const { resp, json } = await ghFetch(`/repos/${upstreamOwner}/${upstreamRepo}/pulls`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, head, base })
    });
    if (!resp.ok) {
        const msg = json && json.message ? json.message : 'Failed to create PR.';
        throw new Error(msg);
    }
    return json.html_url;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkCIFiles') {
        const repoUrl = request.repoUrl;
        fetch(repoUrl)
            .then(response => response.text())
            .then(data => {
                const foundCIFiles = CI_FILES.filter(file => data.includes(file));
                sendResponse({ foundCIFiles });
            })
            .catch(error => {
                console.error('Error fetching repository:', error);
                sendResponse({ foundCIFiles: [] });
            });
        return true; // Indicates that the response will be sent asynchronously
    }

    if (request.action === 'createPullRequest') {
        (async () => {
            try {
                console.log('🚀 Starting PR creation process...');
                const token = await getGitHubToken();
                if (!token) {
                    sendResponse({ ok: false, error: 'No GitHub token configured. Open Settings and paste a token.' });
                    return;
                }
                console.log('✅ Token retrieved');

                const repo = request.repository;
                if (!repo || !repo.owner || !repo.name) {
                    sendResponse({ ok: false, error: 'Missing repository information.' });
                    return;
                }
                console.log('📦 Repository:', repo.owner, '/', repo.name);

                const viewer = await getViewerLogin(token);
                console.log('👤 Viewer login:', viewer);
                
                const upstream = await getRepo(token, repo.owner, repo.name);
                console.log('🔍 Upstream repo fetched:', upstream.full_name, 'Push access:', upstream.permissions?.push);
                
                const baseBranch = upstream.default_branch || 'main';
                console.log('🌿 Base branch:', baseBranch);

                const canPush = upstream.permissions && upstream.permissions.push;

                let targetOwner = repo.owner;
                let targetRepo = repo.name;
                let usedFork = false;

                if (!canPush) {
                    console.log('🍴 No push access, creating/using fork...');
                    const fork = await ensureFork(token, repo.owner, repo.name, viewer);
                    targetOwner = fork.owner;
                    targetRepo = fork.name;
                    usedFork = true;
                    console.log('✅ Fork ready:', targetOwner, '/', targetRepo);
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const branchName = `ci-cd-assistant/migrate-${timestamp}`;
                console.log('🌿 Creating branch:', branchName);

                const baseSha = await getBranchSha(token, repo.owner, repo.name, baseBranch);
                console.log('📍 Base SHA:', baseSha);
                
                await createBranch(token, targetOwner, targetRepo, branchName, baseSha);
                console.log('✅ Branch created');

                const workflowPath = request.workflowPath || '.github/workflows/ci-cd-assistant.yml';
                const workflowYaml = request.workflowYaml || '';
                const commitMessage = request.commitMessage || 'Add migrated GitHub Actions workflow (CI/CD Assistant)';
                
                console.log('📄 Workflow path:', workflowPath);
                console.log('📝 Workflow YAML length:', workflowYaml.length);
                
                if (!workflowYaml.trim()) {
                    sendResponse({ ok: false, error: 'Migrated workflow is empty.' });
                    return;
                }

                console.log('💾 Committing file to:', targetOwner, '/', targetRepo, 'on branch', branchName);
                await upsertFile(
                    token,
                    targetOwner,
                    targetRepo,
                    workflowPath,
                    workflowYaml,
                    branchName,
                    commitMessage
                );
                console.log('✅ File committed');

                const prTitle = request.title || 'Migrate CI/CD to GitHub Actions';
                const prBody = request.body || 'Created by CI/CD Assistant Chrome extension.';

                const headRef = usedFork ? `${targetOwner}:${branchName}` : branchName;
                console.log('🔀 Creating PR with head:', headRef, 'base:', baseBranch);
                
                const prUrl = await createPullRequest(token, repo.owner, repo.name, prTitle, prBody, headRef, baseBranch);
                console.log('✅ PR created:', prUrl);

                sendResponse({ ok: true, prUrl, usedFork, branchName });
            } catch (e) {
                console.error('❌ PR creation failed:', e);
                sendResponse({ ok: false, error: e && e.message ? e.message : 'Unknown error' });
            }
        })();
        return true;
    }
});