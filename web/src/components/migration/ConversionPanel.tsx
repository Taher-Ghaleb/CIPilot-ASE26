import { useState, useCallback, useEffect } from 'react'
import {
  Sparkles,
  RefreshCw,
  CheckCircle,
  GitPullRequest,
  ArrowRight,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { Button, Card, RatingModal } from '../common'
import { CIServiceChips } from './CIServiceChips'
import { DiffViewer } from './DiffViewer'
import { ValidationStatus } from './ValidationStatus'
import { RetryDialog } from './RetryDialog'
import { PRCreationDialog } from './PRCreationDialog'
import { useMigration } from '../../context/MigrationContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReviewer } from '../../context/ReviewerContext'
import { useMigrationHistory, triggerHistoryRefresh } from '../../hooks/useMigrationHistory'
import { cicdApi, buildConversionRequest } from '../../api/cicd'
import { reviewerApi } from '../../api/reviewer'
import { githubProxyApi } from '../../api/githubProxy'
import { ratingApi } from '../../api/rating'
import type { MigrationHistoryItem } from '../../types/migration'

// Step index for "Configure AI Provider" in the onboarding guide
const SETTINGS_STEP_INDEX = 3

// Known CI/CD config file paths
const CI_CONFIG_PATHS: Record<string, { paths: string[]; name: string; isFolder?: boolean }> = {
  github: { paths: ['.github/workflows'], name: 'GitHub Actions', isFolder: true },
  travis: { paths: ['.travis.yml'], name: 'Travis CI' },
  circle: { paths: ['.circleci'], name: 'CircleCI', isFolder: true },
  appveyor: { paths: ['appveyor.yml', '.appveyor.yml'], name: 'AppVeyor' },
  gitlab: { paths: ['.gitlab-ci.yml'], name: 'GitLab CI' },
  semaphore: { paths: ['.semaphore', '.semaphore/semaphore.yml'], name: 'Semaphore', isFolder: true },
  buildkite: { paths: ['.buildkite'], name: 'Buildkite', isFolder: true },
  azure: { paths: ['azure-pipelines.yml', '.azure-pipelines.yml'], name: 'Azure Pipelines' },
  bitbucket: { paths: ['bitbucket-pipelines.yml'], name: 'Bitbucket Pipelines' },
  cirrus: { paths: ['.cirrus.yml'], name: 'Cirrus CI' },
  scrutinizer: { paths: ['.scrutinizer.yml'], name: 'Scrutinizer CI' },
  codeship: { paths: ['codeship-services.yml'], name: 'Codeship' },
  wercker: { paths: ['wercker.yml'], name: 'Wercker' },
  bitrise: { paths: ['bitrise.yml'], name: 'Bitrise' },
  bamboo: { paths: ['bamboo.yml'], name: 'Bamboo' },
  gocd: { paths: ['.gocd.yaml'], name: 'GoCD' },
  codemagic: { paths: ['codemagic.yaml'], name: 'Codemagic' },
  jenkins: { paths: ['Jenkinsfile'], name: 'Jenkins' },
  drone: { paths: ['.drone.yml'], name: 'Drone CI' },
}

export function ConversionPanel() {
  const { state, setEditedYaml, setConversionResult, setError, setStep, setFetchedConfigs } = useMigration()
  const { getCurrentLLMSettings, settings, startOnboardingAtStep } = useSettings()
  const { isReviewer, reviewer, provider: reviewerProvider } = useReviewer()
  const toast = useToast()
  const { saveMigration, updateMigration } = useMigrationHistory()

  const [retryDialogOpen, setRetryDialogOpen] = useState(false)
  const [prDialogOpen, setPrDialogOpen] = useState(false)
  const [ratingModalOpen, setRatingModalOpen] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null)
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [showSourcePreview, setShowSourcePreview] = useState(false)
  const [isFetchingConfig, setIsFetchingConfig] = useState(false)
  const [actualDefaultBranch, setActualDefaultBranch] = useState<string | null>(null)
  const [serverTokenAvailable, setServerTokenAvailable] = useState<boolean | null>(null)

  // Check if PR creation is possible (server token or user token)
  const canCreatePR = serverTokenAvailable || !!settings.githubToken

  const { repository, detectedServices, fetchedConfigs, conversionResult, editedYaml } =
    state

  // Use local isConverting state for reliable UI updates
  const isLoading = isConverting || state.isLoading

  // Check if server-side GitHub token is available (on mount)
  useEffect(() => {
    if (serverTokenAvailable === null) {
      githubProxyApi.getStatus()
        .then((status) => {
          setServerTokenAvailable(status.server_token_configured)
        })
        .catch(() => {
          setServerTokenAvailable(false)
        })
    }
  }, [serverTokenAvailable])

  // Fetch actual default branch from GitHub when repository changes
  useEffect(() => {
    if (!repository) {
      setActualDefaultBranch(null)
      return
    }

    const fetchDefaultBranch = async () => {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${repository.owner}/${repository.name}`,
          {
            headers: settings.githubToken 
              ? { Authorization: `Bearer ${settings.githubToken}` }
              : {}
          }
        )
        
        if (response.ok) {
          const repoInfo = await response.json()
          setActualDefaultBranch(repoInfo.default_branch || repository.branch)
        } else if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}))
          if (errorData.message?.includes('API rate limit exceeded')) {
            toast.warning(
              'Rate Limit Reached',
              'Add your GitHub PAT in Settings for higher rate limits'
            )
          }
          setActualDefaultBranch(repository.branch)
        } else {
          setActualDefaultBranch(repository.branch)
        }
      } catch {
        setActualDefaultBranch(repository.branch)
      }
    }

    fetchDefaultBranch()
  }, [repository, settings.githubToken])

  // Auto-select first non-GitHub Actions service when detected services change
  // Only auto-select if there's no existing conversion result AND no fetched configs (fresh start)
  useEffect(() => {
    if (detectedServices.length > 0 && selectedServices.length === 0 && !conversionResult && Object.keys(fetchedConfigs).length === 0) {
      // Select only the FIRST non-GitHub Actions service (single selection)
      const firstNonGitHub = detectedServices.find(s => s.name !== 'GitHub Actions')
      if (firstNonGitHub) {
        setSelectedServices([firstNonGitHub.name])
        setShowSourcePreview(true)
      }
    }
  }, [detectedServices, selectedServices.length, conversionResult, fetchedConfigs])

  // When loading from history with existing conversionResult and configs, 
  // ensure the migrated service is selected
  useEffect(() => {
    if (conversionResult && Object.keys(fetchedConfigs).length > 0) {
      // Find ALL non-GitHub Actions services from fetchedConfigs
      const serviceKeys = Object.keys(fetchedConfigs).filter(key => {
        const serviceName = key.includes(':') ? key.split(':')[0] : key
        return serviceName !== 'GitHub Actions'
      })
      
      if (serviceKeys.length > 0) {
        // Get unique service names
        const uniqueServices = Array.from(new Set(
          serviceKeys.map(key => key.includes(':') ? key.split(':')[0] : key)
        ))
        
        // Only update if current selection is empty or doesn't match any service in fetchedConfigs
        const hasCorrectSelection = selectedServices.length > 0 && 
          selectedServices.every(s => uniqueServices.includes(s))
        
        if (!hasCorrectSelection) {
          setSelectedServices([uniqueServices[0]])
        }
      }
    }
  }, [conversionResult, fetchedConfigs])

  // Toggle service selection (single selection - radio behavior)
  // Also reset conversion state to allow starting a new migration
  const handleToggleService = useCallback((serviceName: string) => {
    // Single selection: clicking a service selects it (replacing any previous selection)
    // Clicking the same service again keeps it selected (doesn't deselect)
    setSelectedServices(prev => {
      if (prev.includes(serviceName)) {
        // Keep the same selection - don't deselect
        return prev
      } else {
        setShowSourcePreview(true) // Show preview when selecting a service
        // Reset conversion state when selecting a different service (to start new migration)
        setConversionResult(undefined)
        setEditedYaml('')
        setCurrentHistoryId(null) // Clear history ID to create new entry
        return [serviceName] // Select only this one (replace previous)
      }
    })
  }, [setConversionResult, setEditedYaml])

  // Fetch config for a specific service (uses server-side GitHub PAT via proxy)
  const handleFetchServiceConfig = useCallback(async (serviceName: string) => {
    if (!repository) return

    setIsFetchingConfig(true)
    try {
      // Find the service configuration in CI_CONFIG_PATHS
      const configEntry = Object.values(CI_CONFIG_PATHS).find(c => c.name === serviceName)
      if (!configEntry) {
        toast.error('Service not found', `Configuration for ${serviceName} not found`)
        return
      }

      const newConfigs: Record<string, string> = { ...fetchedConfigs }
      let foundConfig = false

      // Try to fetch from each possible path using proxy API (uses server-side PAT)
      for (const path of configEntry.paths) {
        try {
          if (configEntry.isFolder) {
            // Fetch directory contents via proxy
            const contents = await githubProxyApi.getDirectoryContents(
              repository.owner,
              repository.name,
              path,
              settings.githubToken // Optional user token override
            )

            if (contents.length > 0) {
              // Fetch each config file in the folder
              for (const file of contents) {
                if (file.type === 'file' && (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))) {
                  const fileContent = await githubProxyApi.getFileContent(
                    repository.owner,
                    repository.name,
                    file.path,
                    settings.githubToken
                  )
                  if (fileContent) {
                    newConfigs[`${configEntry.name}:${file.name}`] = fileContent
                    foundConfig = true
                  }
                }
              }
              break
            }
          } else {
            // Fetch single file via proxy
            const content = await githubProxyApi.getFileContent(
              repository.owner,
              repository.name,
              path,
              settings.githubToken
            )

            if (content) {
              newConfigs[configEntry.name] = content
              foundConfig = true
              break
            }
          }
        } catch {
          // Continue to next path
        }
      }

      if (foundConfig) {
        setFetchedConfigs(newConfigs)
        setShowSourcePreview(true)
        toast.success('Config loaded', `${serviceName} configuration fetched successfully`)
      } else {
        toast.warning('Config not found', `No ${serviceName} configuration found in this repository`)
      }
    } catch (error) {
      toast.error('Fetch failed', `Failed to fetch ${serviceName} configuration: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsFetchingConfig(false)
    }
  }, [repository, fetchedConfigs, settings.githubToken, setFetchedConfigs, toast])

  // Helper function to get GitHub URL for a config file
  const getConfigUrl = useCallback((serviceKey: string): string | undefined => {
    if (!repository) return undefined
    
    const serviceName = serviceKey.includes(':') ? serviceKey.split(':')[0] : serviceKey
    const branchToUse = actualDefaultBranch || repository.branch
    
    // Find the detected service to get its path
    const detectedService = detectedServices.find(s => s.name === serviceName)
    if (detectedService && actualDefaultBranch) {
      // If we have the actual default branch and it's different from what's in the URL, reconstruct it
      const urlBranch = detectedService.url.match(/\/(blob|tree)\/([^/]+)\//)?.[2]
      if (urlBranch && urlBranch !== actualDefaultBranch) {
        // Reconstruct URL with correct branch
        const path = detectedService.path
        const isFolder = detectedService.url.includes('/tree/')
        if (isFolder) {
          return `${repository.url}/tree/${actualDefaultBranch}/${path}`
        } else {
          return `${repository.url}/blob/${actualDefaultBranch}/${path}`
        }
      }
      return detectedService.url
    }
    
    // Fallback: construct URL from service key
    const fileName = serviceKey.includes(':') ? serviceKey.split(':')[1] : getConfigFileName(serviceKey)
    const configEntry = Object.values(CI_CONFIG_PATHS).find(c => c.name === serviceName)
    
    if (configEntry && configEntry.paths.length > 0) {
      const path = configEntry.paths[0]
      if (configEntry.isFolder) {
        return `${repository.url}/blob/${branchToUse}/${path}/${fileName}`
      } else {
        return `${repository.url}/blob/${branchToUse}/${path}`
      }
    }
    
    return undefined
  }, [repository, detectedServices, actualDefaultBranch])

  // Convert configs to original files format for DiffViewer
  // ALWAYS show files from the SELECTED service only
  const originalFiles = Object.entries(fetchedConfigs)
    .filter(([key]) => {
      // Key format is either "ServiceName" or "ServiceName:filename.yml"
      const serviceName = key.includes(':') ? key.split(':')[0] : key
      // Exclude GitHub Actions since it's the target, not source
      if (serviceName === 'GitHub Actions') return false
      // Show only files from selected service
      return selectedServices.includes(serviceName)
    })
    .map(([service, content]) => ({
      name: getConfigFileName(service),
      content,
      service,
      url: getConfigUrl(service),
    }))

  // Auto-fetch config when service selected but no config available
  useEffect(() => {
    if (selectedServices.length > 0 && !conversionResult && originalFiles.length === 0 && !isFetchingConfig) {
      // Service selected but no config - fetch it
      handleFetchServiceConfig(selectedServices[0])
    }
  }, [selectedServices, conversionResult, originalFiles.length, isFetchingConfig, handleFetchServiceConfig])

  const handleConvert = useCallback(async () => {
    if (!repository || selectedServices.length === 0) {
      toast.warning('No services selected', 'Please select at least one CI service to migrate')
      return
    }

    // Check if LLM provider is configured before attempting conversion
    // Skip this check for reviewers - they use server-side configured provider
    // Ollama doesn't require an API key - it just needs to be running locally
    const llmSettings = getCurrentLLMSettings()
    const isOllama = llmSettings.provider === 'ollama'
    const isProviderConfigured = isOllama || !!llmSettings.apiKey
    
    if (!isProviderConfigured && !(isReviewer && reviewer)) {
      toast.warning(
        'LLM Provider Not Configured',
        'Please configure your AI provider in Settings (⚙️) before migrating. Add an API key for Anthropic, OpenAI, or another provider.'
      )
      // Open onboarding guide at the Settings step to help user configure
      setTimeout(() => {
        startOnboardingAtStep(SETTINGS_STEP_INDEX)
      }, 300)
      return
    }

    // Set local state first for immediate UI update
    setIsConverting(true)
    setError(undefined)
    setStep('converting')

    try {
      // Filter fetchedConfigs to only include selected services
      const selectedConfigs: Record<string, string> = {}
      for (const [key, value] of Object.entries(fetchedConfigs)) {
        // Key format is either "ServiceName" or "ServiceName:filename.yml"
        const serviceName = key.includes(':') ? key.split(':')[0] : key
        if (selectedServices.includes(serviceName)) {
          selectedConfigs[key] = value
        }
      }

      // Combine all source configs into single YAML
      const sourceYaml = Object.entries(selectedConfigs)
        .map(([key, content]) => `# Source: ${key}\n${content}`)
        .join('\n\n')

      let result
      let providerUsed: string
      let modelUsed: string

      // Use reviewer API if in reviewer mode, otherwise use standard API
      if (isReviewer && reviewer) {
        // Use reviewer's pre-configured provider
        const reviewerResult = await reviewerApi.convert({
          reviewer_id: reviewer.id,
          source_yaml: sourceYaml,
          source_ci: selectedServices.join(', '),
          target_ci: 'github-actions',
          repo_url: `https://github.com/${repository.owner}/${repository.name}`,
        })
        
        result = {
          convertedConfig: reviewerResult.convertedConfig,
          validation: reviewerResult.validation ? {
            yamlOk: reviewerResult.validation.yamlOk,
            yamlError: reviewerResult.validation.yamlError || undefined,
            actionlintOk: reviewerResult.validation.actionlintOk,
            actionlintOutput: reviewerResult.validation.actionlintOutput || undefined,
            doubleCheckOk: reviewerResult.validation.doubleCheckOk ?? undefined,
            doubleCheckReasons: reviewerResult.validation.doubleCheckReasons || undefined,
            doubleCheckSkipped: reviewerResult.validation.doubleCheckSkipped ?? false,
          } : undefined,
          attempts: 1,
        }
        providerUsed = reviewerProvider?.name || 'xai'
        modelUsed = reviewerProvider?.model || 'grok-beta'
      } else {
        // Use standard API with user's LLM settings
        const request = buildConversionRequest(
          repository,
          selectedServices,
          selectedConfigs,
          llmSettings
        )
        const standardResult = await cicdApi.convert(request)
        result = standardResult
        providerUsed = result.providerUsed || llmSettings.provider
        modelUsed = result.modelUsed || llmSettings.model
      }

      setConversionResult({
        convertedConfig: result.convertedConfig,
        validation: result.validation,
        attempts: result.attempts,
        providerUsed,
        modelUsed,
      })

      setStep('review')

      // Save to history
      const historyItem: Omit<MigrationHistoryItem, 'id' | 'createdAt' | 'updatedAt'> = {
        repository: {
          ...repository,
          url: `https://github.com/${repository.owner}/${repository.name}`,
        },
        sourceServices: selectedServices,
        detectedServices: detectedServices, // Save all detected services
        targetPlatform: 'github-actions',
        originalConfigs: selectedConfigs,
        convertedConfig: result.convertedConfig,
        validation: result.validation,
        llmProvider: providerUsed,
        llmModel: modelUsed,
        attempts: result.attempts,
        manualRetries: 0,
        status: result.validation?.yamlOk && result.validation?.actionlintOk ? 'validated' : 'draft',
      }

      const id = await saveMigration(historyItem)
      setCurrentHistoryId(id)
      triggerHistoryRefresh() // Update sidebar

      toast.success('Conversion complete', 'Review the generated GitHub Actions workflow')
    } catch (error: unknown) {
      // Extract error message from various error formats
      let message = 'Conversion failed'
      if (error && typeof error === 'object') {
        if ('detail' in error && typeof error.detail === 'string') {
          // APIError format from our client
          message = error.detail
        } else if ('message' in error && typeof error.message === 'string') {
          // Standard Error format
          message = error.message
        }
      }

      // Check if the error is related to configuration/API issues (show as warning, not error)
      const isConfigurationIssue = message.toLowerCase().includes('model') ||
        message.toLowerCase().includes('invalid') ||
        message.toLowerCase().includes('not found') ||
        message.toLowerCase().includes('configuration') ||
        message.toLowerCase().includes('llm') ||
        message.toLowerCase().includes('api key') ||
        message.toLowerCase().includes('connection') ||
        message.toLowerCase().includes('refused') ||
        message.toLowerCase().includes('httpconnection') ||
        message.toLowerCase().includes('max retries') ||
        message.toLowerCase().includes('401') ||
        message.toLowerCase().includes('403') ||
        message.toLowerCase().includes('unauthorized')

      setError(message)

      if (isConfigurationIssue) {
        // Show as warning (yellow) instead of error (red) for configuration issues
        toast.warning(
          'Configuration Issue',
          `Please check your LLM settings in ⚙️ Settings (provider: ${settings.llmProvider}, model: ${settings.llmModel}).`
        )
        // Open onboarding guide at the Settings step to help user configure
        setTimeout(() => {
          startOnboardingAtStep(SETTINGS_STEP_INDEX)
        }, 500)
      } else if (message.toLowerCase().includes('server error') || message.toLowerCase().includes('500')) {
        toast.warning(
          'Server Temporarily Unavailable',
          'The conversion service is experiencing issues. Please try again in a moment.'
        )
      } else {
        toast.error('Conversion failed', message)
      }
    } finally {
      setIsConverting(false)
    }
  }, [
    repository,
    selectedServices,
    fetchedConfigs,
    getCurrentLLMSettings,
    setConversionResult,
    setError,
    setStep,
    toast,
    saveMigration,
    startOnboardingAtStep,
  ])

  const handleValidate = useCallback(async () => {
    if (!editedYaml) return

    setIsValidating(true)
    try {
      // Get original config for Double Check semantic verification
      const originalConfig = Object.values(fetchedConfigs).join('\n---\n')
      const llmSettings = getCurrentLLMSettings()
      
      const validation = await cicdApi.validate(editedYaml, originalConfig, llmSettings)
      setConversionResult({
        convertedConfig: editedYaml,
        validation,
        attempts: conversionResult?.attempts || 1,
        providerUsed: conversionResult?.providerUsed,
        modelUsed: conversionResult?.modelUsed,
      })

      if (validation.yamlOk && validation.actionlintOk && validation.doubleCheckOk !== false) {
        toast.success('Validation passed', 'The workflow is valid')
      } else if (validation.yamlOk && validation.actionlintOk && validation.doubleCheckOk === false) {
        toast.warning('Double Check issues', 'Semantic verification found potential issues')
      } else {
        toast.warning('Validation issues', 'Check the validation details')
      }
    } catch (error: unknown) {
      let message = 'Validation failed'
      if (error && typeof error === 'object') {
        if ('detail' in error && typeof error.detail === 'string') {
          message = error.detail
        } else if ('message' in error && typeof error.message === 'string') {
          message = error.message
        }
      }
      toast.error('Validation failed', message)
    } finally {
      setIsValidating(false)
    }
  }, [editedYaml, conversionResult, setConversionResult, toast, fetchedConfigs, getCurrentLLMSettings])

  const handleRetry = useCallback(
    async (feedback: string) => {
      if (!repository || !editedYaml) return

      setIsConverting(true)
      setRetryDialogOpen(false)

      try {
        const llmSettings = getCurrentLLMSettings()
        const currentAttemptCount = conversionResult?.attempts || 1
        
        console.log('[RETRY] Current attempts:', currentAttemptCount)
        
        const result = await cicdApi.retry({
          originalTravisConfig: Object.values(fetchedConfigs).join('\n---\n'),
          previousGitHubActionsAttempt: editedYaml,
          targetPlatform: 'github-actions',
          feedback,
          llmSettings,
          currentAttempts: currentAttemptCount,
        })

        console.log('[RETRY] Result attempts:', result.attempts)

        setConversionResult({
          convertedConfig: result.convertedConfig,
          validation: result.validation,
          attempts: result.attempts,
          providerUsed: result.providerUsed,
          modelUsed: result.modelUsed,
        })

        // Update history
        if (currentHistoryId) {
          await updateMigration(currentHistoryId, {
            convertedConfig: result.convertedConfig,
            validation: result.validation,
            attempts: result.attempts,
            manualRetries: (conversionResult?.attempts || 1) + 1,
            llmProvider: result.providerUsed || '',
            llmModel: result.modelUsed || '',
          })
          triggerHistoryRefresh() // Update sidebar
        }

        toast.success('Retry complete', 'Review the updated workflow')
      } catch (error: unknown) {
        let message = 'Retry failed'
        if (error && typeof error === 'object') {
          if ('detail' in error && typeof error.detail === 'string') {
            message = error.detail
          } else if ('message' in error && typeof error.message === 'string') {
            message = error.message
          }
        }
        toast.error('Retry failed', message)
      } finally {
        setIsConverting(false)
      }
    },
    [
      repository,
      editedYaml,
      fetchedConfigs,
      getCurrentLLMSettings,
      setConversionResult,
      currentHistoryId,
      updateMigration,
      conversionResult,
      toast,
    ]
  )

  // Check if we have any non-GitHub Actions services to migrate
  const migrateableServices = detectedServices.filter(s => s.name !== 'GitHub Actions')
  const onlyGitHubActions = detectedServices.length > 0 && migrateableServices.length === 0

  // If no services detected yet, show message
  if (detectedServices.length === 0) {
    return (
      <Card variant="glass" padding="lg" className="text-center">
        <AlertCircle className="w-12 h-12 mx-auto text-[var(--text-muted)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
          No CI/CD Services Detected
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Enter a repository URL above to detect CI/CD configurations
        </p>
      </Card>
    )
  }

  // If only GitHub Actions is detected, nothing to migrate
  if (onlyGitHubActions) {
    return (
      <Card variant="glass" padding="lg" className="text-center">
        <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
          Already Using GitHub Actions
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          This repository is already using GitHub Actions. No migration needed.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Detection Results */}
      <Card variant="glass" padding="md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {repository?.owner}/{repository?.name}
              </span>
              <ArrowRight className="w-4 h-4 text-[var(--text-muted)]" />
              <span className="text-sm text-primary-500">GitHub Actions</span>
            </div>
            <div data-tour="service-chips">
              <CIServiceChips
                services={detectedServices}
                selectedServices={selectedServices}
                onToggle={handleToggleService}
                selectable={true}
              />
            </div>
          </div>

          {!conversionResult && (
            <Button
              variant="primary"
              onClick={handleConvert}
              isLoading={isLoading}
              disabled={selectedServices.length === 0}
              leftIcon={<Sparkles className="w-4 h-4" />}
              className="shrink-0"
              data-tour="migrate-button"
            >
              {isLoading
                ? 'Converting...'
                : selectedServices.length > 0
                  ? `Migrate ${selectedServices[0]} → GHA`
                  : 'Select a source CI'}
            </Button>
          )}
        </div>
      </Card>

      {/* Loading state when fetching config for selected service */}
      {!conversionResult && showSourcePreview && selectedServices.length > 0 && originalFiles.length === 0 && isFetchingConfig && (
        <Card variant="glass" padding="lg" className="text-center">
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 mx-auto text-primary-500 mb-4 animate-spin" />
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
              Fetching Configuration
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Loading {selectedServices[0]} configuration from repository...
            </p>
          </div>
        </Card>
      )}

      {/* Side-by-side: Source Preview (left) + Loading/Progress (right) during conversion */}
      {!conversionResult && showSourcePreview && selectedServices.length > 0 && originalFiles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Source Configuration Preview */}
          <Card variant="glass" padding="lg">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                Source Configuration
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {isLoading ? `Converting ${selectedServices[0]} to GitHub Actions` : `Review your current ${selectedServices[0]} configuration`}
              </p>
            </div>
            <DiffViewer
              originalFiles={originalFiles}
              convertedYaml=""
              onYamlChange={() => {}}
              readOnly={true}
              showOnlyOriginal={true}
              defaultSelectedService={selectedServices[0]}
            />
          </Card>

          {/* Right: Loading State with Progress (shown during conversion) */}
          {isLoading && (
            <Card variant="glass" padding="lg">
              <div className="flex flex-col items-center text-center">
                {/* Animated progress indicator */}
                <div className="relative w-20 h-20 mb-6">
                  <div className="absolute inset-0 rounded-full border-4 border-[var(--border)]"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-primary-500 animate-pulse" />
                  </div>
                </div>

                <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                  Converting CI/CD Configuration
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Using <span className="text-primary-500 font-medium">{isReviewer && reviewerProvider ? reviewerProvider.name : settings.llmProvider}</span> ({isReviewer && reviewerProvider ? reviewerProvider.model : settings.llmModel})
                </p>

                {/* Progress steps */}
                <div className="w-full max-w-md space-y-3 text-left">
                  <ProgressStep label="Analyzing source configuration" status="complete" />
                  <ProgressStep label="Generating GitHub Actions workflow" status="active" />
                  <ProgressStep label="Validating output" status="pending" />
                </div>

                <p className="text-xs text-[var(--text-muted)] mt-6">
                  This may take 1-2 minutes for large files. Please be patient...
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Side-by-side: Source Preview (left) + Retry Progress (right) during retry conversion */}
      {isLoading && conversionResult && originalFiles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Source Configuration Preview */}
          <Card variant="glass" padding="lg">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                Source Configuration
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Retrying conversion with feedback
              </p>
            </div>
            <DiffViewer
              originalFiles={originalFiles}
              convertedYaml=""
              onYamlChange={() => {}}
              readOnly={true}
              showOnlyOriginal={true}
              defaultSelectedService={selectedServices[0]}
            />
          </Card>

          {/* Right: Retry Progress */}
          <Card variant="glass" padding="lg">
            <div className="flex flex-col items-center text-center">
              {/* Animated progress indicator */}
              <div className="relative w-20 h-20 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-[var(--border)]"></div>
                <div className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-primary-500 animate-spin" />
                </div>
              </div>

              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                Retrying Conversion
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Using <span className="text-primary-500 font-medium">{isReviewer && reviewerProvider ? reviewerProvider.name : settings.llmProvider}</span> ({isReviewer && reviewerProvider ? reviewerProvider.model : settings.llmModel})
              </p>

              {/* Progress steps */}
              <div className="w-full max-w-md space-y-3 text-left">
                <ProgressStep label="Processing feedback" status="complete" />
                <ProgressStep label="Regenerating GitHub Actions workflow" status="active" />
                <ProgressStep label="Validating output" status="pending" />
              </div>

              <p className="text-xs text-[var(--text-muted)] mt-6">
                This may take 1-2 minutes for large files. Please be patient...
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Conversion Results - hide while loading during retry */}
      {conversionResult && editedYaml && !isLoading && (
        <>
          {/* Validation & Actions */}
          <Card variant="glass" padding="md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <ValidationStatus
                validation={conversionResult.validation}
                attempts={conversionResult.attempts}
                providerUsed={conversionResult.providerUsed}
                modelUsed={conversionResult.modelUsed}
                isValidating={isValidating}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleValidate}
                  isLoading={isValidating}
                  leftIcon={<CheckCircle className="w-4 h-4" />}
                >
                  Validate
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRetryDialogOpen(true)}
                  disabled={isLoading}
                  leftIcon={<RefreshCw className="w-4 h-4" />}
                >
                  Retry
                </Button>
                <div className="relative inline-flex group">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setPrDialogOpen(true)}
                    disabled={!canCreatePR}
                    title=""
                    leftIcon={<GitPullRequest className="w-4 h-4" />}
                  >
                    Create PR
                  </Button>
                  {!canCreatePR && (
                    <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                      GitHub connection unavailable. Add your PAT in Settings.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Diff Viewer */}
          <DiffViewer
            originalFiles={originalFiles}
            convertedYaml={editedYaml}
            onYamlChange={setEditedYaml}
            defaultSelectedService={selectedServices[0]}
          />
        </>
      )}

      {/* Dialogs */}
      <RetryDialog
        isOpen={retryDialogOpen}
        onClose={() => setRetryDialogOpen(false)}
        onRetry={handleRetry}
        yamlError={conversionResult?.validation?.yamlError}
        actionlintOutput={
          conversionResult?.validation?.actionlintOk === false
            ? conversionResult?.validation?.actionlintOutput
            : undefined
        }
        doubleCheckReasons={
          conversionResult?.validation?.doubleCheckOk === false
            ? conversionResult?.validation?.doubleCheckReasons
            : undefined
        }
        isLoading={isLoading}
      />

      <PRCreationDialog
        isOpen={prDialogOpen}
        onClose={() => setPrDialogOpen(false)}
        repository={repository}
        yaml={editedYaml || ''}
        serverTokenAvailable={serverTokenAvailable}
        onSuccess={async (prUrl) => {
          if (currentHistoryId) {
            updateMigration(currentHistoryId, { prUrl, status: 'pr_created' })
          }
          // Check if user has already rated, if not, prompt for rating
          try {
            const userRating = await ratingApi.checkUserRating()
            if (!userRating.has_rated) {
              // Show rating modal after a brief delay
              setTimeout(() => setRatingModalOpen(true), 1000)
            }
          } catch {
            // Silently fail - rating prompt is non-critical
          }
        }}
      />

      <RatingModal
        isOpen={ratingModalOpen}
        onClose={() => setRatingModalOpen(false)}
      />
    </div>
  )
}

function ProgressStep({ label, status }: { label: string; status: 'pending' | 'active' | 'complete' }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
        status === 'complete' ? 'bg-green-500' :
        status === 'active' ? 'bg-primary-500 animate-pulse' :
        'bg-[var(--border)]'
      }`}>
        {status === 'complete' ? (
          <CheckCircle className="w-4 h-4 text-white" />
        ) : status === 'active' ? (
          <div className="w-2 h-2 bg-white rounded-full" />
        ) : (
          <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full" />
        )}
      </div>
      <span className={`text-sm ${
        status === 'active' ? 'text-[var(--text-primary)] font-medium' :
        status === 'complete' ? 'text-[var(--text-secondary)]' :
        'text-[var(--text-muted)]'
      }`}>
        {label}
      </span>
    </div>
  )
}

function getConfigFileName(service: string): string {
  // Handle "ServiceName:filename.yml" format
  if (service.includes(':')) {
    return service.split(':')[1]
  }
  
  // Handle plain service names
  const names: Record<string, string> = {
    'Travis CI': '.travis.yml',
    CircleCI: 'config.yml',
    'GitLab CI': '.gitlab-ci.yml',
    'GitHub Actions': 'ci.yml',
    'Azure Pipelines': 'azure-pipelines.yml',
    AppVeyor: 'appveyor.yml',
    Jenkins: 'Jenkinsfile',
  }
  return names[service] || 'config.yml'
}
