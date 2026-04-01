import crypto from 'node:crypto'

import {
  DATA_BACKEND,
  DISCOVERY_LIVE_POLL_LIMIT,
  DEFAULT_TRACKED_IDS,
  DISCOVERY_CREATOR_EXPANSION_LIMIT,
  DISCOVERY_CREATOR_GAME_LIMIT,
  INGEST_LEASE_TTL_MS,
  INGEST_INTERVAL_MS,
  POSTGRES_URL,
  MAX_FETCH_RETRIES,
  RENDER_SERVICE_TYPE,
  ROBLOX_SECURITY_COOKIES,
  RETRY_BASE_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  SEARCH_DISCOVERY_QUERY_LIMIT,
  SEARCH_DISCOVERY_RESULT_LIMIT,
  TIER_A_POLL_MINUTES,
  TIER_A_POLL_BUDGET,
  TIER_B_POLL_MINUTES,
  TIER_B_POLL_BUDGET,
  TIER_C_POLL_MINUTES,
  TIER_C_POLL_BUDGET,
  TIER_D_POLL_MINUTES,
  TIER_D_POLL_BUDGET,
  TRACKING_FAST_LANE_CCU,
  TRACKING_PRIORITY_CCU,
  TRACKING_WARM_CCU,
  TRACKED_UNIVERSE_CAP,
  UNIVERSE_FETCH_BATCH_CONCURRENCY,
} from './config.mjs'
import { migrateLegacyJsonIfNeeded } from './lib/bootstrap.mjs'
import { createStore } from './lib/store.mjs'

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
const SEARCH_DISCOVERY_SEED_TERMS = [
  'obby',
  'simulator',
  'tycoon',
  'roleplay',
  'anime',
  'horror',
  'survival',
  'battlegrounds',
  'rng',
  'dress up',
  'story',
  'clicker',
  'tower defense',
  'fighting',
  'escape',
]
const SEARCH_DISCOVERY_STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'new',
  'update',
  'official',
  'beta',
  'alpha',
  'game',
  'roblox',
  'roleplay',
  'story',
  'simulator',
  'tycoon',
])

const database = await createStore()
console.log(
  `[roterminal-worker] boot backend=${DATA_BACKEND} renderService=${RENDER_SERVICE_TYPE || 'local'} persistentStore=${POSTGRES_URL ? 'postgres-configured' : 'none'}`,
)
await migrateLegacyJsonIfNeeded(database)
await database.recoverStaleIngestRuns()

const schedulerOwnerId = `worker:${process.pid}:${crypto.randomUUID()}`
let scheduledIngestInFlight = false
let searchDiscoveryCursor = 0

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

function isoNow() {
  return new Date().toISOString()
}

function minutesSince(isoTimestamp, nowMs = Date.now()) {
  if (!isoTimestamp) {
    return Number.POSITIVE_INFINITY
  }

  const parsed = Date.parse(isoTimestamp)
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max((nowMs - parsed) / 60_000, 0)
}

function getTrackingTier(playing) {
  if (playing >= TRACKING_FAST_LANE_CCU) {
    return 'tier_a'
  }
  if (playing >= TRACKING_PRIORITY_CCU) {
    return 'tier_b'
  }
  if (playing >= TRACKING_WARM_CCU) {
    return 'tier_c'
  }
  return 'tier_d'
}

function getPollIntervalMinutesForTier(trackingTier) {
  if (trackingTier === 'tier_a') return TIER_A_POLL_MINUTES
  if (trackingTier === 'tier_b') return TIER_B_POLL_MINUTES
  if (trackingTier === 'tier_c') return TIER_C_POLL_MINUTES
  return TIER_D_POLL_MINUTES
}

function getTierRank(trackingTier) {
  if (trackingTier === 'tier_a') return 0
  if (trackingTier === 'tier_b') return 1
  if (trackingTier === 'tier_c') return 2
  return 3
}

function computePriorityScore({
  playing = 0,
  trackingTier,
  lastDiscoveredAt,
  manuallyPinned = false,
}) {
  const nowMs = Date.now()
  const recencyMinutes = minutesSince(lastDiscoveredAt, nowMs)
  const recencyBoost = Math.max(720 - Math.min(recencyMinutes, 720), 0)
  const tierBoost =
    trackingTier === 'tier_a'
      ? 2_000_000
      : trackingTier === 'tier_b'
        ? 1_000_000
        : trackingTier === 'tier_c'
          ? 250_000
          : 0
  const pinnedBoost = manuallyPinned ? 5_000_000 : 0

  return pinnedBoost + tierBoost + Number(playing || 0) * 10 + recencyBoost
}

function extractSearchTokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) =>
      token.length >= 3 &&
      !/^\d+$/.test(token) &&
      !SEARCH_DISCOVERY_STOPWORDS.has(token),
    )
}

function buildSearchDiscoveryTerms(discoveryGames) {
  const tokenScores = new Map()
  const hotGames = [...discoveryGames]
    .filter((game) => Number(game.playing) >= TRACKING_WARM_CCU)
    .sort((left, right) => Number(right.playing || 0) - Number(left.playing || 0))
    .slice(0, 50)

  for (const game of hotGames) {
    const weight = Math.max(Number(game.playing || 0), 1)
    for (const token of extractSearchTokens(game.name)) {
      tokenScores.set(token, (tokenScores.get(token) ?? 0) + weight)
    }
  }

  const dynamicTerms = [...tokenScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)

  const terms = [...new Set([
    ...SEARCH_DISCOVERY_SEED_TERMS,
    ...dynamicTerms,
  ])]
  const limit = Math.min(SEARCH_DISCOVERY_QUERY_LIMIT, terms.length)

  if (limit === 0) {
    return []
  }

  const selectedTerms = []
  for (let index = 0; index < limit; index += 1) {
    selectedTerms.push(terms[(searchDiscoveryCursor + index) % terms.length])
  }
  searchDiscoveryCursor = (searchDiscoveryCursor + limit) % terms.length

  return selectedTerms
}

async function fetchSearchDiscoveryEntries(discoveryGames) {
  const terms = buildSearchDiscoveryTerms(discoveryGames)

  if (terms.length === 0) {
    return []
  }

  const batches = await mapWithConcurrency(
    terms,
    4,
    async (term) => {
      try {
        const sessionId = crypto.randomUUID()
        const response = await fetchJson(
          `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(term)}&verticalType=game&sessionId=${sessionId}`,
        )

        return (response.searchResults ?? [])
          .flatMap((group) => (Array.isArray(group?.contents) ? group.contents : []))
          .map((entry) => ({
            universeId: Number(entry.universeId),
            rootPlaceId: Number(entry.rootPlaceId) > 0 ? Number(entry.rootPlaceId) : undefined,
            name: entry.name ?? `Universe ${entry.universeId}`,
            creatorName: entry.creatorName ?? 'Unknown creator',
            creatorId: Number(entry.creatorId) > 0 ? Number(entry.creatorId) : 0,
            creatorType: entry.creatorType ?? 'User',
            playerCount: Number(entry.playerCount ?? 0),
            totalUpVotes: Number(entry.totalUpVotes ?? 0),
            totalDownVotes: Number(entry.totalDownVotes ?? 0),
            genre: entry.genre ?? 'Unclassified',
            discoverySource: 'search_sweep',
          }))
          .filter((entry) =>
            Number.isFinite(entry.universeId) &&
            entry.universeId > 0 &&
            entry.playerCount >= TRACKING_WARM_CCU)
          .slice(0, SEARCH_DISCOVERY_RESULT_LIMIT)
      } catch (error) {
        console.warn(`[roterminal-worker] failed search discovery for "${term}"`, error)
        return []
      }
    },
  )

  const entriesByUniverseId = new Map()
  for (const entry of batches.flat()) {
    const current = entriesByUniverseId.get(entry.universeId)
    if (!current || entry.playerCount > current.playerCount) {
      entriesByUniverseId.set(entry.universeId, entry)
    }
  }

  return [...entriesByUniverseId.values()]
}

async function fetchUniverseGames(universeIds, options = {}) {
  const { includeVotes = false } = options

  if (universeIds.length === 0) {
    return []
  }

  if (universeIds.length > PLATFORM_GAME_BATCH_SIZE) {
    const batches = chunkItems(universeIds, PLATFORM_GAME_BATCH_SIZE)
    const responses = await mapWithConcurrency(
      batches,
      UNIVERSE_FETCH_BATCH_CONCURRENCY,
      (batch) => fetchUniverseGames(batch, options),
    )
    return responses.flatMap((entry) => entry)
  }

  const idList = universeIds.join(',')
  let gamesResponse

  try {
    gamesResponse = await fetchJson(`https://games.roblox.com/v1/games?universeIds=${idList}`)
  } catch (error) {
    if (error?.statusCode === 429 && universeIds.length > 1) {
      const midpoint = Math.ceil(universeIds.length / 2)
      const firstHalf = universeIds.slice(0, midpoint)
      const secondHalf = universeIds.slice(midpoint)

      await sleep(RETRY_BASE_DELAY_MS * 2)

      const firstResult = await fetchUniverseGames(firstHalf, options)
      const secondResult = await fetchUniverseGames(secondHalf, options)
      return [...firstResult, ...secondResult]
    }

    throw error
  }
  let votesById = new Map()

  if (includeVotes) {
    const votesResponse = await fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${idList}`)
    votesById = new Map(
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
  }

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

  const payloads = await Promise.allSettled(
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

  const successfulPayloads = payloads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)

  if (successfulPayloads.length === 0) {
    const firstError = payloads.find((result) => result.status === 'rejected')?.reason
    throw firstError instanceof Error ? firstError : new Error('Home recommendation fetch failed')
  }

  const entriesByUniverseId = new Map()

  successfulPayloads.forEach((payload) => {
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

async function fetchCreatorPortfolioUniverseIds(discoveredGames) {
  const candidateGames = [...discoveredGames]
    .filter((game) => Number(game.playing) >= TRACKING_PRIORITY_CCU && Number(game.creatorId) > 0)
    .sort((left, right) => Number(right.playing || 0) - Number(left.playing || 0))
    .slice(0, DISCOVERY_CREATOR_EXPANSION_LIMIT)

  const creatorKeys = [...new Set(
    candidateGames.map((game) => `${game.creatorType ?? 'User'}:${game.creatorId}`),
  )]

  const batches = await mapWithConcurrency(
    creatorKeys,
    6,
    async (creatorKey) => {
      const [creatorType, rawCreatorId] = creatorKey.split(':')
      const creatorId = Number(rawCreatorId)

      if (!Number.isFinite(creatorId) || creatorId <= 0) {
        return []
      }

      const endpoint =
        creatorType === 'Group'
          ? `https://games.roblox.com/v2/groups/${creatorId}/games?accessFilter=Public&limit=${DISCOVERY_CREATOR_GAME_LIMIT}&sortOrder=Desc`
          : `https://games.roblox.com/v2/users/${creatorId}/games?accessFilter=Public&limit=${DISCOVERY_CREATOR_GAME_LIMIT}&sortOrder=Desc`

      try {
        const response = await fetchJson(endpoint)
        return (response.data ?? []).map((entry) => ({
          universeId: Number(entry.id),
          rootPlaceId: Number(entry.rootPlace?.id) > 0 ? Number(entry.rootPlace.id) : undefined,
          name: entry.name ?? `Universe ${entry.id}`,
          creatorId,
          creatorType,
          discoverySource: 'creator_portfolio',
        }))
      } catch (error) {
        console.warn(
          `[roterminal-worker] failed to expand creator portfolio ${creatorKey}`,
          error,
        )
        return []
      }
    },
  )

  return batches.flat()
}

async function fetchUniverseGamesWithFallback(universeIds, discoveryEntries = []) {
  try {
    return await fetchUniverseGames(universeIds)
  } catch (error) {
    if (error?.statusCode !== 429) {
      throw error
    }

    console.warn(
      `[roterminal-worker] falling back to cached snapshot data for ${universeIds.length} universes after Roblox rate limit`,
    )

    return mergeDiscoveredFallbackGames(
      database.getLatestSnapshotGames(universeIds),
      discoveryEntries,
    )
  }
}

function buildTrackedUniverseRecords({
  existingRecords,
  discoveryEntries,
  snapshotGames,
  maxCount,
}) {
  const nowIso = isoNow()
  const existingByUniverseId = new Map(existingRecords.map((record) => [record.universeId, record]))
  const snapshotGamesByUniverseId = new Map(snapshotGames.map((game) => [game.universeId, game]))
  const discoveryByUniverseId = new Map(
    discoveryEntries.map((entry) => [entry.universeId, entry]),
  )
  const allUniverseIds = dedupeUniverseIds(
    existingRecords.map((record) => record.universeId),
    discoveryEntries.map((entry) => entry.universeId),
    snapshotGames.map((game) => game.universeId),
    DEFAULT_TRACKED_IDS,
  )

  const nextRecords = allUniverseIds.map((universeId) => {
    const existing = existingByUniverseId.get(universeId)
    const game = snapshotGamesByUniverseId.get(universeId)
    const discovery = discoveryByUniverseId.get(universeId)
    const playing = Number(game?.playing ?? discovery?.playerCount ?? existing?.lastKnownPlaying ?? 0)
    const trackingTier = getTrackingTier(playing)
    const previousTierRank = existing ? getTierRank(existing.trackingTier) : Number.POSITIVE_INFINITY
    const nextTierRank = getTierRank(trackingTier)
    const lastDiscoveredAt = discovery ? nowIso : (existing?.lastDiscoveredAt ?? nowIso)
    const record = {
      universeId,
      sortOrder: 0,
      trackingTier,
      pollIntervalMinutes: getPollIntervalMinutesForTier(trackingTier),
      priorityScore: 0,
      lastKnownPlaying: playing,
      discoverySource:
        discovery?.discoverySource ??
        (discovery && !existing?.discoverySource ? 'platform_discovery' : existing?.discoverySource) ??
        'manual',
      firstDiscoveredAt: existing?.firstDiscoveredAt ?? nowIso,
      lastDiscoveredAt,
      lastPromotedAt:
        nextTierRank < previousTierRank || (playing >= TRACKING_PRIORITY_CCU && !existing)
          ? nowIso
          : (existing?.lastPromotedAt ?? null),
      lastPolledAt: snapshotGamesByUniverseId.has(universeId)
        ? nowIso
        : (existing?.lastPolledAt ?? null),
      manuallyPinned: existing?.manuallyPinned ?? false,
    }

    record.priorityScore = computePriorityScore(record)
    return record
  })

  const rankedRecords = nextRecords
    .sort((left, right) =>
      Number(right.manuallyPinned) - Number(left.manuallyPinned) ||
      getTierRank(left.trackingTier) - getTierRank(right.trackingTier) ||
      right.priorityScore - left.priorityScore ||
      right.lastKnownPlaying - left.lastKnownPlaying ||
      Date.parse(right.lastDiscoveredAt) - Date.parse(left.lastDiscoveredAt) ||
      left.universeId - right.universeId)
    .slice(0, maxCount)
    .map((record, index) => ({
      ...record,
      sortOrder: index,
    }))

  return rankedRecords
}

function selectDueTrackedUniverseIds(records) {
  const nowMs = Date.now()
  const dueRecords = records
    .filter((record) => minutesSince(record.lastPolledAt, nowMs) >= record.pollIntervalMinutes)
    .sort((left, right) =>
      getTierRank(left.trackingTier) - getTierRank(right.trackingTier) ||
      (left.lastPolledAt ? Date.parse(left.lastPolledAt) : 0) -
        (right.lastPolledAt ? Date.parse(right.lastPolledAt) : 0) ||
      right.priorityScore - left.priorityScore)

  const budgets = {
    tier_a: TIER_A_POLL_BUDGET,
    tier_b: TIER_B_POLL_BUDGET,
    tier_c: TIER_C_POLL_BUDGET,
    tier_d: TIER_D_POLL_BUDGET,
  }
  const selectedIds = []

  for (const record of dueRecords) {
    const tierKey = record.trackingTier in budgets ? record.trackingTier : 'tier_d'
    if (budgets[tierKey] <= 0) {
      continue
    }
    budgets[tierKey] -= 1
    selectedIds.push(record.universeId)
  }

  return selectedIds
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
  const ingestRunId = await database.startIngestRun(trigger)

  try {
    const trackedRecords = await database.getTrackedUniverseRecords()
    const trackedIds =
      trackedRecords.length > 0
        ? trackedRecords.map((record) => record.universeId)
        : DEFAULT_TRACKED_IDS
    const discoveryEntries = await fetchPlatformDiscoveryEntries().catch((error) => {
      console.warn('[roterminal-worker] failed to fetch platform discovery entries', error)
      return []
    })
    const prioritizedDiscoveryEntries = [...discoveryEntries]
      .sort((left, right) => Number(right.playerCount || 0) - Number(left.playerCount || 0))
      .slice(0, DISCOVERY_LIVE_POLL_LIMIT)
    const discoveredUniverseIds = prioritizedDiscoveryEntries.map((entry) => entry.universeId)
    const discoveryGames = mergeDiscoveredFallbackGames(
      await fetchUniverseGamesWithFallback(discoveredUniverseIds, prioritizedDiscoveryEntries),
      prioritizedDiscoveryEntries,
    )
    const searchDiscoveryEntries = await fetchSearchDiscoveryEntries(discoveryGames)
    const searchDiscoveryGames = mergeDiscoveredFallbackGames(discoveryGames, searchDiscoveryEntries)
    const creatorExpansionEntries = await fetchCreatorPortfolioUniverseIds(searchDiscoveryGames)
    const allDiscoveryEntries = [
      ...discoveryEntries.map((entry) => ({
        ...entry,
        discoverySource: 'platform_discovery',
      })),
      ...searchDiscoveryEntries,
      ...creatorExpansionEntries,
    ]
    const dueTrackedUniverseIds = selectDueTrackedUniverseIds(trackedRecords)
    const snapshotUniverseIds = dedupeUniverseIds(
      trackedIds.length > 0 ? dueTrackedUniverseIds : trackedIds,
      discoveredUniverseIds,
      searchDiscoveryEntries.map((entry) => entry.universeId),
      creatorExpansionEntries.map((entry) => entry.universeId),
      DEFAULT_TRACKED_IDS,
    )
    const snapshotGames = mergeDiscoveredFallbackGames(
      await fetchUniverseGamesWithFallback(snapshotUniverseIds, allDiscoveryEntries),
      allDiscoveryEntries,
    )
    const nextTrackedRecords = buildTrackedUniverseRecords({
      existingRecords: trackedRecords.length > 0
        ? trackedRecords
        : trackedIds.map((universeId, index) => ({
            universeId,
            sortOrder: index,
            trackingTier: 'tier_d',
            pollIntervalMinutes: TIER_D_POLL_MINUTES,
            priorityScore: 0,
            lastKnownPlaying: 0,
            discoverySource: 'seed',
            firstDiscoveredAt: isoNow(),
            lastDiscoveredAt: isoNow(),
            lastPromotedAt: null,
            lastPolledAt: null,
            manuallyPinned: false,
          })),
      discoveryEntries: [
        ...discoveryEntries.map((entry) => ({
          ...entry,
          discoverySource: 'platform_discovery',
        })),
        ...searchDiscoveryEntries,
        ...creatorExpansionEntries,
      ],
      snapshotGames,
      maxCount: TRACKED_UNIVERSE_CAP,
    })
    await database.replaceTrackedUniverseRecords(nextTrackedRecords)
    const observedAt = new Date().toISOString()

    await database.recordSnapshots(snapshotGames, {
      observedAt,
      source: 'worker_live',
    })

    await database.finishIngestRun(ingestRunId, {
      status: 'success',
      source: 'worker_live',
      trackedUniverseCount: nextTrackedRecords.length,
      discoveredUniverseCount:
        discoveryEntries.length + searchDiscoveryEntries.length + creatorExpansionEntries.length,
    })

    console.log(
      `[roterminal-worker] ingested ${snapshotGames.length} universes (${discoveryEntries.length} discoveries seen, ${discoveredUniverseIds.length} discovery polls, ${searchDiscoveryEntries.length} search discoveries, ${creatorExpansionEntries.length} creator expansions, ${dueTrackedUniverseIds.length} due tracked polls, ${nextTrackedRecords.length} tracked total)`,
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown ingestion failure'

    await database.finishIngestRun(ingestRunId, {
      status: 'failed',
      source: 'worker_live',
      trackedUniverseCount: (await database.getTrackedUniverseIds()).length,
      errorMessage,
    })

    console.error('[roterminal-worker] polling failed', error)
  }
}

async function runScheduledIngest(trigger = 'worker_schedule') {
  if (scheduledIngestInFlight) {
    return
  }

  const acquired = await database.tryAcquireIngestLease('scheduler', schedulerOwnerId, {
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
