import { useState, useEffect } from 'react'
import { Star } from 'lucide-react'
import { ratingApi, type RatingStats } from '../../api/rating'

interface RatingDisplayProps {
  onRateClick?: () => void
  showRateButton?: boolean
  compact?: boolean
  refreshKey?: number // Increment this to trigger a refresh
}

export function RatingDisplay({ onRateClick, showRateButton = true, compact = false, refreshKey = 0 }: RatingDisplayProps) {
  const [stats, setStats] = useState<RatingStats | null>(null)
  const [hasRated, setHasRated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, userRating] = await Promise.all([
          ratingApi.getStats(),
          ratingApi.checkUserRating(),
        ])
        setStats(statsData)
        setHasRated(userRating.has_rated)
      } catch {
        // Silently fail - rating display is non-critical
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [refreshKey]) // Re-fetch when refreshKey changes

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        <div className="animate-pulse flex gap-1">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-4 h-4 text-[var(--border-primary)]" />
          ))}
        </div>
      </div>
    )
  }

  const renderStars = () => {
    const average = stats?.average || 0
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = value <= Math.round(average)
          return (
            <Star
              key={value}
              className={`w-4 h-4 ${
                filled
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'text-[var(--border-primary)]'
              }`}
            />
          )
        })}
      </div>
    )
  }

  if (compact) {
    return (
      <button
        onClick={onRateClick}
        className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title={`${stats?.average || 0} out of 5 stars (${stats?.total_votes || 0} ratings)`}
      >
        {renderStars()}
        <span className="font-medium">{stats?.average || 0}</span>
        <span className="text-xs">({stats?.total_votes || 0})</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Stars and rating */}
      <div className="flex items-center gap-2">
        {renderStars()}
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {stats?.average || 0}
        </span>
        <span className="text-sm text-[var(--text-secondary)]">
          ({stats?.total_votes || 0} {stats?.total_votes === 1 ? 'rating' : 'ratings'})
        </span>
      </div>

      {/* Rate button */}
      {showRateButton && (
        <button
          onClick={onRateClick}
          className="text-sm text-[var(--accent-primary)] hover:text-[var(--accent-hover)] hover:underline transition-colors"
        >
          {hasRated ? 'Update your rating' : 'Rate CIPilot'}
        </button>
      )}
    </div>
  )
}