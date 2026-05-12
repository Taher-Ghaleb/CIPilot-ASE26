import { apiClient } from './client'
import type {
  ConversionRequest,
  ConversionResponse,
  RetryConversionRequest,
  ValidateGithubActionsRequest,
  ValidationResult,
  LLMSettings,
  CIConfig,
  Repository,
} from '../types/api'

export const cicdApi = {
  /**
   * Convert CI/CD configuration to GitHub Actions
   */
  async convert(request: ConversionRequest): Promise<ConversionResponse> {
    const response = await apiClient.post<ConversionResponse>('/convert-cicd', request)
    return response.data
  },

  /**
   * Validate GitHub Actions YAML with optional Double Check
   */
  async validate(yaml: string, originalConfig?: string, llmSettings?: LLMSettings): Promise<ValidationResult> {
    const request: ValidateGithubActionsRequest = { 
      yaml,
      originalConfig,
      llmSettings,
    }
    const response = await apiClient.post<ValidationResult>('/validate-github-actions', request)
    return response.data
  },

  /**
   * Retry conversion with feedback
   */
  async retry(request: RetryConversionRequest): Promise<ConversionResponse> {
    const response = await apiClient.post<ConversionResponse>('/retry-conversion', request)
    return response.data
  },

  /**
   * Detect CI/CD platform from YAML content
   */
  async detectCI(
    yamlContent: string, 
    filePath?: string,
    repoOwner?: string,
    repoName?: string,
    repoBranch?: string,
    detectedServices?: string[]
  ): Promise<{ detected_platforms: string[]; confidence: number; file_path?: string }> {
    const response = await apiClient.post<{ detected_platforms: string[]; confidence: number; file_path?: string }>('/detect-ci', {
      yaml_content: yamlContent,
      file_path: filePath,
      repo_owner: repoOwner,
      repo_name: repoName,
      repo_branch: repoBranch,
      detected_services: detectedServices,
    })
    return response.data
  },

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: string; message: string }> {
    const response = await apiClient.get<{ status: string; message: string }>('/')
    return response.data
  },
}

/**
 * Helper to build a conversion request
 */
export function buildConversionRequest(
  repository: Repository,
  detectedServices: string[],
  configs: Record<string, string>,
  llmSettings?: LLMSettings,
  targetPlatform: 'github-actions' | 'travis-ci' = 'github-actions'
): ConversionRequest {
  // Convert flat configs to the expected format
  const existingConfigs: Record<string, CIConfig> = {}

  for (const [service, content] of Object.entries(configs)) {
    existingConfigs[service] = {
      files: [
        {
          path: getConfigPath(service),
          content,
          fileName: getConfigFileName(service),
        },
      ],
    }
  }

  return {
    repository,
    detectedServices,
    existingConfigs,
    targetPlatform,
    llmSettings,
  }
}

/**
 * Get typical config file path for a CI service
 */
function getConfigPath(service: string): string {
  const paths: Record<string, string> = {
    'Travis CI': '.travis.yml',
    CircleCI: '.circleci/config.yml',
    'GitLab CI': '.gitlab-ci.yml',
    'GitHub Actions': '.github/workflows/ci.yml',
    'Azure Pipelines': 'azure-pipelines.yml',
    AppVeyor: 'appveyor.yml',
    Jenkins: 'Jenkinsfile',
    'Bitbucket Pipelines': 'bitbucket-pipelines.yml',
  }
  return paths[service] || '.ci.yml'
}

/**
 * Get config file name for a CI service
 */
function getConfigFileName(service: string): string {
  const path = getConfigPath(service)
  return path.split('/').pop() || 'config.yml'
}
