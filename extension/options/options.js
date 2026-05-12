const DEFAULT_SETTINGS = {
  provider: 'ollama',
  model: 'gemma3:12b', // Legacy field for backward compatibility
  ollamaModel: 'gemma3:12b',
  openaiModel: 'gpt-4o-mini',
  xaiModel: 'grok-2-latest',
  groqModel: 'llama-3.3-70b-versatile',
  baseUrl: '',
  openaiApiKey: '',
  xaiApiKey: '',
  groqApiKey: '',
  githubToken: '',
  backendUrl: 'prod',
};

function byId(id) {
  return document.getElementById(id);
}

function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  if (!settings.provider) settings.provider = DEFAULT_SETTINGS.provider;
  
  // Ensure per-provider models exist
  if (!settings.ollamaModel) settings.ollamaModel = DEFAULT_SETTINGS.ollamaModel;
  if (!settings.openaiModel) settings.openaiModel = DEFAULT_SETTINGS.openaiModel;
  if (!settings.xaiModel) settings.xaiModel = DEFAULT_SETTINGS.xaiModel;
  if (!settings.groqModel) settings.groqModel = DEFAULT_SETTINGS.groqModel;
  
  // Legacy model field for backward compatibility
  if (!settings.model) {
    settings.model = settings.provider === 'ollama' ? settings.ollamaModel
      : settings.provider === 'xai' ? settings.xaiModel
      : settings.provider === 'groq' ? settings.groqModel
      : settings.openaiModel;
  }
  return settings;
}

function providerDefaultModel(provider) {
  switch (provider) {
    case 'ollama': return 'gemma3:12b';
    case 'xai': return 'grok-2-latest';
    case 'groq': return 'llama-3.3-70b-versatile';
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

function refreshProviderFields(provider) {
  const openaiKeyRow = byId('openaiKeyRow');
  const xaiKeyRow = byId('xaiKeyRow');
  const groqKeyRow = byId('groqKeyRow');

  openaiKeyRow.classList.toggle('hidden', provider !== 'openai');
  xaiKeyRow.classList.toggle('hidden', provider !== 'xai');
  groqKeyRow.classList.toggle('hidden', provider !== 'groq');
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['llmSettings']);
  const settings = normalizeSettings(stored.llmSettings);

  byId('provider').value = settings.provider;
  
  // Load the model for the current provider
  const currentModel = settings.provider === 'ollama' ? settings.ollamaModel
    : settings.provider === 'xai' ? settings.xaiModel
    : settings.provider === 'groq' ? settings.groqModel
    : settings.openaiModel;
  byId('model').value = currentModel;
  
  byId('baseUrl').value = settings.baseUrl || '';
  byId('openaiApiKey').value = settings.openaiApiKey || '';
  byId('xaiApiKey').value = settings.xaiApiKey || '';
  byId('groqApiKey').value = settings.groqApiKey || '';
  const githubTokenEl = byId('githubToken');
  if (githubTokenEl) githubTokenEl.value = settings.githubToken || '';

  const backendUrlEl = byId('backendUrl');
  if (backendUrlEl) backendUrlEl.value = settings.backendUrl || 'prod';

  refreshProviderFields(settings.provider);
  
  // Show status for configured credentials
  updateCredentialStatus();
}

function updateCredentialStatus() {
  chrome.storage.local.get(['llmSettings'], (result) => {
    const settings = normalizeSettings(result.llmSettings);
    
    // Update LLM status - show which providers have credentials configured
    const llmStatusEl = byId('llmStatus');
    const configuredProviders = [];
    
    // Check each provider's credentials
    if (settings.openaiApiKey) configuredProviders.push('OpenAI');
    if (settings.xaiApiKey) configuredProviders.push('xAI');
    if (settings.groqApiKey) configuredProviders.push('Groq');
    // Ollama is always available (local)
    configuredProviders.push('Ollama');
    
    if (llmStatusEl) {
      if (configuredProviders.length > 0) {
        llmStatusEl.textContent = '✓ Configured: ' + configuredProviders.join(', ');
        llmStatusEl.style.color = 'var(--success)';
      } else {
        llmStatusEl.textContent = '';
        llmStatusEl.style.color = '';
      }
    }
    
    // Update GitHub status
    const githubStatusEl = byId('githubStatus');
    if (githubStatusEl) {
      githubStatusEl.textContent = settings.githubToken ? '✓ Configured' : '';
      githubStatusEl.style.color = settings.githubToken ? 'var(--success)' : '';
    }
  });
}

async function saveLlmSettings() {
  const stored = await chrome.storage.local.get(['llmSettings']);
  const currentSettings = normalizeSettings(stored.llmSettings);
  
  const provider = byId('provider').value;
  const model = byId('model').value.trim();
  const baseUrl = byId('baseUrl').value.trim();
  const openaiApiKey = byId('openaiApiKey').value.trim();
  const xaiApiKey = byId('xaiApiKey').value.trim();
  const groqApiKey = byId('groqApiKey').value.trim();

  const backendUrlSetting = byId('backendUrl') ? byId('backendUrl').value : 'prod';
  const effectiveModel = model || providerDefaultModel(provider);

  // Save model to the provider-specific field
  const updatedSettings = {
    ...currentSettings,
    provider,
    model: effectiveModel, // Legacy field
    baseUrl,
    openaiApiKey,
    xaiApiKey,
    groqApiKey,
    backendUrl: backendUrlSetting,
  };
  
  // Update the provider-specific model field
  if (provider === 'ollama') updatedSettings.ollamaModel = effectiveModel;
  else if (provider === 'openai') updatedSettings.openaiModel = effectiveModel;
  else if (provider === 'xai') updatedSettings.xaiModel = effectiveModel;
  else if (provider === 'groq') updatedSettings.groqModel = effectiveModel;

  const llmSettings = normalizeSettings(updatedSettings);

  await chrome.storage.local.set({ llmSettings });
  setStatus('llmStatus', 'LLM settings saved.');
  updateCredentialStatus();
}

async function saveGithubToken() {
  const stored = await chrome.storage.local.get(['llmSettings']);
  const currentSettings = normalizeSettings(stored.llmSettings);
  
  const githubTokenEl = byId('githubToken');
  const githubToken = githubTokenEl ? githubTokenEl.value.trim() : '';

  const llmSettings = normalizeSettings({
    ...currentSettings,
    githubToken,
  });

  await chrome.storage.local.set({ llmSettings });
  setStatus('githubStatus', 'GitHub token saved.');
  updateCredentialStatus();
}

async function resetDefaults() {
  await chrome.storage.local.set({ llmSettings: DEFAULT_SETTINGS });
  await loadSettings();
  setStatus('resetStatus', 'Reset to defaults.');
}


let statusTimeouts = {};
function setStatus(elementId, text) {
  const el = byId(elementId);
  if (!el) return;
  
  el.textContent = text;
  el.style.color = 'var(--muted)';
  
  if (statusTimeouts[elementId]) clearTimeout(statusTimeouts[elementId]);
  statusTimeouts[elementId] = setTimeout(() => { 
    updateCredentialStatus();
  }, 2500);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();

  byId('provider').addEventListener('change', async (e) => {
    const provider = e.target.value;
    refreshProviderFields(provider);

    // Load the saved model for this provider
    const stored = await chrome.storage.local.get(['llmSettings']);
    const settings = normalizeSettings(stored.llmSettings);
    
    const modelInput = byId('model');
    const savedModel = provider === 'ollama' ? settings.ollamaModel
      : provider === 'xai' ? settings.xaiModel
      : provider === 'groq' ? settings.groqModel
      : settings.openaiModel;
    modelInput.value = savedModel;
    
    updateCredentialStatus();
  });

  byId('saveLlmBtn').addEventListener('click', saveLlmSettings);
  byId('saveGithubBtn').addEventListener('click', saveGithubToken);
  byId('resetBtn').addEventListener('click', resetDefaults);
});
