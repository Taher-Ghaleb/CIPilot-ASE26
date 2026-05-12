// == Main entry point for CIPilot Extension ==
// All helpers are loaded via manifest order (utils.js, banner.js, ciDetection.js, then this file)

// Cache for detected CI services to avoid re-detection on every popup open
let cachedCIServices = null;

// Toast notification helper
function showToast(message, type = 'info', duration = 5000) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.maxWidth = '400px';
    toast.style.padding = '16px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '500';
    toast.style.lineHeight = '1.5';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    toast.style.zIndex = '10002';
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.whiteSpace = 'pre-wrap';
    
    // Set colors based on type
    if (type === 'error') {
        toast.style.background = '#ffebe9';
        toast.style.color = '#cf222e';
        toast.style.border = '1px solid #cf222e';
    } else if (type === 'success') {
        toast.style.background = '#dafbe1';
        toast.style.color = '#1a7f37';
        toast.style.border = '1px solid #1a7f37';
    } else if (type === 'warning') {
        toast.style.background = '#fff8c5';
        toast.style.color = '#7d4e00';
        toast.style.border = '1px solid #bf8700';
    } else {
        toast.style.background = '#ddf4ff';
        toast.style.color = '#0969da';
        toast.style.border = '1px solid #0969da';
    }
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, duration);
}

async function getLLMSettingsForRequest() {
    try {
        const stored = await chrome.storage.local.get(['llmSettings']);
        const s = stored.llmSettings || {};
        const provider = s.provider || 'ollama';
        const model = s.model || (provider === 'ollama' ? 'gemma3:12b' : provider === 'xai' ? 'grok-2-latest' : provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
        const baseUrl = (s.baseUrl || '').trim();

        let apiKey = '';
        if (provider === 'openai') apiKey = (s.openaiApiKey || '').trim();
        if (provider === 'xai') apiKey = (s.xaiApiKey || '').trim();
        if (provider === 'groq') apiKey = (s.groqApiKey || '').trim();

        return {
            provider,
            model,
            baseUrl: baseUrl || null,
            apiKey: apiKey || null
        };
    } catch (e) {
        // Fall back safely
        return {
            provider: 'ollama',
            model: 'gemma3:12b',
            baseUrl: null,
            apiKey: null
        };
    }
}

async function convertCICD(detectedServices, targetPlatform = 'github-actions') {
    try {
        // Get repository information
        const info = window.parseGitHubRepoInfo ? window.parseGitHubRepoInfo() : null;
        if (!info || !info.owner || !info.repo) {
            alert('Unable to get repository information');
            return;
        }

        // Show loading state with spinner
        const loadingMsg = document.createElement('div');
        loadingMsg.style.position = 'fixed';
        loadingMsg.style.top = '50%';
        loadingMsg.style.left = '50%';
        loadingMsg.style.transform = 'translate(-50%, -50%)';
        loadingMsg.style.padding = '20px 30px';
        loadingMsg.style.background = '#fff';
        loadingMsg.style.color = '#333';
        loadingMsg.style.border = '2px solid #007bff';
        loadingMsg.style.borderRadius = '8px';
        loadingMsg.style.zIndex = '10000';
        loadingMsg.style.fontSize = '16px';
        loadingMsg.style.fontWeight = 'bold';
        loadingMsg.style.display = 'flex';
        loadingMsg.style.alignItems = 'center';
        loadingMsg.style.gap = '12px';
        
        // Add spinner
        const spinner = document.createElement('div');
        spinner.style.width = '20px';
        spinner.style.height = '20px';
        spinner.style.border = '3px solid #f3f3f3';
        spinner.style.borderTop = '3px solid #007bff';
        spinner.style.borderRadius = '50%';
        spinner.style.animation = 'spin 1s linear infinite';
        
        // Add keyframes for spinner animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
        const textNode = document.createTextNode('Converting CI/CD configuration...');
        loadingMsg.appendChild(spinner);
        loadingMsg.appendChild(textNode);
        document.body.appendChild(loadingMsg);

        // Filter services to exclude the target platform
        const targetServiceName = targetPlatform === 'github-actions' ? 'GitHub Actions' : 'Travis CI';
        const sourceServices = detectedServices.filter(s => s.text !== targetServiceName);
        
        // If no source services found, use all detected services
        const servicesToConvert = sourceServices.length > 0 ? sourceServices : detectedServices;
        
        // Fetch existing CI/CD configurations
        const cicdConfigs = await fetchCICDConfigurations(info, servicesToConvert);
        
        console.log('Fetched CI/CD configs:', cicdConfigs);
        console.log('Services to convert:', servicesToConvert.map(s => s.text));
        
        // Check if we actually found any configuration content
        const hasActualConfigs = Object.keys(cicdConfigs).length > 0;
        if (!hasActualConfigs) {
            document.body.removeChild(loadingMsg);
            alert('No CI/CD configuration files were found in this repository. The services may be configured elsewhere or use external configurations.');
            return;
        }
        
        // Prepare conversion request data
        const conversionData = {
            repository: {
                owner: info.owner,
                name: info.repo,
                branch: info.branch || 'main'
            },
            detectedServices: servicesToConvert.map(service => service.text),
            existingConfigs: cicdConfigs,
            targetPlatform: targetPlatform,
            llmSettings: await getLLMSettingsForRequest()
        };

        // Send conversion request to API
        const apiBase = await getApiBaseUrl();
        const response = await fetch(`${apiBase}/convert-cicd`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(conversionData)
        });

        if (response.ok) {
            document.body.removeChild(loadingMsg);
            const result = await response.json();
            showConversionResult(result, cicdConfigs, info);
        } else {
            document.body.removeChild(loadingMsg);
            const errorData = await response.json().catch(() => ({}));
            
            console.log('Error response:', response.status, errorData);
            
            // Handle auth / invalid API key errors
            if (response.status === 401) {
                const detail = errorData.detail || {};
                const message = typeof detail === 'string' ? detail : (detail.message || 'Invalid API Key');
                
                showToast(`🔑 ${message}\n\nOpen CIPilot extension options to update your API key.`, 'error', 10000);
                return;
            }

            // Handle rate limit errors specially
            if (response.status === 429) {
                const detail = errorData.detail || {};
                const message = typeof detail === 'string' ? detail : (detail.message || 'Too many requests');
                const suggestion = detail.suggestion || 'Try switching to Ollama or OpenAI in extension options';
                
                const fullMessage = `⚠️ Rate Limit Exceeded\n\n${message}\n\n💡 Suggestion: ${suggestion}`;
                console.log('Showing rate limit toast:', fullMessage);
                
                showToast(fullMessage, 'error', 10000);
                return; // Don't throw, just return
            }
            
            const errorMessage = errorData.detail?.message || errorData.detail || errorData.message || `Server error: ${response.status}`;
            showToast(`Error: ${errorMessage}`, 'error', 6000);
            return; // Don't throw, just return
        }

    } catch (error) {
        console.error('Error during CI/CD conversion:', error);
        
        // Remove loading message if it exists
        const loadingMsg = document.querySelector('div[style*="transform: translate(-50%, -50%)"]');
        if (loadingMsg && loadingMsg.parentNode) {
            document.body.removeChild(loadingMsg);
        }
        
        // Show detailed error message
        let errorMsg;
        if (error.message.includes('Failed to fetch')) {
            errorMsg = `Could not connect to the CIPilot API server (${apiBase}). Check your backend URL in extension options.`;
        } else {
            errorMsg = `Unable to convert CI/CD configuration: ${error.message || 'Please try again later.'}`;
        }
        
        showToast(errorMsg, 'error', 6000);
    }
}

async function fetchCICDConfigurations(repoInfo, detectedServices) {
    const configs = {};
    
    console.log('Fetching configs for services:', detectedServices.map(s => s.text));
    
    for (const service of detectedServices) {
        try {
            let configUrl = '';
            let configPath = '';
            
            console.log(`Attempting to fetch config for: ${service.text}`);
            
            // Handle GitHub Actions specially since it can have multiple workflow files
            if (service.text === 'GitHub Actions') {
                try {
                    // First, get the list of files in .github/workflows directory
                    const workflowsUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/.github/workflows`;
                    const workflowsResponse = await fetch(workflowsUrl);
                    
                    if (workflowsResponse.ok) {
                        const workflowFiles = await workflowsResponse.json();
                        const ymlFiles = workflowFiles.filter(file => 
                            file.type === 'file' && 
                            (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))
                        );
                        
                        if (ymlFiles.length > 0) {
                            // Get content of ALL workflow files
                            const fileContents = [];
                            for (const file of ymlFiles) {
                                try {
                                    const fileResponse = await fetch(file.download_url);
                                    if (fileResponse.ok) {
                                        const content = await fileResponse.text();
                                        fileContents.push({
                                            path: file.path,
                                            content: content,
                                            fileName: file.name
                                        });
                                    }
                                } catch (error) {
                                    console.warn(`Could not fetch workflow file ${file.name}:`, error);
                                }
                            }
                            if (fileContents.length > 0) {
                                configs[service.text] = { files: fileContents };
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Could not fetch GitHub Actions workflows:`, error);
                }
                continue; // Skip the regular file fetching logic below
            }
            
            // Handle CircleCI specially since it can have multiple config files
            if (service.text === 'CircleCI') {
                try {
                    // Try to get all files in .circleci/ directory
                    const circleciUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/.circleci`;
                    const circleciResponse = await fetch(circleciUrl);
                    
                    if (circleciResponse.ok) {
                        const circleciFiles = await circleciResponse.json();
                        const ymlFiles = circleciFiles.filter(file => 
                            file.type === 'file' && 
                            (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))
                        );
                        
                        const fileContents = [];
                        for (const file of ymlFiles) {
                            try {
                                const fileResponse = await fetch(file.download_url);
                                if (fileResponse.ok) {
                                    const content = await fileResponse.text();
                                    fileContents.push({
                                        path: file.path,
                                        content: content,
                                        fileName: file.name
                                    });
                                }
                            } catch (error) {
                                console.warn(`Could not fetch CircleCI file ${file.name}:`, error);
                            }
                        }
                        if (fileContents.length > 0) {
                            configs[service.text] = { files: fileContents };
                        }
                    }
                } catch (error) {
                    console.warn(`Could not fetch CircleCI configs:`, error);
                }
                continue; // Skip the regular file fetching logic below
            }
            
            // Determine the configuration file path based on the service
            switch (service.text) {
                case 'Travis CI':
                    configPath = '.travis.yml';
                    break;
                case 'GitLab':
                    configPath = '.gitlab-ci.yml';
                    break;
                case 'AppVeyor':
                    // AppVeyor can be either appveyor.yml or .appveyor.yml
                    configPath = 'appveyor.yml';
                    break;
                case 'Azure Pipelines':
                    configPath = 'azure-pipelines.yml';
                    break;
                case 'Bitbucket':
                    configPath = 'bitbucket-pipelines.yml';
                    break;
                case 'Jenkins':
                    configPath = 'Jenkinsfile';
                    break;
                case 'Semaphore':
                    configPath = '.semaphore/semaphore.yml';
                    break;
                case 'Cirrus':
                case 'Cirrus CI':
                    configPath = '.cirrus.yml';
                    break;
                case 'Scrutinizer CI':
                    configPath = '.scrutinizer.yml';
                    break;
                case 'Codeship':
                    configPath = 'codeship-services.yml';
                    break;
                case 'Wercker':
                    configPath = 'wercker.yml';
                    break;
                case 'Bitrise':
                    configPath = 'bitrise.yml';
                    break;
                case 'Bamboo':
                    configPath = 'bamboo.yml';
                    break;
                case 'GoCD':
                    configPath = '.gocd.yaml';
                    break;
                case 'Codemagic':
                    configPath = 'codemagic.yaml';
                    break;
                case 'Buildkite':
                    configPath = '.buildkite/pipeline.yml';
                    break;
                default:
                    console.log(`Unknown CI service: ${service.text}`);
                    continue; // Skip unknown services
            }
            
            // Construct GitHub API URL to fetch raw file content
            configUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${configPath}`;
            
            console.log(`📡 Fetching ${service.text} from API:`, configUrl);
            
            const response = await fetch(configUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });
            
            if (response.ok) {
                const configContent = await response.text();
                configs[service.text] = {
                    files: [{
                        path: configPath,
                        content: configContent,
                        fileName: configPath.split('/').pop()
                    }]
                };
                console.log(`✅ Successfully fetched ${service.text}: ${configPath}`);
            } else {
                console.warn(`❌ Config file not found for ${service.text}: ${configPath} (Status: ${response.status})`);
                // Don't add to configs if file doesn't exist
            }
        } catch (error) {
            console.warn(`❌ Could not fetch config for ${service.text}:`, error);
            // Don't add placeholder configs - only add when we have actual content
        }
    }
    
    console.log('Final configs fetched:', Object.keys(configs));
    return configs;
}

function showConversionResult(result, cicdConfigs, repoInfo) {
    // Extract all source files from cicdConfigs
    const sourceFiles = [];
    for (const [serviceName, config] of Object.entries(cicdConfigs)) {
        if (config.files && Array.isArray(config.files)) {
            // New format with files array
            config.files.forEach(file => {
                sourceFiles.push({
                    serviceName,
                    fileName: file.fileName || file.path.split('/').pop(),
                    path: file.path,
                    content: file.content
                });
            });
        } else if (config.content) {
            // Legacy format with direct content field
            sourceFiles.push({
                serviceName,
                fileName: config.path ? config.path.split('/').pop() : serviceName.toLowerCase().replace(/\s+/g, '-') + '.yml',
                path: config.path || '',
                content: config.content
            });
        }
    }
    
    console.log('Source files extracted for display:', sourceFiles.map(f => `${f.serviceName}: ${f.fileName}`));
    
    // Create modal to show conversion result
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.zIndex = '10000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = '#ffffff';
    modalContent.style.padding = '0';
    modalContent.style.borderRadius = '12px';
    modalContent.style.width = '90%';
    modalContent.style.height = '85vh';
    modalContent.style.maxWidth = '1400px';
    modalContent.style.maxHeight = '90vh';
    modalContent.style.minWidth = '800px';
    modalContent.style.minHeight = '500px';
    modalContent.style.display = 'flex';
    modalContent.style.flexDirection = 'column';
    modalContent.style.overflow = 'hidden';
    modalContent.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.3)';
    modalContent.style.resize = 'both';
    modalContent.style.position = 'relative';

    // Header with source → target and buttons
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '16px 24px';
    header.style.borderBottom = '1px solid #e1e4e8';
    header.style.backgroundColor = '#f6f8fa';
    header.style.borderRadius = '12px 12px 0 0';

    // Get source service names
    const sourceServices = Object.keys(cicdConfigs).filter(s => s !== 'GitHub Actions');
    const sourceName = sourceServices.length > 1 
        ? `${sourceServices.length} CI Services` 
        : sourceServices[0] || 'CI/CD';
    const targetName = result.targetPlatform === 'github-actions' ? 'GitHub Actions' : 'Travis CI';

    const title = document.createElement('h3');
    title.innerHTML = `<span style="color: #0969da;">${sourceName}</span> <span style="color: #57606a;">→</span> <span style="color: #1a7f37;">${targetName}</span>`;
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';

    const description = document.createElement('p');
    const serviceCount = Object.keys(cicdConfigs).length;
    const fileCount = sourceFiles.length;
    if (sourceFiles.length > 1) {
        description.textContent = `Converting ${fileCount} configuration file${fileCount > 1 ? 's' : ''} into a unified GitHub Actions workflow`;
    } else {
        description.textContent = 'Review and edit the migrated configuration before creating a PR';
    }
    description.style.margin = '4px 0 0 0';
    description.style.fontSize = '13px';
    description.style.color = '#57606a';
    
    // File selector dropdown (only show if multiple files)
    let fileSelector = null;
    let fileSelectorContainer = null;
    if (sourceFiles.length > 1) {
        fileSelectorContainer = document.createElement('div');
        fileSelectorContainer.style.marginBottom = '12px';
        
        const fileSelectorLabel = document.createElement('label');
        fileSelectorLabel.textContent = 'Select file: ';
        fileSelectorLabel.style.marginRight = '8px';
        fileSelectorLabel.style.fontWeight = '600';
        fileSelectorLabel.style.color = '#24292f';
        
        fileSelector = document.createElement('select');
        fileSelector.style.padding = '4px 8px';
        fileSelector.style.borderRadius = '6px';
        fileSelector.style.border = '1px solid #d0d7de';
        fileSelector.style.fontSize = '13px';
        fileSelector.style.cursor = 'pointer';
        
        sourceFiles.forEach((file, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${file.serviceName}: ${file.fileName}`;
            fileSelector.appendChild(option);
        });
        
        fileSelectorContainer.appendChild(fileSelectorLabel);
        fileSelectorContainer.appendChild(fileSelector);
    }

    const statusRow = document.createElement('div');
    statusRow.style.display = 'flex';
    statusRow.style.alignItems = 'center';
    statusRow.style.gap = '8px';
    statusRow.style.margin = '10px 0 12px';

    function makeChip(label) {
        const chip = document.createElement('span');
        chip.textContent = label;
        chip.style.display = 'inline-flex';
        chip.style.alignItems = 'center';
        chip.style.padding = '4px 10px';
        chip.style.borderRadius = '999px';
        chip.style.fontSize = '12px';
        chip.style.border = '1px solid #d0d7de';
        chip.style.background = '#f6f8fa';
        chip.style.color = '#24292f';
        return chip;
    }

    const yamlChip = makeChip('YAML: unknown');
    const lintChip = makeChip('actionlint: unknown');
    const attemptsChip = makeChip(`generation attempts: ${result.attempts || 1}, manual retries: 0`);
    let manualRetries = 0; // Track manual retries separately

    function setChip(chip, ok, okText, failText) {
        chip.textContent = ok ? okText : failText;
        chip.style.borderColor = ok ? '#1a7f37' : '#cf222e';
        chip.style.background = ok ? '#dafbe1' : '#ffebe9';
        chip.style.color = ok ? '#1a7f37' : '#cf222e';
    }

    function applyValidation(v) {
        if (!v) return;
        setChip(yamlChip, !!v.yamlOk, 'YAML: pass', 'YAML: fail');
        
        // Check if actionlint output contains only INFO-level warnings
        const hasOnlyInfo = v.actionlintOutput && v.actionlintOutput.includes('[Note: Only INFO-level issues found');
        
        if (hasOnlyInfo) {
            // Show as warning (yellow) instead of fail (red)
            lintChip.textContent = 'actionlint: info';
            lintChip.style.borderColor = '#bf8700';
            lintChip.style.background = '#fff8c5';
            lintChip.style.color = '#7d4e00';
        } else {
            setChip(lintChip, !!v.actionlintOk, 'actionlint: pass', 'actionlint: fail');
        }
    }

    applyValidation(result.validation);

    statusRow.appendChild(yamlChip);
    statusRow.appendChild(lintChip);

    // Main content area with panes
    const contentArea = document.createElement('div');
    contentArea.style.flex = '1';
    contentArea.style.display = 'flex';
    contentArea.style.flexDirection = 'column';
    contentArea.style.overflow = 'hidden';
    contentArea.style.padding = '16px 24px';
    contentArea.style.gap = '12px';

    const panes = document.createElement('div');
    panes.style.display = 'flex';
    panes.style.gap = '16px';
    panes.style.flex = '1';
    panes.style.minHeight = '0';

    function buildPane(titleText, readOnly) {
        const pane = document.createElement('div');
        pane.style.flex = '1';
        pane.style.minWidth = '0';
        pane.style.display = 'flex';
        pane.style.flexDirection = 'column';
        pane.style.border = '1px solid #d0d7de';
        pane.style.borderRadius = '8px';
        pane.style.overflow = 'hidden';
        pane.style.backgroundColor = '#ffffff';

        const paneTitle = document.createElement('div');
        paneTitle.textContent = titleText;
        paneTitle.style.fontSize = '13px';
        paneTitle.style.fontWeight = '600';
        paneTitle.style.color = '#24292f';
        paneTitle.style.padding = '10px 14px';
        paneTitle.style.backgroundColor = '#f6f8fa';
        paneTitle.style.borderBottom = '1px solid #d0d7de';

        const editorContainer = document.createElement('div');
        editorContainer.style.display = 'flex';
        editorContainer.style.flex = '1';
        editorContainer.style.overflow = 'hidden';

        const lineNumbers = document.createElement('div');
        lineNumbers.className = 'line-numbers';
        lineNumbers.style.padding = '12px 12px 12px 8px';
        lineNumbers.style.backgroundColor = '#f6f8fa';
        lineNumbers.style.color = '#57606a';
        lineNumbers.style.fontSize = '13px';
        lineNumbers.style.lineHeight = '1.5';
        lineNumbers.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        lineNumbers.style.textAlign = 'right';
        lineNumbers.style.userSelect = 'none';
        lineNumbers.style.borderRight = '1px solid #d0d7de';
        lineNumbers.style.minWidth = '50px';
        lineNumbers.style.overflowY = 'hidden';
        lineNumbers.style.overflowX = 'hidden';
        lineNumbers.style.whiteSpace = 'pre';
        lineNumbers.style.flexShrink = '0';

        const ta = document.createElement('textarea');
        ta.style.flex = '1';
        ta.style.resize = 'none';
        ta.style.backgroundColor = '#ffffff';
        ta.style.color = '#24292f';
        ta.style.padding = '12px';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.fontSize = '13px';
        ta.style.lineHeight = '1.5';
        ta.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ta.style.overflowY = 'auto';
        ta.style.overflowX = 'auto';
        ta.style.whiteSpace = 'pre';
        ta.style.tabSize = '2';
        ta.style.minWidth = '0';
        ta.readOnly = readOnly;
        
        if (readOnly) {
            ta.style.cursor = 'default';
            ta.style.backgroundColor = '#f6f8fa';
        }

        // Sync line numbers with content
        function updateLineNumbers() {
            const lines = (ta.value || '').split('\n');
            lineNumbers.textContent = lines.map((_, i) => i + 1).join('\n');
        }

        // Sync scrolling between textarea and line numbers
        ta.addEventListener('scroll', () => {
            lineNumbers.scrollTop = ta.scrollTop;
        });

        ta.addEventListener('input', updateLineNumbers);
        
        editorContainer.appendChild(lineNumbers);
        editorContainer.appendChild(ta);
        pane.appendChild(paneTitle);
        pane.appendChild(editorContainer);
        return { pane, textarea: ta, lineNumbers, updateLineNumbers };
    }

    const originalPane = buildPane('Original CI/CD Config', true);
    const migratedPane = buildPane('Migrated GitHub Actions Workflow', false);
    
    // Store original source configs for retry
    let allSourceConfigs = '';
    for (const [serviceName, config] of Object.entries(cicdConfigs)) {
        if (config.files && Array.isArray(config.files)) {
            config.files.forEach(file => {
                allSourceConfigs += `# Source: ${serviceName} - ${file.fileName}\n`;
                allSourceConfigs += file.content + '\n\n';
            });
        } else if (config.content) {
            allSourceConfigs += `# Source: ${serviceName}\n`;
            allSourceConfigs += config.content + '\n\n';
        }
    }
    
    // Function to update panes when file selection changes
    let currentFileIndex = 0;
    function updatePanesForFile(index) {
        currentFileIndex = index;
        const selectedFile = sourceFiles[index];
        
        // Set content first
        originalPane.textarea.value = selectedFile.content || '';
        migratedPane.textarea.value = result.convertedConfig || '';
        
        // Then update line numbers
        originalPane.updateLineNumbers();
        migratedPane.updateLineNumbers();
        
        // Update original pane title to show which file is being displayed
        originalPane.pane.querySelector('div').textContent = 
            `Original: ${selectedFile.serviceName} - ${selectedFile.fileName}`;
    }
    
    // Initialize with first file
    updatePanesForFile(0);
    
    // Add change handler for file selector
    if (fileSelector) {
        fileSelector.addEventListener('change', (e) => {
            updatePanesForFile(parseInt(e.target.value));
        });
    }

    panes.appendChild(originalPane.pane);
    panes.appendChild(migratedPane.pane);

    const lintDetails = document.createElement('details');
    lintDetails.style.marginTop = '10px';
    const lintSummary = document.createElement('summary');
    lintSummary.textContent = 'Validation details';
    lintSummary.style.cursor = 'pointer';
    lintSummary.style.color = '#24292f';
    lintDetails.appendChild(lintSummary);

    const attemptsInfo = document.createElement('div');
    attemptsInfo.style.marginBottom = '8px';
    attemptsInfo.style.fontSize = '12px';
    attemptsInfo.style.color = '#57606a';
    attemptsInfo.appendChild(attemptsChip);
    lintDetails.appendChild(attemptsInfo);

    const lintPre = document.createElement('pre');
    lintPre.style.whiteSpace = 'pre-wrap';
    lintPre.style.background = '#0b1220';
    lintPre.style.color = '#e6edf3';
    lintPre.style.borderRadius = '8px';
    lintPre.style.padding = '10px';
    lintPre.style.border = '1px solid #d0d7de';
    lintPre.style.maxHeight = '180px';
    lintPre.style.overflow = 'auto';
    lintPre.textContent = (result.validation && result.validation.actionlintOutput) ? result.validation.actionlintOutput : '';
    lintDetails.appendChild(lintPre);

    const copyErrorsBtn = document.createElement('button');
    copyErrorsBtn.textContent = '📋 Copy Errors';
    copyErrorsBtn.style.marginTop = '8px';
    copyErrorsBtn.style.padding = '4px 10px';
    copyErrorsBtn.style.fontSize = '12px';
    copyErrorsBtn.style.backgroundColor = '#0969da';
    copyErrorsBtn.style.color = 'white';
    copyErrorsBtn.style.border = 'none';
    copyErrorsBtn.style.borderRadius = '4px';
    copyErrorsBtn.style.cursor = 'pointer';
    copyErrorsBtn.onclick = () => {
        const errorsText = lintPre.textContent || 'No errors';
        navigator.clipboard.writeText(errorsText).then(() => {
            copyErrorsBtn.textContent = '✓ Copied!';
            setTimeout(() => copyErrorsBtn.textContent = '📋 Copy Errors', 2000);
        });
    };
    lintDetails.appendChild(copyErrorsBtn);

    // Button container in header
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.alignItems = 'center';

    // Professional button styling helper
    function styleButton(btn, bgColor, hoverColor) {
        btn.style.padding = '8px 16px';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '500';
        btn.style.color = '#ffffff';
        btn.style.backgroundColor = bgColor;
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all 0.2s ease';
        btn.style.whiteSpace = 'nowrap';
        
        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) {
                btn.style.backgroundColor = hoverColor;
                btn.style.transform = 'translateY(-1px)';
                btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            }
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.backgroundColor = bgColor;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = 'none';
        });
        
        // Disabled state
        const originalDisabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
        Object.defineProperty(btn, 'disabled', {
            get: () => originalDisabled.get.call(btn),
            set: (value) => {
                originalDisabled.set.call(btn, value);
                btn.style.opacity = value ? '0.5' : '1';
                btn.style.cursor = value ? 'not-allowed' : 'pointer';
            }
        });
    }

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    styleButton(retryBtn, '#f59e0b', '#d97706');
    retryBtn.onclick = async () => {
        // First, validate the current YAML to get fresh validation errors
        retryBtn.disabled = true;
        const prevRetryText = retryBtn.textContent;
        retryBtn.textContent = 'Checking...';
        
        try {
            const valApiBase = await getApiBaseUrl();
            const validationResp = await fetch(`${valApiBase}/validate-github-actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: migratedPane.textarea.value || '' })
            });
            
            if (validationResp.ok) {
                const freshValidation = await validationResp.json();
                // Update result.validation with current YAML's validation state
                result.validation = freshValidation;
                // Also update the UI chips immediately
                applyValidation(freshValidation);
                lintPre.textContent = freshValidation.actionlintOutput || '';
            }
        } catch (e) {
            console.warn('Pre-retry validation failed:', e);
        } finally {
            retryBtn.disabled = false;
            retryBtn.textContent = prevRetryText;
        }
        
        const retryPromptDiv = document.createElement('div');
        retryPromptDiv.style.position = 'fixed';
        retryPromptDiv.style.top = '0';
        retryPromptDiv.style.left = '0';
        retryPromptDiv.style.width = '100%';
        retryPromptDiv.style.height = '100%';
        retryPromptDiv.style.backgroundColor = 'rgba(0,0,0,0.6)';
        retryPromptDiv.style.display = 'flex';
        retryPromptDiv.style.alignItems = 'center';
        retryPromptDiv.style.justifyContent = 'center';
        retryPromptDiv.style.zIndex = '10001';

        const promptBox = document.createElement('div');
        promptBox.style.backgroundColor = 'white';
        promptBox.style.padding = '24px';
        promptBox.style.borderRadius = '8px';
        promptBox.style.width = '500px';
        promptBox.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

        const promptTitle = document.createElement('h4');
        promptTitle.textContent = 'Retry Conversion';
        promptTitle.style.marginTop = '0';
        promptTitle.style.marginBottom = '12px';
        promptTitle.style.color = '#24292f';

        const promptDesc = document.createElement('p');
        promptDesc.textContent = 'Optionally provide feedback about manual changes you made or improvements needed:';
        promptDesc.style.marginBottom = '12px';
        promptDesc.style.color = '#57606a';
        promptDesc.style.fontSize = '14px';

        const feedbackInput = document.createElement('textarea');
        feedbackInput.placeholder = 'Example: I changed the build step to use Maven instead of Gradle. Please consider this in the retry.';
        
        // Pre-fill with validation errors if available (now using fresh validation results)
        if (result.validation) {
            const errorParts = [];
            const hasYamlError = !result.validation.yamlOk;
            const hasLintError = !result.validation.actionlintOk;
            
            let errorType = '';
            if (hasYamlError && hasLintError) {
                errorType = 'yaml schema validation and linting errors of the GitHub Action Workflow, so it can pass the validation check';
            } else if (hasYamlError) {
                errorType = 'yaml schema validation errors of the GitHub Action Workflow, so it can pass the validation check';
            } else if (hasLintError) {
                errorType = 'linting errors of the GitHub Action Workflow, so it can pass the linting validation check';
            }
            
            if (errorType) {
                errorParts.push(`Please fix below ${errorType}.\n`);
            }
            
            if (hasYamlError) {
                errorParts.push(`YAML Syntax Error:\n${result.validation.yamlError}`);
            }
            if (hasLintError && result.validation.actionlintOutput) {
                errorParts.push(`Linting Errors:\n${result.validation.actionlintOutput}`);
            }
            
            if (errorParts.length > 0) {
                feedbackInput.value = errorParts.join('\n\n');
            }
        }
        
        feedbackInput.style.width = '100%';
        feedbackInput.style.height = '120px';
        feedbackInput.style.padding = '10px';
        feedbackInput.style.border = '1px solid #d0d7de';
        feedbackInput.style.borderRadius = '6px';
        feedbackInput.style.fontSize = '14px';
        feedbackInput.style.fontFamily = 'inherit';
        feedbackInput.style.resize = 'vertical';
        feedbackInput.style.marginBottom = '16px';

        const promptBtnContainer = document.createElement('div');
        promptBtnContainer.style.display = 'flex';
        promptBtnContainer.style.justifyContent = 'flex-end';
        promptBtnContainer.style.gap = '10px';

        const cancelPromptBtn = document.createElement('button');
        cancelPromptBtn.textContent = 'Cancel';
        cancelPromptBtn.style.padding = '8px 16px';
        cancelPromptBtn.style.backgroundColor = '#6c757d';
        cancelPromptBtn.style.color = 'white';
        cancelPromptBtn.style.border = 'none';
        cancelPromptBtn.style.borderRadius = '4px';
        cancelPromptBtn.style.cursor = 'pointer';
        cancelPromptBtn.onclick = () => document.body.removeChild(retryPromptDiv);

        const submitRetryBtn = document.createElement('button');
        submitRetryBtn.textContent = 'Submit Retry';
        submitRetryBtn.style.padding = '8px 16px';
        submitRetryBtn.style.backgroundColor = '#fb8500';
        submitRetryBtn.style.color = 'white';
        submitRetryBtn.style.border = 'none';
        submitRetryBtn.style.borderRadius = '4px';
        submitRetryBtn.style.cursor = 'pointer';
        submitRetryBtn.onclick = async () => {
            submitRetryBtn.disabled = true;
            submitRetryBtn.textContent = 'Retrying...';
            
            // Add progress indicator in the prompt
            const progressDiv = document.createElement('div');
            progressDiv.style.marginTop = '12px';
            progressDiv.style.padding = '8px';
            progressDiv.style.background = '#f6f8fa';
            progressDiv.style.borderRadius = '4px';
            progressDiv.style.fontSize = '13px';
            progressDiv.style.color = '#57606a';
            progressDiv.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Processing retry with LLM...';
            promptBox.insertBefore(progressDiv, promptBtnContainer);
            
            try {
                const userFeedback = feedbackInput.value.trim();
                const currentYAML = migratedPane.textarea.value || '';
                
                // Prepare comprehensive feedback for LLM
                let combinedFeedback = 'ERRORS TO FIX:\n\n';
                if (result.validation) {
                    const parts = [];
                    if (!result.validation.yamlOk) {
                        parts.push(`❌ YAML SYNTAX ERROR:\n${result.validation.yamlError}`);
                    }
                    if (!result.validation.actionlintOk && result.validation.actionlintOutput) {
                        parts.push(`❌ ACTIONLINT ERRORS:\n${result.validation.actionlintOutput}`);
                    }
                    combinedFeedback += parts.join('\n\n');
                }
                if (userFeedback) {
                    combinedFeedback += `\n\n📝 USER INSTRUCTIONS:\n${userFeedback}`;
                }
                combinedFeedback += `\n\nYou MUST fix ALL errors above. Output ONLY valid GitHub Actions YAML.`;

                const llmSettings = await getLLMSettingsForRequest();
                const retryApiBase = await getApiBaseUrl();
                const retryResp = await fetch(`${retryApiBase}/retry-conversion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        originalTravisConfig: allSourceConfigs,
                        previousGitHubActionsAttempt: currentYAML,
                        targetPlatform: result.targetPlatform,
                        feedback: combinedFeedback,
                        llmSettings
                    })
                });
                
                if (!retryResp.ok) {
                    throw new Error(`Retry request failed: ${retryResp.status} ${retryResp.statusText}`);
                }
                
                const retryData = await retryResp.json();
                console.log('Retry response:', retryData);
                
                if (!retryData.convertedConfig) {
                    throw new Error('No converted config returned from retry');
                }
                
                document.body.removeChild(retryPromptDiv);
                
                // Check if YAML actually changed
                const yamlChanged = retryData.convertedConfig.trim() !== currentYAML.trim();
                console.log('YAML changed:', yamlChanged);
                if (!yamlChanged) {
                    console.warn('LLM returned the same YAML without changes');
                }
                
                // Update the UI with new result
                migratedPane.textarea.value = retryData.convertedConfig || '';
                if (retryData.validation) {
                    applyValidation(retryData.validation);
                    lintPre.textContent = retryData.validation.actionlintOutput || '';
                    // Open validation details to show updated results
                    lintDetails.open = true;
                }
                manualRetries++;
                attemptsChip.textContent = `generation attempts: ${result.attempts || 1}, manual retries: ${manualRetries}`;
                result.convertedConfig = retryData.convertedConfig;
                result.validation = retryData.validation;
                
                // Show in-UI success/failure message instead of alert
                const resultMessage = document.createElement('div');
                resultMessage.style.position = 'fixed';
                resultMessage.style.top = '20px';
                resultMessage.style.right = '20px';
                resultMessage.style.padding = '12px 20px';
                resultMessage.style.borderRadius = '6px';
                resultMessage.style.fontSize = '14px';
                resultMessage.style.fontWeight = '500';
                resultMessage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                resultMessage.style.zIndex = '10002';
                resultMessage.style.transition = 'opacity 0.3s';
                
                if (retryData.validation) {
                    const allPassed = retryData.validation.yamlOk && retryData.validation.actionlintOk;
                    if (allPassed) {
                        resultMessage.style.background = '#dafbe1';
                        resultMessage.style.color = '#1a7f37';
                        resultMessage.style.border = '1px solid #1a7f37';
                        resultMessage.textContent = '✅ Retry successful! All validation passed.';
                    } else if (!yamlChanged) {
                        resultMessage.style.background = '#ffebe9';
                        resultMessage.style.color = '#cf222e';
                        resultMessage.style.border = '1px solid #cf222e';
                        resultMessage.textContent = '❌ LLM returned same YAML without changes. Try manual editing or different prompt.';
                    } else {
                        resultMessage.style.background = '#fff8c5';
                        resultMessage.style.color = '#7d4e00';
                        resultMessage.style.border = '1px solid #bf8700';
                        resultMessage.textContent = '⚠️ Retry completed but validation still has errors. Check details below.';
                    }
                } else {
                    resultMessage.style.background = '#dafbe1';
                    resultMessage.style.color = '#1a7f37';
                    resultMessage.style.border = '1px solid #1a7f37';
                    resultMessage.textContent = '✅ Retry completed successfully.';
                }
                
                document.body.appendChild(resultMessage);
                
                // Auto-hide after 4 seconds
                setTimeout(() => {
                    resultMessage.style.opacity = '0';
                    setTimeout(() => document.body.removeChild(resultMessage), 300);
                }, 4000);
                
            } catch (e) {
                console.warn('Retry failed:', e);
                
                // Show error message in UI instead of alert
                const errorMessage = document.createElement('div');
                errorMessage.style.position = 'fixed';
                errorMessage.style.top = '20px';
                errorMessage.style.right = '20px';
                errorMessage.style.padding = '12px 20px';
                errorMessage.style.borderRadius = '6px';
                errorMessage.style.fontSize = '14px';
                errorMessage.style.fontWeight = '500';
                errorMessage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                errorMessage.style.zIndex = '10002';
                errorMessage.style.background = '#ffebe9';
                errorMessage.style.color = '#cf222e';
                errorMessage.style.border = '1px solid #cf222e';
                errorMessage.textContent = '❌ Retry failed. Please try again.';
                document.body.appendChild(errorMessage);
                
                setTimeout(() => {
                    errorMessage.style.opacity = '0';
                    setTimeout(() => document.body.removeChild(errorMessage), 300);
                }, 4000);
            } finally {
                submitRetryBtn.disabled = false;
                submitRetryBtn.textContent = 'Submit Retry';
            }
        };

        promptBtnContainer.appendChild(cancelPromptBtn);
        promptBtnContainer.appendChild(submitRetryBtn);

        promptBox.appendChild(promptTitle);
        promptBox.appendChild(promptDesc);
        promptBox.appendChild(feedbackInput);
        promptBox.appendChild(promptBtnContainer);

        retryPromptDiv.appendChild(promptBox);
        document.body.appendChild(retryPromptDiv);
    };

    const validateBtn = document.createElement('button');
    validateBtn.textContent = 'Validate';
    styleButton(validateBtn, '#0969da', '#0550ae');
    validateBtn.onclick = async () => {
        validateBtn.disabled = true;
        const prevText = validateBtn.textContent;
        validateBtn.textContent = 'Validating...';
        try {
            const validateApiBase = await getApiBaseUrl();
            const resp = await fetch(`${validateApiBase}/validate-github-actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: migratedPane.textarea.value || '' })
            });
            
            if (!resp.ok) {
                throw new Error(`Validation request failed: ${resp.status}`);
            }
            
            const data = await resp.json();
            
            // Update the validation state
            result.validation = data;
            
            // Update UI chips with new validation results
            applyValidation(data);
            
            // Update lint output display
            lintPre.textContent = data.actionlintOutput || '';
            
            // Open validation details to show results
            lintDetails.open = true;
        } catch (e) {
            console.warn('Validation failed:', e);
            
            // Show error notification
            const errorToast = document.createElement('div');
            errorToast.style.position = 'fixed';
            errorToast.style.top = '20px';
            errorToast.style.right = '20px';
            errorToast.style.padding = '12px 20px';
            errorToast.style.borderRadius = '6px';
            errorToast.style.fontSize = '14px';
            errorToast.style.fontWeight = '500';
            errorToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            errorToast.style.zIndex = '10002';
            errorToast.style.background = '#ffebe9';
            errorToast.style.color = '#cf222e';
            errorToast.style.border = '1px solid #cf222e';
            errorToast.textContent = '❌ Validation failed. Check console for details.';
            errorToast.style.transition = 'opacity 0.3s';
            document.body.appendChild(errorToast);
            
            setTimeout(() => {
                errorToast.style.opacity = '0';
                setTimeout(() => document.body.removeChild(errorToast), 300);
            }, 4000);
        } finally {
            validateBtn.disabled = false;
            validateBtn.textContent = prevText;
        }
    };

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    styleButton(copyBtn, '#1a7f37', '#116329');
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(migratedPane.textarea.value || '').then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy Migrated', 2000);
        });
    };

    const prBtn = document.createElement('button');
    prBtn.textContent = 'Create PR';
    styleButton(prBtn, '#8250df', '#6e40c9');
    prBtn.onclick = async () => {
        // Get current repo info from URL
        const currentRepoInfo = window.parseGitHubRepoInfo ? window.parseGitHubRepoInfo() : repoInfo;
        
        if (!currentRepoInfo || !currentRepoInfo.owner || !currentRepoInfo.repo) {
            // Show error toast
            const errorToast = document.createElement('div');
            errorToast.style.position = 'fixed';
            errorToast.style.top = '20px';
            errorToast.style.right = '20px';
            errorToast.style.padding = '12px 20px';
            errorToast.style.borderRadius = '6px';
            errorToast.style.fontSize = '14px';
            errorToast.style.fontWeight = '500';
            errorToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            errorToast.style.zIndex = '10002';
            errorToast.style.background = '#ffebe9';
            errorToast.style.color = '#cf222e';
            errorToast.style.border = '1px solid #cf222e';
            errorToast.textContent = '❌ Unable to determine repository info for PR creation.';
            errorToast.style.transition = 'opacity 0.3s';
            document.body.appendChild(errorToast);
            
            setTimeout(() => {
                errorToast.style.opacity = '0';
                setTimeout(() => document.body.removeChild(errorToast), 300);
            }, 5000);
            return;
        }

        // Show PR customization dialog
        const prPromptDiv = document.createElement('div');
        prPromptDiv.style.position = 'fixed';
        prPromptDiv.style.top = '0';
        prPromptDiv.style.left = '0';
        prPromptDiv.style.width = '100%';
        prPromptDiv.style.height = '100%';
        prPromptDiv.style.backgroundColor = 'rgba(0,0,0,0.6)';
        prPromptDiv.style.display = 'flex';
        prPromptDiv.style.alignItems = 'center';
        prPromptDiv.style.justifyContent = 'center';
        prPromptDiv.style.zIndex = '10001';

        const promptBox = document.createElement('div');
        promptBox.style.backgroundColor = 'white';
        promptBox.style.padding = '24px';
        promptBox.style.borderRadius = '8px';
        promptBox.style.width = '600px';
        promptBox.style.maxHeight = '80vh';
        promptBox.style.overflow = 'auto';
        promptBox.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

        const promptTitle = document.createElement('h4');
        promptTitle.textContent = 'Create Pull Request';
        promptTitle.style.marginTop = '0';
        promptTitle.style.marginBottom = '16px';
        promptTitle.style.color = '#24292f';

        // Commit message input
        const commitLabel = document.createElement('label');
        commitLabel.textContent = 'Commit Message:';
        commitLabel.style.display = 'block';
        commitLabel.style.marginBottom = '6px';
        commitLabel.style.color = '#24292f';
        commitLabel.style.fontSize = '14px';
        commitLabel.style.fontWeight = '600';

        const commitInput = document.createElement('input');
        commitInput.type = 'text';
        commitInput.value = 'Add migrated GitHub Actions workflow (CI/CD Assistant)';
        commitInput.style.width = '100%';
        commitInput.style.padding = '8px';
        commitInput.style.border = '1px solid #d0d7de';
        commitInput.style.borderRadius = '6px';
        commitInput.style.fontSize = '14px';
        commitInput.style.marginBottom = '16px';
        commitInput.style.fontFamily = 'inherit';

        // PR title input
        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Pull Request Title:';
        titleLabel.style.display = 'block';
        titleLabel.style.marginBottom = '6px';
        titleLabel.style.color = '#24292f';
        titleLabel.style.fontSize = '14px';
        titleLabel.style.fontWeight = '600';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = 'Migrate CI/CD to GitHub Actions';
        titleInput.style.width = '100%';
        titleInput.style.padding = '8px';
        titleInput.style.border = '1px solid #d0d7de';
        titleInput.style.borderRadius = '6px';
        titleInput.style.fontSize = '14px';
        titleInput.style.marginBottom = '16px';
        titleInput.style.fontFamily = 'inherit';

        // PR body textarea
        const bodyLabel = document.createElement('label');
        bodyLabel.textContent = 'Pull Request Description:';
        bodyLabel.style.display = 'block';
        bodyLabel.style.marginBottom = '6px';
        bodyLabel.style.color = '#24292f';
        bodyLabel.style.fontSize = '14px';
        bodyLabel.style.fontWeight = '600';

        const bodyInput = document.createElement('textarea');
        bodyInput.value = 'Created by CI/CD Assistant Chrome extension.\n\nThis PR migrates the CI/CD configuration to GitHub Actions.';
        bodyInput.style.width = '100%';
        bodyInput.style.height = '100px';
        bodyInput.style.padding = '8px';
        bodyInput.style.border = '1px solid #d0d7de';
        bodyInput.style.borderRadius = '6px';
        bodyInput.style.fontSize = '14px';
        bodyInput.style.marginBottom = '16px';
        bodyInput.style.fontFamily = 'inherit';
        bodyInput.style.resize = 'vertical';

        const promptBtnContainer = document.createElement('div');
        promptBtnContainer.style.display = 'flex';
        promptBtnContainer.style.justifyContent = 'flex-end';
        promptBtnContainer.style.gap = '10px';

        const cancelPrBtn = document.createElement('button');
        cancelPrBtn.textContent = 'Cancel';
        cancelPrBtn.style.padding = '8px 16px';
        cancelPrBtn.style.backgroundColor = '#6c757d';
        cancelPrBtn.style.color = 'white';
        cancelPrBtn.style.border = 'none';
        cancelPrBtn.style.borderRadius = '4px';
        cancelPrBtn.style.cursor = 'pointer';
        cancelPrBtn.onclick = () => document.body.removeChild(prPromptDiv);

        const submitPrBtn = document.createElement('button');
        submitPrBtn.textContent = 'Create Pull Request';
        submitPrBtn.style.padding = '8px 16px';
        submitPrBtn.style.backgroundColor = '#8250df';
        submitPrBtn.style.color = 'white';
        submitPrBtn.style.border = 'none';
        submitPrBtn.style.borderRadius = '4px';
        submitPrBtn.style.cursor = 'pointer';
        
        submitPrBtn.onclick = async () => {
            console.log('🎯 Create PR button clicked');
            submitPrBtn.disabled = true;
            submitPrBtn.textContent = 'Creating...';
            
            try {
                console.log('📦 Current repo info:', currentRepoInfo);
                const workflowPath = '.github/workflows/ci-cd-assistant.yml';
                const workflowYaml = migratedPane.textarea.value || '';
                console.log('📝 Workflow YAML length:', workflowYaml.length);
                
                const messageData = {
                    action: 'createPullRequest',
                    repository: {
                        owner: currentRepoInfo.owner,
                        name: currentRepoInfo.repo
                    },
                    workflowPath,
                    workflowYaml: workflowYaml,
                    commitMessage: commitInput.value.trim() || 'Add migrated GitHub Actions workflow',
                    title: titleInput.value.trim() || 'Migrate CI/CD to GitHub Actions',
                    body: bodyInput.value.trim() || 'Created by CI/CD Assistant Chrome extension.',
                };
                
                console.log('📤 Sending message to background:', messageData);
                const resp = await chrome.runtime.sendMessage(messageData);
                console.log('📥 Response from background:', resp);
                
                document.body.removeChild(prPromptDiv);
                
                if (resp && resp.ok) {
                    const prUrl = resp.prUrl;
                    prBtn.textContent = 'PR Created ✓';
                    prBtn.disabled = true;
                    
                    // Show success toast
                    const successToast = document.createElement('div');
                    successToast.style.position = 'fixed';
                    successToast.style.top = '20px';
                    successToast.style.right = '20px';
                    successToast.style.padding = '12px 20px';
                    successToast.style.borderRadius = '6px';
                    successToast.style.fontSize = '14px';
                    successToast.style.fontWeight = '500';
                    successToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    successToast.style.zIndex = '10002';
                    successToast.style.background = '#dafbe1';
                    successToast.style.color = '#1a7f37';
                    successToast.style.border = '1px solid #1a7f37';
                    successToast.style.transition = 'opacity 0.3s';
                    
                    if (resp.usedFork) {
                        successToast.textContent = `✅ PR created successfully! (Forked repo and created branch: ${resp.branchName})`;
                    } else {
                        successToast.textContent = '✅ PR created successfully! Opening in new tab...';
                    }
                    
                    document.body.appendChild(successToast);
                    
                    setTimeout(() => {
                        successToast.style.opacity = '0';
                        setTimeout(() => document.body.removeChild(successToast), 300);
                    }, 5000);
                    
                    if (prUrl) {
                        window.open(prUrl, '_blank');
                    }
                } else {
                    console.error('❌ PR creation failed:', resp);
                    let msg = (resp && resp.error) ? resp.error : 'Failed to create PR.';
                    if (msg === 'Not Found') {
                        msg = 'GitHub API returned Not Found. This usually means your token lacks permission to create workflow files. Ensure your token has Contents: read/write and Workflow permissions (classic: `workflow` scope; fine-grained: Actions/Workflows write) and is authorized for the fork repo.';
                    }
                    
                    // Show error toast
                    const errorToast = document.createElement('div');
                    errorToast.style.position = 'fixed';
                    errorToast.style.top = '20px';
                    errorToast.style.right = '20px';
                    errorToast.style.padding = '12px 20px';
                    errorToast.style.borderRadius = '6px';
                    errorToast.style.fontSize = '14px';
                    errorToast.style.fontWeight = '500';
                    errorToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    errorToast.style.zIndex = '10002';
                    errorToast.style.background = '#ffebe9';
                    errorToast.style.color = '#cf222e';
                    errorToast.style.border = '1px solid #cf222e';
                    errorToast.style.transition = 'opacity 0.3s';
                    errorToast.textContent = `❌ ${msg}`;
                    
                    document.body.appendChild(errorToast);
                    
                    setTimeout(() => {
                        errorToast.style.opacity = '0';
                        setTimeout(() => document.body.removeChild(errorToast), 300);
                    }, 6000);
                }
            } catch (e) {
                console.error('❌ Create PR exception:', e);
                
                document.body.removeChild(prPromptDiv);
                
                // Show error toast
                const errorToast = document.createElement('div');
                errorToast.style.position = 'fixed';
                errorToast.style.top = '20px';
                errorToast.style.right = '20px';
                errorToast.style.padding = '12px 20px';
                errorToast.style.borderRadius = '6px';
                errorToast.style.fontSize = '14px';
                errorToast.style.fontWeight = '500';
                errorToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                errorToast.style.zIndex = '10002';
                errorToast.style.background = '#ffebe9';
                errorToast.style.color = '#cf222e';
                errorToast.style.border = '1px solid #cf222e';
                errorToast.style.transition = 'opacity 0.3s';
                errorToast.textContent = '❌ Create PR failed. Open Settings and ensure a GitHub token is configured.';
                
                document.body.appendChild(errorToast);
                
                setTimeout(() => {
                    errorToast.style.opacity = '0';
                    setTimeout(() => document.body.removeChild(errorToast), 300);
                }, 6000);
            } finally {
                submitPrBtn.disabled = false;
                submitPrBtn.textContent = 'Create Pull Request';
            }
        };

        promptBtnContainer.appendChild(cancelPrBtn);
        promptBtnContainer.appendChild(submitPrBtn);

        promptBox.appendChild(promptTitle);
        promptBox.appendChild(commitLabel);
        promptBox.appendChild(commitInput);
        promptBox.appendChild(titleLabel);
        promptBox.appendChild(titleInput);
        promptBox.appendChild(bodyLabel);
        promptBox.appendChild(bodyInput);
        promptBox.appendChild(promptBtnContainer);

        prPromptDiv.appendChild(promptBox);
        document.body.appendChild(prPromptDiv);
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    styleButton(closeBtn, '#6e7781', '#57606a');
    closeBtn.onclick = () => document.body.removeChild(modal);

    buttonContainer.appendChild(retryBtn);
    buttonContainer.appendChild(validateBtn);
    buttonContainer.appendChild(copyBtn);
    buttonContainer.appendChild(prBtn);
    buttonContainer.appendChild(closeBtn);

    // Assemble header
    const titleContainer = document.createElement('div');
    titleContainer.appendChild(title);
    titleContainer.appendChild(description);
    header.appendChild(titleContainer);
    header.appendChild(buttonContainer);

    // File selector (if multiple files)
    if (fileSelectorContainer) {
        fileSelectorContainer.style.marginBottom = '12px';
        contentArea.appendChild(fileSelectorContainer);
    }

    // Status chips
    statusRow.style.marginBottom = '12px';
    contentArea.appendChild(statusRow);

    // Add panes
    contentArea.appendChild(panes);

    // Validation details (collapsed by default)
    lintDetails.style.marginTop = '12px';
    lintDetails.style.padding = '12px';
    lintDetails.style.backgroundColor = '#f6f8fa';
    lintDetails.style.borderRadius = '6px';
    lintDetails.style.border = '1px solid #d0d7de';
    contentArea.appendChild(lintDetails);

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(contentArea);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
}

async function displayCIServicesOnPageAsync() {
    // Only run on valid GitHub repo pages
    const info = window.parseGitHubRepoInfo ? window.parseGitHubRepoInfo() : null;
    if (!info || !info.owner || !info.repo) return;
    if (typeof isInvalidRepo === 'function' && isInvalidRepo()) return;
    const services = await checkForCIServicesAsync();
    
    // Cache the detected services for popup
    cachedCIServices = services;
    
    // Reuse or create the banner
    let banner = document.getElementById('cipilot-banner');
    let isNewBanner = false;
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cipilot-banner';
        banner.style.position = 'relative';
        banner.style.width = '100%';
        banner.style.background = 'linear-gradient(135deg, #f6f8fa 0%, #e1e4e8 100%)';
        banner.style.color = '#24292f';
        banner.style.zIndex = '9999';
        banner.style.padding = '20px 24px';
        banner.style.textAlign = 'center';
        banner.style.fontSize = '14px';
        banner.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        banner.style.borderBottom = '2px solid #d0d7de';
        isNewBanner = true;
    } else {
        // Clear previous content if reusing
        while (banner.firstChild) {
            banner.removeChild(banner.firstChild);
        }
    }
    if(services.length > 0) {
        // Main container
        const mainContainer = document.createElement('div');
        mainContainer.style.maxWidth = '1200px';
        mainContainer.style.margin = '0 auto';
        
        // Services section
        const servicesSection = document.createElement('div');
        servicesSection.style.marginBottom = '16px';
        
        // Heading
        const heading = document.createElement('h2');
        heading.textContent = 'Detected CI Services';
        heading.style.fontSize = '20px';
        heading.style.fontWeight = '700';
        heading.style.color = '#0969da';
        heading.style.margin = '0 0 8px 0';
        heading.style.letterSpacing = '-0.3px';
        
        // Description
        const description = document.createElement('p');
        const serviceCount = services.length;
        if (serviceCount === 1) {
            description.textContent = `Found ${services[0].text} in this repository`;
        } else {
            description.textContent = `${serviceCount} CI/CD services detected in this repository`;
        }
        description.style.fontSize = '13px';
        description.style.color = '#57606a';
        description.style.margin = '0 0 12px 0';
        
        // Service chips container
        const chipsContainer = document.createElement('div');
        chipsContainer.style.display = 'flex';
        chipsContainer.style.flexWrap = 'wrap';
        chipsContainer.style.gap = '8px';
        chipsContainer.style.justifyContent = 'center';
        chipsContainer.style.alignItems = 'center';
        
        services.forEach((service, idx) => {
            const serviceChip = document.createElement('a');
            serviceChip.href = service.url;
            serviceChip.target = '_blank';
            serviceChip.style.display = 'inline-flex';
            serviceChip.style.alignItems = 'center';
            serviceChip.style.gap = '6px';
            serviceChip.style.padding = '6px 14px';
            serviceChip.style.background = 'linear-gradient(135deg, #0969da 0%, #0550ae 100%)';
            serviceChip.style.color = '#ffffff';
            serviceChip.style.textDecoration = 'none';
            serviceChip.style.borderRadius = '16px';
            serviceChip.style.fontSize = '12px';
            serviceChip.style.fontWeight = '600';
            serviceChip.style.border = 'none';
            serviceChip.style.transition = 'all 0.2s ease';
            serviceChip.style.boxShadow = '0 2px 4px rgba(9, 105, 218, 0.3)';
            
            // Add check icon
            const icon = document.createElement('span');
            icon.textContent = '✓';
            icon.style.fontSize = '11px';
            
            // Add text
            const text = document.createElement('span');
            text.textContent = service.text;
            
            serviceChip.appendChild(icon);
            serviceChip.appendChild(text);
            
            serviceChip.addEventListener('mouseenter', () => {
                serviceChip.style.transform = 'translateY(-2px)';
                serviceChip.style.boxShadow = '0 4px 12px rgba(9, 105, 218, 0.4)';
            });
            serviceChip.addEventListener('mouseleave', () => {
                serviceChip.style.transform = 'translateY(0)';
                serviceChip.style.boxShadow = '0 2px 4px rgba(9, 105, 218, 0.3)';
            });
            
            chipsContainer.appendChild(serviceChip);
        });
        
        servicesSection.appendChild(heading);
        servicesSection.appendChild(description);
        servicesSection.appendChild(chipsContainer);
        mainContainer.appendChild(servicesSection);

        // Show conversion prompt ONLY if non-GitHub-Actions CI is detected
        const hasGitHubActions = services.some(service => service.text === 'GitHub Actions');
        const hasOtherCI = services.some(service => service.text !== 'GitHub Actions');
        
        // Conversion logic:
        // - If ANY non-GitHub-Actions CI is detected → show "Migrate to GitHub Actions" button
        // - If ONLY GitHub Actions is detected → DO NOT show migration button (already using GitHub Actions)
        
        if (hasOtherCI) {
            const migrationCard = document.createElement('div');
            migrationCard.style.marginTop = '16px';
            migrationCard.style.padding = '14px 18px';
            migrationCard.style.background = '#ffffff';
            migrationCard.style.border = '1px solid #d0d7de';
            migrationCard.style.borderRadius = '8px';
            migrationCard.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
            migrationCard.style.display = 'flex';
            migrationCard.style.alignItems = 'center';
            migrationCard.style.justifyContent = 'space-between';
            migrationCard.style.gap = '14px';
            migrationCard.style.flexWrap = 'wrap';
            
            // Left section with icon and text
            const leftSection = document.createElement('div');
            leftSection.style.display = 'flex';
            leftSection.style.alignItems = 'center';
            leftSection.style.gap = '10px';
            
            const iconDiv = document.createElement('div');
            iconDiv.textContent = '🚀';
            iconDiv.style.fontSize = '20px';
            iconDiv.style.flexShrink = '0';
            
            const textSection = document.createElement('div');
            
            const titleText = document.createElement('div');
            titleText.textContent = 'Migrate to GitHub Actions';
            titleText.style.fontSize = '13px';
            titleText.style.fontWeight = '600';
            titleText.style.color = '#24292f';
            
            textSection.appendChild(titleText);
            leftSection.appendChild(iconDiv);
            leftSection.appendChild(textSection);
            
            // Right section with controls
            const rightSection = document.createElement('div');
            rightSection.style.display = 'flex';
            rightSection.style.alignItems = 'center';
            rightSection.style.gap = '8px';
            
            // Get non-GitHub-Actions services
            const nonGHAServices = services.filter(s => s.text !== 'GitHub Actions');
            
            // Add service selector if multiple services detected
            let serviceSelector = null;
            if (nonGHAServices.length > 1) {
                serviceSelector = document.createElement('select');
                serviceSelector.style.padding = '6px 10px';
                serviceSelector.style.fontSize = '12px';
                serviceSelector.style.borderRadius = '6px';
                serviceSelector.style.border = '1px solid #d0d7de';
                serviceSelector.style.backgroundColor = '#ffffff';
                serviceSelector.style.cursor = 'pointer';
                serviceSelector.style.fontWeight = '500';
                serviceSelector.style.color = '#24292f';
                serviceSelector.style.outline = 'none';
                serviceSelector.style.transition = 'border-color 0.2s ease';
                
                serviceSelector.addEventListener('focus', () => {
                    serviceSelector.style.borderColor = '#0969da';
                });
                serviceSelector.addEventListener('blur', () => {
                    serviceSelector.style.borderColor = '#d0d7de';
                });
                
                // Add "All Services" option
                const allOption = document.createElement('option');
                allOption.value = 'all';
                allOption.textContent = `All ${nonGHAServices.length} services`;
                serviceSelector.appendChild(allOption);
                
                // Add individual service options
                nonGHAServices.forEach(service => {
                    const option = document.createElement('option');
                    option.value = service.text;
                    option.textContent = service.text;
                    serviceSelector.appendChild(option);
                });
                
                rightSection.appendChild(serviceSelector);
            }
            
            // Migrate button
            const migrateBtn = document.createElement('button');
            migrateBtn.textContent = '→ Migrate';
            migrateBtn.style.backgroundColor = '#1a7f37';
            migrateBtn.style.padding = '6px 14px';
            migrateBtn.style.fontSize = '12px';
            migrateBtn.style.fontWeight = '600';
            migrateBtn.style.cursor = 'pointer';
            migrateBtn.style.color = '#ffffff';
            migrateBtn.style.border = 'none';
            migrateBtn.style.borderRadius = '6px';
            migrateBtn.style.transition = 'background-color 0.2s ease';
            migrateBtn.style.whiteSpace = 'nowrap';
            
            migrateBtn.addEventListener('mouseenter', () => {
                migrateBtn.style.backgroundColor = '#116329';
            });
            migrateBtn.addEventListener('mouseleave', () => {
                migrateBtn.style.backgroundColor = '#1a7f37';
            });
            migrateBtn.onclick = () => {
                let servicesToMigrate = services;
                if (serviceSelector && serviceSelector.value !== 'all') {
                    servicesToMigrate = services.filter(s => s.text === serviceSelector.value);
                }
                convertCICD(servicesToMigrate, 'github-actions');
            };
            
            const dismissBtn = document.createElement('button');
            dismissBtn.textContent = 'Dismiss';
            dismissBtn.style.padding = '6px 14px';
            dismissBtn.style.fontSize = '12px';
            dismissBtn.style.fontWeight = '500';
            dismissBtn.style.cursor = 'pointer';
            dismissBtn.style.backgroundColor = 'transparent';
            dismissBtn.style.color = '#57606a';
            dismissBtn.style.border = '1px solid #d0d7de';
            dismissBtn.style.borderRadius = '6px';
            dismissBtn.style.transition = 'all 0.2s ease';
            dismissBtn.style.whiteSpace = 'nowrap';
            
            dismissBtn.addEventListener('mouseenter', () => {
                dismissBtn.style.backgroundColor = '#f6f8fa';
            });
            dismissBtn.addEventListener('mouseleave', () => {
                dismissBtn.style.backgroundColor = 'transparent';
            });
            dismissBtn.onclick = () => migrationCard.remove();
            
            rightSection.appendChild(migrateBtn);
            rightSection.appendChild(dismissBtn);
            
            migrationCard.appendChild(leftSection);
            migrationCard.appendChild(rightSection);
            mainContainer.appendChild(migrationCard);
        }
        
        banner.appendChild(mainContainer);
        
        // Insert banner into DOM only after content is ready (if it's a new banner)
        if (isNewBanner) {
            const header = document.querySelector('header');
            if (header && header.parentNode) {
                header.parentNode.insertBefore(banner, header.nextSibling);
            } else {
                document.body.prepend(banner);
            }
        }
    }
}

// On page load, run async detection
window.addEventListener('DOMContentLoaded', displayCIServicesOnPageAsync);
// Run detection immediately in case DOMContentLoaded already fired
(async () => { await displayCIServicesOnPageAsync(); })();
// Listen for GitHub PJAX navigation events (dynamic page loads)
document.addEventListener('pjax:end', displayCIServicesOnPageAsync);

// Listen for messages from the popup to provide detected CI services (async)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getCiServices') {
            // Always respond instantly with whatever is cached.
            // If detection hasn't finished yet, return empty array —
            // the banner on the page will update once detection completes.
            sendResponse({ services: cachedCIServices || [] });
        }
    });
}
