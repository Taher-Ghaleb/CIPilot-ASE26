// CI detection logic for CIPilot Extension (async, DOM+network, incremental updates)
const keyCIConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows', isFolder: true },
    { name: 'Travis CI', path: '.travis.yml', isFolder: false },
    { name: 'GitLab', path: '.gitlab-ci.yml', isFolder: false },
    { name: 'CircleCI', path: 'circleci.yml', isFolder: false },
    { name: 'CircleCI', path: '.circleci', isFolder: true },
    { name: 'AppVeyor', path: '.appveyor.yml', isFolder: false },
    { name: 'AppVeyor', path: 'appveyor.yml', isFolder: false },
    { name: 'Semaphore', path: 'semaphore.yml', isFolder: false },
    { name: 'Semaphore', path: '.semaphore', isFolder: true },
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
    { name: 'Jenkins', path: 'Jenkinsfile', isFolder: false }
];

function getCIServiceLinks() {
    const info = window.parseGitHubRepoInfo ? window.parseGitHubRepoInfo() : null;
    const links = {};
    if (!info) return links;
    links['GitHub Actions'] = `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.github/workflows`;
    links['CircleCI'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/circleci.yml`;
    links['CircleCI'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.circleci`;
    links['Travis CI'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.travis.yml`;
    links['AppVeyor'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.appveyor.yml`;
    links['AppVeyor'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/appveyor.yml`;
    links['Azure Pipelines'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/azure-pipelines.yml`;
    links['Cirrus'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.cirrus.yml`;
    links['Semaphore'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.semaphore/semaphore.yml`;
    links['Semaphore'] = `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.semaphore`;
    links['Buildkite'] = `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/.buildkite`;
    links['GitLab'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gitlab-ci.yml`;
    links['Bitbucket'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitbucket-pipelines.yml`;
    links['Scrutinizer CI'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.scrutinizer.yml`;
    links['Codeship'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codeship-services.yml`;
    links['Wercker'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/wercker.yml`;
    links['Bitrise'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bitrise.yml`;
    links['Bamboo'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/bamboo.yml`;
    links['GoCD'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/.gocd.yaml`;
    links['Codemagic'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/codemagic.yaml`;
    links['Jenkins'] = `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/Jenkinsfile`;
    return links;
}

async function checkForCIServicesAsync() {
    //showOrUpdateBanner([], true); // Show banner immediately with spinner
    const domDetected = [];
    const links = getCIServiceLinks();
    let semaphoreFound = null;
    let circleciFound = null;
    let appveyorFound = null;
    for (const { name, path, isFolder } of keyCIConfigs) {
        if (isFolder) {
            // Check if the folder exists in the DOM first
            const folderSelector = `a.js-navigation-open[title='${path.replace(/\//g, '')}'], a[title='${path}']`;
            const folderElements = document.querySelectorAll(folderSelector);
            if (folderElements.length === 0) continue; // Skip if folder not found
        }
        let selector = isFolder ? `a[href*="${path}/"]` : `a[href*="${path}"]`;
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            if (name.startsWith('CircleCI')) {
                if (name === 'CircleCI') {
                    circleciFound = { text: 'CircleCI', url: links['CircleCI'] };
                } else if (name === 'CircleCI' && !circleciFound) {
                    circleciFound = { text: 'CircleCI', url: links['CircleCI'] };
                }
            }
            else if (name.startsWith('Semaphore')) {
                if (isFolder) {
                    semaphoreFound = { text: 'Semaphore', url: links['Semaphore'] };
                } else if (!semaphoreFound) {
                    semaphoreFound = { text: 'Semaphore', url: links['Semaphore'] };
                }
            } else if (name.startsWith('AppVeyor')) {
                if (name === 'AppVeyor') {
                    appveyorFound = { text: 'AppVeyor', url: links['AppVeyor'] };
                } else if (name === 'AppVeyor' && !appveyorFound) {
                    appveyorFound = { text: 'AppVeyor', url: links['AppVeyor'] };
                }
            } else {
                domDetected.push({ text: name, url: links[name] || '#' });
            }
            showOrUpdateBanner([
                ...domDetected,
                ...(semaphoreFound ? [semaphoreFound] : []),
                ...(circleciFound ? [circleciFound] : []),
                ...(appveyorFound ? [appveyorFound] : [])
            ], true);
        }
    }
    const networkDetected = [];
    const info = window.parseGitHubRepoInfo ? window.parseGitHubRepoInfo() : null;
    let semaphoreNetworkFound = null;
    let circleciNetworkFound = null;
    let appveyorNetworkFound = null;
    if (info) {
        for (const { name, path, isFolder } of keyCIConfigs) {
            if (name.startsWith('CircleCI') && circleciFound) continue;
            if (name.startsWith('Semaphore') && semaphoreFound) continue;
            if (name.startsWith('AppVeyor') && appveyorFound) continue;
            if (domDetected.map(x => x.text).includes(name)) continue;
            const url = isFolder
                ? `https://github.com/${info.owner}/${info.repo}/tree/${info.branch}/${path}`
                : `https://github.com/${info.owner}/${info.repo}/blob/${info.branch}/${path}`;
            try {
                const response = await fetch(url, { method: 'GET' });
                if (response.status !== 404) {
                    if (name.startsWith('CircleCI')) {
                        if (name === 'CircleCI') {
                            circleciNetworkFound = { text: 'CircleCI', url: links['CircleCI'] };
                        } else if (name === 'CircleCI' && !circleciNetworkFound) {
                            circleciNetworkFound = { text: 'CircleCI', url: links['CircleCI'] };
                        }
                    }
                    else if (name.startsWith('Semaphore')) {
                        if (isFolder) {
                            semaphoreNetworkFound = { text: 'Semaphore', url: links['Semaphore'] };
                        } else if (!semaphoreNetworkFound) {
                            semaphoreNetworkFound = { text: 'Semaphore', url: links['Semaphore'] };
                        }
                    } else if (name.startsWith('AppVeyor')) {
                        if (name === 'AppVeyor') {
                            appveyorNetworkFound = { text: 'AppVeyor', url: links['AppVeyor'] };
                        } else if (name === 'AppVeyor' && !appveyorNetworkFound) {
                            appveyorNetworkFound = { text: 'AppVeyor', url: links['AppVeyor'] };
                        }
                    } else {
                        networkDetected.push({ text: name, url: links[name] || '#' });
                    }
                    showOrUpdateBanner([
                        ...domDetected,
                        ...(semaphoreFound ? [semaphoreFound] : []),
                        ...(circleciFound ? [circleciFound] : []),
                        ...(appveyorFound ? [appveyorFound] : []),
                        ...networkDetected,
                        ...(semaphoreNetworkFound ? [semaphoreNetworkFound] : []),
                        ...(circleciNetworkFound ? [circleciNetworkFound] : []),
                        ...(appveyorNetworkFound ? [appveyorNetworkFound] : [])
                    ], true);
                }
            } catch { /* ignore all fetch errors silently */ }
        }
    }
    const allDetected = [
        ...domDetected,
        ...(semaphoreFound ? [semaphoreFound] : []),
        ...(circleciFound ? [circleciFound] : []),
        ...(appveyorFound ? [appveyorFound] : []),
        ...networkDetected,
        ...(semaphoreNetworkFound ? [semaphoreNetworkFound] : []),
        ...(circleciNetworkFound ? [circleciNetworkFound] : []),
        ...(appveyorNetworkFound ? [appveyorNetworkFound] : [])
    ];
    // Deduplicate Semaphore, CircleCI, AppVeyor if both DOM and network found
    const seen = new Set();
    const deduped = allDetected.filter(ci => {
        if (['Semaphore', 'CircleCI', 'AppVeyor'].includes(ci.text)) {
            if (seen.has(ci.text)) return false;
            seen.add(ci.text);
            return true;
        }
        if (seen.has(ci.text)) return false;
        seen.add(ci.text);
        return true;
    });
    showOrUpdateBanner(deduped, false); // Remove spinner when done
    return deduped;
}
