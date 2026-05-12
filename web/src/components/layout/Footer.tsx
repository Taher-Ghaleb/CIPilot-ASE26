import { useState } from 'react'
import { Heart, Github, ExternalLink, Plane } from 'lucide-react'
import { Link } from 'react-router-dom'
import { RatingDisplay, RatingModal } from '../common'

export function Footer() {
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false)
  const [ratingRefreshKey, setRatingRefreshKey] = useState(0)

  const handleRatingSubmitted = () => {
    // Increment refresh key to trigger RatingDisplay to re-fetch stats
    setRatingRefreshKey(prev => prev + 1)
  }

  return (
    <>
      <footer className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex">
          {/* Sidebar spacer - hidden on mobile, matches sidebar width on desktop */}
          <div className="hidden lg:block w-72 flex-shrink-0" />
          
          {/* Main footer content */}
          <div className="flex-1 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4">
                {/* Left: Logo & copyright */}
                <div className="flex items-center gap-3">
                  <Link to="/" className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
                      <Plane className="w-4 h-4 text-white" style={{ transform: 'rotate(-45deg)' }} />
                    </div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      CIPilot
                    </span>
                  </Link>
                  <span className="text-sm text-[var(--text-secondary)]">
                    © {new Date().getFullYear()}
                  </span>
                  <span className="hidden sm:flex items-center gap-1 text-sm text-[var(--text-secondary)]">
                    · Made with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" /> for DevOps
                  </span>
                </div>

                {/* Center: Rating */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text-secondary)]">Rate us:</span>
                  <RatingDisplay
                    compact
                    refreshKey={ratingRefreshKey}
                    onRateClick={() => setIsRatingModalOpen(true)}
                  />
                </div>

                {/* Right: Links */}
                <div className="flex items-center gap-4 text-sm">
                  <a
                    href="https://github.com/nazhoscse/cipilot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Github className="w-4 h-4" />
                    <span className="hidden sm:inline">GitHub</span>
                  </a>
                  <a
                    href="https://github.com/nazhoscse/cipilot/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span className="hidden sm:inline">Report Issue</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>

      <RatingModal
        isOpen={isRatingModalOpen}
        onClose={() => setIsRatingModalOpen(false)}
        onSubmitted={handleRatingSubmitted}
      />
    </>
  )
}
