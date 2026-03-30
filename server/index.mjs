import { createServer } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  BOARD_CACHE_TTL_MS,
  DB_PATH,
  DEFAULT_TRACKED_IDS,
  DIST_DIR,
  GAME_SUPPLEMENTAL_CACHE_TTL_MS,
  GAMES_CACHE_TTL_MS,
  INGEST_LEASE_TTL_MS,
  INGEST_INTERVAL_MS,
  INGEST_STALE_AFTER_MS,
  IMPORT_TOKEN,
  MAX_FETCH_RETRIES,
  ONE_DAY_MS,
  ONE_HOUR_MS,
  PLATFORM_CACHE_TTL_MS,
  PORT,
  ROBLOX_SECURITY_COOKIES,
  REQUEST_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
  SEARCH_CACHE_TTL_MS,
  SERVER_ENABLE_SCHEDULED_INGEST,
  SNAPSHOT_RETENTION_MS,
  TRACKED_UNIVERSE_CAP,
  UNIVERSE_FETCH_BATCH_CONCURRENCY,
} from './config.mjs'
import { migrateLegacyJsonIfNeeded } from './lib/bootstrap.mjs'
import { createDatabase } from './lib/database.mjs'

const SIX_HOURS_MS = 6 * ONE_HOUR_MS
const THIRTY_MINUTES_MS = 30 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS
const CHART_RANGE_MS = {
  '30m': THIRTY_MINUTES_MS,
  '1h': ONE_HOUR_MS,
  '6h': SIX_HOURS_MS,
  '24h': ONE_DAY_MS,
  '7d': ONE_WEEK_MS,
  '30d': THIRTY_DAYS_MS,
}
const GAME_ICON_CACHE_TTL_MS = 5 * 60 * 1000

const LIVE_DISCOVERY_CACHE_TTL_MS = Math.min(PLATFORM_CACHE_TTL_MS, 5_000)

function getPlatformStatsCacheTtlMs(range) {
  switch (range) {
    case '30m':
    case '1h':
    case '24h':
      return Math.min(PLATFORM_CACHE_TTL_MS, 5_000)
    case '6h':
      return Math.min(PLATFORM_CACHE_TTL_MS, 10_000)
    case '7d':
      return Math.min(PLATFORM_CACHE_TTL_MS, 20_000)
    case '30d':
      return Math.min(PLATFORM_CACHE_TTL_MS, 30_000)
    default:
      return Math.min(PLATFORM_CACHE_TTL_MS, 15_000)
  }
}

function getBoardPayloadCacheTtlMs(range) {
  switch (range) {
    case '30m':
    case '1h':
    case '24h':
      return Math.min(BOARD_CACHE_TTL_MS, 5_000)
    case '6h':
      return Math.min(BOARD_CACHE_TTL_MS, 10_000)
    case '7d':
      return Math.min(BOARD_CACHE_TTL_MS, 20_000)
    case '30d':
      return Math.min(BOARD_CACHE_TTL_MS, 30_000)
    default:
      return Math.min(BOARD_CACHE_TTL_MS, 15_000)
  }
}

function getGamePagePayloadCacheTtlMs(range, detailLevel = 'full') {
  const baseTtlMs = getBoardPayloadCacheTtlMs(range)

  if (detailLevel === 'core') {
    return Math.min(baseTtlMs, 5_000)
  }

  return Math.min(baseTtlMs, 15_000)
}
const OFFICIAL_PLATFORM_SCALE = {
  value: '45M',
  dateLabel: 'Jan 13, 2026',
}
const FULL_PLATFORM_STATS_URL = 'https://portal-api.bloxbiz.com/games/platform_stats'
const PLATFORM_SORT_IDS = [
  'top-playing-now',
  'top-trending',
  'up-and-coming',
  'top-revisited',
]
const PLATFORM_GAME_BATCH_SIZE = 50
const SCREENER_RESULT_LIMIT = 15
const SCREENER_SEARCH_LIMIT = 24
const GAME_PAGE_SERVER_SAMPLE_MAX_PAGES = 10
const GAME_PAGE_SERVER_SAMPLE_LIMIT = 100
const GAME_PAGE_CREATOR_PORTFOLIO_LIMIT = 8
const GAME_PAGE_COMPARABLE_LIMIT = 8
const SCREENER_STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'best',
  'by',
  'cool',
  'experience',
  'experiences',
  'find',
  'for',
  'freshly',
  'game',
  'games',
  'in',
  'me',
  'of',
  'show',
  'that',
  'the',
  'these',
  'those',
  'to',
  'with',
  'updated',
])
const SCREENER_GENRE_ALIASES = {
  roleplay: ['roleplay', 'rp', 'town', 'city'],
  simulator: ['simulator', 'simulation', 'pet'],
  obby: ['obby', 'parkour'],
  action: ['action', 'combat', 'battle', 'fighting', 'shooter'],
  anime: ['anime'],
  horror: ['horror', 'scary'],
  sports: ['sports', 'soccer', 'football', 'basketball'],
  tycoon: ['tycoon'],
  fashion: ['fashion', 'dress'],
  adventure: ['adventure', 'rpg'],
  survival: ['survival'],
}

const searchCache = new Map()
const gamesCache = new Map()
const platformCache = new Map()
const platformStatsCache = new Map()
const boardCache = new Map()
const gamePageCache = new Map()
const gameSupplementalCache = new Map()
const gameIconRedirectCache = new Map()
let lastBoardUniverseIds = []
const ROBLOX_AUTH_COOKIE_HEADERS = [...new Set(
  ROBLOX_SECURITY_COOKIES.map((cookieValue) =>
    cookieValue.includes('.ROBLOSECURITY=')
      ? cookieValue
      : `.ROBLOSECURITY=${cookieValue}`,
  ),
)]

const GENRE_BENCHMARKS = {
  simulator: {
    dauMultiplier: 6.5,
    mauMultiplier: 4.2,
    sessionsPerUser: 1.35,
    rpvLow: 0.5,
    rpvMid: 0.9,
    rpvHigh: 1.5,
    itemCountAverage: 14,
    gamePassPriceAverage: 220,
  },
  tycoon: {
    dauMultiplier: 6.2,
    mauMultiplier: 4,
    sessionsPerUser: 1.3,
    rpvLow: 0.5,
    rpvMid: 0.85,
    rpvHigh: 1.4,
    itemCountAverage: 12,
    gamePassPriceAverage: 200,
  },
  rpg: {
    dauMultiplier: 5.8,
    mauMultiplier: 4,
    sessionsPerUser: 1.25,
    rpvLow: 0.4,
    rpvMid: 0.7,
    rpvHigh: 1,
    itemCountAverage: 9,
    gamePassPriceAverage: 180,
  },
  roleplay: {
    dauMultiplier: 5.2,
    mauMultiplier: 4.6,
    sessionsPerUser: 1.15,
    rpvLow: 0.1,
    rpvMid: 0.22,
    rpvHigh: 0.35,
    itemCountAverage: 4,
    gamePassPriceAverage: 110,
  },
  social: {
    dauMultiplier: 5,
    mauMultiplier: 4.8,
    sessionsPerUser: 1.1,
    rpvLow: 0.1,
    rpvMid: 0.2,
    rpvHigh: 0.3,
    itemCountAverage: 3,
    gamePassPriceAverage: 90,
  },
  obby: {
    dauMultiplier: 8.5,
    mauMultiplier: 4.8,
    sessionsPerUser: 1.45,
    rpvLow: 0.05,
    rpvMid: 0.12,
    rpvHigh: 0.2,
    itemCountAverage: 3,
    gamePassPriceAverage: 80,
  },
  horror: {
    dauMultiplier: 7.2,
    mauMultiplier: 4.4,
    sessionsPerUser: 1.35,
    rpvLow: 0.15,
    rpvMid: 0.28,
    rpvHigh: 0.4,
    itemCountAverage: 6,
    gamePassPriceAverage: 120,
  },
  shooter: {
    dauMultiplier: 6.8,
    mauMultiplier: 4.2,
    sessionsPerUser: 1.3,
    rpvLow: 0.2,
    rpvMid: 0.4,
    rpvHigh: 0.6,
    itemCountAverage: 8,
    gamePassPriceAverage: 150,
  },
  sports: {
    dauMultiplier: 6.7,
    mauMultiplier: 4,
    sessionsPerUser: 1.25,
    rpvLow: 0.18,
    rpvMid: 0.35,
    rpvHigh: 0.55,
    itemCountAverage: 7,
    gamePassPriceAverage: 140,
  },
  anime: {
    dauMultiplier: 6.4,
    mauMultiplier: 4.1,
    sessionsPerUser: 1.3,
    rpvLow: 0.35,
    rpvMid: 0.65,
    rpvHigh: 1,
    itemCountAverage: 10,
    gamePassPriceAverage: 180,
  },
  default: {
    dauMultiplier: 6.5,
    mauMultiplier: 4.2,
    sessionsPerUser: 1.3,
    rpvLow: 0.2,
    rpvMid: 0.4,
    rpvHigh: 0.7,
    itemCountAverage: 6,
    gamePassPriceAverage: 120,
  },
}

let lastIngestedAt = null
let lastIngestError = null
let lastHomeFetchAttemptedAt = null
let lastHomeFetchSucceededAt = null
let lastHomeFetchError = null
let lastHomeFetchSortCount = 0
let lastHomeFetchUniverseCount = 0
let lastHomeFetchSeedSuccessCount = 0
let lastHomeFetchSeedFailureCount = 0
const startedAt = Date.now()
const schedulerOwnerId = `api-server:${process.pid}:${randomUUID()}`
let scheduledIngestInFlight = false

function gameIconPath(universeId) {
  return `/api/game-icon/${universeId}`
}

const database = await createDatabase()
const {
  appendTrackedUniverseIds,
  countCatalogEntries,
  countDailyMetrics,
  countDerivedHistory,
  countExternalHistory,
  countExternalImportRuns,
  countMetadataHistory,
  countObservations,
  countSnapshots,
  finishIngestRun,
  getActiveIngestLease,
  getHistoryMap,
  getLatestIngestRun,
  getLatestSnapshotGames,
  getPlatformCurrentMetric,
  getTrackedUniverseIds,
  importHistoryBundle,
  recordGamePageSnapshot,
  recordPlatformCurrentMetric,
  recordSnapshots,
  recoverStaleIngestRuns,
  replaceTrackedUniverseIds,
  searchLocalGames,
  startIngestRun,
  tryAcquireIngestLease,
} = database

recoverStaleIngestRuns()

const startupIngestRun = getLatestIngestRun()
if (startupIngestRun?.finished_at) {
  lastIngestedAt = startupIngestRun.finished_at
}
if (startupIngestRun?.status === 'failed') {
  lastIngestError = startupIngestRun.error_message ?? 'Unknown ingestion failure'
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value)
}

function formatWholeNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatApproval(value) {
  return `${value.toFixed(1)}% liked`
}

function formatRelativeUpdate(value) {
  const updatedAt = new Date(value)
  const diffMs = Date.now() - updatedAt.getTime()
  const diffHours = Math.max(Math.round(diffMs / ONE_HOUR_MS), 0)

  if (diffHours < 1) {
    return 'Updated <1h ago'
  }

  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`
  }

  return `Updated ${Math.round(diffHours / 24)}d ago`
}

function getToneFromDelta(delta) {
  if (delta > 2) return 'positive'
  if (delta < -2) return 'negative'
  return 'neutral'
}

function getToneFromApproval(approval) {
  if (approval >= 85) return 'positive'
  if (approval <= 70) return 'negative'
  return 'neutral'
}

function sanitizeUniverseIds(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
}

function parseChartRange(value, fallback = '24h') {
  return Object.hasOwn(CHART_RANGE_MS, value) ? value : fallback
}

function getHistoryCutoffIso() {
  return new Date(Date.now() - SNAPSHOT_RETENTION_MS).toISOString()
}

function formatTrendLabel(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function limitTrendPoints(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points
  }

  if (maxPoints <= 2) {
    return [points[0], points.at(-1)].filter(Boolean)
  }

  const firstPoint = points[0]
  const lastPoint = points.at(-1)
  const interior = points.slice(1, -1)
  const bucketCount = Math.min(
    interior.length,
    Math.max(1, Math.floor((maxPoints - 2) / 2)),
  )
  const limited = [firstPoint]

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const startIndex = Math.floor((bucketIndex / bucketCount) * interior.length)
    const endIndex = Math.floor(((bucketIndex + 1) / bucketCount) * interior.length)
    const bucket = interior.slice(startIndex, endIndex)

    if (bucket.length === 0) {
      continue
    }

    let minPoint = bucket[0]
    let maxPoint = bucket[0]

    for (const point of bucket) {
      if (point.value < minPoint.value) {
        minPoint = point
      }

      if (point.value > maxPoint.value) {
        maxPoint = point
      }
    }

    if (minPoint === maxPoint) {
      limited.push(minPoint)
      continue
    }

    if (new Date(minPoint.timestamp).getTime() <= new Date(maxPoint.timestamp).getTime()) {
      limited.push(minPoint, maxPoint)
    } else {
      limited.push(maxPoint, minPoint)
    }
  }

  if (lastPoint) {
    limited.push(lastPoint)
  }

  const deduped = []
  const seenTimestamps = new Set()

  for (const point of limited) {
    if (!point?.timestamp || seenTimestamps.has(point.timestamp)) {
      continue
    }

    seenTimestamps.add(point.timestamp)
    deduped.push(point)
  }

  return deduped
}

function getMaxTrendPoints(range) {
  switch (range) {
    case '30m':
      return 24
    case '1h':
      return 36
    case '6h':
      return 72
    case '24h':
      return 96
    case '7d':
      return 120
    case '30d':
      return 160
    default:
      return 96
  }
}

function buildSecurityHeaders(extraHeaders = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; connect-src 'self' https://apis.roblox.com https://games.roblox.com https://thumbnails.roblox.com; img-src 'self' data: https://tr.rbxcdn.com https://*.rbxcdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; object-src 'none'",
    ...extraHeaders,
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(
    statusCode,
    buildSecurityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  )
  response.end(JSON.stringify(payload))
}

async function readRequestBody(request, maxBytes = 64 * 1024 * 1024) {
  const chunks = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length

    if (totalBytes > maxBytes) {
      const error = new Error('Request body too large.')
      error.statusCode = 413
      throw error
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks)
}

function isAuthorizedImportRequest(request) {
  if (!IMPORT_TOKEN) {
    return false
  }

  const authorization = request.headers.authorization ?? ''
  const expectedValue = `Bearer ${IMPORT_TOKEN}`
  return authorization === expectedValue
}

function resetInMemoryCaches() {
  searchCache.clear()
  gamesCache.clear()
  platformCache.clear()
  platformStatsCache.clear()
  boardCache.clear()
  gamePageCache.clear()
  gameSupplementalCache.clear()
  gameIconRedirectCache.clear()
  lastBoardUniverseIds = []
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getContentType(filePath) {
  const extension = path.extname(filePath)

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.json':
      return 'application/json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

async function serveStaticAsset(requestPath, response) {
  let relativePath = requestPath === '/' ? '/index.html' : requestPath
  if (relativePath.includes('..')) {
    sendJson(response, 400, { error: 'Invalid path.' })
    return true
  }

  let filePath = path.join(DIST_DIR, relativePath)
  try {
    await access(filePath)
  } catch {
    filePath = path.join(DIST_DIR, 'index.html')
    try {
      await access(filePath)
    } catch {
      return false
    }
  }

  const body = await readFile(filePath)
  response.writeHead(
    200,
    buildSecurityHeaders({
      'Content-Type': getContentType(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=300',
    }),
  )
  response.end(body)
  return true
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

async function fetchText(url, retries = MAX_FETCH_RETRIES) {
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

      return await response.text()
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

async function fetchJsonWithOptions(url, options = {}, retries = MAX_FETCH_RETRIES) {
  let attempt = 0
  let lastError = null

  while (attempt <= retries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        ...options,
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

function readCache(cache, key) {
  const entry = cache.get(key)

  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function readCacheEntry(cache, key) {
  return cache.get(key) ?? null
}

function writeCache(cache, key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
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

function buildTimeline(historyMap, universeIds, games, range = '24h') {
  const cutoffMs = Date.now() - CHART_RANGE_MS[range]
  const timestamps = [...new Set(
    universeIds.flatMap((universeId) =>
      (historyMap.get(universeId) ?? [])
        .map((entry) => entry.timestamp)
        .filter((timestamp) => new Date(timestamp).getTime() >= cutoffMs),
    ),
  )]
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())

  const chartPoints = timestamps.map((timestamp) => {
    const atTime = new Date(timestamp).getTime()
    const value = universeIds.reduce((sum, universeId) => {
      const history = historyMap.get(universeId) ?? []
      let latestPlaying = 0

      for (const entry of history) {
        if (new Date(entry.timestamp).getTime() <= atTime) {
          latestPlaying = entry.playing
        } else {
          break
        }
      }

      return sum + latestPlaying
    }, 0)

    return {
      label: formatTrendLabel(timestamp),
      timestamp,
      value,
    }
  })

  chartPoints.push({
    label: formatTrendLabel(new Date().toISOString()),
    timestamp: new Date().toISOString(),
    value: games.reduce((sum, game) => sum + game.playing, 0),
  })

  return limitTrendPoints(chartPoints, getMaxTrendPoints(range))
}

function detectEvents(enrichedGames) {
  return enrichedGames
    .flatMap((game) => {
      const events = []
      const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS
      const priorVisits = game.history.at(-1)?.visits ?? game.visits
      const currentVisitMilestone = Math.floor(game.visits / 1_000_000_000)
      const previousVisitMilestone = Math.floor(priorVisits / 1_000_000_000)

      if (hoursSinceUpdate <= 12) {
        events.push({
          title: `${game.name} pushed a recent update window`,
          detail: `${formatRelativeUpdate(game.updated)} with a ${game.delta6h >= 0 ? '+' : ''}${game.delta6h.toFixed(1)}% 6-hour move.`,
          timestamp: formatRelativeUpdate(game.updated).replace('Updated ', ''),
          tone: game.delta6h >= 0 ? 'positive' : 'neutral',
          category: 'update',
          weight: 3,
        })
      }

      if (game.delta1h >= 5) {
        events.push({
          title: `${game.name} is breaking upward on short-window traffic`,
          detail: `Up ${game.delta1h.toFixed(1)}% in the last hour to ${formatWholeNumber(game.playing)} live players.`,
          timestamp: '1h window',
          tone: 'positive',
          category: 'spike',
          weight: 4,
        })
      }

      if (game.delta1h <= -5) {
        events.push({
          title: `${game.name} is dropping faster than the rest of the board`,
          detail: `Down ${Math.abs(game.delta1h).toFixed(1)}% in the last hour with ${formatWholeNumber(game.playing)} players still live.`,
          timestamp: '1h window',
          tone: 'negative',
          category: 'drop',
          weight: 4,
        })
      }

      if (currentVisitMilestone > previousVisitMilestone) {
        events.push({
          title: `${game.name} crossed ${currentVisitMilestone}B lifetime visits`,
          detail: `Milestone crossed inside the current ingestion history while traffic sits at ${formatWholeNumber(game.playing)} live players.`,
          timestamp: 'Latest sweep',
          tone: 'neutral',
          category: 'milestone',
          weight: 2,
        })
      }

      return events
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map(({ weight: _weight, ...event }) => event)
}

function parseMagnitudeNumber(value, suffix = '') {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return null
  }

  const normalizedSuffix = String(suffix).toLowerCase()
  if (normalizedSuffix === 'k') return numericValue * 1_000
  if (normalizedSuffix === 'm') return numericValue * 1_000_000
  if (normalizedSuffix === 'b') return numericValue * 1_000_000_000
  return numericValue
}

function buildScreenerPlan(query) {
  const normalizedQuery = query.trim().toLowerCase()
  const steps = [{ label: 'Mode', value: 'Natural-language live game screen' }]
  const filters = {
    genreTokens: [],
    minPlaying: null,
    maxPlaying: null,
    minApproval: null,
    freshnessHours: null,
    minDelta1h: null,
    maxDelta1h: null,
    trackedOnly: false,
  }

  if (
    normalizedQuery.includes('tracked') ||
    normalizedQuery.includes('watchlist') ||
    normalizedQuery.includes('board')
  ) {
    filters.trackedOnly = true
    steps.push({ label: 'Universe set', value: 'Tracked board only' })
  } else {
    steps.push({ label: 'Universe set', value: 'Tracked board + live search candidates' })
  }

  for (const [genre, aliases] of Object.entries(SCREENER_GENRE_ALIASES)) {
    if (aliases.some((alias) => normalizedQuery.includes(alias))) {
      filters.genreTokens.push(genre)
    }
  }

  if (filters.genreTokens.length > 0) {
    steps.push({
      label: 'Genre focus',
      value: filters.genreTokens.map((value) => value[0].toUpperCase() + value.slice(1)).join(', '),
    })
  }

  let sortBy = 'playing'
  let sortDirection = 'desc'

  if (
    normalizedQuery.includes('rising') ||
    normalizedQuery.includes('growing') ||
    normalizedQuery.includes('gaining') ||
    normalizedQuery.includes('surging') ||
    normalizedQuery.includes('breakout') ||
    normalizedQuery.includes('momentum')
  ) {
    filters.minDelta1h = normalizedQuery.includes('breakout') ? 2 : 0.5
    sortBy = 'delta1h'
    sortDirection = 'desc'
    steps.push({ label: 'Signal', value: 'Positive short-window momentum' })
  }

  if (
    normalizedQuery.includes('dropping') ||
    normalizedQuery.includes('falling') ||
    normalizedQuery.includes('cooling') ||
    normalizedQuery.includes('slipping') ||
    normalizedQuery.includes('weak')
  ) {
    filters.maxDelta1h = -0.5
    sortBy = 'delta1h'
    sortDirection = 'asc'
    steps.push({ label: 'Signal', value: 'Negative short-window momentum' })
  }

  if (
    normalizedQuery.includes('high approval') ||
    normalizedQuery.includes('well liked') ||
    normalizedQuery.includes('liked') ||
    normalizedQuery.includes('quality')
  ) {
    filters.minApproval = 85
    if (sortBy === 'playing') {
      sortBy = 'approval'
    }
    steps.push({ label: 'Quality filter', value: 'Approval at or above 85%' })
  }

  if (
    normalizedQuery.includes('fresh') ||
    normalizedQuery.includes('updated') ||
    normalizedQuery.includes('new update') ||
    normalizedQuery.includes('recent update')
  ) {
    filters.freshnessHours = 24
    sortBy = 'updated'
    sortDirection = 'desc'
    steps.push({ label: 'Recency', value: 'Updated in the last 24 hours' })
  }

  if (
    normalizedQuery.includes('underrated') ||
    normalizedQuery.includes('hidden gem') ||
    normalizedQuery.includes('under the radar')
  ) {
    filters.maxPlaying = 20_000
    filters.minApproval = Math.max(filters.minApproval ?? 0, 80)
    sortBy = 'approval'
    steps.push({ label: 'Size band', value: 'Smaller games with quality floor' })
  }

  if (
    normalizedQuery.includes('large') ||
    normalizedQuery.includes('biggest') ||
    normalizedQuery.includes('popular') ||
    normalizedQuery.includes('top')
  ) {
    filters.minPlaying = Math.max(filters.minPlaying ?? 0, 50_000)
    sortBy = sortBy === 'playing' ? 'playing' : sortBy
    steps.push({ label: 'Size band', value: 'Scaled live audience' })
  }

  if (normalizedQuery.includes('mid') || normalizedQuery.includes('medium')) {
    filters.minPlaying = Math.max(filters.minPlaying ?? 0, 5_000)
    filters.maxPlaying = filters.maxPlaying == null ? 50_000 : Math.min(filters.maxPlaying, 50_000)
    steps.push({ label: 'Size band', value: 'Mid-market live audience' })
  }

  if (normalizedQuery.includes('small')) {
    filters.maxPlaying = filters.maxPlaying == null ? 5_000 : Math.min(filters.maxPlaying, 5_000)
    steps.push({ label: 'Size band', value: 'Small live audience' })
  }

  const minCcuMatch = normalizedQuery.match(
    /(?:over|above|at least|minimum)\s+(\d+(?:\.\d+)?)\s*([kmb])?\s*(?:ccu|players?)/,
  )
  if (minCcuMatch) {
    const minPlaying = parseMagnitudeNumber(minCcuMatch[1], minCcuMatch[2])
    if (minPlaying != null) {
      filters.minPlaying = Math.max(filters.minPlaying ?? 0, minPlaying)
      steps.push({ label: 'Minimum CCU', value: formatWholeNumber(minPlaying) })
    }
  }

  const maxCcuMatch = normalizedQuery.match(
    /(?:under|below|less than|max(?:imum)?)\s+(\d+(?:\.\d+)?)\s*([kmb])?\s*(?:ccu|players?)/,
  )
  if (maxCcuMatch) {
    const maxPlaying = parseMagnitudeNumber(maxCcuMatch[1], maxCcuMatch[2])
    if (maxPlaying != null) {
      filters.maxPlaying =
        filters.maxPlaying == null ? maxPlaying : Math.min(filters.maxPlaying, maxPlaying)
      steps.push({ label: 'Maximum CCU', value: formatWholeNumber(maxPlaying) })
    }
  }

  const approvalMatch = normalizedQuery.match(/(?:over|above|at least)?\s*(\d{2,3})\s*%?\s*(?:approval|liked|like)/)
  if (approvalMatch) {
    const minApproval = Math.min(Math.max(Number(approvalMatch[1]), 0), 100)
    filters.minApproval = Math.max(filters.minApproval ?? 0, minApproval)
    steps.push({ label: 'Minimum approval', value: `${minApproval}% liked` })
  }

  const tokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean)
  const knownWords = new Set([
    ...Object.keys(SCREENER_GENRE_ALIASES),
    ...Object.values(SCREENER_GENRE_ALIASES).flat(),
    'approval',
    'board',
    'breakout',
    'ccu',
    'cooling',
    'dropping',
    'falling',
    'fresh',
    'freshly',
    'gaining',
    'growing',
    'high',
    'large',
    'liked',
    'medium',
    'momentum',
    'new',
    'players',
    'popular',
    'quality',
    'rising',
    'screen',
    'screener',
    'search',
    'show',
    'small',
    'surging',
    'top',
    'tracked',
    'under',
    'underrated',
    'update',
    'updated',
    'watchlist',
  ])

  const searchTerm = tokens
    .filter((token) => !SCREENER_STOPWORDS.has(token) && !knownWords.has(token))
    .slice(0, 4)
    .join(' ')

  if (searchTerm) {
    steps.push({ label: 'Search term', value: searchTerm })
  } else if (filters.genreTokens.length > 0) {
    steps.push({ label: 'Search term', value: filters.genreTokens[0] })
  }

  return {
    normalizedQuery,
    searchTerm,
    sortBy,
    sortDirection,
    filters,
    steps,
  }
}

function matchesGenreFilter(game, genreTokens) {
  if (genreTokens.length === 0) {
    return true
  }

  const haystack = `${game.genre} ${game.name}`.toLowerCase()
  return genreTokens.some((genreToken) => {
    const aliases = SCREENER_GENRE_ALIASES[genreToken] ?? [genreToken]
    return aliases.some((alias) => haystack.includes(alias))
  })
}

function sortScreenedGames(games, sortBy, sortDirection) {
  const direction = sortDirection === 'asc' ? 1 : -1

  return [...games].sort((left, right) => {
    let leftValue = 0
    let rightValue = 0

    switch (sortBy) {
      case 'approval':
        leftValue = left.approval
        rightValue = right.approval
        break
      case 'updated':
        leftValue = new Date(left.updated).getTime()
        rightValue = new Date(right.updated).getTime()
        break
      case 'visits':
        leftValue = left.visits
        rightValue = right.visits
        break
      case 'delta1h':
        leftValue = left.delta1h
        rightValue = right.delta1h
        break
      case 'delta6h':
        leftValue = left.delta6h
        rightValue = right.delta6h
        break
      case 'delta24h':
        leftValue = left.delta24h
        rightValue = right.delta24h
        break
      default:
        leftValue = left.playing
        rightValue = right.playing
        break
    }

    if (leftValue === rightValue) {
      return right.playing - left.playing
    }

    return (leftValue - rightValue) * direction
  })
}

function buildScreenerSignal(game) {
  const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS

  if (game.delta1h >= 5) {
    return `+${game.delta1h.toFixed(1)}% in the last hour`
  }

  if (game.delta1h <= -5) {
    return `${game.delta1h.toFixed(1)}% in the last hour`
  }

  if (hoursSinceUpdate <= 12) {
    return formatRelativeUpdate(game.updated)
  }

  if (game.approval >= 90) {
    return `High approval at ${game.approval.toFixed(1)}%`
  }

  if (game.delta24h >= 5) {
    return `+${game.delta24h.toFixed(1)}% across 24h`
  }

  return 'Stable live demand'
}

async function fetchScreenerPayload(query) {
  const plan = buildScreenerPlan(query)
  const trackedIds = getTrackedUniverseIds()
  const candidateIds = new Set(trackedIds)

  const candidateQuery =
    plan.searchTerm || plan.filters.genreTokens[0] || (!plan.filters.trackedOnly ? query.trim() : '')

  if (!plan.filters.trackedOnly && candidateQuery) {
    const searchMatches = await searchRobloxGames(candidateQuery)
    searchMatches.slice(0, SCREENER_SEARCH_LIMIT).forEach((match) => {
      candidateIds.add(match.universeId)
    })
  }

  const universeIds = [...candidateIds].slice(0, SCREENER_SEARCH_LIMIT + trackedIds.length)
  const { games, source } = await fetchUniverseGames(universeIds)

  if (source !== 'database') {
    recordSnapshots(games)
  }

  const historyMap = getHistoryMap(universeIds, getHistoryCutoffIso())
  const enrichedGames = enrichGames(games, historyMap)
  const filteredGames = sortScreenedGames(
    enrichedGames.filter((game) => {
      const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS

      if (!matchesGenreFilter(game, plan.filters.genreTokens)) return false
      if (plan.filters.minPlaying != null && game.playing < plan.filters.minPlaying) return false
      if (plan.filters.maxPlaying != null && game.playing > plan.filters.maxPlaying) return false
      if (plan.filters.minApproval != null && game.approval < plan.filters.minApproval) return false
      if (plan.filters.freshnessHours != null && hoursSinceUpdate > plan.filters.freshnessHours) return false
      if (plan.filters.minDelta1h != null && game.delta1h < plan.filters.minDelta1h) return false
      if (plan.filters.maxDelta1h != null && game.delta1h > plan.filters.maxDelta1h) return false
      return true
    }),
    plan.sortBy,
    plan.sortDirection,
  )

  const results = filteredGames.slice(0, SCREENER_RESULT_LIMIT).map((game) => ({
    universeId: game.universeId,
    name: game.name,
    creatorName: game.creatorName,
    genre: game.genre,
    liveCCU: game.playing,
    approval: Number(game.approval.toFixed(1)),
    visits: game.visits,
    favorites: game.favoritedCount,
    updated: game.updated,
    delta1h: Number(game.delta1h.toFixed(1)),
    delta6h: Number(game.delta6h.toFixed(1)),
    delta24h: Number(game.delta24h.toFixed(1)),
    signal: buildScreenerSignal(game),
    tone: game.tone,
    thumbnailUrl: game.thumbnailUrl,
  }))

  const queryPlan = [
    ...plan.steps,
    { label: 'Sort', value: `${plan.sortBy} ${plan.sortDirection}` },
    { label: 'Source', value: source === 'live' ? 'Live Roblox API' : source === 'cache' ? 'Cached Roblox API responses' : 'SQLite snapshot fallback' },
  ]

  const tableCode = JSON.stringify(
    {
      query,
      candidateQuery: candidateQuery || null,
      sortBy: plan.sortBy,
      sortDirection: plan.sortDirection,
      filters: plan.filters,
      limit: SCREENER_RESULT_LIMIT,
    },
    null,
    2,
  )

  const summary =
    results.length > 0
      ? `${results.length} of ${filteredGames.length} matches shown for "${query}". Ranked by ${plan.sortBy} ${plan.sortDirection}.`
      : `No games matched "${query}" against the current live universe set. Try a genre, size band, or update-based query.`

  return {
    query,
    status: {
      label: results.length > 0 ? 'Screener results ready' : 'No matches returned',
      detail:
        source === 'live'
          ? 'Live search plus tracked-board enrichment'
          : source === 'cache'
            ? 'Using cached Roblox responses while upstream is unstable'
            : 'Serving from snapshot history while upstream is unavailable',
      tone: results.length > 0 ? 'positive' : 'neutral',
    },
    ops: {
      source,
      ingestIntervalMinutes: Math.round(INGEST_INTERVAL_MS / 60_000),
      lastIngestedAt,
    },
    totalResults: filteredGames.length,
    shownResults: results.length,
    queryPlan,
    tableCode,
    summary,
    results,
  }
}

function findBaseline(history, cutoffMs) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (new Date(entry.timestamp).getTime() <= cutoffMs) {
      return entry
    }
  }

  return history[0] ?? null
}

function computeDeltaPercent(current, baseline) {
  if (!baseline || baseline.playing === 0) {
    return 0
  }

  return ((current.playing - baseline.playing) / baseline.playing) * 100
}

function getMostRecentSaturdayStartMs(referenceMs = Date.now()) {
  const date = new Date(referenceMs)
  const day = date.getDay()
  const daysSinceSaturday = (day + 1) % 7

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysSinceSaturday)

  return date.getTime()
}

function findPeakPlayingInWindow(history, startMs, endMs) {
  let peakPlaying = 0

  for (const entry of history) {
    const observedAt = new Date(entry.timestamp).getTime()

    if (observedAt < startMs || observedAt >= endMs) {
      continue
    }

    peakPlaying = Math.max(peakPlaying, Number(entry.playing) || 0)
  }

  return peakPlaying
}

function computeValueDeltaPercent(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue <= 0) {
    return 0
  }

  return ((currentValue - baselineValue) / baselineValue) * 100
}

function getUpdateStatus(updated) {
  const hours = (Date.now() - new Date(updated).getTime()) / ONE_HOUR_MS
  if (hours <= 6) return 'live'
  if (hours <= 24) return 'rolling'
  return 'scheduled'
}

function buildSparkline(history, currentPlaying, now = Date.now()) {
  const cutoffMs = now - ONE_DAY_MS
  const points = history
    .filter((entry) => new Date(entry.timestamp).getTime() >= cutoffMs)
    .map((entry) => ({
      timestamp: entry.timestamp,
      value: entry.playing,
    }))

  points.push({
    timestamp: new Date(now).toISOString(),
    value: currentPlaying,
  })

  const values = limitTrendPoints(points, 12).map((point) => point.value)

  if (values.length === 1) {
    return [values[0], values[0]]
  }

  return values
}

function enrichGames(games, historyMap) {
  const now = Date.now()
  const currentWeekStartMs = getMostRecentSaturdayStartMs(now)
  const previousWeekStartMs = currentWeekStartMs - ONE_WEEK_MS
  const sortedGames = [...games].sort((left, right) => right.playing - left.playing)

  return sortedGames.map((game) => {
    const fullHistory = historyMap.get(game.universeId) ?? []
    const priorHistory = fullHistory.slice(0, -1)
    const observedPoints = [
      ...priorHistory,
      {
        timestamp: new Date(now).toISOString(),
        playing: game.playing,
      },
    ]
    const baseline1h = findBaseline(priorHistory, now - ONE_HOUR_MS)
    const baseline6h = findBaseline(priorHistory, now - SIX_HOURS_MS)
    const baseline24h = findBaseline(priorHistory, now - ONE_DAY_MS)
    const delta1h = computeDeltaPercent(game, baseline1h)
    const delta6h = computeDeltaPercent(game, baseline6h)
    const delta24h = computeDeltaPercent(game, baseline24h)
    const currentWeekPeak = findPeakPlayingInWindow(observedPoints, currentWeekStartMs, now + 1)
    const previousWeekPeak = findPeakPlayingInWindow(priorHistory, previousWeekStartMs, currentWeekStartMs)
    const hasPreviousWeekHistory = previousWeekPeak > 0
    const deltaWeek = hasPreviousWeekHistory
      ? computeValueDeltaPercent(currentWeekPeak, previousWeekPeak)
      : delta24h
    const favoriteDelta =
      baseline24h != null ? game.favoritedCount - baseline24h.favorited_count : 0
    const tone =
      Math.abs(delta1h) >= 0.5 ? getToneFromDelta(delta1h) : getToneFromApproval(game.approval)

    return {
      ...game,
      history: priorHistory,
      delta1h,
      delta6h,
      delta24h,
      deltaWeek,
      favoriteDelta,
      tone,
      sparkline: buildSparkline(priorHistory, game.playing, now),
      updateStatus: getUpdateStatus(game.updated),
    }
  })
}

function buildBoardPayload(
  games,
  historyMap,
  source = 'live',
  range = '24h',
  trackedGames = null,
  platformMeta = null,
) {
  const enrichedGames = enrichGames(games, historyMap)
  const trackedEnrichedGames = trackedGames
    ? enrichGames(
        trackedGames.games,
        trackedGames.historyMap,
      )
    : enrichedGames

  if (enrichedGames.length === 0) {
    return {
      status: {
        label: 'Live Roblox feed empty',
        detail: 'No universes are currently returning game data.',
        tone: 'negative',
      },
      ops: {
        source,
        ingestIntervalMinutes: Math.round(INGEST_INTERVAL_MS / 60_000),
        lastIngestedAt,
      },
      metrics: [],
      leaderboard: [],
      topExperiences: [],
      watchlist: [],
      summaryFeed: [],
      trendingNow: [],
      timeline: [],
      eventFeed: [],
      genreHeatmap: [],
      updateCalendar: [],
      developerBoard: [],
      alertQueue: [],
    }
  }

  const totalPlaying = enrichedGames.reduce((sum, game) => sum + game.playing, 0)
  const leadMover = [...enrichedGames].sort(
    (left, right) => Math.abs(right.delta1h) - Math.abs(left.delta1h),
  )[0]
  const topMoverDown = [...enrichedGames].sort((left, right) => left.delta1h - right.delta1h)[0]
  const freshestUpdate = [...enrichedGames].sort(
    (left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime(),
  )[0]
  const strongestApproval = [...enrichedGames].sort(
    (left, right) => right.approval - left.approval,
  )[0]

  const developers = Array.from(
    enrichedGames.reduce((map, game) => {
      const key = `${game.creatorType}:${game.creatorName}`
      const current = map.get(key) ?? {
        name: game.creatorName,
        studioType: game.creatorType,
        totalVisits: 0,
        liveCCU: 0,
        flagship: game.name,
        flagshipCCU: 0,
        avgDelta1h: 0,
        titles: 0,
      }

      current.totalVisits += game.visits
      current.liveCCU += game.playing
      current.avgDelta1h += game.delta1h
      current.titles += 1
      if (game.playing > current.flagshipCCU) {
        current.flagship = game.name
        current.flagshipCCU = game.playing
      }
      map.set(key, current)
      return map
    }, new Map()).values(),
  )
    .sort((left, right) => right.liveCCU - left.liveCCU)
    .slice(0, 5)
    .map((developer) => ({
      name: developer.name,
      studioType: developer.studioType,
      flagship: developer.flagship,
      totalVisits: `${formatCompactNumber(developer.totalVisits)} visits`,
      liveCCU: `${formatCompactNumber(developer.liveCCU)} live CCU`,
    }))

  const genres = Array.from(
    enrichedGames.reduce((map, game) => {
      const key = game.genre || 'Unclassified'
      const bucket = map.get(key) ?? { name: key, totalCCU: 0, deltaWeek: 0, experiences: [] }
      bucket.totalCCU += game.playing
      bucket.deltaWeek += game.deltaWeek
      bucket.experiences.push(game)
      map.set(key, bucket)
      return map
    }, new Map()).values(),
  )
    .sort((left, right) => right.totalCCU - left.totalCCU)
    .map((bucket) => ({
      name: bucket.name,
      ccuLabel: `${formatCompactNumber(bucket.totalCCU)} combined CCU`,
      change: bucket.experiences.length > 0 ? bucket.deltaWeek / bucket.experiences.length : 0,
      tone: getToneFromDelta(bucket.deltaWeek),
      experiences: bucket.experiences.map((game) => ({
        universeId: game.universeId,
        name: game.name,
        change: game.deltaWeek,
        weight: Math.max(game.playing, 1),
        tone: getToneFromDelta(game.deltaWeek),
      })),
    }))

  const boardLeader = enrichedGames[0]
  const boardLeaderShare = (boardLeader.playing / totalPlaying) * 100
  const timeline = buildTimeline(
    historyMap,
    enrichedGames.map((game) => game.universeId),
    enrichedGames,
    range,
  )
  const eventFeed = detectEvents(enrichedGames)

  const summaryFeed = [
    {
      title: `${leadMover.name} is the strongest live mover on the board at ${leadMover.delta1h >= 0 ? '+' : ''}${leadMover.delta1h.toFixed(1)}%.`,
      detail: `${leadMover.name} is now at ${formatWholeNumber(leadMover.playing)} live players, with a ${leadMover.delta6h >= 0 ? '+' : ''}${leadMover.delta6h.toFixed(1)}% move across the last 6 hours.`,
      datapoints: '1h + 6h snapshot windows',
    },
    {
      title: `${freshestUpdate.name} is the freshest tracked update and is currently ${freshestUpdate.delta6h >= 0 ? 'holding' : 'losing'} traffic.`,
      detail: `${formatRelativeUpdate(freshestUpdate.updated)}. The latest 6-hour move is ${freshestUpdate.delta6h >= 0 ? '+' : ''}${freshestUpdate.delta6h.toFixed(1)}%, which is a better launch-read than a single snapshot jump.`,
      datapoints: 'update recency + 6h delta',
    },
    {
      title: `${boardLeader.name} controls ${boardLeaderShare.toFixed(1)}% of tracked live demand.`,
      detail: `The board is still concentrated around a handful of large experiences, which means one title can distort the platform picture if you are not checking share alongside raw CCU.`,
      datapoints: 'board concentration',
    },
  ]

  const trendingNow = [
    {
      universeId: leadMover.universeId,
      title: `${leadMover.name} is ${leadMover.delta1h >= 0 ? 'accelerating' : 'sliding'} faster than the rest of the tracked board.`,
      timestamp: formatRelativeUpdate(freshestUpdate.updated).replace('Updated ', ''),
      summary: `${formatWholeNumber(leadMover.playing)} live players, ${leadMover.delta1h >= 0 ? '+' : ''}${leadMover.delta1h.toFixed(1)}% in the last hour, ${leadMover.delta24h >= 0 ? '+' : ''}${leadMover.delta24h.toFixed(1)}% across the day.`,
      source: `${leadMover.creatorName} · ${leadMover.genre}`,
      tone: leadMover.tone,
    },
    {
      universeId: topMoverDown.universeId,
      title: `${topMoverDown.name} is the clearest downside move in the current watch window.`,
      timestamp: formatRelativeUpdate(topMoverDown.updated).replace('Updated ', ''),
      summary: `${formatWholeNumber(topMoverDown.playing)} live players and ${topMoverDown.delta1h.toFixed(1)}% over the last hour. This is a stronger alert candidate than games that only slipped once.`,
      source: `${topMoverDown.creatorName} · ${topMoverDown.genre}`,
      tone: topMoverDown.tone,
    },
    {
      universeId: strongestApproval.universeId,
      title: `${strongestApproval.name} still leads approval while holding scale.`,
      timestamp: formatRelativeUpdate(strongestApproval.updated).replace('Updated ', ''),
      summary: `${formatApproval(strongestApproval.approval)} with ${formatCompactNumber(strongestApproval.visits)} lifetime visits and ${formatWholeNumber(strongestApproval.playing)} live players.`,
      source: `${strongestApproval.creatorName} · approval durability`,
      tone: getToneFromApproval(strongestApproval.approval),
    },
  ]

  const alertCandidates = enrichedGames
    .flatMap((game) => {
      const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS
      const alerts = []

      if (Math.abs(game.delta1h) >= 8) {
        alerts.push({
          title: `${game.name} ${game.delta1h >= 0 ? 'spiked' : 'dropped'} ${Math.abs(game.delta1h).toFixed(1)}% in the last hour`,
          rule: `${formatWholeNumber(game.playing)} live players · ${game.delta24h >= 0 ? '+' : ''}${game.delta24h.toFixed(1)}% across the last day`,
          severity: 'critical',
          weight: 3,
        })
      }

      if (hoursSinceUpdate <= 12 && Math.abs(game.delta6h) >= 3) {
        alerts.push({
          title: `${game.name} is reacting to a recent update window`,
          rule: `${formatRelativeUpdate(game.updated)} · ${game.delta6h >= 0 ? '+' : ''}${game.delta6h.toFixed(1)}% across 6 hours`,
          severity: 'watch',
          weight: 2,
        })
      }

      if (game.approval >= 90 && game.playing >= 50_000) {
        alerts.push({
          title: `${game.name} is holding high approval at scale`,
          rule: `${formatApproval(game.approval)} · ${formatWholeNumber(game.playing)} current players`,
          severity: 'info',
          weight: 1,
        })
      }

      return alerts
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 4)
    .map(({ weight: _weight, ...alert }) => alert)

  const alertQueue = alertCandidates.length > 0
    ? alertCandidates
    : [
        {
          title: `${strongestApproval.name} leads board quality`,
          rule: `${formatApproval(strongestApproval.approval)} with stable live demand`,
          severity: 'info',
        },
      ]

  return {
    status: {
      label:
        source === 'live'
          ? 'Live Roblox feed online'
          : source === 'cache'
            ? 'Live Roblox feed degraded'
            : 'Database fallback active',
      detail:
        source === 'live'
          ? `${formatCompactNumber(totalPlaying)} live players across ${enrichedGames.length} indexed experiences · 5 minute ingestion`
          : source === 'cache'
            ? `Using recent cached Roblox surface data across ${enrichedGames.length} live experiences`
            : `Serving ${enrichedGames.length} indexed experiences from SQLite snapshots while upstream is unavailable`,
      tone: source === 'live' ? 'positive' : 'neutral',
    },
    metrics: [
      {
        label: 'Observed live CCU',
        value: formatCompactNumber(totalPlaying),
        change: `${enrichedGames.length} games indexed`,
        footnote: 'Aggregate concurrent users across the live Roblox surface set',
        tone: 'positive',
      },
      {
        label: 'Games indexed',
        value: formatWholeNumber(enrichedGames.length),
        change: `${platformMeta?.discoveredSorts?.length ?? PLATFORM_SORT_IDS.length} live sorts`,
        footnote: 'Unique experiences currently covered from Roblox discovery and Home feeds',
        tone: 'neutral',
      },
      {
        label: 'Genres indexed',
        value: formatWholeNumber(genres.length),
        change: genres[0]?.name ?? 'Unclassified',
        footnote: 'Genre families represented in the indexed live universe set',
        tone: 'neutral',
      },
      {
        label: 'Official platform scale',
        value: OFFICIAL_PLATFORM_SCALE.value,
        change: OFFICIAL_PLATFORM_SCALE.dateLabel,
        footnote: 'Latest official Roblox concurrency milestone, separate from current surface coverage',
        tone: 'positive',
      },
    ],
    ops: {
      source,
      ingestIntervalMinutes: Math.round(INGEST_INTERVAL_MS / 60_000),
      lastIngestedAt,
    },
    leaderboard: enrichedGames.slice(0, 50).map((game) => ({
      universeId: game.universeId,
      name: game.name,
      creatorName: game.creatorName,
      genre: game.genre,
      playing: game.playing,
      visits: game.visits,
      approval: Number(game.approval.toFixed(1)),
      updated: game.updated,
      delta1h: Number(game.delta1h.toFixed(1)),
      delta24h: Number(game.delta24h.toFixed(1)),
      deltaWeek: Number(game.deltaWeek.toFixed(1)),
      tone: game.tone,
      sparkline: game.sparkline,
      thumbnailUrl: game.thumbnailUrl,
    })),
    topFiveSeries: enrichedGames.slice(0, 5).map((game) => ({
      universeId: game.universeId,
      timeline: buildSingleGameTimeline(game, range),
    })),
    topExperiences: enrichedGames.slice(0, 4).map((game) => ({
      universeId: game.universeId,
      name: game.name,
      genre: game.genre,
      ccu: `${formatWholeNumber(game.playing)} CCU`,
      badge: `${game.delta1h >= 0 ? '+' : ''}${game.delta1h.toFixed(1)}%`,
      context: `${game.creatorName} · ${formatCompactNumber(game.visits)} visits · ${formatRelativeUpdate(game.updated)}`,
      sparkline: game.sparkline,
      thumbnailUrl: game.thumbnailUrl,
      tone: game.tone,
    })),
    watchlist: trackedEnrichedGames.map((game) => ({
      universeId: game.universeId,
      name: game.name,
      creator: game.creatorName,
      ccu: formatWholeNumber(game.playing),
      change: Number(game.approval.toFixed(1)),
      tone: getToneFromApproval(game.approval),
    })),
    summaryFeed,
    trendingNow,
    timeline,
    eventFeed,
    genreHeatmap: genres,
    updateCalendar: [...enrichedGames]
      .sort((left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime())
      .slice(0, 8)
      .map((game) => ({
        universeId: game.universeId,
        experience: game.name,
        genre: game.genre,
        eta: formatRelativeUpdate(game.updated),
        expectedImpact:
          game.delta6h >= 0
            ? `${game.delta6h.toFixed(1)}% gain across the 6-hour watch window`
            : `${Math.abs(game.delta6h).toFixed(1)}% pullback across the 6-hour watch window`,
        status: game.updateStatus,
      })),
    developerBoard: developers,
    alertQueue,
  }
}

async function searchRobloxGames(query) {
  const normalizedQuery = query.trim().toLowerCase()
  const cachedMatches = readCache(searchCache, normalizedQuery)

  if (cachedMatches) {
    return cachedMatches
  }

  try {
    const sessionId = crypto.randomUUID()
    const response = await fetchJson(
      `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(query)}&verticalType=game&sessionId=${sessionId}`,
    )

    const matches = response.searchResults
      .flatMap((group) => group.contents)
      .map((entry) => ({
        universeId: entry.universeId,
        rootPlaceId: entry.rootPlaceId,
        name: entry.name,
        creatorName: entry.creatorName || 'Unknown creator',
        playerCount: entry.playerCount,
        approval:
          entry.totalUpVotes + entry.totalDownVotes === 0
            ? 0
            : (entry.totalUpVotes / (entry.totalUpVotes + entry.totalDownVotes)) * 100,
      }))

    writeCache(searchCache, normalizedQuery, matches, SEARCH_CACHE_TTL_MS)
    return matches
  } catch (error) {
    const staleCache = readCacheEntry(searchCache, normalizedQuery)
    if (staleCache) {
      return staleCache.value
    }

    const localMatches = searchLocalGames(query)
    if (localMatches.length > 0) {
      return localMatches
    }

    throw error
  }
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

async function fetchHomeRecommendationSet() {
  if (ROBLOX_AUTH_COOKIE_HEADERS.length === 0) {
    lastHomeFetchAttemptedAt = null
    lastHomeFetchSucceededAt = null
    lastHomeFetchError = null
    lastHomeFetchSortCount = 0
    lastHomeFetchUniverseCount = 0
    lastHomeFetchSeedSuccessCount = 0
    lastHomeFetchSeedFailureCount = 0
    return {
      games: [],
      discoveredSorts: [],
    }
  }

  lastHomeFetchAttemptedAt = new Date().toISOString()
  const discoveredByUniverseId = new Map()
  const discoveredSorts = []

  const payloads = await Promise.allSettled(
    ROBLOX_AUTH_COOKIE_HEADERS.map((cookieHeader, index) =>
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
            sessionId: randomUUID(),
          }),
        },
      ).then((payload) => ({ index, payload })),
    ),
  )

  const successfulPayloads = payloads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failedPayloads = payloads.filter((result) => result.status === 'rejected')

  lastHomeFetchSeedSuccessCount = successfulPayloads.length
  lastHomeFetchSeedFailureCount = failedPayloads.length

  if (successfulPayloads.length === 0) {
    const firstError = failedPayloads[0]?.reason
    lastHomeFetchError = firstError instanceof Error ? firstError.message : 'Unknown Home fetch failure'
    lastHomeFetchSucceededAt = null
    lastHomeFetchSortCount = 0
    lastHomeFetchUniverseCount = 0
    throw firstError instanceof Error ? firstError : new Error(lastHomeFetchError)
  }

  lastHomeFetchError = failedPayloads.length > 0
    ? `${failedPayloads.length} of ${ROBLOX_AUTH_COOKIE_HEADERS.length} Home seeds failed`
    : null

  for (const { index, payload } of successfulPayloads) {
    for (const sort of payload.sorts ?? []) {
      const sortEntries = [...extractHomeRecommendationEntries(sort).values()]
      const baseSortId =
        sort.topicId != null
          ? `home-topic-${sort.topicId}`
          : typeof sort.topic === 'string' && sort.topic.length > 0
            ? `home-${sort.topic}`
            : typeof sort.name === 'string' && sort.name.length > 0
              ? `home-${sort.name}`
              : 'home-recommendation'
      const sortId = `${baseSortId}:seed-${index + 1}`

      discoveredSorts.push({
        sortId,
        count: sortEntries.length,
      })

      sortEntries.forEach((entry) => {
        if (!discoveredByUniverseId.has(entry.universeId)) {
          discoveredByUniverseId.set(entry.universeId, {
            ...entry,
            sortId: baseSortId,
          })
        }
      })
    }
  }

  lastHomeFetchSucceededAt = new Date().toISOString()
  lastHomeFetchSortCount = discoveredSorts.length
  lastHomeFetchUniverseCount = discoveredByUniverseId.size

  return {
    games: [...discoveredByUniverseId.values()],
    discoveredSorts,
  }
}

async function fetchPlatformDiscoverySet() {
  const cacheKey = `${PLATFORM_SORT_IDS.join(',')}:home-seeds-${ROBLOX_AUTH_COOKIE_HEADERS.length}`
  const cachedPlatform = readCache(platformCache, cacheKey)

  if (cachedPlatform) {
    return {
      ...cachedPlatform,
      source: 'live',
    }
  }

  try {
    const [sortPayloads, homeRecommendationSet] = await Promise.all([
      Promise.all(
        PLATFORM_SORT_IDS.map(async (sortId) => ({
          sortId,
          payload: await fetchDiscoverSort(sortId),
        })),
      ),
      fetchHomeRecommendationSet().catch((error) => {
        console.warn(
          '[roterminal-server] failed to fetch authenticated Roblox Home recommendations',
          error,
        )
        return { games: [], discoveredSorts: [] }
      }),
    ])

    const discoveredByUniverseId = new Map()

    for (const { sortId, payload } of sortPayloads) {
      for (const game of payload.games ?? []) {
        const current = discoveredByUniverseId.get(game.universeId)
        if (!current || game.playerCount > current.playerCount) {
          discoveredByUniverseId.set(game.universeId, {
            universeId: game.universeId,
            rootPlaceId: game.rootPlaceId,
            name: game.name,
            playerCount: game.playerCount,
            totalUpVotes: game.totalUpVotes,
            totalDownVotes: game.totalDownVotes,
            sortId,
          })
        }
      }
    }

    for (const game of homeRecommendationSet.games) {
      if (!discoveredByUniverseId.has(game.universeId)) {
        discoveredByUniverseId.set(game.universeId, game)
      }
    }

    const universeIds = [...discoveredByUniverseId.keys()]
    const { games, source } = await fetchUniverseGames(universeIds)
    const gamesByUniverseId = new Map(games.map((game) => [game.universeId, game]))
    const fallbackTimestamp = new Date().toISOString()

    discoveredByUniverseId.forEach((entry, universeId) => {
      if (gamesByUniverseId.has(universeId)) {
        return
      }

      const approval =
        (entry.totalUpVotes ?? 0) + (entry.totalDownVotes ?? 0) > 0
          ? ((entry.totalUpVotes ?? 0) / ((entry.totalUpVotes ?? 0) + (entry.totalDownVotes ?? 0))) * 100
          : 0

      gamesByUniverseId.set(universeId, {
        rootPlaceId: entry.rootPlaceId,
        universeId,
        name: entry.name ?? `Universe ${universeId}`,
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
        thumbnailUrl: undefined,
        bannerUrl: undefined,
        screenshotUrls: [],
      })
    })

    const enrichedGames = [...gamesByUniverseId.values()].map((game) => {
      const discoverEntry = discoveredByUniverseId.get(game.universeId)
      const upVotes = discoverEntry?.totalUpVotes ?? 0
      const downVotes = discoverEntry?.totalDownVotes ?? 0
      const approval =
        upVotes + downVotes > 0
          ? (upVotes / (upVotes + downVotes)) * 100
          : game.approval

      return {
        ...game,
        approval,
        sortId: discoverEntry?.sortId ?? 'top-playing-now',
      }
    })

    const platformPayload = {
      games: enrichedGames,
      discoveredUniverseIds: universeIds,
      discoveredSorts: [
        ...sortPayloads.map(({ sortId, payload }) => ({
          sortId,
          count: payload.games?.length ?? 0,
        })),
        ...homeRecommendationSet.discoveredSorts,
      ],
    }

    writeCache(platformCache, cacheKey, platformPayload, LIVE_DISCOVERY_CACHE_TTL_MS)

    return {
      ...platformPayload,
      source,
    }
  } catch (error) {
    const stalePlatform = readCacheEntry(platformCache, cacheKey)
    if (stalePlatform) {
      return {
        ...stalePlatform.value,
        source: 'cache',
      }
    }

    throw error
  }
}

async function fetchUniverseGames(universeIds, options = {}) {
  const { bypassCache = false } = options

  if (universeIds.length === 0) {
    return {
      games: [],
      source: 'live',
    }
  }

  if (universeIds.length > PLATFORM_GAME_BATCH_SIZE) {
    const batches = chunkItems(universeIds, PLATFORM_GAME_BATCH_SIZE)
    const responses = await mapWithConcurrency(
      batches,
      UNIVERSE_FETCH_BATCH_CONCURRENCY,
      (batch) => fetchUniverseGames(batch),
    )
    const sourcePriority = { live: 0, cache: 1, database: 2 }
    const mergedSource = responses.reduce(
      (current, entry) =>
        sourcePriority[entry.source] > sourcePriority[current] ? entry.source : current,
      'live',
    )

    return {
      games: responses.flatMap((entry) => entry.games),
      source: mergedSource,
    }
  }

  const idList = universeIds.join(',')
  const cachedGames = bypassCache ? null : readCache(gamesCache, idList)

  if (cachedGames) {
    return {
      games: cachedGames,
      source: 'live',
    }
  }

  try {
    const [gamesResponse, votesResponse, thumbnailsResponse, bannersResponse] = await Promise.all([
      fetchJson(`https://games.roblox.com/v1/games?universeIds=${idList}`),
      fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${idList}`),
      fetchJson(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idList}&size=150x150&format=Png&isCircular=false`,
        0,
      ).catch(() => ({ data: [] })),
      fetchJson(
        `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${idList}&size=768x432&format=Png&isCircular=false`,
        0,
      ).catch(() => ({ data: [] })),
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

    const thumbnailsById = new Map(
      thumbnailsResponse.data.map((entry) => [entry.targetId, entry.imageUrl]),
    )
    const bannersById = new Map(
      bannersResponse.data.map((entry) => [
        entry.universeId,
        entry.thumbnails
          ?.map((thumbnail) => thumbnail.imageUrl)
          .filter((imageUrl) => typeof imageUrl === 'string' && imageUrl.length > 0) ?? [],
      ]),
    )

    const games = gamesResponse.data.map((game) => ({
      rootPlaceId: game.rootPlaceId,
      universeId: game.id,
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
      thumbnailUrl: thumbnailsById.has(game.id) ? gameIconPath(game.id) : undefined,
      bannerUrl: bannersById.get(game.id)?.[0],
      screenshotUrls: bannersById.get(game.id) ?? [],
    }))

    thumbnailsById.forEach((imageUrl, universeId) => {
      if (typeof imageUrl === 'string' && imageUrl.length > 0) {
        writeCache(gameIconRedirectCache, universeId, imageUrl, GAME_ICON_CACHE_TTL_MS)
      }
    })

    if (!bypassCache) {
      writeCache(gamesCache, idList, games, GAMES_CACHE_TTL_MS)
    }
    return {
      games,
      source: 'live',
    }
  } catch (error) {
    const staleCache = readCacheEntry(gamesCache, idList)
    if (staleCache) {
      return {
        games: staleCache.value,
        source: 'cache',
      }
    }

    const snapshotGames = getLatestSnapshotGames(universeIds)
    if (snapshotGames.length > 0) {
      return {
        games: snapshotGames,
        source: 'database',
      }
    }

    throw error
  }
}

async function fetchGameLivePointPayload(universeId) {
  try {
    const response = await fetchJson(
      `https://games.roblox.com/v1/games?universeIds=${universeId}`,
    )
    const game = response.data?.[0]

    if (!game) {
      const error = new Error('Game not found.')
      error.statusCode = 404
      throw error
    }

    return {
      universeId,
      value: game.playing ?? 0,
      timestamp: new Date().toISOString(),
      source: 'live',
    }
  } catch (error) {
    const snapshotGame = getLatestSnapshotGames([universeId])[0]

    if (!snapshotGame) {
      throw error
    }

    return {
      universeId,
      value: snapshotGame.playing,
      timestamp: new Date().toISOString(),
      source: 'database',
    }
  }
}

function buildPlatformStatsWindow(range = '24h') {
  const endDatetime = new Date().toISOString()
  const startDatetime = new Date(Date.now() - CHART_RANGE_MS[range]).toISOString()

  return {
    startDatetime,
    endDatetime,
  }
}

function buildPlatformTone(latestValue, timeline) {
  const previousPoint = timeline.length > 1 ? timeline.at(-2) : null

  if (!previousPoint) {
    return 'neutral'
  }

  if (latestValue > previousPoint.value) {
    return 'positive'
  }

  if (latestValue < previousPoint.value) {
    return 'negative'
  }

  return 'neutral'
}

function normalizePlatformStatsPayload(payload, source, range = '24h') {
  const history = Array.isArray(payload?.ccu_history) ? payload.ccu_history : []
  const timeline = limitTrendPoints(
    history
      .filter((entry) => Number.isFinite(entry?.playing) && entry?.process_timestamp)
      .map((entry) => ({
        label: formatTrendLabel(entry.process_timestamp),
        timestamp: entry.process_timestamp,
        value: entry.playing,
      })),
    getMaxTrendPoints(range),
  )
  const latestTimestamp =
    payload?.latest_ccu_timestamp ??
    timeline.at(-1)?.timestamp ??
    new Date().toISOString()
  const latestValue =
    payload?.latest_ccu ??
    timeline.at(-1)?.value ??
    0
  const tone = buildPlatformTone(latestValue, timeline)

  return {
    status: {
      label:
        source === 'live'
          ? 'Full platform CCU live'
          : 'Full platform CCU using cache',
      detail: `${formatWholeNumber(latestValue)} players across Roblox right now.`,
      tone,
    },
    source,
    latest: {
      value: latestValue,
      timestamp: latestTimestamp,
      source,
    },
    peak:
      Number.isFinite(payload?.peak_ccu) && payload?.peak_ccu_timestamp
        ? {
            value: payload.peak_ccu,
            timestamp: payload.peak_ccu_timestamp,
          }
        : null,
    timeline,
    tone,
  }
}

async function fetchFullPlatformStats(range = '24h') {
  const cachedStats = readCache(platformStatsCache, range)

  if (cachedStats) {
    return {
      ...cachedStats,
      source: 'live',
    }
  }

  const { startDatetime, endDatetime } = buildPlatformStatsWindow(range)

  try {
    const response = await fetchJsonWithOptions(
      FULL_PLATFORM_STATS_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/json',
          Origin: 'https://ads.bloxbiz.com',
          Referer: 'https://ads.bloxbiz.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          start_datetime: startDatetime,
          end_datetime: endDatetime,
        }),
      },
      0,
    )

    const normalized = normalizePlatformStatsPayload(response?.data ?? response, 'live', range)
    recordPlatformCurrentMetric(normalized.latest)
    writeCache(platformStatsCache, range, normalized, getPlatformStatsCacheTtlMs(range))
    return normalized
  } catch (error) {
    const staleStats = readCacheEntry(platformStatsCache, range)

    if (staleStats) {
      return {
        ...staleStats.value,
        source: 'cache',
        status: {
          ...staleStats.value.status,
          label: 'Full platform CCU using cache',
        },
        latest: {
          ...staleStats.value.latest,
          source: 'cache',
        },
      }
    }

    throw error
  }
}

async function fetchFullPlatformPointPayload() {
  const cachedRanges = ['30m', '24h', '7d', '30d']

  for (const range of cachedRanges) {
    const cachedStats = readCache(platformStatsCache, range)

    if (cachedStats?.latest) {
      return cachedStats.latest
    }
  }

  const storedPoint = getPlatformCurrentMetric()

  if (storedPoint) {
    return storedPoint
  }

  const payload = await fetchFullPlatformStats('24h')
  return payload.latest
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, entity) =>
      String.fromCodePoint(Number.parseInt(entity, 16)),
    )
    .replace(/&#(\d+);/g, (_match, entity) =>
      String.fromCodePoint(Number.parseInt(entity, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseBooleanish(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

function parseIntegerOrNull(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function toErrorNote(error, fallbackMessage) {
  if (error?.statusCode) {
    return `${fallbackMessage} (${error.statusCode}).`
  }

  if (error instanceof Error && error.message) {
    return `${fallbackMessage} (${error.message}).`
  }

  return fallbackMessage
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function averageValues(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (filtered.length === 0) {
    return null
  }

  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

function roundNullable(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) {
    return null
  }

  const multiplier = 10 ** digits
  return Math.round(value * multiplier) / multiplier
}

function buildUnavailableSection(source, note) {
  return {
    status: 'unavailable',
    source,
    note,
  }
}

function getGenreBenchmarkKey(game) {
  const value = `${game.genrePrimary ?? ''} ${game.genreSecondary ?? ''} ${game.genre ?? ''}`.toLowerCase()

  if (value.includes('sim')) return 'simulator'
  if (value.includes('tycoon')) return 'tycoon'
  if (value.includes('roleplay')) return 'roleplay'
  if (value.includes('avatar')) return 'roleplay'
  if (value.includes('social')) return 'social'
  if (value.includes('obby') || value.includes('parkour')) return 'obby'
  if (value.includes('horror')) return 'horror'
  if (value.includes('shooter') || value.includes('combat') || value.includes('battle')) return 'shooter'
  if (value.includes('sport') || value.includes('soccer') || value.includes('football') || value.includes('basketball')) return 'sports'
  if (value.includes('anime')) return 'anime'
  if (value.includes('rpg') || value.includes('adventure')) return 'rpg'
  return 'default'
}

function getGenreBenchmarks(game) {
  const key = getGenreBenchmarkKey(game)
  return GENRE_BENCHMARKS[key] ?? GENRE_BENCHMARKS.default
}

function buildObservedSeries(game) {
  const history = Array.isArray(game.history) ? game.history : []
  const currentTimestamp = new Date().toISOString()

  return [
    ...history.map((entry) => ({
      timestamp: entry.timestamp,
      playing: Number(entry.playing) || 0,
      visits: Number(entry.visits) || 0,
      favoritedCount: Number(entry.favorited_count ?? entry.favoritedCount) || 0,
    })),
    {
      timestamp: currentTimestamp,
      playing: Number(game.playing) || 0,
      visits: Number(game.visits) || 0,
      favoritedCount: Number(game.favoritedCount) || 0,
    },
  ].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
}

function getObservedHistoryHours(series) {
  if (series.length < 2) {
    return 0
  }

  return Math.max(
    (new Date(series.at(-1).timestamp).getTime() - new Date(series[0].timestamp).getTime()) /
      ONE_HOUR_MS,
    0,
  )
}

function findSeriesEntryAtOrBefore(series, timestampMs) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const entry = series[index]
    if (new Date(entry.timestamp).getTime() <= timestampMs) {
      return entry
    }
  }

  return series[0] ?? null
}

function computeAveragePlaying(series, startMs, endMs) {
  const values = series
    .filter((entry) => {
      const timestampMs = new Date(entry.timestamp).getTime()
      return timestampMs >= startMs && timestampMs <= endMs
    })
    .map((entry) => entry.playing)

  return averageValues(values)
}

function computeVisitsDelta(series, startMs, endMs) {
  const start = findSeriesEntryAtOrBefore(series, startMs)
  const end = findSeriesEntryAtOrBefore(series, endMs)

  if (!start || !end) {
    return null
  }

  return Math.max((end.visits ?? 0) - (start.visits ?? 0), 0)
}

function computeHourlyHeatmap(series) {
  const lastTimestampMs = new Date(series.at(-1)?.timestamp ?? Date.now()).getTime()
  const cutoffMs = lastTimestampMs - ONE_DAY_MS
  const buckets = new Map()

  for (const entry of series) {
    const timestampMs = new Date(entry.timestamp).getTime()
    if (timestampMs < cutoffMs) {
      continue
    }

    const hour = new Date(entry.timestamp).getHours()
    const current = buckets.get(hour) ?? []
    current.push(entry.playing)
    buckets.set(hour, current)
  }

  return Array.from({ length: 24 }, (_value, hour) => ({
    hour,
    averageCCU: roundNullable(averageValues(buckets.get(hour) ?? []), 0) ?? 0,
  }))
}

function computeGrowthWindow(series, windowMs, estimatedRevenuePerVisit) {
  const observedHistoryMs =
    new Date(series.at(-1)?.timestamp ?? Date.now()).getTime() -
    new Date(series[0]?.timestamp ?? Date.now()).getTime()

  if (observedHistoryMs < windowMs * 1.9) {
    return {
      ccu: null,
      visits: null,
      revenue: null,
    }
  }

  const endMs = new Date(series.at(-1).timestamp).getTime()
  const currentStartMs = endMs - windowMs
  const previousStartMs = endMs - windowMs * 2

  const currentAverageCcu = computeAveragePlaying(series, currentStartMs, endMs)
  const previousAverageCcu = computeAveragePlaying(series, previousStartMs, currentStartMs)
  const currentVisits = computeVisitsDelta(series, currentStartMs, endMs)
  const previousVisits = computeVisitsDelta(series, previousStartMs, currentStartMs)

  const computePercent = (currentValue, previousValue) => {
    if (currentValue == null || previousValue == null || previousValue <= 0) {
      return null
    }

    return ((currentValue - previousValue) / previousValue) * 100
  }

  const currentRevenue =
    currentVisits == null || estimatedRevenuePerVisit == null
      ? null
      : currentVisits * estimatedRevenuePerVisit
  const previousRevenue =
    previousVisits == null || estimatedRevenuePerVisit == null
      ? null
      : previousVisits * estimatedRevenuePerVisit

  return {
    ccu: roundNullable(computePercent(currentAverageCcu, previousAverageCcu)),
    visits: roundNullable(computePercent(currentVisits, previousVisits)),
    revenue: roundNullable(computePercent(currentRevenue, previousRevenue)),
  }
}

function parseRobloxGamePageMetadata(html) {
  const metaDataMatch = html.match(/<div id="game-detail-meta-data"([^>]+)>/i)
  const attributes = {}

  if (metaDataMatch) {
    for (const match of metaDataMatch[1].matchAll(/data-([a-z0-9-]+)="([^"]*)"/gi)) {
      attributes[match[1]] = decodeHtmlEntities(match[2])
    }
  }

  const jsonLdMatch = html.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i,
  )

  let structuredData = null
  if (jsonLdMatch) {
    try {
      structuredData = JSON.parse(jsonLdMatch[1])
    } catch {
      structuredData = null
    }
  }

  return {
    sellerName: attributes['seller-name'] || null,
    sellerId: parseIntegerOrNull(attributes['seller-id']),
    rootPlaceId: parseIntegerOrNull(attributes['root-place-id']),
    canCreateServer: parseBooleanish(attributes['can-create-server']),
    privateServerPrice: parseIntegerOrNull(attributes['private-server-price']),
    privateServerProductId: parseIntegerOrNull(attributes['private-server-product-id']),
    seoImageUrl:
      typeof structuredData?.image === 'string' && structuredData.image.length > 0
        ? structuredData.image
        : null,
  }
}

async function fetchRobloxGamePageMetadata(rootPlaceId) {
  if (!Number.isFinite(rootPlaceId) || rootPlaceId <= 0) {
    return {
      status: 'unavailable',
      source: 'roblox.com game page',
      note: 'Root place id was not available for this experience.',
    }
  }

  try {
    const html = await fetchText(`https://www.roblox.com/games/${rootPlaceId}/`, 0)
    return {
      status: 'available',
      source: 'roblox.com game page',
      ...parseRobloxGamePageMetadata(html),
      note: null,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source: 'roblox.com game page',
      note: toErrorNote(error, 'Failed to scrape the public Roblox game page metadata'),
    }
  }
}

async function fetchAgeRating(universeId) {
  const source = 'apis.roblox.com/experience-guidelines-api/experience-guidelines/get-age-recommendation'

  try {
    const response = await fetchJsonWithOptions(
      'https://apis.roblox.com/experience-guidelines-api/experience-guidelines/get-age-recommendation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          universeId: String(universeId),
        }),
      },
      0,
    )

    const recommendation = response.ageRecommendationDetails?.summary?.ageRecommendation
    const descriptors = Array.isArray(response.ageRecommendationDetails?.descriptorUsages)
      ? response.ageRecommendationDetails.descriptorUsages
          .map((entry) => entry?.descriptor?.displayName)
          .filter((value) => typeof value === 'string' && value.length > 0)
      : []

    return {
      status: 'available',
      source,
      note: null,
      label: response.headerDisplayNameShort ?? response.headerDisplayName ?? 'Content Maturity',
      minimumAge: recommendation?.minimumAge ?? null,
      displayName:
        recommendation?.displayNameWithHeaderShort ??
        recommendation?.displayName ??
        null,
      descriptors,
    }
  } catch (error) {
    return {
      ...buildUnavailableSection(
        source,
        toErrorNote(error, 'Failed to fetch public age rating data'),
      ),
      label: null,
      minimumAge: null,
      displayName: null,
      descriptors: [],
    }
  }
}

function computeDailyVisitsEstimate(series, estimatedDau, sessionsPerUser) {
  if (series.length < 2) {
    return estimatedDau == null ? null : roundNullable(estimatedDau * sessionsPerUser, 0)
  }

  const endMs = new Date(series.at(-1).timestamp).getTime()
  const startMs = Math.max(endMs - ONE_DAY_MS, new Date(series[0].timestamp).getTime())
  const observedWindowHours = Math.max((endMs - startMs) / ONE_HOUR_MS, 0)
  const observedVisits = computeVisitsDelta(series, startMs, endMs)

  if (observedVisits != null && observedWindowHours >= 18) {
    return roundNullable(observedVisits, 0)
  }

  if (observedVisits != null && observedWindowHours >= 4) {
    return roundNullable((observedVisits / observedWindowHours) * 24, 0)
  }

  return estimatedDau == null ? null : roundNullable(estimatedDau * sessionsPerUser, 0)
}

function computePlayerMetrics(game) {
  const source = 'Tracked Roblox snapshots + games.roblox.com public game metadata'
  const series = buildObservedSeries(game)
  const benchmarks = getGenreBenchmarks(game)
  const observedHistoryHours = getObservedHistoryHours(series)
  const endMs = new Date(series.at(-1)?.timestamp ?? Date.now()).getTime()
  const averageWindowHours = clampNumber(observedHistoryHours || 1, 1, 24)
  const averageStartMs = endMs - averageWindowHours * ONE_HOUR_MS
  const averageCcu = computeAveragePlaying(series, averageStartMs, endMs) ?? game.playing
  const estimatedDau = roundNullable(averageCcu * benchmarks.dauMultiplier, 0)
  const estimatedMau =
    estimatedDau == null ? null : roundNullable(estimatedDau * benchmarks.mauMultiplier, 0)
  const dailyVisitsObserved = computeDailyVisitsEstimate(
    series,
    estimatedDau,
    benchmarks.sessionsPerUser,
  )
  const averageSessionLengthMinutes =
    dailyVisitsObserved != null && dailyVisitsObserved > 0
      ? roundNullable(
          clampNumber((averageCcu * 1440) / dailyVisitsObserved, 5, 600),
          0,
        )
      : null
  const peakCCUObserved =
    series.length > 0
      ? series.reduce(
          (maxValue, entry) => Math.max(maxValue, Number(entry.playing) || 0),
          0,
        )
      : null
  const peakCCU30dObserved =
    series.length > 0
      ? series
          .filter((entry) => endMs - new Date(entry.timestamp).getTime() <= 30 * ONE_DAY_MS)
          .reduce(
            (maxValue, entry) => Math.max(maxValue, Number(entry.playing) || 0),
            0,
          )
      : null

  let note = null
  if (observedHistoryHours < 4) {
    note =
      'Only a short observation window exists so DAU, MAU, daily visits, and session length are benchmark-driven estimates.'
  } else if (observedHistoryHours < 24) {
    note = `Observed ${roundNullable(observedHistoryHours, 1)} hours since tracking began. Daily estimates are scaled to a 24-hour baseline.`
  } else {
    note = `Observed ${roundNullable(observedHistoryHours, 1)} hours since tracking began. Peaks and heatmap are based on tracked snapshots.`
  }

  return {
    status: observedHistoryHours >= 24 ? 'available' : 'partial',
    source,
    note,
    currentCCU: game.playing,
    estimatedDAU: estimatedDau,
    estimatedMAU: estimatedMau,
    peakCCUObserved,
    peakCCU30dObserved,
    averageSessionLengthMinutes,
    dailyVisitsObserved,
    hourlyHeatmap: computeHourlyHeatmap(series),
    observedHistoryHours,
    benchmarks,
  }
}

function computeMonetizationMetrics(game, supplemental, players) {
  const gamePasses = supplemental.store.gamePasses.items ?? []
  const developerProducts = supplemental.store.developerProducts.items ?? []
  const benchmarks = players.benchmarks ?? getGenreBenchmarks(game)
  const averageGamePassPrice = roundNullable(
    averageValues(
      gamePasses.map((item) => item.price).filter((price) => Number.isFinite(price)),
    ),
    0,
  )
  const averageDeveloperProductPrice = roundNullable(
    averageValues(
      developerProducts
        .map((item) => item.price)
        .filter((price) => Number.isFinite(price)),
    ),
    0,
  )
  const totalMonetizationItemCount = gamePasses.length + developerProducts.length

  let hasPremiumPayoutsLikely = null
  if (game.price == null) {
    hasPremiumPayoutsLikely =
      totalMonetizationItemCount <= 2 &&
      ((players.averageSessionLengthMinutes ?? 0) >= 45 ||
        ['roleplay', 'social'].includes(getGenreBenchmarkKey(game)))
  }

  let strategy = 'Minimal Monetization'
  if (game.price != null) {
    strategy = 'Premium Access'
  } else if (
    totalMonetizationItemCount > 10 &&
    (averageGamePassPrice ?? averageDeveloperProductPrice ?? 0) > 200
  ) {
    strategy = 'Heavy IAP'
  } else if (totalMonetizationItemCount > 5) {
    strategy = 'Moderate IAP'
  } else if (hasPremiumPayoutsLikely) {
    strategy = 'Premium Payouts Focus'
  } else if (totalMonetizationItemCount > 0) {
    strategy = 'Light IAP'
  }

  const availableCount = [
    supplemental.store.gamePasses.status,
    supplemental.store.developerProducts.status,
  ].filter((status) => status === 'available').length
  const partialCount = [
    supplemental.store.gamePasses.status,
    supplemental.store.developerProducts.status,
  ].filter((status) => status === 'partial').length
  const status = availableCount === 2 ? 'available' : availableCount > 0 || partialCount > 0 || game.price != null ? 'partial' : 'unavailable'
  const notes = [
    supplemental.store.gamePasses.note,
    supplemental.store.developerProducts.note,
    status !== 'unavailable'
      ? 'Strategy and payout fields are heuristic classifications, not Roblox-owner analytics.'
      : null,
  ].filter(Boolean)

  return {
    status,
    source: 'Public Roblox store endpoints + internal monetization heuristics',
    note: notes.length > 0 ? notes.join(' ') : null,
    hasPremiumPayoutsLikely,
    strategy,
    gamePassCount: gamePasses.length,
    developerProductCount: developerProducts.length,
    totalMonetizationItemCount,
    averageGamePassPrice,
    averageDeveloperProductPrice,
    gamePassCountVsGenreAverage:
      benchmarks.itemCountAverage > 0
        ? roundNullable(
            ((gamePasses.length - benchmarks.itemCountAverage) / benchmarks.itemCountAverage) * 100,
          )
        : null,
    averageGamePassPriceVsGenreAverage:
      averageGamePassPrice != null && benchmarks.gamePassPriceAverage > 0
        ? roundNullable(
            ((averageGamePassPrice - benchmarks.gamePassPriceAverage) /
              benchmarks.gamePassPriceAverage) *
              100,
          )
        : null,
  }
}

function computeRevenuePerVisitRange(game, monetization, benchmarks) {
  let intensity = 1

  if (game.price != null) {
    intensity += 0.2
  }

  if (game.createVipServersAllowed) {
    intensity += 0.05
  }

  if (monetization.totalMonetizationItemCount > 0) {
    intensity += clampNumber(
      monetization.totalMonetizationItemCount / Math.max(benchmarks.itemCountAverage, 1),
      0.1,
      1.2,
    ) * 0.2
  }

  if (
    monetization.averageGamePassPrice != null &&
    benchmarks.gamePassPriceAverage > 0
  ) {
    intensity += clampNumber(
      monetization.averageGamePassPrice / benchmarks.gamePassPriceAverage,
      0.25,
      1.75,
    ) * 0.1
  }

  intensity = clampNumber(intensity, 0.7, 1.8)

  return {
    low: roundNullable(benchmarks.rpvLow * intensity, 2),
    mid: roundNullable(benchmarks.rpvMid * intensity, 2),
    high: roundNullable(benchmarks.rpvHigh * intensity, 2),
  }
}

function computeFinancialMetrics(game, players, monetization) {
  const benchmarks = players.benchmarks ?? getGenreBenchmarks(game)
  const estimatedRevenuePerVisit = computeRevenuePerVisitRange(game, monetization, benchmarks)
  const estimatedDailyVisits =
    players.dailyVisitsObserved ??
    (players.estimatedDAU == null
      ? null
      : roundNullable(players.estimatedDAU * benchmarks.sessionsPerUser, 0))
  const robuxToUsd = (robux) => robux * 0.7 * 0.0038
  const toRange = (multiplier, inputRange) => ({
    low: inputRange.low == null ? null : roundNullable(multiplier(inputRange.low), 0),
    mid: inputRange.mid == null ? null : roundNullable(multiplier(inputRange.mid), 0),
    high: inputRange.high == null ? null : roundNullable(multiplier(inputRange.high), 0),
  })
  const dailyRobuxRange =
    estimatedDailyVisits == null
      ? { low: null, mid: null, high: null }
      : {
          low: estimatedRevenuePerVisit.low == null ? null : estimatedDailyVisits * estimatedRevenuePerVisit.low,
          mid: estimatedRevenuePerVisit.mid == null ? null : estimatedDailyVisits * estimatedRevenuePerVisit.mid,
          high:
            estimatedRevenuePerVisit.high == null ? null : estimatedDailyVisits * estimatedRevenuePerVisit.high,
        }
  const estimatedDailyRevenueUsd = toRange(robuxToUsd, dailyRobuxRange)
  const estimatedMonthlyRevenueUsd = toRange((value) => value * 30, estimatedDailyRevenueUsd)
  const estimatedAnnualRunRateUsd = toRange((value) => value * 12, estimatedMonthlyRevenueUsd)
  const estimatedValuationUsd = {
    low:
      estimatedMonthlyRevenueUsd.low == null
        ? null
        : roundNullable(estimatedMonthlyRevenueUsd.low * 6, 0),
    mid:
      estimatedMonthlyRevenueUsd.mid == null
        ? null
        : roundNullable(estimatedMonthlyRevenueUsd.mid * 12, 0),
    high:
      estimatedMonthlyRevenueUsd.high == null
        ? null
        : roundNullable(estimatedMonthlyRevenueUsd.high * 18, 0),
  }

  let confidenceScore = 0
  if (players.observedHistoryHours >= 24) confidenceScore += 1
  if (players.observedHistoryHours >= 24 * 3) confidenceScore += 1
  if (players.dailyVisitsObserved != null) confidenceScore += 1
  if (players.averageSessionLengthMinutes != null) confidenceScore += 1
  if (monetization.gamePassCount > 0) confidenceScore += 1
  if (monetization.developerProductCount > 0) confidenceScore += 1

  const confidence =
    confidenceScore >= 5 ? 'high' : confidenceScore >= 3 ? 'medium' : 'low'

  const methodology = [
    `DAU estimate uses a ${benchmarks.dauMultiplier.toFixed(1)}x CCU multiplier for the ${getGenreBenchmarkKey(game)} benchmark bucket.`,
    `RPV range starts from public genre benchmarks (${benchmarks.rpvLow.toFixed(2)}-${benchmarks.rpvHigh.toFixed(2)} R$/visit) and is adjusted by public monetization signals.`,
    players.dailyVisitsObserved != null
      ? 'Daily visits are based on observed lifetime-visit deltas from tracked snapshots.'
      : `Daily visits fall back to estimated DAU x ${benchmarks.sessionsPerUser.toFixed(2)} sessions/day.`,
    'USD figures assume Roblox net share and a 0.0038 USD DevEx rate per Robux after platform share.',
    'Valuation range is a directional monthly-revenue multiple, not a verified transaction price.',
  ]

  return {
    status: 'available',
    source: 'Internal revenue model from tracked Roblox snapshots + public game metadata',
    note:
      confidence === 'low'
        ? 'Short history and limited public store visibility keep this estimate low-confidence.'
        : 'Revenue is a modeled range, not owner-reported earnings.',
    confidence,
    estimatedRevenuePerVisit,
    estimatedDailyRevenueUsd,
    estimatedMonthlyRevenueUsd,
    estimatedAnnualRunRateUsd,
    estimatedValuationUsd,
    methodology,
  }
}

function classifyGrowth(ccuGrowth) {
  if (ccuGrowth == null) {
    return 'Unclassified'
  }

  if (ccuGrowth > 50) return 'Exploding'
  if (ccuGrowth > 10) return 'Growing'
  if (ccuGrowth >= -10) return 'Stable'
  if (ccuGrowth >= -50) return 'Declining'
  return 'Dead'
}

function computeGrowthMetrics(game, peers, financials) {
  const series = buildObservedSeries(game)
  const observedHistoryHours = getObservedHistoryHours(series)
  const growth7d = computeGrowthWindow(
    series,
    7 * ONE_DAY_MS,
    financials.estimatedRevenuePerVisit.mid,
  )
  const growth30d = computeGrowthWindow(
    series,
    30 * ONE_DAY_MS,
    financials.estimatedRevenuePerVisit.mid,
  )
  const growth90d = computeGrowthWindow(
    series,
    90 * ONE_DAY_MS,
    financials.estimatedRevenuePerVisit.mid,
  )
  const fallbackGrowth = roundNullable(game.delta24h)
  const genreAverageGrowth30d = roundNullable(
    averageValues(
      peers
        .filter((peer) => peer.genre === game.genre)
        .map((peer) => computeGrowthWindow(buildObservedSeries(peer), 30 * ONE_DAY_MS, null).ccu)
        .filter((value) => Number.isFinite(value)),
    ),
  )
  const daysSinceLastUpdate = Math.max(
    Math.floor((Date.now() - new Date(game.updated).getTime()) / ONE_DAY_MS),
    0,
  )
  const classification = classifyGrowth(growth30d.ccu ?? growth7d.ccu ?? fallbackGrowth)

  let note = null
  if (observedHistoryHours < 24 * 7) {
    note = `Observed ${roundNullable(observedHistoryHours, 1)} hours so far. Seven, thirty, and ninety-day windows remain blank until enough history exists.`
  } else {
    note = 'Growth windows are computed from tracked CCU and visit snapshots.'
  }

  return {
    status: observedHistoryHours >= 24 * 7 ? 'available' : 'partial',
    source: 'Tracked Roblox snapshot time series',
    note,
    observedHistoryHours: roundNullable(observedHistoryHours, 1) ?? 0,
    growth7d,
    growth30d,
    growth90d,
    classification,
    daysSinceLastUpdate,
    genreAverageGrowth30d,
  }
}

function computeRblxScore(game, growth, financials, monetization) {
  const growthSignal = growth.growth30d.ccu ?? growth.growth7d.ccu ?? game.delta24h ?? 0
  const growthScore = clampNumber(((growthSignal + 50) / 100) * 100, 0, 100)
  const engagementScore = clampNumber(game.approval, 0, 100)
  const monetizationHigh = Math.max(financials.estimatedRevenuePerVisit.high ?? 1, 1)
  const monetizationMid = financials.estimatedRevenuePerVisit.mid ?? 0
  const monetizationScore = clampNumber((monetizationMid / monetizationHigh) * 100, 0, 100)
  const scaleScore = clampNumber((Math.log10(game.playing + 1) / 5) * 100, 0, 100)
  const freshnessScore = clampNumber(
    100 -
      Math.max(Math.floor((Date.now() - new Date(game.updated).getTime()) / ONE_DAY_MS), 0) * 3,
    0,
    100,
  )
  const socialScore =
    monetization.status === 'unavailable' && financials.confidence === 'low' ? 50 : 55

  return roundNullable(
    growthScore * 0.25 +
      engagementScore * 0.2 +
      monetizationScore * 0.2 +
      scaleScore * 0.15 +
      freshnessScore * 0.1 +
      socialScore * 0.1,
    0,
  )
}

function computeComparableScore(target, candidate) {
  const targetGenreKey = getGenreBenchmarkKey(target)
  const candidateGenreKey = getGenreBenchmarkKey(candidate)
  const ccuRatio =
    Math.min(target.playing, candidate.playing) / Math.max(target.playing, candidate.playing, 1)
  const visitRatio =
    Math.min(target.visits, candidate.visits) / Math.max(target.visits, candidate.visits, 1)
  const approvalGap = Math.abs(target.approval - candidate.approval)
  const freshnessGapDays = Math.abs(
    (new Date(target.updated).getTime() - new Date(candidate.updated).getTime()) / ONE_DAY_MS,
  )

  let score = 0
  if (target.genre === candidate.genre) score += 35
  else if (targetGenreKey === candidateGenreKey) score += 25
  score += ccuRatio * 30
  score += visitRatio * 15
  score += clampNumber(1 - approvalGap / 25, 0, 1) * 10
  score += clampNumber(1 - freshnessGapDays / 90, 0, 1) * 10

  return roundNullable(score, 1) ?? 0
}

function computeComparableRevenueRange(game) {
  const benchmarks = getGenreBenchmarks(game)
  const estimatedDau = (game.playing || 0) * benchmarks.dauMultiplier
  const dailyVisits = estimatedDau * benchmarks.sessionsPerUser
  const dailyRevenueUsd = dailyVisits * benchmarks.rpvMid * 0.7 * 0.0038
  const monthlyMid = dailyRevenueUsd * 30

  return {
    low: roundNullable(monthlyMid * 0.6, 0),
    mid: roundNullable(monthlyMid, 0),
    high: roundNullable(monthlyMid * 1.5, 0),
  }
}

function computeComparables(game, peers) {
  const games = peers
    .filter((peer) => peer.universeId !== game.universeId)
    .map((peer) => ({
      universeId: peer.universeId,
      name: peer.name,
      genre: peer.genre,
      similarityScore: computeComparableScore(game, peer),
      playing: peer.playing,
      visits: peer.visits,
      approval: roundNullable(peer.approval, 1) ?? peer.approval,
      updated: peer.updated,
      estimatedMonthlyRevenueUsd: computeComparableRevenueRange(peer),
    }))
    .sort((left, right) => right.similarityScore - left.similarityScore)
    .slice(0, GAME_PAGE_COMPARABLE_LIMIT)

  return {
    status: games.length >= 5 ? 'available' : games.length > 0 ? 'partial' : 'unavailable',
    source: 'Internal similarity model across the tracked Roblox board',
    note:
      games.length > 0
        ? 'Comparable set is currently limited to the tracked board, not the full Roblox catalog.'
        : 'No comparable tracked games were available yet.',
    games,
  }
}

function addFinancialRanges(left, right) {
  return {
    low: roundNullable((left.low ?? 0) + (right.low ?? 0), 0),
    mid: roundNullable((left.mid ?? 0) + (right.mid ?? 0), 0),
    high: roundNullable((left.high ?? 0) + (right.high ?? 0), 0),
  }
}

function computeDeveloperSummary(game, supplemental) {
  const portfolioGames = supplemental.creatorPortfolio.games ?? []
  const estimatedPortfolioMonthlyRevenueUsd = portfolioGames.reduce(
    (total, entry) => addFinancialRanges(total, computeComparableRevenueRange(entry)),
    { low: 0, mid: 0, high: 0 },
  )
  const aggregateVisits =
    game.visits +
    portfolioGames.reduce((sum, entry) => sum + (entry.visits ?? 0), 0)
  const aggregatePlaying =
    game.playing +
    portfolioGames.reduce((sum, entry) => sum + (entry.playing ?? 0), 0)
  const breadthScore = clampNumber((supplemental.creatorPortfolio.totalCount / 12) * 20, 0, 20)
  const scaleScore = clampNumber((Math.log10(aggregateVisits + 1) / 9) * 45, 0, 45)
  const liveScore = clampNumber((Math.log10(aggregatePlaying + 1) / 6) * 25, 0, 25)
  const approvalScore = clampNumber((game.approval / 100) * 10, 0, 10)
  const verifiedScore = supplemental.creatorProfile.hasVerifiedBadge ? 10 : 0
  const trackRecordScore = roundNullable(
    clampNumber(scaleScore + liveScore + breadthScore + approvalScore + verifiedScore, 0, 100),
    0,
  )

  return {
    status:
      supplemental.creatorPortfolio.status === 'available' ||
      supplemental.creatorProfile.status === 'available'
        ? 'available'
        : 'partial',
    source: 'Public creator portfolio data + internal revenue heuristics',
    note:
      'Portfolio revenue and track record are modeled from the creator’s public Roblox games, not verified backend analytics.',
    estimatedPortfolioMonthlyRevenueUsd,
    trackRecordScore,
  }
}

function buildSocialDiscoverySection() {
  return {
    status: 'unavailable',
    source: 'YouTube Data API, X API, TikTok scraping, Roblox search-rank polling',
    note:
      'Public social coverage is blocked right now: YouTube search needs an API key, X needs API or a scraper, TikTok search blocks unauthenticated access, and Roblox search trend requires separate rank polling over time.',
    youtube: null,
    tiktok: null,
    x: null,
    robloxSearchTrend: null,
  }
}

async function fetchCreatorProfile(game) {
  const creatorId = game.creatorId
  const creatorType = game.creatorType

  if (!Number.isFinite(creatorId) || creatorId <= 0) {
    return {
      status: 'unavailable',
      source: creatorType === 'Group' ? 'groups.roblox.com' : 'users.roblox.com',
      note: 'Creator id was not available for this experience.',
    }
  }

  try {
    if (creatorType === 'Group') {
      const response = await fetchJson(`https://groups.roblox.com/v1/groups/${creatorId}`, 0)
      return {
        status: 'available',
        source: 'groups.roblox.com/v1/groups/:groupId',
        profileUrl: `https://www.roblox.com/communities/${creatorId}`,
        id: response.id,
        type: 'Group',
        name: response.name,
        description: response.description ?? '',
        hasVerifiedBadge: Boolean(response.hasVerifiedBadge),
        memberCount: response.memberCount ?? null,
        created: null,
        owner: response.owner
          ? {
              userId: response.owner.userId,
              username: response.owner.username,
              displayName: response.owner.displayName,
              hasVerifiedBadge: Boolean(response.owner.hasVerifiedBadge),
            }
          : null,
        note: null,
      }
    }

    const response = await fetchJson(`https://users.roblox.com/v1/users/${creatorId}`, 0)
    return {
      status: 'available',
      source: 'users.roblox.com/v1/users/:userId',
      profileUrl: `https://www.roblox.com/users/${creatorId}/profile`,
      id: response.id,
      type: 'User',
      name: response.name,
      displayName: response.displayName,
      description: response.description ?? '',
      hasVerifiedBadge: Boolean(response.hasVerifiedBadge),
      memberCount: null,
      created: response.created ?? null,
      owner: null,
      note: null,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source: creatorType === 'Group' ? 'groups.roblox.com/v1/groups/:groupId' : 'users.roblox.com/v1/users/:userId',
      note: toErrorNote(error, 'Failed to fetch public creator profile data'),
    }
  }
}

async function fetchCreatorPortfolio(game) {
  const creatorId = game.creatorId
  const creatorType = game.creatorType

  if (!Number.isFinite(creatorId) || creatorId <= 0) {
    return {
      status: 'unavailable',
      source: creatorType === 'Group' ? 'games.roblox.com/v2/groups/:groupId/games' : 'games.roblox.com/v2/users/:userId/games',
      note: 'Creator id was not available for portfolio lookup.',
      totalCount: 0,
      games: [],
    }
  }

  const endpoint =
    creatorType === 'Group'
      ? `https://games.roblox.com/v2/groups/${creatorId}/games?sortOrder=Desc&limit=50`
      : `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Desc&limit=50`

  try {
    const response = await fetchJson(endpoint, 0)
    const rawGames = Array.isArray(response.data) ? response.data : []
    const portfolioGames = rawGames
      .filter((entry) => entry.id !== game.universeId)
      .sort((left, right) => (right.placeVisits ?? 0) - (left.placeVisits ?? 0))

    const selectedUniverseIds = portfolioGames
      .slice(0, GAME_PAGE_CREATOR_PORTFOLIO_LIMIT)
      .map((entry) => entry.id)

    const livePortfolio =
      selectedUniverseIds.length > 0 ? await fetchUniverseGames(selectedUniverseIds) : { games: [] }
    const liveByUniverseId = new Map(
      livePortfolio.games.map((entry) => [entry.universeId, entry]),
    )

    return {
      status: 'available',
      source:
        creatorType === 'Group'
          ? 'games.roblox.com/v2/groups/:groupId/games'
          : 'games.roblox.com/v2/users/:userId/games',
      note: null,
      totalCount: portfolioGames.length,
      games: portfolioGames.slice(0, GAME_PAGE_CREATOR_PORTFOLIO_LIMIT).map((entry) => {
        const live = liveByUniverseId.get(entry.id)
        return {
          universeId: entry.id,
          rootPlaceId: entry.rootPlace?.id ?? live?.rootPlaceId ?? null,
          name: live?.name ?? entry.name,
          genre: live?.genre ?? 'Unclassified',
          playing: live?.playing ?? null,
          visits: live?.visits ?? entry.placeVisits ?? null,
          updated: live?.updated ?? entry.updated ?? null,
          created: entry.created ?? null,
          thumbnailUrl: live?.thumbnailUrl,
        }
      }),
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source:
        creatorType === 'Group'
          ? 'games.roblox.com/v2/groups/:groupId/games'
          : 'games.roblox.com/v2/users/:userId/games',
      note: toErrorNote(error, 'Failed to fetch creator portfolio data'),
      totalCount: 0,
      games: [],
    }
  }
}

async function fetchServerSample(game) {
  if (!Number.isFinite(game.rootPlaceId) || game.rootPlaceId <= 0) {
    return {
      status: 'unavailable',
      source: 'games.roblox.com/v1/games/:placeId/servers/0',
      note: 'Root place id was not available for active server sampling.',
    }
  }

  let nextPageCursor = null
  let sampledServerCount = 0
  let sampledPlayerCount = 0
  const sampledServers = []
  let pageCount = 0
  let complete = false

  try {
    while (pageCount < GAME_PAGE_SERVER_SAMPLE_MAX_PAGES) {
      const cursorQuery = nextPageCursor
        ? `&cursor=${encodeURIComponent(nextPageCursor)}`
        : ''
      const response = await fetchJson(
        `https://games.roblox.com/v1/games/${game.rootPlaceId}/servers/0?sortOrder=2&excludeFullGames=false&limit=${GAME_PAGE_SERVER_SAMPLE_LIMIT}${cursorQuery}`,
        0,
      )

      const data = Array.isArray(response.data) ? response.data : []
      sampledServerCount += data.length
      sampledPlayerCount += data.reduce(
        (sum, entry) => sum + (Number(entry.playing) || 0),
        0,
      )

      if (sampledServers.length < 20) {
        sampledServers.push(
          ...data.slice(0, 20 - sampledServers.length).map((entry) => ({
            id: entry.id,
            playing: Number(entry.playing) || 0,
            maxPlayers: Number(entry.maxPlayers) || game.maxPlayers || 0,
            ping: Number.isFinite(Number(entry.ping)) ? Number(entry.ping) : null,
            fps: Number.isFinite(Number(entry.fps)) ? Number(entry.fps) : null,
          })),
        )
      }

      pageCount += 1
      nextPageCursor = response.nextPageCursor ?? null

      if (!nextPageCursor) {
        complete = true
        break
      }
    }

    const averagePlayersPerServer =
      sampledServerCount > 0 ? sampledPlayerCount / sampledServerCount : 0
    const fillRate =
      game.maxPlayers > 0 ? (averagePlayersPerServer / game.maxPlayers) * 100 : 0
    const estimatedActiveServers =
      sampledServerCount > 0 && averagePlayersPerServer > 0
        ? Math.max(Math.ceil(game.playing / averagePlayersPerServer), sampledServerCount)
        : null

    return {
      status: complete ? 'available' : 'partial',
      source: 'games.roblox.com/v1/games/:placeId/servers/0',
      note: complete
        ? null
        : `Sampled ${sampledServerCount} servers across ${pageCount} pages before hitting the crawl limit.`,
      pageCount,
      sampledServerCount,
      sampledPlayerCount,
      exactActiveServerCount: complete ? sampledServerCount : null,
      estimatedActiveServerCount: complete ? sampledServerCount : estimatedActiveServers,
      averagePlayersPerServer,
      fillRate,
      servers: sampledServers,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source: 'games.roblox.com/v1/games/:placeId/servers/0',
      note: toErrorNote(error, 'Failed to fetch active server sample data'),
    }
  }
}

function normalizeStoreItem(item) {
  const price =
    parseIntegerOrNull(item.price) ??
    parseIntegerOrNull(item.PriceInRobux) ??
    parseIntegerOrNull(item.priceInRobux)

  return {
    id:
      parseIntegerOrNull(item.id) ??
      parseIntegerOrNull(item.passId) ??
      parseIntegerOrNull(item.productId) ??
      parseIntegerOrNull(item.ProductId) ??
      parseIntegerOrNull(item.targetId) ??
      parseIntegerOrNull(item.DeveloperProductId),
    name: item.name ?? item.Name ?? item.displayName ?? 'Unnamed item',
    price,
  }
}

async function fetchGamePassInventory(universeId) {
  const source = 'games.roblox.com/v1/games/:universeId/game-passes'

  try {
    const response = await fetchJson(
      `https://games.roblox.com/v1/games/${universeId}/game-passes?sortOrder=Asc&limit=100`,
      0,
    )
    const items = Array.isArray(response.data) ? response.data.map(normalizeStoreItem) : []

    return {
      status: 'available',
      source,
      note: null,
      totalCount: items.length,
      items,
    }
  } catch (error) {
    const note =
      error?.statusCode === 404
        ? 'Legacy public game-pass endpoint returned 404, and a public replacement was not exposed in the page HTML.'
        : toErrorNote(error, 'Failed to fetch public game-pass inventory')

    return {
      status: 'unavailable',
      source,
      note,
      totalCount: 0,
      items: [],
    }
  }
}

async function fetchDeveloperProductInventory(universeId) {
  const source = 'apis.roblox.com/experience-store/v1/universes/:universeId/store'

  try {
    const response = await fetchJson(
      `https://apis.roblox.com/experience-store/v1/universes/${universeId}/store`,
      0,
    )
    const items = Array.isArray(response.developerProducts)
      ? response.developerProducts.map(normalizeStoreItem)
      : []

    return {
      status: 'available',
      source,
      note: null,
      totalCount: items.length,
      items,
    }
  } catch (error) {
    const note =
      error?.statusCode === 401
        ? 'Roblox now requires an authenticated cookie for the experience-store developer products endpoint.'
        : toErrorNote(error, 'Failed to fetch developer product inventory')

    return {
      status: 'unavailable',
      source,
      note,
      totalCount: 0,
      items: [],
    }
  }
}

function buildUnavailableGameSupplementalData(game) {
  return {
    pageMeta: {
      status: 'unavailable',
      source: 'Deferred supplemental fetch',
      note: 'Supplemental game metadata is still loading.',
      rootPlaceId: game.rootPlaceId ?? null,
      seoImageUrl: null,
    },
    ageRating: {
      status: 'unavailable',
      source: 'Deferred supplemental fetch',
      note: 'Age-rating details are still loading.',
      label: null,
      minimumAge: null,
      displayName: null,
      descriptors: [],
    },
    creatorProfile: {
      status: 'unavailable',
      source: 'Deferred supplemental fetch',
      note: 'Creator profile details are still loading.',
      hasVerifiedBadge: Boolean(game.creatorHasVerifiedBadge),
    },
    creatorPortfolio: {
      status: 'unavailable',
      source: 'Deferred supplemental fetch',
      note: 'Creator portfolio details are still loading.',
      totalCount: 0,
      games: [],
    },
    servers: {
      status: 'unavailable',
      source: 'Deferred supplemental fetch',
      note: 'Server sample details are still loading.',
      servers: [],
    },
    store: {
      gamePasses: {
        status: 'unavailable',
        source: 'Deferred supplemental fetch',
        note: 'Game pass inventory is still loading.',
        totalCount: 0,
        items: [],
      },
      developerProducts: {
        status: 'unavailable',
        source: 'Deferred supplemental fetch',
        note: 'Developer product inventory is still loading.',
        totalCount: 0,
        items: [],
      },
    },
  }
}

async function fetchGameSupplementalData(game, { allowNetwork = true } = {}) {
  const cacheKey = String(game.universeId)
  const cached = readCache(gameSupplementalCache, cacheKey)

  if (cached) {
    return cached
  }

  if (!allowNetwork) {
    return buildUnavailableGameSupplementalData(game)
  }

  const [
    pageMeta,
    ageRating,
    creatorProfile,
    creatorPortfolio,
    servers,
    gamePasses,
    developerProducts,
  ] =
    await Promise.all([
      fetchRobloxGamePageMetadata(game.rootPlaceId),
      fetchAgeRating(game.universeId),
      fetchCreatorProfile(game),
      fetchCreatorPortfolio(game),
      fetchServerSample(game),
      fetchGamePassInventory(game.universeId),
      fetchDeveloperProductInventory(game.universeId),
    ])

  const supplemental = {
    pageMeta,
    ageRating,
    creatorProfile,
    creatorPortfolio,
    servers,
    store: {
      gamePasses,
      developerProducts,
    },
  }

  writeCache(
    gameSupplementalCache,
    cacheKey,
    supplemental,
    GAME_SUPPLEMENTAL_CACHE_TTL_MS,
  )

  return supplemental
}

async function hydrateTrackedUniverses(universeIds, range = '24h') {
  const currentTrackedIds = getTrackedUniverseIds()
  const ids = universeIds.length > 0 ? universeIds : currentTrackedIds
  const uniqueIds = [...new Set(ids.length > 0 ? ids : DEFAULT_TRACKED_IDS)]
  const { games, source } = await fetchUniverseGames(uniqueIds)

  if (source === 'live' && SERVER_ENABLE_SCHEDULED_INGEST) {
    recordSnapshots(games)
  }
  replaceTrackedUniverseIds(uniqueIds)

  const historyMap = getHistoryMap(uniqueIds, getHistoryCutoffIso())
  return buildBoardPayload(games, historyMap, source, range)
}

async function fetchPlatformBoardPayload(range = '24h') {
  const cachedBoard = readCache(boardCache, range)

  if (cachedBoard) {
    return cachedBoard
  }

  const trackedUniverseIds = getTrackedUniverseIds()
  const trackedIds = trackedUniverseIds.length > 0 ? trackedUniverseIds : DEFAULT_TRACKED_IDS
  const trackedSnapshotGames = getLatestSnapshotGames(trackedIds)
  const [platformSet, trackedLiveFallback] = await Promise.all([
    fetchPlatformDiscoverySet(),
    trackedSnapshotGames.length > 0
      ? Promise.resolve({ games: trackedSnapshotGames, source: 'database' })
      : fetchUniverseGames(trackedIds),
  ])
  lastBoardUniverseIds = platformSet.discoveredUniverseIds

  const liveSnapshotGames = mergeSnapshotGames(
    platformSet.source === 'live' ? platformSet.games : [],
    trackedLiveFallback.source === 'live' ? trackedLiveFallback.games : [],
  )

  if (SERVER_ENABLE_SCHEDULED_INGEST && liveSnapshotGames.length > 0) {
    recordSnapshots(liveSnapshotGames, {
      observedAt: new Date().toISOString(),
    })
  }

  const platformHistoryMap = getHistoryMap(
    platformSet.discoveredUniverseIds,
    getHistoryCutoffIso(),
  )
  const trackedHistoryMap = getHistoryMap(trackedIds, getHistoryCutoffIso())

  const payload = buildBoardPayload(
    platformSet.games,
    platformHistoryMap,
    platformSet.source,
    range,
    {
      games: trackedLiveFallback.games,
      historyMap: trackedHistoryMap,
    },
    {
      discoveredSorts: platformSet.discoveredSorts,
    },
  )

  writeCache(boardCache, range, payload, getBoardPayloadCacheTtlMs(range))
  return payload
}

function fetchBoardLivePointPayload() {
  const universeIds =
    lastBoardUniverseIds.length > 0
      ? lastBoardUniverseIds
      : getTrackedUniverseIds().length > 0
        ? getTrackedUniverseIds()
        : DEFAULT_TRACKED_IDS
  const latestGames = getLatestSnapshotGames(universeIds)

  return {
    value: latestGames.reduce((sum, game) => sum + game.playing, 0),
    timestamp: new Date().toISOString(),
    source: 'database',
  }
}

async function fetchGamePagePayload(universeId, range = '24h', detailLevel = 'full') {
  const cacheKey = `${universeId}:${range}:${detailLevel}`
  const cachedPayload = readCache(gamePageCache, cacheKey)

  if (cachedPayload) {
    return cachedPayload
  }

  const { games, source } = await fetchUniverseGames([universeId])

  if (games.length === 0) {
    const error = new Error('Game not found.')
    error.statusCode = 404
    throw error
  }

  if (source === 'live' && SERVER_ENABLE_SCHEDULED_INGEST) {
    recordSnapshots(games)
  }

  appendTrackedUniverseIds([universeId], TRACKED_UNIVERSE_CAP)

  const trackedUniverseIds = getTrackedUniverseIds()
  const historyMap = getHistoryMap([universeId], getHistoryCutoffIso())
  const peerGames = getLatestSnapshotGames(trackedUniverseIds)
  const supplemental = await fetchGameSupplementalData(games[0], {
    allowNetwork: detailLevel === 'full',
  })
  const payload = buildGameDetailPayload(
    games[0],
    historyMap,
    peerGames,
    trackedUniverseIds,
    supplemental,
    source,
    range,
  )

  if (detailLevel === 'full') {
    recordGamePageSnapshot(payload, {
      source: `game_page_${source}`,
    })
  }

  writeCache(
    gamePageCache,
    cacheKey,
    payload,
    getGamePagePayloadCacheTtlMs(range, detailLevel),
  )

  if (detailLevel === 'full') {
    writeCache(
      gamePageCache,
      `${universeId}:${range}:core`,
      payload,
      getGamePagePayloadCacheTtlMs(range, 'full'),
    )
  }

  return payload
}

async function pollTrackedUniverses() {
  const ingestRunId = startIngestRun('scheduler')

  try {
    const payload = await fetchPlatformBoardPayload('24h')
    const discoveredUniverseIds = lastBoardUniverseIds.length > 0
      ? lastBoardUniverseIds
      : payload.leaderboard?.map((entry) => entry.universeId) ?? []

    if (discoveredUniverseIds.length > 0) {
      appendTrackedUniverseIds(discoveredUniverseIds, TRACKED_UNIVERSE_CAP)
    }

    const trackedUniverseCount = getTrackedUniverseIds().length
    lastIngestedAt = new Date().toISOString()
    lastIngestError = null

    finishIngestRun(ingestRunId, {
      status: 'success',
      source: payload.ops?.source ?? 'live',
      trackedUniverseCount,
      discoveredUniverseCount: discoveredUniverseIds.length,
    })

    console.log(
      `[roterminal-server] ingested platform discovery set (${trackedUniverseCount} tracked, ${discoveredUniverseIds.length} discovered)`,
    )
  } catch (error) {
    lastIngestError = error instanceof Error ? error.message : 'Unknown ingestion failure'
    finishIngestRun(ingestRunId, {
      status: 'failed',
      source: 'error',
      trackedUniverseCount: getTrackedUniverseIds().length,
      errorMessage: lastIngestError,
    })
    console.error('[roterminal-server] polling failed', error)
  }
}

async function runScheduledIngest() {
  if (!SERVER_ENABLE_SCHEDULED_INGEST || scheduledIngestInFlight) {
    return
  }

  const acquired = tryAcquireIngestLease('scheduler', schedulerOwnerId, {
    ownerLabel: `api-server:${PORT}`,
    ttlMs: INGEST_LEASE_TTL_MS,
  })

  if (!acquired) {
    return
  }

  scheduledIngestInFlight = true

  try {
    await pollTrackedUniverses()
  } finally {
    scheduledIngestInFlight = false
  }
}

function getOpsMetrics() {
  const latestIngestRun = getLatestIngestRun()
  const activeLease = getActiveIngestLease('scheduler')
  const lastIngestedAtMs =
    typeof lastIngestedAt === 'string' ? Date.parse(lastIngestedAt) : Number.NaN
  const activeLeaseExpiresAtMs =
    typeof activeLease?.expires_at === 'string'
      ? Date.parse(activeLease.expires_at)
      : Number.NaN
  const staleIngest =
    Number.isFinite(lastIngestedAtMs) && Date.now() - lastIngestedAtMs > INGEST_STALE_AFTER_MS
  const missingIngest = !Number.isFinite(lastIngestedAtMs)
  const activeLeaseExpired =
    Number.isFinite(activeLeaseExpiresAtMs) && activeLeaseExpiresAtMs <= Date.now()
  const healthy =
    lastIngestError == null && !missingIngest && !staleIngest && !activeLeaseExpired

  return {
    ok: healthy,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    trackedUniverseCount: getTrackedUniverseIds().length,
    warehouse: {
      catalogUniverseCount: countCatalogEntries(),
      observationCount: countObservations(),
      dailyMetricCount: countDailyMetrics(),
      metadataHistoryCount: countMetadataHistory(),
      derivedHistoryCount: countDerivedHistory(),
      externalHistoryCount: countExternalHistory(),
      externalImportRunCount: countExternalImportRuns(),
      legacySnapshotCount: countSnapshots(),
      observationRetentionDays: Math.round(SNAPSHOT_RETENTION_MS / ONE_DAY_MS),
    },
    lastIngestedAt,
    lastIngestError,
    latestIngestRun,
    activeIngestLease: activeLease,
    ingestIntervalMs: INGEST_INTERVAL_MS,
    ingestStaleAfterMs: INGEST_STALE_AFTER_MS,
    ingest: {
      healthy,
      missing: missingIngest,
      stale: staleIngest,
      activeLeaseExpired,
    },
    homeRecommendations: {
      seedCountConfigured: ROBLOX_AUTH_COOKIE_HEADERS.length,
      lastAttemptedAt: lastHomeFetchAttemptedAt,
      lastSucceededAt: lastHomeFetchSucceededAt,
      lastError: lastHomeFetchError,
      sortCount: lastHomeFetchSortCount,
      universeCount: lastHomeFetchUniverseCount,
      seedSuccessCount: lastHomeFetchSeedSuccessCount,
      seedFailureCount: lastHomeFetchSeedFailureCount,
    },
    cache: {
      searchKeys: searchCache.size,
      gameKeys: gamesCache.size,
      platformKeys: platformCache.size,
      boardKeys: boardCache.size,
      supplementalKeys: gameSupplementalCache.size,
    },
    databasePath: DB_PATH,
  }
}

function buildSingleGameTimeline(game, range = '24h') {
  const cutoffMs = Date.now() - CHART_RANGE_MS[range]
  const points = [
    ...game.history.map((entry) => ({
      timestamp: entry.timestamp,
      value: entry.playing,
    })),
    {
      timestamp: new Date().toISOString(),
      value: game.playing,
    },
  ].filter((point) => new Date(point.timestamp).getTime() >= cutoffMs)

  return limitTrendPoints(points, getMaxTrendPoints(range)).map((point) => ({
    label: formatTrendLabel(point.timestamp),
    timestamp: point.timestamp,
    value: point.value,
  }))
}

function buildGameIssues(game) {
  const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS

  return [
    {
      title: 'Update cadence',
      bullish:
        hoursSinceUpdate <= 24
          ? `${game.name} updated recently, which keeps it inside the strongest observation window for traffic continuation.`
          : `${game.name} is still holding scale without an immediate update catalyst, which points to durable baseline demand.`,
      bearish:
        hoursSinceUpdate > 72
          ? 'No recent update means the experience can lose attention faster if discovery rotates or competitors ship first.'
          : 'If the current update window keeps decaying across the next few sweeps, the lift may prove temporary.',
    },
    {
      title: 'Approval durability',
      bullish:
        game.approval >= 85
          ? `${formatApproval(game.approval)} suggests the current audience is broadly satisfied, which usually helps spikes convert into retention.`
          : 'Approval is still strong enough that content cadence matters more than outright player dissatisfaction.',
      bearish:
        game.approval < 80
          ? 'Approval is below the strongest durability band, so traffic gains may not hold as well after the initial move.'
          : 'High approval alone will not matter if concurrency weakens while peers continue climbing.',
    },
    {
      title: 'Momentum versus baseline',
      bullish:
        game.delta6h >= 0
          ? `${game.delta6h.toFixed(1)}% over 6 hours says the current move is at least holding against the recent baseline.`
          : 'Even with short-term weakness, the game still has enough scale to recover quickly if another trigger appears.',
      bearish:
        game.delta6h < 0
          ? `${Math.abs(game.delta6h).toFixed(1)}% down over 6 hours means the recent window is losing steam and deserves monitoring.`
          : 'If the current move flattens while peers keep rising, attention may be rotating elsewhere.',
    },
  ]
}

function buildGameStats(game) {
  return [
    { label: 'RBlx Score', value: game.rblxScore == null ? 'Unavailable' : formatWholeNumber(game.rblxScore) },
    { label: 'Live CCU', value: formatWholeNumber(game.playing) },
    { label: 'Approval', value: formatApproval(game.approval) },
    { label: '1h move', value: `${game.delta1h >= 0 ? '+' : ''}${game.delta1h.toFixed(1)}%` },
    { label: '6h move', value: `${game.delta6h >= 0 ? '+' : ''}${game.delta6h.toFixed(1)}%` },
    { label: '24h move', value: `${game.delta24h >= 0 ? '+' : ''}${game.delta24h.toFixed(1)}%` },
    { label: 'Visits', value: formatCompactNumber(game.visits) },
    { label: 'Favorites', value: formatCompactNumber(game.favoritedCount) },
    { label: 'Favorites 24h', value: `${game.favoriteDelta >= 0 ? '+' : ''}${formatWholeNumber(game.favoriteDelta)}` },
    { label: 'Genre', value: game.genre },
    { label: 'Developer', value: game.creatorName },
  ]
}

function buildGameDetailPayload(
  game,
  historyMap,
  peerGames,
  trackedUniverseIds,
  supplemental,
  source,
  range = '24h',
) {
  const enrichedGame = enrichGames([game], historyMap)[0]
  const peerHistoryMap = getHistoryMap(
    peerGames.map((peer) => peer.universeId),
    getHistoryCutoffIso(),
  )
  const allPeers = enrichGames(peerGames, peerHistoryMap)
  const peers = allPeers
    .filter((peer) => peer.universeId !== enrichedGame.universeId)
    .sort((left, right) => {
      const leftGenreMatch = left.genre === enrichedGame.genre ? 1 : 0
      const rightGenreMatch = right.genre === enrichedGame.genre ? 1 : 0
      if (leftGenreMatch !== rightGenreMatch) {
        return rightGenreMatch - leftGenreMatch
      }
      return right.playing - left.playing
    })
    .slice(0, 5)
  const players = computePlayerMetrics(enrichedGame)
  const monetization = computeMonetizationMetrics(enrichedGame, supplemental, players)
  const financials = computeFinancialMetrics(enrichedGame, players, monetization)
  const growth = computeGrowthMetrics(enrichedGame, allPeers, financials)
  const comparables = computeComparables(enrichedGame, allPeers)
  const developerSummary = computeDeveloperSummary(enrichedGame, supplemental)
  const socialDiscovery = buildSocialDiscoverySection()
  const rblxScore = computeRblxScore(enrichedGame, growth, financials, monetization)

  const eventFeed = detectEvents([enrichedGame])
  const fallbackEventFeed =
    eventFeed.length > 0
      ? eventFeed
      : [
          {
            universeId: enrichedGame.universeId,
            title: `${enrichedGame.name} is being monitored for its next directional move`,
            detail: `${formatRelativeUpdate(enrichedGame.updated)} and ${formatApproval(enrichedGame.approval)} still make this page worth keeping on watch.`,
            timestamp: 'Current sweep',
            tone: enrichedGame.tone,
            category: 'update',
          },
        ]

  return {
    status: {
      label:
        source === 'live'
          ? `${enrichedGame.name} page live`
          : source === 'cache'
            ? `${enrichedGame.name} page using cache`
            : `${enrichedGame.name} page using snapshot fallback`,
      detail: `${formatWholeNumber(enrichedGame.playing)} live players · ${formatApproval(enrichedGame.approval)} · ${formatRelativeUpdate(enrichedGame.updated)}`,
      tone: source === 'live' ? 'positive' : 'neutral',
    },
    ops: {
      source,
      ingestIntervalMinutes: Math.round(INGEST_INTERVAL_MS / 60_000),
      lastIngestedAt,
    },
    game: {
      universeId: enrichedGame.universeId,
      rootPlaceId: enrichedGame.rootPlaceId ?? supplemental.pageMeta.rootPlaceId ?? null,
      name: enrichedGame.name,
      description: enrichedGame.description ?? '',
      creatorName: enrichedGame.creatorName,
      creatorId: enrichedGame.creatorId ?? null,
      creatorType: enrichedGame.creatorType,
      creatorHasVerifiedBadge:
        enrichedGame.creatorHasVerifiedBadge ??
        supplemental.creatorProfile.hasVerifiedBadge ??
        false,
      rblxScore,
      genre: enrichedGame.genre,
      genrePrimary: enrichedGame.genrePrimary ?? enrichedGame.genre,
      genreSecondary: enrichedGame.genreSecondary ?? null,
      playing: enrichedGame.playing,
      visits: enrichedGame.visits,
      favoritedCount: enrichedGame.favoritedCount,
      upVotes: enrichedGame.upVotes ?? 0,
      downVotes: enrichedGame.downVotes ?? 0,
      approval: enrichedGame.approval,
      price: enrichedGame.price ?? null,
      maxPlayers: enrichedGame.maxPlayers ?? null,
      created: enrichedGame.created ?? null,
      updated: enrichedGame.updated,
      createVipServersAllowed: enrichedGame.createVipServersAllowed ?? false,
      thumbnailUrl: enrichedGame.thumbnailUrl,
      bannerUrl: enrichedGame.bannerUrl,
      seoImageUrl: supplemental.pageMeta.seoImageUrl ?? null,
      screenshotUrls: enrichedGame.screenshotUrls ?? [],
      tracked: trackedUniverseIds.includes(enrichedGame.universeId),
    },
    timeline: buildSingleGameTimeline(enrichedGame, range),
    eventFeed: fallbackEventFeed,
    stats: buildGameStats({ ...enrichedGame, rblxScore }),
    keyIssues: buildGameIssues(enrichedGame),
    dataSections: {
      pageMeta: supplemental.pageMeta,
      ageRating: supplemental.ageRating,
      financials,
      growth,
      players: {
        status: players.status,
        source: players.source,
        note: players.note,
        currentCCU: players.currentCCU,
        estimatedDAU: players.estimatedDAU,
        estimatedMAU: players.estimatedMAU,
        peakCCUObserved: players.peakCCUObserved,
        peakCCU30dObserved: players.peakCCU30dObserved,
        averageSessionLengthMinutes: players.averageSessionLengthMinutes,
        dailyVisitsObserved: players.dailyVisitsObserved,
        hourlyHeatmap: players.hourlyHeatmap,
      },
      monetization,
      comparables,
      developerSummary,
      creatorProfile: supplemental.creatorProfile,
      creatorPortfolio: supplemental.creatorPortfolio,
      servers: supplemental.servers,
      socialDiscovery,
      store: supplemental.store,
    },
    peers: peers.map((peer) => ({
      universeId: peer.universeId,
      name: peer.name,
      creator: peer.creatorName,
      ccu: formatWholeNumber(peer.playing),
      change: Number(peer.approval.toFixed(1)),
      tone: getToneFromApproval(peer.approval),
    })),
  }
}

await migrateLegacyJsonIfNeeded(database)

if (SERVER_ENABLE_SCHEDULED_INGEST) {
  await runScheduledIngest()
  setInterval(() => {
    void runScheduledIngest()
  }, INGEST_INTERVAL_MS)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const started = Date.now()

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        trackedUniverseIds: getTrackedUniverseIds(),
        lastIngestedAt,
        lastIngestError,
        scheduledIngestEnabled: SERVER_ENABLE_SCHEDULED_INGEST,
        ingestIntervalMs: INGEST_INTERVAL_MS,
        databasePath: DB_PATH,
      })
    }

    if (request.method === 'GET' && url.pathname === '/ready') {
      const ops = getOpsMetrics()
      return sendJson(response, ops.ok ? 200 : 503, ops)
    }

    if (request.method === 'GET' && url.pathname === '/api/ops/metrics') {
      return sendJson(response, 200, getOpsMetrics())
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/import-history') {
      if (!isAuthorizedImportRequest(request)) {
        return sendJson(response, 401, { error: 'Unauthorized.' })
      }

      const rawBody = await readRequestBody(request)
      const decodedBody =
        request.headers['content-encoding'] === 'gzip'
          ? gunzipSync(rawBody)
          : rawBody
      const payload = JSON.parse(decodedBody.toString('utf8'))
      const result = importHistoryBundle({
        catalogEntries: Array.isArray(payload?.catalogEntries) ? payload.catalogEntries : [],
        observations: Array.isArray(payload?.observations) ? payload.observations : [],
        trackedUniverseIds: Array.isArray(payload?.trackedUniverseIds) ? payload.trackedUniverseIds : [],
        replaceTracked: Boolean(payload?.replaceTracked),
        trackedLimit: Number.isFinite(Number(payload?.trackedLimit))
          ? Number(payload.trackedLimit)
          : TRACKED_UNIVERSE_CAP,
        defaultSource:
          typeof payload?.defaultSource === 'string' && payload.defaultSource.length > 0
            ? payload.defaultSource
            : 'history_import',
      })

      resetInMemoryCaches()
      return sendJson(response, 200, result)
    }

    if (request.method === 'GET' && url.pathname === '/api/search') {
      const query = url.searchParams.get('query')?.trim()

      if (!query) {
        return sendJson(response, 400, { error: 'Missing query parameter.' })
      }

      const matches = await searchRobloxGames(query)
      return sendJson(response, 200, { query, matches: matches.slice(0, 8) })
    }

    if (request.method === 'GET' && url.pathname === '/api/screener') {
      const query = url.searchParams.get('query')?.trim()

      if (!query) {
        return sendJson(response, 400, { error: 'Missing query parameter.' })
      }

      const payload = await fetchScreenerPayload(query)
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname === '/api/live/board') {
      const range = parseChartRange(url.searchParams.get('range'))
      const payload = await fetchPlatformBoardPayload(range)
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname === '/api/live/platform') {
      const range = parseChartRange(url.searchParams.get('range'))
      const payload = await fetchFullPlatformStats(range)
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname === '/api/live/board-point') {
      return sendJson(response, 200, fetchBoardLivePointPayload())
    }

    if (request.method === 'GET' && url.pathname === '/api/live/platform-point') {
      const payload = await fetchFullPlatformPointPayload()
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/live/game/')) {
      const universeId = Number(url.pathname.split('/').at(-1))

      if (!Number.isFinite(universeId) || universeId <= 0) {
        return sendJson(response, 400, { error: 'Invalid universe id.' })
      }

      const payload = await fetchGameLivePointPayload(universeId)
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/game-page/')) {
      const universeId = Number(url.pathname.split('/').at(-1))
      const range = parseChartRange(url.searchParams.get('range'))
      const detailLevel = url.searchParams.get('detail') === 'core' ? 'core' : 'full'

      if (!Number.isFinite(universeId) || universeId <= 0) {
        return sendJson(response, 400, { error: 'Invalid universe id.' })
      }

      const payload = await fetchGamePagePayload(universeId, range, detailLevel)
      return sendJson(response, 200, payload)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/game-icon/')) {
      const universeId = Number(url.pathname.split('/').at(-1))

      if (!Number.isFinite(universeId) || universeId <= 0) {
        return sendJson(response, 400, { error: 'Invalid universe id.' })
      }

      const cachedImageUrl = readCache(gameIconRedirectCache, universeId)
      let imageUrl = cachedImageUrl

      if (!imageUrl) {
        const thumbnailPayload = await fetchJson(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=150x150&format=Png&isCircular=false`,
          0,
        )
        imageUrl = thumbnailPayload.data?.[0]?.imageUrl

        if (typeof imageUrl === 'string' && imageUrl.length > 0) {
          writeCache(gameIconRedirectCache, universeId, imageUrl, GAME_ICON_CACHE_TTL_MS)
        }
      }

      if (!imageUrl) {
        return sendJson(response, 404, { error: 'Game thumbnail not found.' })
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const imageResponse = await fetch(imageUrl, {
          signal: controller.signal,
          headers: {
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        })

        if (!imageResponse.ok) {
          return sendJson(response, imageResponse.status, { error: 'Game thumbnail fetch failed.' })
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/png'
        const arrayBuffer = await imageResponse.arrayBuffer()

        response.writeHead(
          200,
          buildSecurityHeaders({
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=300',
          }),
        )
        response.end(Buffer.from(arrayBuffer))
      } finally {
        clearTimeout(timeoutId)
      }
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/watchlist') {
      const universeIds = sanitizeUniverseIds(url.searchParams.get('universeIds'))
      const payload = await hydrateTrackedUniverses(universeIds)
      return sendJson(response, 200, { watchlist: payload.watchlist })
    }

    if (request.method === 'GET' && url.pathname === '/api/developers') {
      const payload = await fetchPlatformBoardPayload('24h')
      return sendJson(response, 200, { developerBoard: payload.developerBoard })
    }

    if (request.method === 'GET' && url.pathname === '/api/genres') {
      const payload = await fetchPlatformBoardPayload('24h')
      return sendJson(response, 200, { genreHeatmap: payload.genreHeatmap })
    }

    if (request.method === 'GET' && url.pathname === '/api/alerts') {
      const payload = await fetchPlatformBoardPayload('24h')
      return sendJson(response, 200, { alertQueue: payload.alertQueue })
    }

    const served = await serveStaticAsset(url.pathname, response)
    if (served) {
      return
    }

    return sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    console.error('[roterminal-server] request failed', error)
    const statusCode =
      typeof error?.statusCode === 'number' ? error.statusCode : 500
    return sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Unknown server failure.',
    })
  } finally {
    const durationMs = Date.now() - started
    console.log(
      `[roterminal-server] ${request.method ?? 'GET'} ${url.pathname} ${durationMs}ms`,
    )
  }
})

server.listen(PORT, () => {
  console.log(`[roterminal-server] listening on http://localhost:${PORT}`)
})
