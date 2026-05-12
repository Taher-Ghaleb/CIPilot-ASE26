import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Clock, ChevronRight, GitBranch, Trash2, Search, X, Edit3 } from 'lucide-react'
import { Button, Input, Spinner, Modal } from '../common'
import { DiffViewer } from '../migration/DiffViewer'
import { ValidationStatus } from '../migration/ValidationStatus'
import { useMigrationHistory } from '../../hooks/useMigrationHistory'
import type { MigrationHistoryItem } from '../../types/migration'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation()
  const { items, loading, searchQuery, setSearchQuery, deleteMigration } = useMigrationHistory()
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [selectedItem, setSelectedItem] = useState<MigrationHistoryItem | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [localSearch, setSearchQuery])

  // Close sidebar on route change (mobile)
  useEffect(() => {
    onClose()
  }, [location.pathname, onClose])

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-50 lg:z-0
          h-screen lg:h-[calc(100vh-4rem)]
          w-80 lg:w-72
          glass border-r border-[var(--border)]
          transform transition-transform duration-300 lg:transform-none
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col
        `}
      >
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">History</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Search */}
        <div className="p-4">
          <Input
            placeholder="Search migrations..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
            rightIcon={
              localSearch && (
                <button onClick={() => setLocalSearch('')}>
                  <X className="w-4 h-4 hover:text-[var(--text-primary)]" />
                </button>
              )
            }
          />
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Recent Migrations
          </h3>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
              <p className="text-sm text-[var(--text-muted)]">
                {searchQuery ? 'No matches found' : 'No migration history yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.slice(0, 10).map((item) => (
                <HistoryItem
                  key={item.id}
                  item={item}
                  onClick={() => setSelectedItem(item)}
                  onDelete={() => setDeleteConfirmId(item.id)}
                />
              ))}
              {items.length > 10 && (
                <Link
                  to="/history"
                  className="flex items-center justify-center gap-2 py-2 text-sm text-primary-500 hover:text-primary-600 transition-colors"
                >
                  View all ({items.length})
                  <ChevronRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* History Detail Modal */}
      {selectedItem && (
        <HistoryDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete Migration"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteConfirmId) {
                  deleteMigration(deleteConfirmId)
                  setDeleteConfirmId(null)
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[var(--text-secondary)]">
          Are you sure you want to delete this migration record? This action cannot be undone.
        </p>
      </Modal>
    </>
  )
}

interface HistoryItemProps {
  item: MigrationHistoryItem
  onClick: () => void
  onDelete: () => void
}

function HistoryItem({ item, onClick, onDelete }: HistoryItemProps) {
  const [showDelete, setShowDelete] = useState(false)

  const formatDate = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(date).toLocaleDateString()
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-400',
    detecting: 'bg-yellow-400',
    converting: 'bg-blue-400',
    validated: 'bg-green-400',
    pr_created: 'bg-purple-400',
    completed: 'bg-green-500',
    error: 'bg-red-400',
  }

  return (
    <div
      className="group relative p-3 rounded-xl bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] transition-all cursor-pointer"
      onClick={onClick}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-2 ${statusColors[item.status] || 'bg-gray-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {item.repository.owner}/{item.repository.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-[var(--text-muted)]">
              {item.sourceServices.join(', ')} → GitHub Actions
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {formatDate(item.updatedAt)}
          </div>
        </div>
      </div>

      {showDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

interface HistoryDetailModalProps {
  item: MigrationHistoryItem
  onClose: () => void
}

function HistoryDetailModal({ item, onClose }: HistoryDetailModalProps) {
  const navigate = useNavigate()

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

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

        {/* Migration Info */}
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
