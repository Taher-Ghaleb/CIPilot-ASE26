import { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, Brain } from 'lucide-react'
import { Modal, Button } from '../common'

interface RetryDialogProps {
  isOpen: boolean
  onClose: () => void
  onRetry: (feedback: string) => void
  yamlError?: string
  actionlintOutput?: string
  doubleCheckReasons?: string[]
  isLoading?: boolean
}

/**
 * Build the default feedback message based on validation errors
 * Matches the Chrome extension format
 */
function buildDefaultFeedback(yamlError?: string, actionlintOutput?: string, doubleCheckReasons?: string[]): string {
  const parts: string[] = []

  if (yamlError) {
    parts.push(
      'Please fix below yaml schema validation and linting errors of the GitHub Action Workflow, so it can pass the validation check.\n\n' +
      'YAML Syntax Error:\n' +
      yamlError
    )
  }

  if (actionlintOutput) {
    // Check if it's just info-level warnings (not real errors)
    const isInfoOnly = actionlintOutput.includes('[Note: Only INFO-level')

    if (!isInfoOnly) {
      parts.push(
        'Please fix below linting errors of the GitHub Action Workflow, so it can pass the linting validation check.\n\n' +
        'Linting Errors:\n' +
        actionlintOutput
      )
    }
  }

  if (doubleCheckReasons && doubleCheckReasons.length > 0) {
    parts.push(
      'Please fix below semantic issues identified by the Double Check AI verification:\n\n' +
      'Semantic Issues:\n' +
      doubleCheckReasons.map(r => `- ${r}`).join('\n')
    )
  }

  return parts.join('\n\n---\n\n')
}

export function RetryDialog({
  isOpen,
  onClose,
  onRetry,
  yamlError,
  actionlintOutput,
  doubleCheckReasons,
  isLoading = false,
}: RetryDialogProps) {
  const [feedback, setFeedback] = useState('')

  // Pre-fill with formatted validation errors
  useEffect(() => {
    if (isOpen) {
      const defaultFeedback = buildDefaultFeedback(yamlError, actionlintOutput, doubleCheckReasons)
      if (defaultFeedback) {
        setFeedback(defaultFeedback)
      } else {
        setFeedback('')
      }
    }
  }, [isOpen, yamlError, actionlintOutput, doubleCheckReasons])

  const hasValidationErrors = !!(yamlError || actionlintOutput)
  const hasDoubleCheckIssues = !!(doubleCheckReasons && doubleCheckReasons.length > 0)

  const handleSubmit = () => {
    if (feedback.trim()) {
      onRetry(feedback)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Retry Conversion"
      description="Provide feedback to help improve the generated workflow"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isLoading}
            disabled={!feedback.trim()}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Retry Conversion
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hasValidationErrors && (
          <div className="flex gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Validation Issues Detected
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {yamlError && actionlintOutput
                  ? 'YAML syntax errors and linting issues found.'
                  : yamlError
                    ? 'YAML syntax errors found in the workflow.'
                    : 'Linting issues found in the workflow.'}
                {' '}The feedback below has been pre-filled to help the AI fix them.
              </p>
            </div>
          </div>
        )}

        {hasDoubleCheckIssues && !hasValidationErrors && (
          <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <Brain className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Semantic Issues Detected
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                The AI Double Check found potential semantic issues with the migration.
                {' '}The feedback below has been pre-filled to help address them.
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Feedback / Instructions
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what needs to be fixed or changed..."
            rows={8}
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-glass)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-none font-mono text-sm"
          />
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Be specific about what needs to change. The AI will use this feedback along with the
            original configuration to generate an improved workflow.
          </p>
        </div>
      </div>
    </Modal>
  )
}
