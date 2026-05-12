import Dexie, { type Table } from 'dexie'
import type { MigrationHistoryItem } from '../types/migration'

class MigrationDatabase extends Dexie {
  migrations!: Table<MigrationHistoryItem, string>

  constructor() {
    super('cigrate-db')

    this.version(1).stores({
      migrations:
        'id, createdAt, updatedAt, [repository.owner+repository.name], status, *sourceServices',
    })
  }
}

export const db = new MigrationDatabase()

export const migrationStore = {
  async getAll(): Promise<MigrationHistoryItem[]> {
    return db.migrations.orderBy('updatedAt').reverse().toArray()
  },

  async search(
    query: string,
    page = 1,
    limit = 20
  ): Promise<{
    items: MigrationHistoryItem[]
    total: number
    hasMore: boolean
  }> {
    const lowerQuery = query.toLowerCase()
    const offset = (page - 1) * limit

    const allMatching = await db.migrations
      .filter(
        (m) =>
          m.repository.name.toLowerCase().includes(lowerQuery) ||
          m.repository.owner.toLowerCase().includes(lowerQuery) ||
          m.sourceServices.some((s) => s.toLowerCase().includes(lowerQuery))
      )
      .toArray()

    const sorted = allMatching.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return {
      items: sorted.slice(offset, offset + limit),
      total: sorted.length,
      hasMore: sorted.length > offset + limit,
    }
  },

  async getPaginated(
    page = 1,
    limit = 20
  ): Promise<{
    items: MigrationHistoryItem[]
    total: number
    hasMore: boolean
  }> {
    const offset = (page - 1) * limit
    const total = await db.migrations.count()
    const items = await db.migrations
      .orderBy('updatedAt')
      .reverse()
      .offset(offset)
      .limit(limit)
      .toArray()

    return {
      items,
      total,
      hasMore: total > offset + limit,
    }
  },

  async getById(id: string): Promise<MigrationHistoryItem | undefined> {
    return db.migrations.get(id)
  },

  async create(
    item: Omit<MigrationHistoryItem, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date()
    await db.migrations.add({
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    })
    return id
  },

  async update(id: string, updates: Partial<MigrationHistoryItem>): Promise<void> {
    await db.migrations.update(id, {
      ...updates,
      updatedAt: new Date(),
    })
  },

  async delete(id: string): Promise<void> {
    await db.migrations.delete(id)
  },

  async deleteAll(): Promise<void> {
    await db.migrations.clear()
  },

  async exportAll(): Promise<MigrationHistoryItem[]> {
    return db.migrations.toArray()
  },

  async importAll(items: MigrationHistoryItem[]): Promise<number> {
    // Use bulkPut to handle both inserts and updates
    await db.migrations.bulkPut(items)
    return items.length
  },

  async getStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    byProvider: Record<string, number>
  }> {
    const all = await db.migrations.toArray()

    const byStatus: Record<string, number> = {}
    const byProvider: Record<string, number> = {}

    for (const item of all) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
      byProvider[item.llmProvider] = (byProvider[item.llmProvider] || 0) + 1
    }

    return {
      total: all.length,
      byStatus,
      byProvider,
    }
  },
}
