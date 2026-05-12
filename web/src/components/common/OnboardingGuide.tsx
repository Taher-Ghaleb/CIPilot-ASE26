import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'

interface OnboardingStep {
  title: string
  description: string
  targetSelector: string // CSS selector to highlight
  position: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  // Fallback description when target element doesn't exist
  fallbackDescription?: string
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: 'Enter Repository URL',
    description: 'Start by entering a GitHub repository URL here. You can use formats like "owner/repo" or the full URL.',
    targetSelector: '[data-tour="repo-input"]',
    position: 'bottom',
    align: 'start',
  },
  {
    title: 'Detect CI/CD Services',
    description: 'Click this button to scan the repository and automatically detect existing CI/CD configurations like CircleCI, Travis CI, GitLab CI, and more.',
    targetSelector: '[data-tour="detect-button"]',
    position: 'bottom',
    align: 'end',
  },
  {
    title: 'Select Source Service',
    description: 'After detection, the detected CI services will appear here. Select the one you want to migrate from. CIPilot supports 15+ platforms.',
    targetSelector: '[data-tour="service-chips"]',
    position: 'bottom',
    align: 'start',
    fallbackDescription: 'After clicking "Detect CI/CD", the detected services (like CircleCI, Travis CI, etc.) will appear here as selectable chips. Choose the one you want to migrate from.',
  },
  {
    title: 'Configure AI Provider',
    description: 'Before migrating, open Settings and add your API key for Anthropic, OpenAI, Groq, or another LLM provider.',
    targetSelector: '[data-tour="settings-button"]',
    position: 'bottom',
    align: 'end',
  },
  {
    title: 'Start Migration',
    description: 'Once you\'ve selected a service and configured your AI provider, the Migrate button will appear here. Click it to convert your CI/CD configuration to GitHub Actions.',
    targetSelector: '[data-tour="migrate-button"]',
    position: 'left',
    align: 'center',
    fallbackDescription: 'After detecting services and selecting one, the "Migrate" button will appear. Click it to convert your CI/CD configuration to GitHub Actions using AI.',
  },
  {
    title: 'You\'re All Set!',
    description: 'After migration, you can review the generated workflow, make edits, validate it, and even create a Pull Request directly. Enjoy using CIPilot!',
    targetSelector: '[data-tour="repo-input"]',
    position: 'bottom',
    align: 'center',
  },
]

interface OnboardingGuideProps {
  isOpen: boolean
  onComplete: () => void
  onSkip: () => void
  startStep?: number // Allow starting at a specific step
}

export function OnboardingGuide({ isOpen, onComplete, onSkip, startStep = 0 }: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState(startStep)
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({})
  const [highlightStyle, setHighlightStyle] = useState<React.CSSProperties>({})
  const [targetExists, setTargetExists] = useState(true)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const step = ONBOARDING_STEPS[currentStep]
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1

  // Position the tooltip relative to the target element
  const positionTooltip = useCallback(() => {
    if (!step) return

    const target = document.querySelector(step.targetSelector)
    const tooltip = tooltipRef.current

    // If target not found, show centered tooltip
    if (!target || !tooltip) {
      setTargetExists(false)
      setTooltipStyle({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      })
      setArrowStyle({ display: 'none' })
      setHighlightStyle({ display: 'none' })
      return
    }

    setTargetExists(true)
    const targetRect = target.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const padding = 12
    const arrowSize = 8

    let top = 0
    let left = 0
    let arrowTop = 0
    let arrowLeft = 0

    // Calculate position based on step.position
    switch (step.position) {
      case 'bottom':
        top = targetRect.bottom + padding + arrowSize
        break
      case 'top':
        top = targetRect.top - tooltipRect.height - padding - arrowSize
        break
      case 'left':
        left = targetRect.left - tooltipRect.width - padding - arrowSize
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2
        break
      case 'right':
        left = targetRect.right + padding + arrowSize
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2
        break
    }

    // Handle horizontal alignment for top/bottom positions
    if (step.position === 'top' || step.position === 'bottom') {
      switch (step.align) {
        case 'start':
          left = targetRect.left
          arrowLeft = Math.min(40, targetRect.width / 2)
          break
        case 'end':
          left = targetRect.right - tooltipRect.width
          arrowLeft = tooltipRect.width - Math.min(40, targetRect.width / 2)
          break
        case 'center':
        default:
          left = targetRect.left + (targetRect.width - tooltipRect.width) / 2
          arrowLeft = tooltipRect.width / 2
          break
      }
    }

    // Handle vertical alignment for left/right positions
    if (step.position === 'left' || step.position === 'right') {
      arrowTop = tooltipRect.height / 2
    }

    // Ensure tooltip stays within viewport
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    if (left < padding) left = padding
    if (left + tooltipRect.width > viewportWidth - padding) {
      left = viewportWidth - tooltipRect.width - padding
    }
    if (top < padding) top = padding
    if (top + tooltipRect.height > viewportHeight - padding) {
      top = viewportHeight - tooltipRect.height - padding
    }

    // Arrow positioning
    const arrowStyles: React.CSSProperties = {
      position: 'absolute',
    }

    switch (step.position) {
      case 'bottom':
        arrowStyles.top = -arrowSize
        arrowStyles.left = arrowLeft - arrowSize
        arrowStyles.borderLeft = `${arrowSize}px solid transparent`
        arrowStyles.borderRight = `${arrowSize}px solid transparent`
        arrowStyles.borderBottom = `${arrowSize}px solid #2563eb`
        break
      case 'top':
        arrowStyles.bottom = -arrowSize
        arrowStyles.left = arrowLeft - arrowSize
        arrowStyles.borderLeft = `${arrowSize}px solid transparent`
        arrowStyles.borderRight = `${arrowSize}px solid transparent`
        arrowStyles.borderTop = `${arrowSize}px solid #2563eb`
        break
      case 'left':
        arrowStyles.right = -arrowSize
        arrowStyles.top = arrowTop - arrowSize
        arrowStyles.borderTop = `${arrowSize}px solid transparent`
        arrowStyles.borderBottom = `${arrowSize}px solid transparent`
        arrowStyles.borderLeft = `${arrowSize}px solid #2563eb`
        break
      case 'right':
        arrowStyles.left = -arrowSize
        arrowStyles.top = arrowTop - arrowSize
        arrowStyles.borderTop = `${arrowSize}px solid transparent`
        arrowStyles.borderBottom = `${arrowSize}px solid transparent`
        arrowStyles.borderRight = `${arrowSize}px solid #2563eb`
        break
    }

    setTooltipStyle({
      position: 'fixed',
      top,
      left,
    })
    setArrowStyle(arrowStyles)

    // Highlight the target element
    setHighlightStyle({
      position: 'fixed',
      top: targetRect.top - 4,
      left: targetRect.left - 4,
      width: targetRect.width + 8,
      height: targetRect.height + 8,
      borderRadius: '8px',
      boxShadow: '0 0 0 4000px rgba(0, 0, 0, 0.5)',
      pointerEvents: 'none',
    })
  }, [step])

  // Reposition on step change or window resize
  useEffect(() => {
    if (!isOpen) return

    // Initial position after a short delay to ensure DOM is ready
    const timer = setTimeout(positionTooltip, 100)

    window.addEventListener('resize', positionTooltip)
    window.addEventListener('scroll', positionTooltip)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', positionTooltip)
      window.removeEventListener('scroll', positionTooltip)
    }
  }, [isOpen, currentStep, positionTooltip])

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete()
    } else {
      setCurrentStep((prev) => prev + 1)
    }
  }, [isLastStep, onComplete])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onSkip()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext()
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        setCurrentStep((prev) => prev - 1)
      }
    },
    [isOpen, handleNext, currentStep, onSkip]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Reset step when opening (use startStep if provided)
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(startStep)
    }
  }, [isOpen, startStep])

  if (!isOpen) return null

  // Use fallback description if target doesn't exist
  const displayDescription = !targetExists && step.fallbackDescription 
    ? step.fallbackDescription 
    : step.description

  return (
    <>
      {/* Backdrop with highlight cutout */}
      <div className="fixed inset-0 z-[100] pointer-events-none">
        <div style={highlightStyle} />
      </div>

      {/* Dark overlay when target doesn't exist */}
      {!targetExists && (
        <div className="fixed inset-0 z-[99] bg-black/50" onClick={onSkip} />
      )}

      {/* Click blocker (allows clicking only on highlighted area) */}
      {targetExists && (
        <div 
          className="fixed inset-0 z-[99]" 
          onClick={onSkip}
          style={{ background: 'transparent' }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[101] w-80 bg-blue-600 text-white rounded-lg shadow-2xl"
        style={tooltipStyle}
      >
        {/* Arrow - only show when target exists */}
        {targetExists && <div style={arrowStyle} />}

        {/* Close button */}
        <button
          onClick={onSkip}
          className="absolute top-3 right-3 p-1 rounded-full hover:bg-blue-500 transition-colors"
          title="Skip tour"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="p-4">
          {/* Show "Coming up..." badge when element doesn't exist yet */}
          {!targetExists && step.fallbackDescription && (
            <span className="inline-block px-2 py-0.5 bg-blue-500 text-xs rounded mb-2">
              Preview
            </span>
          )}
          
          <h3 className="font-semibold text-lg mb-2 pr-6">{step.title}</h3>
          <p className="text-blue-100 text-sm leading-relaxed mb-4">{displayDescription}</p>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <span className="text-blue-200 text-sm">
              {currentStep + 1} of {ONBOARDING_STEPS.length}
            </span>
            <button
              onClick={handleNext}
              className="px-4 py-1.5 bg-white text-blue-600 rounded-md font-medium text-sm hover:bg-blue-50 transition-colors"
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
