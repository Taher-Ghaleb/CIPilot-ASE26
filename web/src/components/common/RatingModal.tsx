import { useState } from 'react'
import { Star, Send, X } from 'lucide-react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { ratingApi } from '../../api/rating'
import { useToast } from '../../context/ToastContext'

interface RatingModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmitted?: () => void
}

export function RatingModal({ isOpen, onClose, onSubmitted }: RatingModalProps) {
  const [score, setScore] = useState(0)
  const [hoveredScore, setHoveredScore] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const toast = useToast()

  const handleSubmit = async () => {
    if (score === 0) {
      toast.warning('Please select a rating', 'Click on the stars to rate CIPilot')
      return
    }

    setIsSubmitting(true)
    try {
      await ratingApi.submit(score, feedback || undefined)
      setHasSubmitted(true)
      toast.success('Thank you!', 'Your feedback helps us improve CIPilot')
      onSubmitted?.()
      
      // Close modal after brief delay
      setTimeout(() => {
        onClose()
        // Reset state for next time
        setScore(0)
        setFeedback('')
        setHasSubmitted(false)
      }, 1500)
    } catch (error) {
      toast.error('Submission failed', 'Please try again later')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    onClose()
    // Reset state
    setScore(0)
    setFeedback('')
    setHasSubmitted(false)
  }

  const displayScore = hoveredScore || score

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={hasSubmitted ? '🎉 Thank You!' : '⭐ Rate CIPilot'}
      description={
        hasSubmitted
          ? 'Your feedback has been submitted successfully.'
          : 'How would you rate your experience with CIPilot?'
      }
      size="sm"
    >
      {hasSubmitted ? (
        <div className="text-center py-4">
          <div className="text-4xl mb-2">🙏</div>
          <p className="text-[var(--text-secondary)]">
            Your feedback helps us improve!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Star Rating */}
          <div className="flex justify-center gap-2 py-4">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className="transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] rounded"
                onMouseEnter={() => setHoveredScore(value)}
                onMouseLeave={() => setHoveredScore(0)}
                onClick={() => setScore(value)}
                aria-label={`Rate ${value} star${value > 1 ? 's' : ''}`}
              >
                <Star
                  className={`w-10 h-10 transition-colors ${
                    value <= displayScore
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-[var(--border-primary)] hover:text-yellow-300'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Score label */}
          <div className="text-center text-sm text-[var(--text-secondary)]">
            {displayScore === 0 && 'Click to rate'}
            {displayScore === 1 && 'Poor'}
            {displayScore === 2 && 'Fair'}
            {displayScore === 3 && 'Good'}
            {displayScore === 4 && 'Very Good'}
            {displayScore === 5 && 'Excellent!'}
          </div>

          {/* Feedback textarea */}
          <div>
            <label
              htmlFor="rating-feedback"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              Feedback (optional)
            </label>
            <textarea
              id="rating-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell us what you liked or how we can improve..."
              className="w-full h-24 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-none"
              maxLength={500}
            />
            <div className="text-right text-xs text-[var(--text-secondary)] mt-1">
              {feedback.length}/500
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              className="flex-1"
            >
              <X className="w-4 h-4 mr-2" />
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={score === 0}
              className="flex-1"
            >
              <Send className="w-4 h-4 mr-2" />
              Submit
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
