import {
  DATA_BACKEND,
  IS_RENDER,
  POSTGRES_URL,
  REQUIRE_PERSISTENT_STORE,
  RENDER_SERVICE_TYPE,
} from '../config.mjs'

export async function createStore() {
  if (REQUIRE_PERSISTENT_STORE && DATA_BACKEND !== 'postgres') {
    const renderHint = IS_RENDER
      ? ` Render service type: ${RENDER_SERVICE_TYPE || 'unknown'}.`
      : ''
    const postgresHint = POSTGRES_URL
      ? ''
      : ' DATABASE_URL/ROTERMINAL_POSTGRES_URL is missing.'
    throw new Error(
      `Persistent production storage is required, but DATA_BACKEND resolved to "${DATA_BACKEND}" instead of "postgres".${postgresHint}${renderHint}`,
    )
  }

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
