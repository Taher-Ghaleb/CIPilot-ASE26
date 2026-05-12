import { Download, Upload, Trash2 } from 'lucide-react'
import { Button, Card, CardTitle, CardContent } from '../common'
import { useExportImport } from '../../hooks/useExportImport'
import { useToast } from '../../context/ToastContext'
import { migrationStore } from '../../store/indexedDB'

export function ExportImportPanel() {
  const { handleExport, triggerFileInput, isExporting, isImporting } = useExportImport()
  const toast = useToast()

  const handleClearAll = async () => {
    if (
      window.confirm(
        'Are you sure you want to delete all migration history? This cannot be undone.'
      )
    ) {
      try {
        await migrationStore.deleteAll()
        toast.success('History cleared', 'All migration history has been deleted.')
        window.location.reload() // Refresh to update UI
      } catch (error) {
        toast.error('Failed to clear history', error instanceof Error ? error.message : 'Unknown error')
      }
    }
  }

  return (
    <Card variant="glass" padding="lg">
      <CardTitle>Data Management</CardTitle>
      <CardContent className="mt-4 space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Export your migration history to a JSON file for backup, or import history from a
          previous export.
        </p>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={handleExport}
            isLoading={isExporting}
            leftIcon={<Download className="w-4 h-4" />}
          >
            Export History
          </Button>

          <Button
            variant="secondary"
            onClick={() => triggerFileInput(true)}
            isLoading={isImporting}
            leftIcon={<Upload className="w-4 h-4" />}
          >
            Import & Merge
          </Button>

          <Button
            variant="secondary"
            onClick={() => triggerFileInput(false)}
            isLoading={isImporting}
            leftIcon={<Upload className="w-4 h-4" />}
          >
            Import & Replace
          </Button>
        </div>

        <div className="border-t border-[var(--border)] pt-4 mt-4">
          <p className="text-sm text-[var(--text-muted)] mb-3">Danger Zone</p>
          <Button
            variant="danger"
            onClick={handleClearAll}
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            Clear All History
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
