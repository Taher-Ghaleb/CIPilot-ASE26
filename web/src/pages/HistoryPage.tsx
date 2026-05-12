import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Clock, GitBranch, Trash2, ExternalLink, ChevronLeft, ChevronRight, Edit3 } from 'lucide-react'
import { Button, Input, Card, Spinner, Chip, Modal } from '../components/common'
import { DiffViewer } from '../components/migration/DiffViewer'
import { ValidationStatus } from '../components/migration/ValidationStatus'
import { ExportImportPanel } from '../components/settings'
import { useMigrationHistory } from '../hooks/useMigrationHistory'
import type { MigrationHistoryItem, MigrationStatus } from '../types/migration'

const STATUS_LABELS: Record<MigrationStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  detecting: { label: 'Detecting', variant: 'info' },
  converting: { label: 'Converting', variant: 'info' },
  validated: { label: 'Validated', variant: 'success' },
  pr_created: { label: 'PR Created', variant: 'success' },
  completed: { label: 'Completed', variant: 'success' },
  error: { label: 'Error', variant: 'danger' },
}

export function HistoryPage() {
  const {
    items,
    loading,
    total,
    hasMore,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    deleteMigration,
  } = useMigrationHistory()

  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [selectedItem, setSelectedItem] = useState<MigrationHistoryItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearch)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [localSearch, setSearchQuery, setPage])

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleDelete = async (id: string) => {
    await deleteMigration(id)
    setDeleteConfirm(null)
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Migration History</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {total} migration{total !== 1 ? 's' : ''} recorded
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <Card variant="glass" padding="md">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search by repository, owner, or CI service..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
        </div>
      </Card>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <Card variant="glass" padding="lg" className="text-center">
          <Clock className="w-12 h-12 mx-auto text-[var(--text-muted)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
            {searchQuery ? 'No Results Found' : 'No Migration History'}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {searchQuery
              ? 'Try a different search term'
              : 'Start by migrating a repository on the home page'}
          </p>
        </Card>
      ) : (
        <>
          {/* History List */}
          <div className="space-y-3">
            {items.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                onView={() => setSelectedItem(item)}
                onDelete={() => setDeleteConfirm(item.id)}
                formatDate={formatDate}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                leftIcon={<ChevronLeft className="w-4 h-4" />}
              >
                Previous
              </Button>
              <span className="px-4 text-sm text-[var(--text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={!hasMore}
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* Export/Import Panel */}
      <ExportImportPanel />

      {/* Detail Modal */}
      {selectedItem && (
        <HistoryDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          formatDate={formatDate}
        />
      )}

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Migration"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[var(--text-secondary)]">
          Are you sure you want to delete this migration record? This action cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

interface HistoryCardProps {
  item: MigrationHistoryItem
  onView: () => void
  onDelete: () => void
  formatDate: (date: Date) => string
}

function HistoryCard({ item, onView, onDelete, formatDate }: HistoryCardProps) {
  const status = STATUS_LABELS[item.status] || STATUS_LABELS.draft

  return (
    <Card variant="glass" padding="md" hover className="group" onClick={onView}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <GitBranch className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="font-medium text-[var(--text-primary)] truncate">
              {item.repository.owner}/{item.repository.name}
            </span>
            <Chip variant={status.variant} size="sm">
              {status.label}
            </Chip>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>{item.sourceServices.join(', ')}</span>
            <span className="text-[var(--text-muted)]">→</span>
            <span>GitHub Actions</span>
            <span className="text-[var(--text-muted)]">•</span>
            <span>{formatDate(item.updatedAt)}</span>
          </div>

          {item.prUrl && (
            <a
              href={item.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 mt-2 text-sm text-primary-500 hover:text-primary-600"
            >
              <ExternalLink className="w-3 h-3" />
              View PR
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>
    </Card>
  )
}

interface HistoryDetailModalProps {
  item: MigrationHistoryItem
  onClose: () => void
  formatDate: (date: Date) => string
}

function HistoryDetailModal({ item, onClose, formatDate }: HistoryDetailModalProps) {
  const navigate = useNavigate()

  // Convert originalConfigs to the format expected by DiffViewer
  const originalFiles = Object.entries(item.originalConfigs).map(([service, content]) => ({
    name: getConfigFileName(service),
    content,
    service,
  }))

  const handleContinueEditing = () => {
    // Store the history item in sessionStorage for the home page to pick up
    sessionStorage.setItem('cigrate-edit-migration', JSON.stringify(item))
    onClose()
    navigate('/')
  }

  return (
    <Modal isOpen onClose={onClose} title="Migration Details" size="full">
      <div className="space-y-6">
        {/* Header with action button */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {item.repository.owner}/{item.repository.name}
          </h3>
          <Button onClick={handleContinueEditing}>
            <Edit3 className="w-4 h-4 mr-2" />
            Continue Editing
          </Button>
        </div>

        {/* Meta info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">Repository</span>
            <p className="font-medium">{item.repository.owner}/{item.repository.name}</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Source Services</span>
            <p className="font-medium">{item.sourceServices.join(', ')}</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">LLM Provider</span>
            <p className="font-medium">{item.llmProvider} ({item.llmModel})</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Attempts</span>
            <p className="font-medium">{item.attempts} (+ {item.manualRetries} retries)</p>
          </div>
        </div>

        {/* Validation Status */}
        {item.validation && (
          <ValidationStatus validation={item.validation} attempts={item.attempts} />
        )}

        {/* Side-by-side comparison */}
        <DiffViewer
          originalFiles={originalFiles}
          convertedYaml={item.convertedConfig}
          onYamlChange={() => {}} // Read-only in history view
          readOnly
        />

        {/* Timestamps */}
        <div className="flex gap-6 text-xs text-[var(--text-muted)]">
          <span>Created: {formatDate(item.createdAt)}</span>
          <span>Updated: {formatDate(item.updatedAt)}</span>
        </div>
      </div>
    </Modal>
  )
}

function getConfigFileName(service: string): string {
  // Handle "ServiceName:filename.yml" format
  if (service.includes(':')) {
    return service.split(':')[1]
  }
  
  // Handle plain service names
  const names: Record<string, string> = {
    'Travis CI': '.travis.yml',
    CircleCI: 'config.yml',
    'GitLab CI': '.gitlab-ci.yml',
    'GitHub Actions': 'ci.yml',
    'Azure Pipelines': 'azure-pipelines.yml',
    AppVeyor: 'appveyor.yml',
    Jenkins: 'Jenkinsfile',
  }
  return names[service] || 'config.yml'
}
