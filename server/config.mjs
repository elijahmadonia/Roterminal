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
  60_000,
)
export const PLATFORM_POINT_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_PLATFORM_POINT_CACHE_TTL_MS',
  5_000,
)
export const BOARD_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_BOARD_CACHE_TTL_MS',
  60_000,
)
export const GAME_SUPPLEMENTAL_CACHE_TTL_MS = readNumberEnv(
  'ROTERMINAL_GAME_SUPPLEMENTAL_CACHE_TTL_MS',
  5 * 60_000,
)
export const TRACKED_UNIVERSE_CAP = readNumberEnv(
  'ROTERMINAL_TRACKED_UNIVERSE_CAP',
  10_000,
)
export const UNIVERSE_FETCH_BATCH_CONCURRENCY = readNumberEnv(
  'ROTERMINAL_UNIVERSE_FETCH_BATCH_CONCURRENCY',
  8,
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
