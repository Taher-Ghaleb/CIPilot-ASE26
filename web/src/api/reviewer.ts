/**
 * Reviewer Access API
 * Handles authentication and API calls for reviewer access
 */

import { apiClient } from './client'

export interface ReviewerSession {
  id: string
  name: string
  expires_at: string
}

export interface ReviewerProvider {
  name: string
  model: string
}

export interface ReviewerValidateResponse {
  success: boolean
  reviewer: ReviewerSession
  provider: ReviewerProvider
  access_count: number
}

export interface ReviewerStats {
  reviewer_id: string
  migration_count: number
  detection_count: number
  access_count: number
  last_activity: string | null
}

export interface ReviewerConvertRequest {
  reviewer_id: string
  source_yaml: string
  source_ci: string
  target_ci: string
  repo_url?: string
}

export interface ReviewerStatusResponse {
  enabled: boolean
  provider: string | null
  model: string | null
}

export const reviewerApi = {
  /**
   * Check if reviewer access is enabled on the server
   */
  async getStatus(): Promise<ReviewerStatusResponse> {
    const response = await apiClient.get<ReviewerStatusResponse>('/reviewer/status')
    return response.data
  },

  /**
   * Validate a reviewer access token
   */
  async validateToken(token: string): Promise<ReviewerValidateResponse> {
    const response = await apiClient.post<ReviewerValidateResponse>('/reviewer/validate', {
      token
    })
    return response.data
  },

  /**
   * Get reviewer session info and stats
   */
  async getSession(reviewerId: string): Promise<{ session: any; stats: ReviewerStats }> {
    const response = await apiClient.get<{ session: any; stats: ReviewerStats }>(
      `/reviewer/session/${reviewerId}`
    )
    return response.data
  },

  /**
   * Convert CI/CD config using reviewer's pre-configured provider
   */
  async convert(request: ReviewerConvertRequest) {
    const response = await apiClient.post('/reviewer/convert', request)
    return response.data
  }
}
