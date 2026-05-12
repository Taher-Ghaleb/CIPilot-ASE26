/**
 * Reviewer Access Page
 * Validates reviewer token and redirects to the main app
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plane, CheckCircle, XCircle, Loader2, Shield, Star } from 'lucide-react'
import { useReviewer } from '../context/ReviewerContext'

export function ReviewerAccessPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { validateToken, isValidating, error, reviewer, provider } = useReviewer()
  const [validationComplete, setValidationComplete] = useState(false)
  const [validationSuccess, setValidationSuccess] = useState(false)

  useEffect(() => {
    const validate = async () => {
      if (!token) {
        setValidationComplete(true)
        setValidationSuccess(false)
        return
      }

      const success = await validateToken(token)
      setValidationComplete(true)
      setValidationSuccess(success)

      // Redirect to home after successful validation
      if (success) {
        setTimeout(() => {
          navigate('/', { replace: true })
        }, 2000)
      }
    }

    validate()
  }, [token, validateToken, navigate])

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-8 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
            <Plane className="w-7 h-7 text-white" style={{ transform: 'rotate(-45deg)' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">CIPilot</h1>
            <p className="text-sm text-[var(--text-secondary)]">Reviewer Access</p>
          </div>
        </div>

        {/* Content */}
        <div className="text-center">
          {/* Validating */}
          {isValidating && !validationComplete && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin" />
              </div>
              <p className="text-[var(--text-secondary)]">Validating your access token...</p>
            </div>
          )}

          {/* Success */}
          {validationComplete && validationSuccess && reviewer && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
                  Welcome, {reviewer.name}!
                </h2>
                <p className="text-[var(--text-secondary)]">
                  Your reviewer access has been validated.
                </p>
              </div>

              {/* Provider Info */}
              {provider && (
                <div className="mt-4 p-4 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-primary)]">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-2">
                    <Shield className="w-4 h-4" />
                    <span>Pre-configured LLM Provider</span>
                  </div>
                  <div className="text-[var(--text-primary)] font-medium">
                    {provider.name?.toUpperCase()} - {provider.model}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    No proviAPI key configuration needed
                  </p>
                </div>
              )}

              <p className="text-sm text-[var(--text-secondary)] mt-4">
                Redirecting to the app...
              </p>
            </div>
          )}

          {/* Error */}
          {validationComplete && !validationSuccess && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                  <XCircle className="w-10 h-10 text-red-500" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
                  Access Denied
                </h2>
                <p className="text-[var(--text-secondary)]">
                  {error || 'Invalid or expired access token'}
                </p>
              </div>

              {!token && (
                <p className="text-sm text-[var(--text-secondary)]">
                  No access token was provided in the URL.
                </p>
              )}

              <button
                onClick={() => navigate('/')}
                className="mt-4 px-6 py-2 bg-[var(--accent-primary)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
              >
                Go to Home
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-[var(--border-primary)]">
          <div className="flex items-center justify-center gap-1 text-xs text-[var(--text-secondary)]">
            <Star className="w-3 h-3" />
            <span>Academic/Paper Reviewer Access</span>
          </div>
        </div>
      </div>
    </div>
  )
}
