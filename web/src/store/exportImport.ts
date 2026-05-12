import { migrationStore } from './indexedDB'
import type { MigrationHistoryItem } from '../types/migration'

export interface ExportData {
  version: string
  exportedAt: string
  itemCount: number
  migrations: MigrationHistoryItem[]
}

export const exportImport = {
  async exportToJSON(): Promise<string> {
    const migrations = await migrationStore.exportAll()

    const exportData: ExportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      itemCount: migrations.length,
      migrations,
    }

    return JSON.stringify(exportData, null, 2)
  },

  async downloadExport(filename?: string): Promise<void> {
    const json = await this.exportToJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename || `cigrate-export-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  async importFromJSON(
    jsonString: string,
    options: { merge?: boolean } = {}
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const { merge = true } = options
    const errors: string[] = []
    let imported = 0
    let skipped = 0

    try {
      const data = JSON.parse(jsonString) as ExportData

      // Validate structure
      if (!data.migrations || !Array.isArray(data.migrations)) {
        throw new Error('Invalid export file format: missing migrations array')
      }

      if (!merge) {
        // Clear existing data if not merging
        await migrationStore.deleteAll()
      }

      // Import each migration
      for (const migration of data.migrations) {
        try {
          // Validate required fields
          if (!migration.id || !migration.repository) {
            errors.push(`Skipped migration: missing required fields`)
            skipped++
            continue
          }

          // Convert date strings to Date objects
          const processedMigration: MigrationHistoryItem = {
            ...migration,
            createdAt: new Date(migration.createdAt),
            updatedAt: new Date(migration.updatedAt),
          }

          // Check if exists when merging
          if (merge) {
            const existing = await migrationStore.getById(migration.id)
            if (existing) {
              // Update if imported is newer
              if (new Date(migration.updatedAt) > new Date(existing.updatedAt)) {
                await migrationStore.update(migration.id, processedMigration)
                imported++
              } else {
                skipped++
              }
              continue
            }
          }

          // Insert new
          await migrationStore.importAll([processedMigration])
          imported++
        } catch (itemError) {
          errors.push(`Error importing migration ${migration.id}: ${itemError}`)
          skipped++
        }
      }

      return { imported, skipped, errors }
    } catch (error) {
      throw new Error(`Failed to parse import file: ${error}`)
    }
  },

  async importFromFile(file: File, options?: { merge?: boolean }): Promise<{
    imported: number
    skipped: number
    errors: string[]
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string
          const result = await this.importFromJSON(content, options)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }

      reader.onerror = () => {
        reject(new Error('Failed to read file'))
      }

      reader.readAsText(file)
    })
  },
}
