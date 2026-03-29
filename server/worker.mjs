import crypto from 'node:crypto'

import {
  DEFAULT_TRACKED_IDS,
  INGEST_LEASE_TTL_MS,
  INGEST_INTERVAL_MS,
  MAX_FETCH_RETRIES,
  ROBLOX_SECURITY_COOKIES,
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
const ROBLOX_AUTH_COOKIE_HEADERS = [...new Set(
  ROBLOX_SECURITY_COOKIES.map((cookieValue) =>
    cookieValue.includes('.ROBLOSECURITY=')
      ? cookieValue
      : `.ROBLOSECURITY=${cookieValue}`,
  ),
)]

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

function buildRobloxAuthHeaders(cookieHeader, headers = {}) {
  if (!cookieHeader) {
    return headers
  }

  return {
    ...headers,
    cookie: cookieHeader,
  }
}

async function fetchJson(url, retries = MAX_FETCH_RETRIES, init = undefined) {
  let attempt = 0
  let lastError = null

  while (attempt <= retries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

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

function extractHomeRecommendationEntries(node, entriesByUniverseId = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((item) => {
      extractHomeRecommendationEntries(item, entriesByUniverseId)
    })
    return entriesByUniverseId
  }

  if (!node || typeof node !== 'object') {
    return entriesByUniverseId
  }

  const candidateUniverseId = Number(node.universeId ?? node.contentId)
  const contentType = typeof node.contentType === 'string' ? node.contentType.toLowerCase() : null
  const isGameContent = contentType === 'game' || Number.isFinite(candidateUniverseId)

  if (isGameContent && Number.isFinite(candidateUniverseId) && candidateUniverseId > 0) {
    const current = entriesByUniverseId.get(candidateUniverseId) ?? {}
    const next = {
      universeId: candidateUniverseId,
      rootPlaceId: Number(node.rootPlaceId) > 0 ? Number(node.rootPlaceId) : current.rootPlaceId,
      name:
        (typeof node.name === 'string' && node.name.trim().length > 0
          ? node.name.trim()
          : typeof node.title === 'string' && node.title.trim().length > 0
            ? node.title.trim()
            : current.name) ?? `Universe ${candidateUniverseId}`,
      playerCount:
        Number(node.playerCount ?? node.playing) >= 0
          ? Number(node.playerCount ?? node.playing)
          : (current.playerCount ?? 0),
      totalUpVotes:
        Number(node.totalUpVotes ?? node.upVotes) >= 0
          ? Number(node.totalUpVotes ?? node.upVotes)
          : (current.totalUpVotes ?? 0),
      totalDownVotes:
        Number(node.totalDownVotes ?? node.downVotes) >= 0
          ? Number(node.totalDownVotes ?? node.downVotes)
          : (current.totalDownVotes ?? 0),
      creatorName:
        (typeof node.creatorName === 'string' && node.creatorName.trim().length > 0
          ? node.creatorName.trim()
          : current.creatorName) ?? 'Unknown creator',
      creatorId:
        Number(node.creatorId) > 0 ? Number(node.creatorId) : (current.creatorId ?? 0),
      creatorType:
        (typeof node.creatorType === 'string' && node.creatorType.length > 0
          ? node.creatorType
          : current.creatorType) ?? 'User',
      genre:
        (typeof node.genre === 'string' && node.genre.length > 0
          ? node.genre
          : typeof node.contentMaturity === 'string' && node.contentMaturity.length > 0
            ? `Maturity: ${node.contentMaturity}`
            : current.genre) ?? 'Unclassified',
    }

    entriesByUniverseId.set(candidateUniverseId, next)
  }

  Object.values(node).forEach((value) => {
    extractHomeRecommendationEntries(value, entriesByUniverseId)
  })

  return entriesByUniverseId
}

async function fetchHomeRecommendationEntries() {
  if (ROBLOX_AUTH_COOKIE_HEADERS.length === 0) {
    return []
  }

  const payloads = await Promise.all(
    ROBLOX_AUTH_COOKIE_HEADERS.map((cookieHeader) =>
      fetchJson(
        'https://apis.roblox.com/discovery-api/omni-recommendation',
        MAX_FETCH_RETRIES,
        {
          method: 'POST',
          headers: buildRobloxAuthHeaders(cookieHeader, {
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            pageType: 'Home',
            sessionId: crypto.randomUUID(),
          }),
        },
      ),
    ),
  )

  const entriesByUniverseId = new Map()

  payloads.forEach((payload) => {
    ;(payload.sorts ?? []).forEach((sort) => {
      extractHomeRecommendationEntries(sort, entriesByUniverseId)
    })
  })

  return [...entriesByUniverseId.values()]
}

async function fetchPlatformDiscoveryEntries() {
  const [sortPayloads, homeRecommendationEntries] = await Promise.all([
    Promise.all(
      PLATFORM_SORT_IDS.map(async (sortId) => ({
        sortId,
        payload: await fetchDiscoverSort(sortId),
      })),
    ),
    fetchHomeRecommendationEntries().catch((error) => {
      console.warn(
        '[roterminal-worker] failed to fetch authenticated Roblox Home recommendations',
        error,
      )
      return []
    }),
  ])

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

  for (const entry of homeRecommendationEntries) {
    if (!discoveredByUniverseId.has(entry.universeId)) {
      discoveredByUniverseId.set(entry.universeId, entry)
    }
  }

  return [...discoveredByUniverseId.values()]
}

function mergeDiscoveredFallbackGames(fetchedGames, discoveryEntries) {
  const gamesByUniverseId = new Map(fetchedGames.map((game) => [game.universeId, game]))
  const fallbackTimestamp = new Date().toISOString()

  discoveryEntries.forEach((entry) => {
    if (gamesByUniverseId.has(entry.universeId)) {
      return
    }

    const approval =
      (entry.totalUpVotes ?? 0) + (entry.totalDownVotes ?? 0) > 0
        ? ((entry.totalUpVotes ?? 0) / ((entry.totalUpVotes ?? 0) + (entry.totalDownVotes ?? 0))) * 100
        : 0

    gamesByUniverseId.set(entry.universeId, {
      universeId: entry.universeId,
      rootPlaceId: entry.rootPlaceId,
      name: entry.name ?? `Universe ${entry.universeId}`,
      description: '',
      creatorName: entry.creatorName ?? 'Unknown creator',
      creatorId: entry.creatorId ?? 0,
      creatorType: entry.creatorType ?? 'User',
      creatorHasVerifiedBadge: false,
      genre: entry.genre ?? 'Unclassified',
      genrePrimary: entry.genre ?? 'Unclassified',
      genreSecondary: null,
      playing: entry.playerCount ?? 0,
      visits: 0,
      favoritedCount: 0,
      upVotes: entry.totalUpVotes ?? 0,
      downVotes: entry.totalDownVotes ?? 0,
      approval,
      price: null,
      maxPlayers: null,
      created: fallbackTimestamp,
      updated: fallbackTimestamp,
      createVipServersAllowed: false,
    })
  })

  return [...gamesByUniverseId.values()]
}

async function pollTrackedUniverses(trigger = 'worker') {
  const ingestRunId = database.startIngestRun(trigger)

  try {
    const trackedUniverseIds = database.getTrackedUniverseIds()
    const trackedIds = trackedUniverseIds.length > 0 ? trackedUniverseIds : DEFAULT_TRACKED_IDS
    const discoveredEntries = await fetchPlatformDiscoveryEntries()
    const discoveredUniverseIds = discoveredEntries.map((entry) => entry.universeId)
    database.appendTrackedUniverseIds(discoveredUniverseIds, TRACKED_UNIVERSE_CAP)
    const snapshotUniverseIds = dedupeUniverseIds(trackedIds, discoveredUniverseIds)
    const snapshotGames = mergeDiscoveredFallbackGames(
      await fetchUniverseGames(snapshotUniverseIds),
      discoveredEntries,
    )
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
