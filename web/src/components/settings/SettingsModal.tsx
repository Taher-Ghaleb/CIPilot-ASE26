import { useState, useEffect } from 'react'
import { Key, Server, Github, Download, Upload, RotateCcw, Eye, EyeOff, HelpCircle, Shield, LogOut } from 'lucide-react'
import { Modal, Button, Input, Select, Card, CardTitle, CardContent } from '../common'
import { useSettings } from '../../context/SettingsContext'
import { useExportImport } from '../../hooks/useExportImport'
import { useReviewer } from '../../context/ReviewerContext'
import { LLM_PROVIDERS, DEFAULT_SETTINGS, PROVIDER_MODELS, type AppSettings, type LLMProvider } from '../../types/settings'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings, resetSettings, isProviderConfigured, setShowOnboarding, setOnboardingComplete } = useSettings()
  const { handleExport, triggerFileInput, isExporting, isImporting } = useExportImport()
  const { isReviewer, reviewer, provider: reviewerProvider, clearReviewerSession } = useReviewer()
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings)
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [showGithubToken, setShowGithubToken] = useState(false)
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [customModelName, setCustomModelName] = useState('')

  // Check if current model is not in the predefined list (custom model)
  const isCustomModel = (provider: LLMProvider, model: string) => {
    return !PROVIDER_MODELS[provider].some(m => m.value === model)
  }

  // Sync with global settings when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings)
      // Check if current model is custom
      const custom = isCustomModel(settings.llmProvider, settings.llmModel)
      setUseCustomModel(custom)
      if (custom) {
        setCustomModelName(settings.llmModel)
      } else {
        setCustomModelName('')
      }
    }
  }, [isOpen, settings])

  const handleSave = () => {
    updateSettings(localSettings)
    onClose()
  }

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all settings to defaults?')) {
      resetSettings()
      setLocalSettings(settings)
    }
  }

  const updateLocal = (updates: Partial<AppSettings>) => {
    setLocalSettings((prev) => {
      const updated = { ...prev, ...updates }

      // When provider changes, update the model to match the provider's saved model (or default)
      if (updates.llmProvider && updates.llmProvider !== prev.llmProvider) {
        const modelKey = `${updates.llmProvider}Model` as keyof AppSettings
        const defaultModelKey = `${updates.llmProvider}Model` as keyof typeof DEFAULT_SETTINGS
        // Use saved model for this provider, or fall back to default
        const savedModel = updated[modelKey]
        const defaultModel = DEFAULT_SETTINGS[defaultModelKey]
        updated.llmModel = (typeof savedModel === 'string' && savedModel) ? savedModel : String(defaultModel)
      }

      // When model changes, save to provider-specific field
      if (updates.llmModel) {
        const modelKey = `${updated.llmProvider}Model` as keyof AppSettings
        ;(updated as Record<string, unknown>)[modelKey] = updates.llmModel
      }

      return updated
    })
  }

  const getApiKeyField = (provider: LLMProvider): keyof AppSettings | null => {
    switch (provider) {
      case 'openai':
        return 'openaiApiKey'
      case 'xai':
        return 'xaiApiKey'
      case 'groq':
        return 'groqApiKey'
      case 'anthropic':
        return 'anthropicApiKey'
      case 'google':
        return 'googleApiKey'
      case 'generic':
        return 'genericApiKey'
      default:
        return null
    }
  }

  // Check if running in production (deployed to remote server)
  // Allow Ollama if running on localhost (includes Docker local setup)
  const isProduction = import.meta.env.PROD && 
    !window.location.hostname.includes('localhost') && 
    !window.location.hostname.includes('127.0.0.1')

  const providerOptions = LLM_PROVIDERS
    .filter((p) => {
      // Filter out Ollama in production since it requires local backend
      if (isProduction && p.value === 'ollama') {
        return false
      }
      return true
    })
    .map((p) => ({
      value: p.value,
      label: `${p.label}${isProviderConfigured(p.value) ? ' ✓' : ''}`,
      disabled: false,
    }))

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleReset} leftIcon={<RotateCcw className="w-4 h-4" />}>
            Reset
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save Settings
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Reviewer Mode Banner */}
        {isReviewer && reviewer && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-amber-800 dark:text-amber-300 mb-1">
                  Reviewer Access Mode
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
                  Welcome, <strong>{reviewer.name}</strong>! You have pre-configured LLM access.
                </p>
                <div className="text-sm text-amber-600 dark:text-amber-400/80 space-y-1">
                  <p>• Provider: <strong>{reviewerProvider?.name?.toUpperCase()}</strong></p>
                  <p>• Model: <strong>{reviewerProvider?.model}</strong></p>
                  <p>• No provider API key configuration needed</p>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('Exit reviewer mode? You will need to use the reviewer URL to re-authenticate.')) {
                      clearReviewerSession()
                    }
                  }}
                  className="mt-3 flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Exit Reviewer Mode
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Security Notice */}
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-300">
            🔒 <strong>Privacy:</strong> All settings and API keys are stored locally in your browser storage. Nothing is sent to or stored on any server. Your credentials remain completely private and secure on your device.
          </p>
        </div>

        {/* LLM Provider Section */}
        <Card variant="bordered" padding="md">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-primary-500" />
            LLM Provider
          </CardTitle>
          <CardContent className="space-y-4">
            {isProduction && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  ℹ️ Ollama is not available in the deployed version. Use cloud providers (Anthropic, OpenAI, xAI, Groq, or Google) or run locally for Ollama support.
                </p>
              </div>
            )}
            <Select
              label="Provider"
              value={localSettings.llmProvider}
              onChange={(e) => {
                const newProvider = e.target.value as LLMProvider
                updateLocal({ llmProvider: newProvider })
                // Reset custom model when provider changes
                setUseCustomModel(false)
                setCustomModelName('')
              }}
              options={providerOptions}
            />

            <div className="space-y-2">
              <Select
                label="Model"
                value={useCustomModel ? '__custom__' : localSettings.llmModel}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setUseCustomModel(true)
                    // Keep current model if switching to custom
                    setCustomModelName(localSettings.llmModel)
                  } else {
                    setUseCustomModel(false)
                    setCustomModelName('')
                    updateLocal({ llmModel: e.target.value })
                  }
                }}
                options={[
                  ...PROVIDER_MODELS[localSettings.llmProvider].map((m) => ({
                    value: m.value,
                    label: m.label,
                  })),
                  { value: '__custom__', label: '✏️ Custom Model...' },
                ]}
              />
              {useCustomModel && (
                <Input
                  placeholder="Enter custom model name (e.g., llama-3.2-90b-text-preview)"
                  value={customModelName}
                  onChange={(e) => {
                    setCustomModelName(e.target.value)
                    updateLocal({ llmModel: e.target.value })
                  }}
                  hint="Enter the exact model ID from your provider"
                />
              )}
            </div>

            {localSettings.llmProvider === 'ollama' && (
              <Input
                label="Base URL (optional)"
                value={localSettings.llmBaseUrl}
                onChange={(e) => updateLocal({ llmBaseUrl: e.target.value })}
                placeholder="http://localhost:11434"
                hint="Leave empty for default Ollama endpoint"
              />
            )}

            {localSettings.llmProvider === 'generic' && (
              <Input
                label="API Base URL"
                value={localSettings.genericBaseUrl}
                onChange={(e) => updateLocal({ genericBaseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                hint="Enter the base URL for your custom API endpoint"
              />
            )}

            {/* API Key for cloud providers */}
            {LLM_PROVIDERS.find((p) => p.value === localSettings.llmProvider)?.requiresKey && (
              <Input
                label={`${LLM_PROVIDERS.find((p) => p.value === localSettings.llmProvider)?.label} API Key`}
                type={showApiKey[localSettings.llmProvider] ? 'text' : 'password'}
                value={localSettings[getApiKeyField(localSettings.llmProvider)!] as string}
                onChange={(e) =>
                  updateLocal({ [getApiKeyField(localSettings.llmProvider)!]: e.target.value })
                }
                placeholder="Enter your API key"
                rightIcon={
                  <button
                    type="button"
                    onClick={() =>
                      setShowApiKey((prev) => ({
                        ...prev,
                        [localSettings.llmProvider]: !prev[localSettings.llmProvider],
                      }))
                    }
                    className="hover:text-[var(--text-primary)]"
                  >
                    {showApiKey[localSettings.llmProvider] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                }
              />
            )}
          </CardContent>
        </Card>

        {/* GitHub Integration Section */}
        <Card variant="bordered" padding="md">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Github className="w-5 h-5 text-primary-500" />
            GitHub Integration
          </CardTitle>
          <CardContent className="space-y-4">
            <Input
              label="Personal Access Token (PAT)"
              type={showGithubToken ? 'text' : 'password'}
              value={localSettings.githubToken}
              onChange={(e) => updateLocal({ githubToken: e.target.value })}
              placeholder="ghp_..."
              hint="Required for fetching private repos and creating PRs"
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowGithubToken((prev) => !prev)}
                  className="hover:text-[var(--text-primary)]"
                >
                  {showGithubToken ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              }
            />

            <div className="text-xs text-[var(--text-muted)] p-3 rounded-lg bg-[var(--bg-glass)]">
              <p className="font-medium mb-1">Required scopes:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  <code className="text-primary-500">repo</code> - Access repositories
                </li>
                <li>
                  <code className="text-primary-500">workflow</code> - Manage GitHub Actions
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Backend Configuration - Hidden in production */}
        {!isProduction && (
          <Card variant="bordered" padding="md">
            <CardTitle className="flex items-center gap-2 mb-4">
              <Server className="w-5 h-5 text-primary-500" />
              Backend
            </CardTitle>
            <CardContent>
              <Input
                label="Backend URL"
                value={localSettings.backendUrl}
                onChange={(e) => updateLocal({ backendUrl: e.target.value })}
                placeholder="http://localhost:5200"
                hint="URL of the CI/CD conversion backend"
              />
            </CardContent>
          </Card>
        )}

        {/* Export/Import Section */}
        <Card variant="bordered" padding="md">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Key className="w-5 h-5 text-primary-500" />
            Data Management
          </CardTitle>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={handleExport}
                isLoading={isExporting}
                leftIcon={<Download className="w-4 h-4" />}
              >
                Export History
              </Button>
              <Button
                variant="secondary"
                onClick={() => triggerFileInput(true)}
                isLoading={isImporting}
                leftIcon={<Upload className="w-4 h-4" />}
              >
                Import History
              </Button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Export your migration history to JSON for backup or import from a previous export.
            </p>
          </CardContent>
        </Card>

        {/* Getting Started Guide Section */}
        <Card variant="bordered" padding="md">
          <CardTitle className="flex items-center gap-2 mb-4">
            <HelpCircle className="w-5 h-5 text-primary-500" />
            Help
          </CardTitle>
          <CardContent>
            <Button
              variant="secondary"
              onClick={() => {
                setOnboardingComplete(false)
                setShowOnboarding(true)
                onClose()
              }}
              leftIcon={<HelpCircle className="w-4 h-4" />}
            >
              Restart Getting Started Guide
            </Button>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Show the step-by-step tutorial for new users again.
            </p>
          </CardContent>
        </Card>
      </div>
    </Modal>
  )
}
