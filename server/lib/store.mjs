import { DATA_BACKEND } from '../config.mjs'

export async function createStore() {
  switch (DATA_BACKEND) {
    case 'memory': {
      const { createMemoryStore } = await import('./memory-store.mjs')
      return createMemoryStore()
    }
    case 'postgres': {
      const { createPostgresStore } = await import('./postgres-store.mjs')
      return createPostgresStore()
    }
    case 'sqlite': {
      const { createDatabase } = await import('./database.mjs')
      return createDatabase()
    }
    default:
      throw new Error(`Unsupported data backend: ${DATA_BACKEND}`)
  }
}
