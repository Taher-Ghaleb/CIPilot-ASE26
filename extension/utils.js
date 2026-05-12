// Utility functions for CIPilot Extension
function parseGitHubRepoInfo() {
    const match = window.location.pathname.match(/^\/(.+?)\/(.+?)(?:\/(tree|blob)\/([^\/]+))?(?:\/|$)/);
    if (!match) return null;
    return {
        owner: match[1],
        repo: match[2],
        branch: match[4] || 'master',
    };
}
window.parseGitHubRepoInfo = parseGitHubRepoInfo;

function isInvalidRepo() {
    const imgs = document.querySelectorAll('img[alt^="404"]');
    return imgs.length > 0;
}
window.isInvalidRepo = isInvalidRepo;

const CIPILOT_API_PROD = 'https://cipilot-api.onrender.com';
const CIPILOT_API_LOCAL = 'http://localhost:5200';

async function getApiBaseUrl() {
    try {
        const stored = await chrome.storage.local.get(['llmSettings']);
        const settings = stored.llmSettings || {};
        if (settings.backendUrl === 'local') return CIPILOT_API_LOCAL;
        if (settings.backendUrl && settings.backendUrl !== 'prod') return settings.backendUrl;
        return CIPILOT_API_PROD;
    } catch {
        return CIPILOT_API_PROD;
    }
}
window.getApiBaseUrl = getApiBaseUrl;
