/**
 * Reviewer Context
 * Manages reviewer authentication state and provides reviewer-specific functionality
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { reviewerApi, type ReviewerSession, type ReviewerProvider, type ReviewerStats } from '../api/reviewer'

interface ReviewerContextType {
  // State
  isReviewer: boolean
  isLoading: boolean
  isValidating: boolean
  error: string | null
  reviewer: ReviewerSession | null
  provider: ReviewerProvider | null
  stats: ReviewerStats | null
  
  // Actions
  validateToken: (token: string) => Promise<boolean>
  refreshStats: () => Promise<void>
  clearReviewerSession: () => void
}

const ReviewerContext = createContext<ReviewerContextType | undefined>(undefined)

const REVIEWER_STORAGE_KEY = 'cipilot_reviewer_session'
const REVIEWER_TOKEN_KEY = 'cipilot_reviewer_token'

interface ReviewerProviderProps {
  children: ReactNode
}

export function ReviewerProvider({ children }: ReviewerProviderProps) {
  const [isReviewer, setIsReviewer] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewer, setReviewer] = useState<ReviewerSession | null>(null)
  const [provider, setProvider] = useState<ReviewerProvider | null>(null)
  const [stats, setStats] = useState<ReviewerStats | null>(null)

  // Load reviewer session from storage on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        const storedSession = localStorage.getItem(REVIEWER_STORAGE_KEY)
        const storedToken = localStorage.getItem(REVIEWER_TOKEN_KEY)
        
        if (storedSession && storedToken) {
          const session = JSON.parse(storedSession)
          
          // Check if session is expired
          if (new Date(session.reviewer.expires_at) > new Date()) {
            setReviewer(session.reviewer)
            setProvider(session.provider)
            setIsReviewer(true)
            
            // Refresh stats in background
            refreshStats()
          } else {
            // Session expired, clear it
            clearReviewerSession()
          }
        }
      } catch (err) {
        console.error('Failed to load reviewer session:', err)
        clearReviewerSession()
      } finally {
        setIsLoading(false)
      }
    }
    
    loadSession()
  }, [])

  const validateToken = useCallback(async (token: string): Promise<boolean> => {
    setIsValidating(true)
    setError(null)
    
    try {
      const response = await reviewerApi.validateToken(token)
      
      if (response.success) {
        // Store session
        const session = {
          reviewer: response.reviewer,
          provider: response.provider
        }
        localStorage.setItem(REVIEWER_STORAGE_KEY, JSON.stringify(session))
        localStorage.setItem(REVIEWER_TOKEN_KEY, token)
        
        setReviewer(response.reviewer)
        setProvider(response.provider)
        setIsReviewer(true)
        
        // Fetch stats
        try {
          const { stats: reviewerStats } = await reviewerApi.getSession(response.reviewer.id)
          setStats(reviewerStats)
        } catch {
          // Stats fetch failed, non-critical
        }
        
        return true
      } else {
        setError('Token validation failed')
        return false
      }
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || 'Token validation failed'
      setError(message)
      return false
    } finally {
      setIsValidating(false)
    }
  }, [])

  const refreshStats = useCallback(async () => {
    if (!reviewer?.id) return
    
    try {
      const { stats: reviewerStats } = await reviewerApi.getSession(reviewer.id)
      setStats(reviewerStats)
    } catch (err) {
      console.error('Failed to refresh reviewer stats:', err)
    }
  }, [reviewer?.id])

  const clearReviewerSession = useCallback(() => {
    localStorage.removeItem(REVIEWER_STORAGE_KEY)
    localStorage.removeItem(REVIEWER_TOKEN_KEY)
    setReviewer(null)
    setProvider(null)
    setStats(null)
    setIsReviewer(false)
    setError(null)
  }, [])

  const value: ReviewerContextType = {
    isReviewer,
    isLoading,
    isValidating,
    error,
    reviewer,
    provider,
    stats,
    validateToken,
    refreshStats,
    clearReviewerSession
  }

  return (
    <ReviewerContext.Provider value={value}>
      {children}
    </ReviewerContext.Provider>
  )
}

export function useReviewer() {
  const context = useContext(ReviewerContext)
  if (context === undefined) {
    throw new Error('useReviewer must be used within a ReviewerProvider')
  }
  return context
}

/**
 * Get the stored reviewer token (if any)
 */
export function getStoredReviewerToken(): string | null {
  return localStorage.getItem(REVIEWER_TOKEN_KEY)
}

/**
 * Get the stored reviewer ID (if any)
 */
export function getStoredReviewerId(): string | null {
  const stored = localStorage.getItem(REVIEWER_STORAGE_KEY)
  if (stored) {
    try {
      const session = JSON.parse(stored)
      return session.reviewer?.id || null
    } catch {
      return null
    }
  }
  return null
}
