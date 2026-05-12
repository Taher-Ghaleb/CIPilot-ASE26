/**
 * Rating API - For user ratings and feedback
 */

import { apiClient } from './client'

export interface RatingStats {
  average: number
  total_votes: number
  distribution: Record<number, number>
}

export interface RatingSubmitRequest {
  score: number // 1-5 stars
  feedback?: string
  session_id: string
}

export interface UserRating {
  has_rated: boolean
  score?: number
  feedback?: string
}

// Generate or get session ID for rating (stored in localStorage)
export function getRatingSessionId(): string {
  const key = 'cipilot_rating_session_id'
  let sessionId = localStorage.getItem(key)
  if (!sessionId) {
    sessionId = `rating_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
    localStorage.setItem(key, sessionId)
  }
  return sessionId
}

export const ratingApi = {
  /**
   * Get aggregate rating statistics
   */
  async getStats(): Promise<RatingStats> {
    const response = await apiClient.get<RatingStats>('/rating/stats')
    return response.data
  },

  /**
   * Submit a rating
   */
  async submit(score: number, feedback?: string): Promise<{ success: boolean; message: string }> {
    const sessionId = getRatingSessionId()
    const response = await apiClient.post<{ success: boolean; message: string }>('/rating/submit', {
      score,
      feedback,
      session_id: sessionId,
    })
    return response.data
  },

  /**
   * Check if current user has already rated
   */
  async checkUserRating(): Promise<UserRating> {
    const sessionId = getRatingSessionId()
    const response = await apiClient.get<UserRating>(`/rating/check/${sessionId}`)
    return response.data
  },
}
