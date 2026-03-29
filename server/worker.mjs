import crypto from 'node:crypto'

import {
  DEFAULT_TRACKED_IDS,
  INGEST_LEASE_TTL_MS,
  INGEST_INTERVAL_MS,
  MAX_FETCH_RETRIES,
  RETRY_BASE_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  TRACKED_UNIVERSE_CAP,
  UNIVERSE_FETCH_BATCH_CONCURRENCY,
} from './config.mjs'
import { migrateLegacyJsonIfNeeded } from './lib/bootstrap.mjs'
import { createDatabase } from './lib/database.mjs'

const PLATFORM_SORT_IDS = [
  'top-playing-now',
  'top-trending',
  'up-and-coming',
  'top-revisited',
]
const PLATFORM_GAME_BATCH_SIZE = 50

const database = await createDatabase()
await migrateLegacyJsonIfNeeded(database)
database.recoverStaleIngestRuns()

const schedulerOwnerId = `worker:${process.pid}:${crypto.randomUUID()}`
let scheduledIngestInFlight = false

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchJson(url, retries = MAX_FETCH_RETRIES) {
  let attempt = 0
  let lastError = null

  while (attempt <= retries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, { signal: controller.signal })

      if (!response.ok) {
        const body = await response.text()
        const error = new Error(`Request failed ${response.status}: ${body}`)
        error.statusCode = response.status
        throw error
      }

      return await response.json()
    } catch (error) {
      lastError = error
      const statusCode = error?.statusCode
      const isRetryable =
        statusCode === 429 ||
        error?.name === 'AbortError' ||
        error?.cause?.code === 'ECONNRESET' ||
        error?.cause?.code === 'ETIMEDOUT'

      if (!isRetryable || attempt === retries) {
        throw error
      }

      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
      attempt += 1
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw lastError ?? new Error('Unknown fetch failure')
}

function chunkItems(items, size) {
  const chunks = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

function mergeSnapshotGames(...gameSets) {
  const gamesByUniverseId = new Map()

  for (const gameSet of gameSets) {
    for (const game of gameSet) {
      if (!game?.universeId) {
        continue
      }

      gamesByUniverseId.set(game.universeId, game)
    }
  }

  return [...gamesByUniverseId.values()]
}

function dedupeUniverseIds(...universeIdSets) {
  return [...new Set(universeIdSets.flatMap((items) => items ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
}

async function fetchUniverseGames(universeIds) {
  if (universeIds.length === 0) {
    return []
  }

  if (universeIds.length > PLATFORM_GAME_BATCH_SIZE) {
    const batches = chunkItems(universeIds, PLATFORM_GAME_BATCH_SIZE)
    const responses = await mapWithConcurrency(
      batches,
      UNIVERSE_FETCH_BATCH_CONCURRENCY,
      (batch) => fetchUniverseGames(batch),
    )
    return responses.flatMap((entry) => entry)
  }

  const idList = universeIds.join(',')
  const [gamesResponse, votesResponse] = await Promise.all([
    fetchJson(`https://games.roblox.com/v1/games?universeIds=${idList}`),
    fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${idList}`),
  ])

  const votesById = new Map(
    votesResponse.data.map((entry) => [
      entry.id,
      {
        upVotes: entry.upVotes,
        downVotes: entry.downVotes,
        approval:
          entry.upVotes + entry.downVotes === 0
            ? 0
            : (entry.upVotes / (entry.upVotes + entry.downVotes)) * 100,
      },
    ]),
  )

  return gamesResponse.data.map((game) => ({
    universeId: game.id,
    rootPlaceId: game.rootPlaceId,
    name: game.name,
    description: game.description ?? '',
    creatorName: game.creator.name,
    creatorId: game.creator.id,
    creatorType: game.creator.type,
    creatorHasVerifiedBadge: Boolean(game.creator.hasVerifiedBadge),
    genre: game.genre_l1 || game.genre || 'Unclassified',
    genrePrimary: game.genre_l1 || game.genre || 'Unclassified',
    genreSecondary: game.genre_l2 || null,
    playing: game.playing,
    visits: game.visits,
    favoritedCount: game.favoritedCount,
    upVotes: votesById.get(game.id)?.upVotes ?? 0,
    downVotes: votesById.get(game.id)?.downVotes ?? 0,
    approval: votesById.get(game.id)?.approval ?? 0,
    price: game.price,
    maxPlayers: game.maxPlayers,
    created: game.created,
    updated: game.updated,
    createVipServersAllowed: Boolean(game.createVipServersAllowed),
  }))
}

async function fetchDiscoverSort(sortId) {
  const sessionId = crypto.randomUUID()
  return fetchJson(
    `https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}`,
  )
}

async function fetchPlatformDiscoveryUniverseIds() {
  const sortPayloads = await Promise.all(
    PLATFORM_SORT_IDS.map(async (sortId) => ({
      sortId,
      payload: await fetchDiscoverSort(sortId),
    })),
  )

  const discoveredByUniverseId = new Map()

  for (const { payload } of sortPayloads) {
    for (const game of payload.games ?? []) {
      const current = discoveredByUniverseId.get(game.universeId)

      if (!current || game.playerCount > current.playerCount) {
        discoveredByUniverseId.set(game.universeId, {
          universeId: game.universeId,
          playerCount: game.playerCount,
        })
      }
    }
  }

  return [...discoveredByUniverseId.keys()]
}

async function pollTrackedUniverses(trigger = 'worker') {
  const ingestRunId = database.startIngestRun(trigger)

  try {
    const trackedUniverseIds = database.getTrackedUniverseIds()
    const trackedIds = trackedUniverseIds.length > 0 ? trackedUniverseIds : DEFAULT_TRACKED_IDS
    const discoveredUniverseIds = await fetchPlatformDiscoveryUniverseIds()
    database.appendTrackedUniverseIds(discoveredUniverseIds, TRACKED_UNIVERSE_CAP)
    const snapshotUniverseIds = dedupeUniverseIds(trackedIds, discoveredUniverseIds)
    const snapshotGames = await fetchUniverseGames(snapshotUniverseIds)
    const observedAt = new Date().toISOString()

    database.recordSnapshots(snapshotGames, {
      observedAt,
      source: 'worker_live',
    })

    database.finishIngestRun(ingestRunId, {
      status: 'success',
      source: 'worker_live',
      trackedUniverseCount: trackedIds.length,
      discoveredUniverseCount: discoveredUniverseIds.length,
    })

    console.log(
      `[roterminal-worker] ingested ${snapshotGames.length} total universes (${trackedIds.length} tracked, ${discoveredUniverseIds.length} discovered)`,
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown ingestion failure'

    database.finishIngestRun(ingestRunId, {
      status: 'failed',
      source: 'worker_live',
      trackedUniverseCount: database.getTrackedUniverseIds().length,
      errorMessage,
    })

    console.error('[roterminal-worker] polling failed', error)
  }
}

async function runScheduledIngest(trigger = 'worker_schedule') {
  if (scheduledIngestInFlight) {
    return
  }

  const acquired = database.tryAcquireIngestLease('scheduler', schedulerOwnerId, {
    ownerLabel: 'worker',
    ttlMs: INGEST_LEASE_TTL_MS,
  })

  if (!acquired) {
    return
  }

  scheduledIngestInFlight = true

  try {
    await pollTrackedUniverses(trigger)
  } finally {
    scheduledIngestInFlight = false
  }
}

await runScheduledIngest('worker_boot')
setInterval(() => {
  void runScheduledIngest('worker_schedule')
}, INGEST_INTERVAL_MS)

console.log(
  `[roterminal-worker] running with ${Math.round(INGEST_INTERVAL_MS / 60_000)} minute cadence`,
)
