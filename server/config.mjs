import path from 'node:path'
import { fileURLToPath } from 'node:url'

function readNumberEnv(name, fallback) {
  const raw = process.env[name]

  if (raw == null || raw.trim() === '') {
    return fallback
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name]

  if (raw == null || raw.trim() === '') {
    return fallback
  }

  const normalized = raw.trim().toLowerCase()

  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function readStringEnv(name, fallback = '') {
  const raw = process.env[name]

  if (raw == null) {
    return fallback
  }

  const value = raw.trim()
  return value.length > 0 ? value : fallback
}

function readListEnv(name) {
  const raw = process.env[name]

  if (raw == null) {
    return []
  }

  return [...new Set(raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0))]
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const ROOT_DIR = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT_DIR, 'data')
export const DIST_DIR = path.join(ROOT_DIR, 'dist')
export const DB_PATH = path.resolve(
  process.env.ROTERMINAL_DB_PATH ?? path.join(DATA_DIR, 'roterminal.db'),
)
export const LEGACY_STATE_PATH = path.join(DATA_DIR, 'roterminal-state.json')

export const PORT = readNumberEnv('ROTERMINAL_SERVER_PORT', 8787)
export const IS_RENDER = process.env.RENDER?.trim().toLowerCase() === 'true'
export const RENDER_SERVICE_TYPE = readStringEnv('RENDER_SERVICE_TYPE', '')
export const POSTGRES_URL = readStringEnv(
  'ROTERMINAL_POSTGRES_URL',
  readStringEnv('DATABASE_URL', ''),
)
export const SERVER_ENABLE_SCHEDULED_INGEST = readBooleanEnv(
  'ROTERMINAL_SERVER_ENABLE_SCHEDULED_INGEST',
  true,
)
export const INGEST_INTERVAL_MS =
  readNumberEnv('ROTERMINAL_INGEST_INTERVAL_MINUTES', 5) * 60 * 1000
export const INGEST_STALE_AFTER_MS = readNumberEnv(
  'ROTERMINAL_INGEST_STALE_AFTER_MS',
  Math.max(INGEST_INTERVAL_MS * 3, 20 * 60 * 1000),
)

const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS

export const SNAPSHOT_RETENTION_MS =
  readNumberEnv('ROTERMINAL_SNAPSHOT_RETENTION_DAYS', 365) * ONE_DAY_MS
export const INGEST_LEASE_TTL_MS = readNumberEnv(
  'ROTERMINAL_INGEST_LEASE_TTL_MS',
  Math.max(INGEST_INTERVAL_MS * 3, 15 * 60 * 1000),
)
export const INGEST_RUN_STALE_AFTER_MS = readNumberEnv(
  'ROTERMINAL_INGEST_RUN_STALE_AFTER_MS',
  Math.max(INGEST_INTERVAL_MS * 6, 30 * 60 * 1000),
)
export const REQUEST_TIMEOUT_MS = readNumberEnv(
  'ROTERMINAL_REQUEST_TIMEOUT_MS',
  8_000,
)
export const IMPORT_TOKEN = readStringEnv('ROTERMINAL_IMPORT_TOKEN', '')
export const DATA_BACKEND = readStringEnv(
  'ROTERMINAL_DATA_BACKEND',
  POSTGRES_URL
    ? 'postgres'
    : IS_RENDER && RENDER_SERVICE_TYPE === 'web'
      ? 'memory'
      : 'sqlite',
)
export const REQUIRE_PERSISTENT_STORE = readBooleanEnv(
  'ROTERMINAL_REQUIRE_PERSISTENT_STORE',
  IS_RENDER,
)
export const ALLOW_LIVE_READ_FALLBACK = readBooleanEnv(
  'ROTERMINAL_ALLOW_LIVE_READ_FALLBACK',
  DATA_BACKEND !== 'postgres',
)
export const POSTGRES_POOL_MAX = readNumberEnv('ROTERMINAL_POSTGRES_POOL_MAX', 10)
export const POSTGRES_IDLE_TIMEOUT_MS = readNumberEnv(
  'ROTERMINAL_POSTGRES_IDLE_TIMEOUT_MS',
  30_000,
)
export const ROBLOX_SECURITY_COOKIE = readStringEnv('ROBLOX_SECURITY_COOKIE', '')
export const ROBLOX_SECURITY_COOKIES = [...new Set([
  ...readListEnv('ROBLOX_SECURITY_COOKIES'),
  ...(ROBLOX_SECURITY_COOKIE ? [ROBLOX_SECURITY_COOKIE] : []),
])]
export const SEARCH_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_SEARCH_CACHE_TTL_MS',
  60_000,
)
export const GAMES_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_GAMES_CACHE_TTL_MS',
  15_000,
)
export const PLATFORM_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_PLATFORM_CACHE_TTL_MS',
  INGEST_INTERVAL_MS,
)
export const PLATFORM_POINT_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_PLATFORM_POINT_CACHE_TTL_MS',
  5_000,
)
export const BOARD_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_BOARD_CACHE_TTL_MS',
  INGEST_INTERVAL_MS,
)
export const GAME_SUPPLEMENTAL_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_GAME_SUPPLEMENTAL_CACHE_TTL_MS',
  5 * 60_000,
)
export const TRACKED_UNIVERSE_CAP = readNumberEnv(
  'ROTERMINAL_TRACKED_UNIVERSE_CAP',
  25_000,
)
export const UNIVERSE_FETCH_BATCH_CONCURRENCY = readNumberEnv(
  'ROTERMINAL_UNIVERSE_FETCH_BATCH_CONCURRENCY',
  4,
)
export const TRACKING_FAST_LANE_CCU = readNumberEnv(
  'ROTERMINAL_TRACKING_FAST_LANE_CCU',
  10_000,
)
export const TRACKING_PRIORITY_CCU = readNumberEnv(
  'ROTERMINAL_TRACKING_PRIORITY_CCU',
  1_000,
)
export const TRACKING_WARM_CCU = readNumberEnv(
  'ROTERMINAL_TRACKING_WARM_CCU',
  100,
)
export const TIER_A_POLL_MINUTES = readNumberEnv(
  'ROTERMINAL_TIER_A_POLL_MINUTES',
  1,
)
export const TIER_B_POLL_MINUTES = readNumberEnv(
  'ROTERMINAL_TIER_B_POLL_MINUTES',
  5,
)
export const TIER_C_POLL_MINUTES = readNumberEnv(
  'ROTERMINAL_TIER_C_POLL_MINUTES',
  15,
)
export const TIER_D_POLL_MINUTES = readNumberEnv(
  'ROTERMINAL_TIER_D_POLL_MINUTES',
  60,
)
export const DISCOVERY_CREATOR_EXPANSION_LIMIT = readNumberEnv(
  'ROTERMINAL_DISCOVERY_CREATOR_EXPANSION_LIMIT',
  60,
)
export const DISCOVERY_CREATOR_GAME_LIMIT = readNumberEnv(
  'ROTERMINAL_DISCOVERY_CREATOR_GAME_LIMIT',
  50,
)
export const DISCOVERY_LIVE_POLL_LIMIT = readNumberEnv(
  'ROTERMINAL_DISCOVERY_LIVE_POLL_LIMIT',
  250,
)
export const SEARCH_DISCOVERY_QUERY_LIMIT = readNumberEnv(
  'ROTERMINAL_SEARCH_DISCOVERY_QUERY_LIMIT',
  12,
)
export const SEARCH_DISCOVERY_RESULT_LIMIT = readNumberEnv(
  'ROTERMINAL_SEARCH_DISCOVERY_RESULT_LIMIT',
  8,
)
export const TIER_A_POLL_BUDGET = readNumberEnv(
  'ROTERMINAL_TIER_A_POLL_BUDGET',
  500,
)
export const TIER_B_POLL_BUDGET = readNumberEnv(
  'ROTERMINAL_TIER_B_POLL_BUDGET',
  750,
)
export const TIER_C_POLL_BUDGET = readNumberEnv(
  'ROTERMINAL_TIER_C_POLL_BUDGET',
  750,
)
export const TIER_D_POLL_BUDGET = readNumberEnv(
  'ROTERMINAL_TIER_D_POLL_BUDGET',
  250,
)
export const MAX_FETCH_RETRIES = readNumberEnv('ROTERMINAL_MAX_FETCH_RETRIES', 2)
export const RETRY_BASE_DELAY_MS = readNumberEnv(
  'ROTERMINAL_RETRY_BASE_DELAY_MS',
  450,
)

export const DEFAULT_TRACKED_IDS = [
  383310974,
  66654135,
  1686885941,
  3317771874,
  5836869368,
]

export { ONE_HOUR_MS, ONE_DAY_MS }
