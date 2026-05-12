import type { LLMProvider } from './settings'

export interface Repository {
  owner: string
  name: string
  branch: string
}

export interface LLMSettings {
  provider: LLMProvider
  model: string
  baseUrl?: string
  apiKey?: string
}

export interface CIConfigFile {
  path: string
  content: string
  fileName: string
}

export interface CIConfig {
  files?: CIConfigFile[]
  content?: string // Legacy format
}

export interface ValidationResult {
  yamlOk: boolean
  yamlError?: string
  actionlintOk: boolean
  actionlintOutput?: string
  // Agentic Double Check - semantic verification by LLM
  doubleCheckOk?: boolean
  doubleCheckReasons?: string[]
  doubleCheckSkipped?: boolean  // True if YAML/lint failed
}

export interface ConversionRequest {
  repository: Repository
  detectedServices: string[]
  existingConfigs: Record<string, CIConfig>
  targetPlatform?: 'github-actions' | 'travis-ci'
  llmSettings?: LLMSettings
}

export interface ConversionResponse {
  status: string
  message: string
  convertedConfig: string
  originalServices: string[]
  targetPlatform: string
  providerUsed?: string
  modelUsed?: string
  attempts: number
  validation?: ValidationResult
}

export interface RetryConversionRequest {
  originalTravisConfig: string
  previousGitHubActionsAttempt: string
  targetPlatform: string
  feedback: string
  llmSettings?: LLMSettings
  currentAttempts?: number
}

export interface ValidateGithubActionsRequest {
  yaml: string
  originalConfig?: string  // For Double Check semantic verification
  llmSettings?: LLMSettings
}

export interface APIError {
  detail: string
  status?: number
}
