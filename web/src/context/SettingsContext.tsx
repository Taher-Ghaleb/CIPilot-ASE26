import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { type AppSettings, DEFAULT_SETTINGS, type LLMProvider } from '../types/settings'

interface SettingsContextType {
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void
  resetSettings: () => void
  getCurrentLLMSettings: () => {
    provider: LLMProvider
    model: string
    baseUrl?: string
    apiKey?: string
  }
  isProviderConfigured: (provider: LLMProvider) => boolean
  // Onboarding state
  hasCompletedOnboarding: boolean
  setOnboardingComplete: (complete: boolean) => void
  showOnboarding: boolean
  setShowOnboarding: (show: boolean) => void
  onboardingStartStep: number
  startOnboardingAtStep: (step: number) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

const SETTINGS_KEY = 'cigrate-settings'
const ONBOARDING_KEY = 'cigrate-onboarding-complete'

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

function loadOnboardingState(): boolean {
  try {
    const stored = localStorage.getItem(ONBOARDING_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

function saveOnboardingState(complete: boolean): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, String(complete))
  } catch (e) {
    console.error('Failed to save onboarding state:', e)
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(loadOnboardingState)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStartStep, setOnboardingStartStep] = useState(0)

  // Show onboarding on first visit
  useEffect(() => {
    if (!hasCompletedOnboarding) {
      // Small delay to let the app render first
      const timer = setTimeout(() => {
        setShowOnboarding(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [hasCompletedOnboarding])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const setOnboardingComplete = useCallback((complete: boolean) => {
    setHasCompletedOnboarding(complete)
    saveOnboardingState(complete)
    if (complete) {
      setShowOnboarding(false)
      setOnboardingStartStep(0)
    }
  }, [])

  const startOnboardingAtStep = useCallback((step: number) => {
    setOnboardingStartStep(step)
    setShowOnboarding(true)
  }, [])

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...updates }

      // When provider changes, update the llmModel to match the provider's stored model
      if (updates.llmProvider && updates.llmProvider !== prev.llmProvider) {
        const providerModelKey = `${updates.llmProvider}Model` as keyof AppSettings
        const storedModel = updated[providerModelKey]
        if (typeof storedModel === 'string') {
          updated.llmModel = storedModel
        }
      }

      // When model changes, also store it in the provider-specific field
      if (updates.llmModel) {
        const providerModelKey = `${updated.llmProvider}Model` as keyof AppSettings
        ;(updated as Record<string, unknown>)[providerModelKey] = updates.llmModel
      }

      return updated
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    localStorage.removeItem(SETTINGS_KEY)
  }, [])

  const getCurrentLLMSettings = useCallback(() => {
    const { 
      llmProvider, 
      llmModel, 
      llmBaseUrl, 
      openaiApiKey, 
      xaiApiKey, 
      groqApiKey, 
      anthropicApiKey, 
      googleApiKey, 
      genericApiKey,
      genericBaseUrl
    } = settings

    let apiKey: string | undefined
    let baseUrl: string | undefined = llmBaseUrl || undefined

    switch (llmProvider) {
      case 'openai':
        apiKey = openaiApiKey
        break
      case 'xai':
        apiKey = xaiApiKey
        break
      case 'groq':
        apiKey = groqApiKey
        break
      case 'anthropic':
        apiKey = anthropicApiKey
        break
      case 'google':
        apiKey = googleApiKey
        break
      case 'generic':
        apiKey = genericApiKey
        baseUrl = genericBaseUrl || undefined
        break
    }

    return {
      provider: llmProvider,
      model: llmModel,
      baseUrl,
      apiKey: apiKey || undefined,
    }
  }, [settings])

  const isProviderConfigured = useCallback(
    (provider: LLMProvider): boolean => {
      switch (provider) {
        case 'ollama':
          return true // Ollama doesn't need API key
        case 'openai':
          return !!settings.openaiApiKey
        case 'xai':
          return !!settings.xaiApiKey
        case 'groq':
          return !!settings.groqApiKey
        case 'anthropic':
          return !!settings.anthropicApiKey
        case 'google':
          return !!settings.googleApiKey
        case 'generic':
          return !!settings.genericApiKey && !!settings.genericBaseUrl
        default:
          return false
      }
    },
    [settings]
  )

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        resetSettings,
        getCurrentLLMSettings,
        isProviderConfigured,
        hasCompletedOnboarding,
        setOnboardingComplete,
        showOnboarding,
        setShowOnboarding,
        onboardingStartStep,
        startOnboardingAtStep,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
