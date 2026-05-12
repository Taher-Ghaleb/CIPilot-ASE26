import { useState, useCallback } from 'react'
import { exportImport } from '../store/exportImport'
import { useToast } from '../context/ToastContext'

export function useExportImport() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const toast = useToast()

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      await exportImport.downloadExport()
      toast.success('Export successful', 'Your migration history has been downloaded.')
    } catch (error) {
      toast.error('Export failed', error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsExporting(false)
    }
  }, [toast])

  const handleImport = useCallback(
    async (file: File, merge = true) => {
      setIsImporting(true)
      try {
        const result = await exportImport.importFromFile(file, { merge })

        if (result.errors.length > 0) {
          console.warn('Import errors:', result.errors)
        }

        toast.success(
          'Import successful',
          `Imported ${result.imported} migrations${result.skipped > 0 ? `, ${result.skipped} skipped` : ''}`
        )

        return result
      } catch (error) {
        toast.error('Import failed', error instanceof Error ? error.message : 'Unknown error')
        throw error
      } finally {
        setIsImporting(false)
      }
    },
    [toast]
  )

  const triggerFileInput = useCallback((merge = true) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        await handleImport(file, merge)
      }
    }
    input.click()
  }, [handleImport])

  return {
    isExporting,
    isImporting,
    handleExport,
    handleImport,
    triggerFileInput,
  }
}
