import { useState, useEffect, useCallback } from 'react'
import { migrationStore } from '../store/indexedDB'
import type { MigrationHistoryItem } from '../types/migration'

// Global refresh trigger for cross-component updates
let refreshListeners: (() => void)[] = []

export function triggerHistoryRefresh() {
  refreshListeners.forEach(listener => listener())
}

export function useMigrationHistory() {
  const [items, setItems] = useState<MigrationHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [refreshCounter, setRefreshCounter] = useState(0)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      if (searchQuery) {
        const result = await migrationStore.search(searchQuery, page)
        setItems(result.items)
        setTotal(result.total)
        setHasMore(result.hasMore)
      } else {
        const result = await migrationStore.getPaginated(page)
        setItems(result.items)
        setTotal(result.total)
        setHasMore(result.hasMore)
      }
    } catch (error) {
      console.error('Failed to load history:', error)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, page, refreshCounter])

  // Register for global refresh events
  useEffect(() => {
    const listener = () => setRefreshCounter(c => c + 1)
    refreshListeners.push(listener)
    return () => {
      refreshListeners = refreshListeners.filter(l => l !== listener)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Reset page when search query changes
  useEffect(() => {
    setPage(1)
  }, [searchQuery])

  const saveMigration = useCallback(
    async (item: Omit<MigrationHistoryItem, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = await migrationStore.create(item)
      await loadHistory()
      return id
    },
    [loadHistory]
  )

  const updateMigration = useCallback(
    async (id: string, updates: Partial<MigrationHistoryItem>) => {
      await migrationStore.update(id, updates)
      await loadHistory()
    },
    [loadHistory]
  )

  const deleteMigration = useCallback(
    async (id: string) => {
      await migrationStore.delete(id)
      await loadHistory()
    },
    [loadHistory]
  )

  const loadMore = useCallback(() => {
    if (hasMore) {
      setPage((p) => p + 1)
    }
  }, [hasMore])

  return {
    items,
    loading,
    total,
    hasMore,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    loadMore,
    saveMigration,
    updateMigration,
    deleteMigration,
    refresh: loadHistory,
  }
}
