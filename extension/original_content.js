// On page load, run async detection if repo is valid
async function runCIExtension() {
    if (isInvalidRepo()) return;
    await checkForCIServicesAsync();
}

window.addEventListener('DOMContentLoaded', runCIExtension);
(async () => { await runCIExtension(); })();
document.addEventListener('pjax:end', runCIExtension);

// ...existing code...
// Use the same CI file patterns as in ciCheck.js
const ciFilePatterns = {
    '.github/workflows': 'GitHub Actions',
    '.travis.yml': 'Travis CI',
    'circle.yml': 'CircleCI',
    '.circleci/config.yml': 'CircleCI',
    '.gitlab-ci.yml': 'GitLab',
    '.appveyor.yml': 'AppVeyor',
    'appveyor.yml': 'AppVeyor',
    'azure-pipelines.yml': 'Azure Pipelines',
    'bitbucket-pipelines.yml': 'Bitbucket',
    '.cirrus.yml': 'Cirrus',
    '.scrutinizer.yml': 'Scrutinizer CI',
    'codeship-services.yml': 'Codeship',
    '.semaphore/semaphore.yml': 'Semaphore CI',
    'wercker.yml': 'Wercker',
    'bitrise.yml': 'Bitrise',
    'bamboo.yml': 'Bamboo',
    '.gocd.yaml': 'GoCD',
    'codemagic.yaml': 'Codemagic',
    '.buildkite/pipeline.yml': 'Buildkite',
    'Jenkinsfile.yml': 'Jenkins'
};

// Map CI services to their folder or file tree paths for detection
const ciTreePaths = {
    'GitHub Actions': '.github/workflows',
    'CircleCI': '.circleci',
    'Semaphore CI': '.semaphore',
    'Buildkite': '.buildkite',
    'Travis CI': '', // file-based, but we can check for .travis.yml in tree
    'GitLab': '',
    'AppVeyor': '',
    'Azure Pipelines': '',
    'Bitbucket': '',
    'Cirrus': '.cirrus.yml',
    'Scrutinizer CI': '.scrutinizer.yml',
    'Codeship': 'codeship-services.yml',
    'Semaphore': '.semaphore/semaphore.yml',
    'Wercker': 'wercker.yml',
    'Bitrise': 'bitrise.yml',
    'Bamboo': 'bamboo.yml',
    'GoCD': '.gocd.yaml',
    'Codemagic': 'codemagic.yaml',
    'Jenkins': 'Jenkinsfile.yml',
};

// Use all CI configs in keyCIConfigs for both file-based and folder-based detection
const keyCIConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows', isFolder: true },
    { name: 'Travis CI', path: '.travis.yml', isFolder: false },
    { name: 'CircleCI', path: '.circleci', isFolder: true },
    { name: 'AppVeyor', path: 'appveyor.yml', isFolder: false },
    { name: 'GitLab', path: '.gitlab-ci.yml', isFolder: false },
    { name: 'Semaphore', path: '.semaphore', isFolder: true },
    { name: 'Semaphore', path: '.semaphore/semaphore.yml', isFolder: false },
    { name: 'Buildkite', path: '.buildkite', isFolder: true },
    { name: 'Azure Pipelines', path: 'azure-pipelines.yml', isFolder: false },
    { name: 'Bitbucket', path: 'bitbucket-pipelines.yml', isFolder: false },
    { name: 'Cirrus', path: '.cirrus.yml', isFolder: false },
    { name: 'Scrutinizer CI', path: '.scrutinizer.yml', isFolder: false },
    { name: 'Codeship', path: 'codeship-services.yml', isFolder: false },
    { name: 'Wercker', path: 'wercker.yml', isFolder: false },
    { name: 'Bitrise', path: 'bitrise.yml', isFolder: false },
    { name: 'Bamboo', path: 'bamboo.yml', isFolder: false },
    { name: 'GoCD', path: '.gocd.yaml', isFolder: false },
    { name: 'Codemagic', path: 'codemagic.yaml', isFolder: false },
    { name: 'Jenkins', path: 'Jenkinsfile.yml', isFolder: false }
];

// Split CI configs into file-based and folder-based
const fileBasedCIConfigs = [
    { name: 'Travis CI', path: '.travis.yml' },
    { name: 'GitLab', path: '.gitlab-ci.yml' },
    { name: 'AppVeyor', path: 'appveyor.yml' },
    { name: 'Azure Pipelines', path: 'azure-pipelines.yml' },
    { name: 'Bitbucket', path: 'bitbucket-pipelines.yml' },
    { name: 'Cirrus', path: '.cirrus.yml' },
    { name: 'Scrutinizer CI', path: '.scrutinizer.yml' },
    { name: 'Codeship', path: 'codeship-services.yml' },
    { name: 'Semaphore', path: '.semaphore/semaphore.yml' },
    { name: 'Wercker', path: 'wercker.yml' },
    { name: 'Bitrise', path: 'bitrise.yml' },
    { name: 'Bamboo', path: 'bamboo.yml' },
    { name: 'GoCD', path: '.gocd.yaml' },
    { name: 'Codemagic', path: 'codemagic.yaml' },
    { name: 'Jenkins', path: 'Jenkinsfile.yml' },
];
const folderBasedCIConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows' },
    { name: 'CircleCI', path: '.circleci' },
    { name: 'Semaphore CI', path: '.semaphore' },
    { name: 'Buildkite', path: '.buildkite' },
];

// Detect CI services in the repository
function checkForCIServices() {
    const foundCIServices = [];
    for (const [pattern, ciName] of Object.entries(ciFilePatterns)) {
        let selector;
        // Special handling for folder-based CIs
        if (pattern === '.github/workflows') {
            selector = 'a[href*=".github/workflows/"]'; // Any file inside .github/workflows
        } else if (pattern === '.semaphore/semaphore.yml') {
            selector = 'a[href*=".semaphore/"]'; // Any file inside .semaphore
        } else if (pattern === '.circleci/config.yml') {
            selector = 'a[href*=".circleci/"]'; // Any file inside .circleci
        } else if (pattern === '.buildkite/pipeline.yml') {
            selector = 'a[href*=".buildkite/"]'; // Any file inside .buildkite
        } else {
            selector = `a[href*="${pattern}"]`;
        }
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            foundCIServices.push(ciName);
        }
    }
    return [...new Set(foundCIServices)]; // Remove duplicates
}

// Helper: Parse owner, repo, and branch from GitHub URL
function parseGitHubRepoInfo() {
    const match = window.location.pathname.match(/^\/(.+?)\/(.+?)(?:\/(tree|blob)\/([^\/]+))?(?:\/|$)/);
    if (!match) return null;
    return {
        owner: match[1],
        repo: match[2],
        branch: match[4] || 'master',
    };
}

// Helper: Check if a folder exists by fetching its tree URL
async function folderExistsOnGitHub(folder) {
    const info = parseGitHubRepoInfo();
    if (!info) return false;
    const url = `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${folder}`;
    try {
        const response = await fetch(url, { method: 'GET' });
        return response.status !== 404;
    } catch {
        return false;
    }
}

// Helper: Check if a file or folder exists by fetching its tree/blob URL
async function pathExistsOnGitHub(path, isFolder = true) {
    const info = parseGitHubRepoInfo();
    if (!info || !path) return false;
    const url = isFolder
        ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${path}`
        : `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/${path}`;
    try {
        const response = await fetch(url, { method: 'GET' });
        return response.status !== 404;
    } catch {
        return false;
    }
}

// DOM check for file-based CIs
function detectFileBasedCIsInDOM() {
    const found = new Set();
    for (const { name, path } of fileBasedCIConfigs) {
        const selector = `a[href*="${path}"]`;
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            found.add(name);
        }
    }
    return Array.from(found);
}

// DOM check for folder-based CIs
function detectFolderBasedCIsInDOM() {
    const found = new Set();
    for (const { name, path } of folderBasedCIConfigs) {
        const selector = `a[href*="${path}/"]`;
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            found.add(name);
        }
    }
    return Array.from(found);
}

// DOM check for all CIs
function detectCIsInDOM() {
    const found = new Set();
    for (const { name, path, isFolder } of keyCIConfigs) {
        let selector = isFolder ? `a[href*="${path}/"]` : `a[href*="${path}"]`;
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            found.add(name);
        }
    }
    return Array.from(found);
}

// Network check for file-based CIs
async function detectFileBasedCIsViaNetwork(skip = []) {
    const found = [];
    const info = parseGitHubRepoInfo();
    if (!info) return found;
    for (const { name, path } of fileBasedCIConfigs) {
        if (skip.includes(name)) continue;
        const url = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/${path}`;
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.status !== 404) {
                found.push(name);
            }
        } catch {}
    }
    return found;
}

// Network check for folder-based CIs
async function detectFolderBasedCIsViaNetwork(skip = []) {
    const found = [];
    const info = parseGitHubRepoInfo();
    if (!info) return found;
    for (const { name, path } of folderBasedCIConfigs) {
        if (skip.includes(name)) continue;
        const url = `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${path}`;
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.status !== 404) {
                found.push(name);
            }
        } catch {}
    }
    return found;
}

// Network check for all CIs
async function detectCIsViaNetwork(skip = []) {
    const found = [];
    const info = parseGitHubRepoInfo();
    if (!info) return found;
    for (const { name, path, isFolder } of keyCIConfigs) {
        if (skip.includes(name)) continue;
        const url = isFolder
            ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${path}`
            : `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/${path}`;
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.status !== 404) {
                found.push(name);
            }
        } catch {}
    }
    return found;
}

// Add a simple loading spinner SVG
function getLoadingSpinner() {
    const spinner = document.createElement('span');
    spinner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 50 50" style="vertical-align:middle;">
            <defs>
                <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#00c3ff"/>
                    <stop offset="100%" stop-color="rgb(240, 240, 213)"/>
                </linearGradient>
            </defs>
            <circle cx="25" cy="25" r="20" fill="none" stroke="url(#spinner-gradient)" stroke-width="5" stroke-linecap="round" stroke-dasharray="31.415, 31.415" transform="rotate(0 25 25)">
                <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
            </circle>
        </svg>
    `;
    spinner.style.marginLeft = '10px';
    spinner.title = 'Detecting more CI services...';
    return spinner;
}

// Show banner immediately, then update as CIs are found
let banner = null;
function showOrUpdateBanner(services, loading = false) {
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cipilot-banner';
        banner.style.position = 'fixed';
        banner.style.top = '0';
        banner.style.left = '0';
        banner.style.width = '100%';
        banner.style.background = '#24292f';
        banner.style.color = '#fff';
        banner.style.zIndex = '9999';
        banner.style.padding = '10px 0';
        banner.style.textAlign = 'center';
        banner.style.fontSize = '14px';
        banner.style.fontFamily = 'sans-serif';
        document.body.prepend(banner);
    }
    banner.textContent = '';
    if(services.length > 0) {
        // Label
        const label = document.createElement('span');
        label.textContent = 'Detected CI services:';
        label.style.color = '#FFD700';
        label.style.fontWeight = 'bold';
        label.style.fontSize = '16px';
        label.style.marginRight = '10px';
        label.style.background = 'linear-gradient(90deg, #00c3ff 0%,rgb(240, 240, 213) 100%)';
        label.style.webkitBackgroundClip = 'text';
        label.style.webkitTextFillColor = 'transparent';
        label.style.backgroundClip = 'text';
        label.style.textFillColor = 'transparent';
        // List with links
        const list = document.createElement('span');
        list.style.fontSize = '14px';
        const info = parseGitHubRepoInfo();
        const ciLinks = {
            'GitHub Actions': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.github/workflows` : '#',
            'Travis CI': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.travis.yml` : '#',
            'CircleCI': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.circleci` : '#',
            'AppVeyor': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/appveyor.yml` : '#',
            'Azure Pipelines': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/azure-pipelines.yml` : '#',
            'Cirrus': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.cirrus.yml` : '#',
            'Semaphore CI': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.semaphore` : '#',
            'Buildkite': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.buildkite` : '#',
            'GitLab': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gitlab-ci.yml` : '#',
            'Bitbucket': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitbucket-pipelines.yml` : '#',
            'Scrutinizer CI': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.scrutinizer.yml` : '#',
            'Codeship': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codeship-services.yml` : '#',
            'Wercker': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/wercker.yml` : '#',
            'Bitrise': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitrise.yml` : '#',
            'Bamboo': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bamboo.yml` : '#',
            'GoCD': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gocd.yaml` : '#',
            'Codemagic': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codemagic.yaml` : '#',
            'Jenkins': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/Jenkinsfile.yml` : '#',
        };
        services.forEach((service, idx) => {
            const link = document.createElement('a');
            link.textContent = service;
            link.href = ciLinks[service] || '#';
            link.target = '_blank';
            link.style.color = '#4FC3F7';
            link.style.textDecoration = 'underline';
            link.style.marginRight = '8px';
            list.appendChild(link);
            if (idx < services.length - 1) {
                list.appendChild(document.createTextNode(', '));
            }
        });
        banner.appendChild(label);
        banner.appendChild(list);
        if (loading) {
            banner.appendChild(getLoadingSpinner());
        }
    }
}

// Async detection: show banner first, then update as CIs are found one by one
async function checkForCIServicesAsync() {
    showOrUpdateBanner([], true); // Show banner immediately with spinner
    const domDetected = [];
    for (const { name, path, isFolder } of keyCIConfigs) {
        let selector = isFolder ? `a[href*="${path}/"]` : `a[href*="${path}"]`;
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            domDetected.push(name);
            showOrUpdateBanner([...domDetected], true);
        }
    }
    const networkDetected = [];
    const info = parseGitHubRepoInfo();
    if (info) {
        for (const { name, path, isFolder } of keyCIConfigs) {
            if (domDetected.includes(name)) continue;
            const url = isFolder
                ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${path}`
                : `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/${path}`;
            try {
                const response = await fetch(url, { method: 'GET' });
                if (response.status !== 404) {
                    networkDetected.push(name);
                    showOrUpdateBanner([...domDetected, ...networkDetected], true);
                }
            } catch {}
        }
    }
    showOrUpdateBanner([...domDetected, ...networkDetected], false); // Remove spinner when done
    return [...domDetected, ...networkDetected];
}

// Check for 404 image (invalid repo)
function isInvalidRepo() {
    const imgs = document.querySelectorAll('img[alt^="404"]');
    return imgs.length > 0;
}

// Show detected CI services on the webpage itself (async version)
async function displayCIServicesOnPageAsync() {
    if (isInvalidRepo()) return; // Do not show banner if repo is invalid
    const services = await checkForCIServicesAsync();
    // Remove old banner if present
    const oldBanner = document.getElementById('cipilot-banner');
    if (oldBanner) oldBanner.remove();
    // Create banner
    const banner = document.createElement('div');
    banner.id = 'cipilot-banner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.width = '100%';
    banner.style.background = '#24292f';
    banner.style.color = '#fff';
    banner.style.zIndex = '9999';
    banner.style.padding = '10px 0';
    banner.style.textAlign = 'center';
    banner.style.fontSize = '14px';
    banner.style.fontFamily = 'sans-serif';
    if (services.length === 0) {
        // If no CI services detected, show a prompt with Yes/No buttons
        banner.textContent = '';
        const msg = document.createElement('span');
        msg.textContent = 'No CI/CD is detected in this repository. Would you like to adopt one? ';
        msg.style.color = '#FFD700'; // Gold color for emphasis
        msg.style.fontSize = '16px';
        msg.style.fontWeight = 'bold';
        
        banner.appendChild(msg);
        const yesBtn = document.createElement('button');
        yesBtn.textContent = 'Yes';
        yesBtn.style.margin = '0 8px';
        yesBtn.style.padding = '2px 5px';
        yesBtn.style.fontSize = '14px';
        yesBtn.style.cursor = 'pointer';
        yesBtn.onclick = () => {
            fetch('http://localhost:5000/run-script', { method: 'POST' })
                .then(res => res.json())
                .then(data => alert(data.message))
                .catch(err => alert('Failed to reach local server'));
        };

        const noBtn = document.createElement('button');
        noBtn.textContent = 'No';
        noBtn.style.margin = '0 8px';
        noBtn.style.padding = '2px 8px';
        noBtn.style.fontSize = '14px';
        noBtn.style.cursor = 'pointer';
        noBtn.onclick = () => {
            banner.remove();
        };

        banner.appendChild(yesBtn);
        banner.appendChild(noBtn);
    } else {
        // Create a span for the label with special color and bigger font
        const label = document.createElement('span');
        label.textContent = 'Detected CI services:';
        label.style.color = '#FFD700'; // Gold color for emphasis
        label.style.fontWeight = 'bold';
        label.style.fontSize = '17px';
        label.style.marginRight = '10px';
        label.style.background = 'linear-gradient(90deg, #00c3ff 0%, rgb(240, 240, 213) 100%)';
        label.style.webkitBackgroundClip = 'text';
        label.style.webkitTextFillColor = 'transparent';
        label.style.backgroundClip = 'text';
        label.style.textFillColor = 'transparent';

        // Create a span for the list
        const list = document.createElement('span');
        list.style.fontSize = '14px';

        // Map CI service names to their folder or file URLs
        const info = parseGitHubRepoInfo();
        const ciLinks = {
            'GitHub Actions': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.github/workflows` : '#',
            'CircleCI': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.circleci` : '#',
            'Travis CI': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.travis.yml` : '#',
            'AppVeyor': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/appveyor.yml` : '#',
            'Azure Pipelines': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/azure-pipelines.yml` : '#',
            'Cirrus': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.cirrus.yml` : '#',
            'Semaphore CI': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.semaphore` : '#',
            'Buildkite': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.buildkite` : '#',
            'GitLab': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gitlab-ci.yml` : '#',
            'Bitbucket': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitbucket-pipelines.yml` : '#',
            'Scrutinizer CI': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.scrutinizer.yml` : '#',
            'Codeship': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codeship-services.yml` : '#',
            'Semaphore': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.semaphore/semaphore.yml` : '#',
            'Wercker': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/wercker.yml` : '#',
            'Bitrise': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitrise.yml` : '#',
            'Bamboo': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bamboo.yml` : '#',
            'GoCD': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gocd.yaml` : '#',
            'Codemagic': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codemagic.yaml` : '#',
            'Buildkite': info ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.buildkite` : '#',
            'Jenkins': info ? `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/Jenkinsfile.yml` : '#',
        };

        services.forEach((service, idx) => {
            const link = document.createElement('a');
            link.textContent = service;
            link.href = ciLinks[service] || '#';
            link.target = '_blank';
            link.style.color = '#4FC3F7';
            link.style.textDecoration = 'underline';
            link.style.marginRight = '8px';
            list.appendChild(link);
            if (idx < services.length - 1) {
                list.appendChild(document.createTextNode('|  '));
            }
        });

        banner.textContent = '';
        banner.appendChild(label);
        banner.appendChild(list);
    }
    document.body.prepend(banner);
}

// On page load, run async detection
window.addEventListener('DOMContentLoaded', displayCIServicesOnPageAsync);
// Run detection immediately in case DOMContentLoaded already fired
(async () => { await displayCIServicesOnPageAsync(); })();
// Listen for GitHub PJAX navigation events (dynamic page loads)
document.addEventListener('pjax:end', displayCIServicesOnPageAsync);

// Listen for messages from the popup to provide detected CI services (async)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getCiServices') {
        checkForCIServicesAsync().then(services => sendResponse({ services }));
        return true; // Keep the message channel open for async response
    }
});