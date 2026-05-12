import type { ValidationResult } from './api'

export type MigrationStatus = 'draft' | 'detecting' | 'converting' | 'validated' | 'pr_created' | 'completed' | 'error'

export interface MigrationRepository {
  owner: string
  name: string
  branch: string
  url: string
}

export interface DetectedService {
  name: string
  path: string
  url: string
}

export interface MigrationHistoryItem {
  id: string
  createdAt: Date
  updatedAt: Date
  repository: MigrationRepository
  sourceServices: string[]
  detectedServices?: DetectedService[] // All services that were detected (optional for backward compatibility)
  targetPlatform: string
  originalConfigs: Record<string, string>
  convertedConfig: string
  validation?: ValidationResult
  llmProvider: string
  llmModel: string
  attempts: number
  manualRetries: number
  prUrl?: string
  status: MigrationStatus
  tags?: string[]
  notes?: string
}

export interface MigrationState {
  step: 'input' | 'detecting' | 'converting' | 'review' | 'creating_pr'
  repository?: MigrationRepository
  detectedServices: DetectedService[]
  fetchedConfigs: Record<string, string>
  conversionResult?: {
    convertedConfig: string
    validation?: ValidationResult
    attempts: number
    providerUsed?: string
    modelUsed?: string
  }
  editedYaml?: string
  error?: string
  isLoading: boolean
}

export const INITIAL_MIGRATION_STATE: MigrationState = {
  step: 'input',
  detectedServices: [],
  fetchedConfigs: {},
  isLoading: false,
}
