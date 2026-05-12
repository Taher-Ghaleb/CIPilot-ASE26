export type LLMProvider = 'ollama' | 'openai' | 'xai' | 'groq' | 'anthropic' | 'google' | 'generic'
export type Theme = 'light' | 'dark' | 'system'

// Check if running in production (deployed to remote server)
// Ollama only works locally, not in production
const isProduction = typeof window !== 'undefined' && 
  import.meta.env.PROD && 
  !window.location.hostname.includes('localhost') && 
  !window.location.hostname.includes('127.0.0.1')

export interface AppSettings {
  // LLM Settings
  llmProvider: LLMProvider
  llmModel: string
  ollamaModel: string
  openaiModel: string
  xaiModel: string
  groqModel: string
  anthropicModel: string
  googleModel: string
  genericModel: string
  llmBaseUrl: string
  openaiApiKey: string
  xaiApiKey: string
  groqApiKey: string
  anthropicApiKey: string
  googleApiKey: string
  genericApiKey: string
  genericBaseUrl: string

  // GitHub Settings
  githubToken: string

  // UI Settings
  theme: Theme
  sidebarCollapsed: boolean

  // Backend Settings
  backendUrl: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  // In production, default to Anthropic (requires API key); locally default to Ollama
  llmProvider: isProduction ? 'anthropic' : 'ollama',
  llmModel: isProduction ? 'claude-3-5-sonnet-20241022' : 'gemma3:12b',
  ollamaModel: 'gemma3:12b',
  openaiModel: 'gpt-4o-mini',
  xaiModel: 'grok-2-latest',
  groqModel: 'llama-3.3-70b-versatile',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  googleModel: 'gemini-2.0-flash-exp',
  genericModel: '',
  llmBaseUrl: '',
  openaiApiKey: '',
  xaiApiKey: '',
  groqApiKey: '',
  anthropicApiKey: '',
  googleApiKey: '',
  genericApiKey: '',
  genericBaseUrl: '',
  githubToken: '',
  theme: 'dark',
  sidebarCollapsed: false,
  backendUrl: import.meta.env.VITE_API_URL || 'http://localhost:5200',
}

export const LLM_PROVIDERS: { value: LLMProvider; label: string; requiresKey: boolean }[] = [
  { value: 'ollama', label: 'Ollama (Local)', requiresKey: false },
  { value: 'openai', label: 'OpenAI', requiresKey: true },
  { value: 'anthropic', label: 'Anthropic', requiresKey: true },
  { value: 'google', label: 'Google', requiresKey: true },
  { value: 'xai', label: 'xAI (Grok)', requiresKey: true },
  { value: 'groq', label: 'Groq', requiresKey: true },
  { value: 'generic', label: 'Generic (Custom)', requiresKey: true },
]

// Available models for each provider
export const PROVIDER_MODELS: Record<LLMProvider, { value: string; label: string }[]> = {
  ollama: [
    { value: 'gemma3:12b', label: 'Gemma 3 12B' },
    { value: 'llama3.3:latest', label: 'Llama 3.3' },
    { value: 'qwen2.5-coder:14b', label: 'Qwen 2.5 Coder 14B' },
    { value: 'codellama:13b', label: 'Code Llama 13B' },
    { value: 'mistral:latest', label: 'Mistral' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ],
  google: [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
    { value: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-flash-8b-latest', label: 'Gemini 1.5 Flash 8B' },
  ],
  xai: [
    { value: 'grok-2-latest', label: 'Grok 2 Latest' },
    { value: 'grok-2', label: 'Grok 2' },
    { value: 'grok-2-1212', label: 'Grok 2 (Dec 2024)' },
    { value: 'grok-beta', label: 'Grok Beta' },
    { value: 'grok-vision-beta', label: 'Grok Vision Beta' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
  ],
  generic: [
    { value: 'custom', label: 'Custom Model' },
  ],
}
