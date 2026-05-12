import { useState, useEffect } from 'react'
import { Search, GitBranch } from 'lucide-react'
import { Button, Input, Card } from '../common'
import type { Repository } from '../../types/api'

interface RepoInputProps {
  onSubmit: (repo: Repository) => void
  isLoading: boolean
  error?: string
  initialRepo?: { owner: string; name: string }
}

export function RepoInput({ onSubmit, isLoading, error, initialRepo }: RepoInputProps) {
  const [repoUrl, setRepoUrl] = useState('')

  // Set initial repo URL when loaded from history
  useEffect(() => {
    if (initialRepo) {
      setRepoUrl(`${initialRepo.owner}/${initialRepo.name}`)
    } else {
      // Clear the input when initialRepo is cleared (e.g., Start New Migration)
      setRepoUrl('')
    }
  }, [initialRepo])
  const [parseError, setParseError] = useState<string | null>(null)

  const parseRepoUrl = (url: string): Repository | null => {
    // Clean the input
    const cleaned = url.trim()

    // Match various GitHub URL formats
    const patterns = [
      // Full URLs: https://github.com/owner/repo
      /^https?:\/\/github\.com\/([^\/]+)\/([^\/\s#?]+)/,
      // Short format: owner/repo
      /^([^\/\s]+)\/([^\/\s#?]+)$/,
      // SSH format: git@github.com:owner/repo.git
      /^git@github\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/,
    ]

    for (const pattern of patterns) {
      const match = cleaned.match(pattern)
      if (match) {
        return {
          owner: match[1],
          name: match[2].replace(/\.git$/, ''),
          branch: 'main', // Default branch, can be detected later
        }
      }
    }

    return null
  }

  const handleSubmit = () => {
    setParseError(null)
    const repo = parseRepoUrl(repoUrl)

    if (!repo) {
      setParseError('Invalid repository URL. Use format: owner/repo or https://github.com/owner/repo')
      return
    }

    onSubmit(repo)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && repoUrl && !isLoading) {
      handleSubmit()
    }
  }

  const displayError = parseError || error

  return (
    <Card variant="glass" padding="lg" className="relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary-500/20 to-transparent rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />

      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center">
            <GitBranch className="w-5 h-5 text-primary-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Repository Configuration
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Enter your repository URL to start the migration
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Repository URL
            </label>
            <div className="flex gap-3">
              <div className="flex-1" data-tour="repo-input">
                <Input
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value)
                    setParseError(null)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="https://github.com/owner/repo or owner/repo"
                  leftIcon={<Search className="w-4 h-4" />}
                  error={displayError}
                  disabled={isLoading}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleSubmit}
                isLoading={isLoading}
                disabled={!repoUrl || isLoading}
                className="whitespace-nowrap"
                data-tour="detect-button"
              >
                {isLoading ? 'Detecting...' : 'Detect CI/CD'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Enter a public repository URL or connect your GitHub account for private repos
          </p>

          {/* Quick examples */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-[var(--text-muted)]">Try:</span>
            {[
              'nazhoscse/machine'
            ].map((example) => (
              <button
                key={example}
                onClick={() => setRepoUrl(example)}
                className="text-xs text-primary-500 hover:text-primary-600 hover:underline"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
