import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import type { APIError } from '../types/api'
import { getAnalyticsHeaders } from '../utils/analytics'

// Get base URL from environment or use default
const getBaseUrl = (): string => {
  // In development, use Vite proxy (requests to /api are proxied to backend)
  if (import.meta.env.DEV) {
    return '/api'
  }
  // In production, use environment variable or default
  return import.meta.env.VITE_API_URL || 'http://localhost:5200'
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: getBaseUrl(),
  timeout: 300000, // 5 minutes for LLM calls (increased for large files)
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add analytics headers
apiClient.interceptors.request.use(
  (config) => {
    // Add anonymous analytics headers (no credentials!)
    const analyticsHeaders = getAnalyticsHeaders()
    Object.entries(analyticsHeaders).forEach(([key, value]) => {
      config.headers.set(key, value)
    })
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<APIError>) => {
    // Transform error to consistent format
    const apiError: APIError = {
      detail: error.response?.data?.detail || error.message || 'An unknown error occurred',
      status: error.response?.status,
    }

    // Handle specific error codes
    if (error.response?.status === 500) {
      // Check if it's a model-related error
      const detail = error.response?.data?.detail || ''
      if (detail.toLowerCase().includes('model') || detail.toLowerCase().includes('api') || detail.toLowerCase().includes('key')) {
        apiError.detail = `LLM Configuration Error: ${detail}. Please check your model and API key settings.`
      } else {
        apiError.detail = `Server Error: ${detail || 'The request failed. This may be due to invalid LLM settings. Please check your model configuration in Settings.'}`
      }
    } else if (error.response?.status === 429) {
      apiError.detail = 'Rate limit exceeded. Please wait a moment and try again.'
    } else if (error.response?.status === 401 || error.response?.status === 403) {
      apiError.detail = 'Authentication failed. Please check your API key in Settings.'
    } else if (error.response?.status === 503) {
      apiError.detail = 'Service unavailable. The backend server may be down.'
    } else if (error.code === 'ECONNABORTED') {
      apiError.detail = 'Request timed out. The conversion may be taking longer than expected.'
    } else if (!error.response) {
      apiError.detail = 'Network error. Please check your connection and ensure the backend is running.'
    }

    return Promise.reject(apiError)
  }
)

// Helper function for making requests with custom config
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.request<T>(config)
  return response.data
}
