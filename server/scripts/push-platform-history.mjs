import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const FULL_PLATFORM_STATS_URL = 'https://portal-api.bloxbiz.com/games/platform_stats'

const RANGE_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

function parseArgs(argv) {
  const args = {
    url: '',
    token: process.env.ROTERMINAL_IMPORT_TOKEN ?? '',
    range: '30d',
    batchSize: 1000,
    defaultSource: 'local_platform_sync',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--url' && argv[index + 1]) {
      args.url = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--token' && argv[index + 1]) {
      args.token = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--range' && argv[index + 1]) {
      args.range = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--batch-size' && argv[index + 1]) {
      args.batchSize = Math.max(1, Number(argv[index + 1]) || args.batchSize)
      index += 1
      continue
    }

    if (token === '--source' && argv[index + 1]) {
      args.defaultSource = argv[index + 1]
      index += 1
    }
  }

  return args
}

function printUsage() {
  console.log(`Usage:
  node server/scripts/push-platform-history.mjs --url https://www.roterminal.co --token <token> [--range 30d] [--batch-size 1000] [--source local_platform_sync]`)
}

function buildWindow(range) {
  const durationMs = RANGE_MS[range] ?? RANGE_MS['30d']
  return {
    startDatetime: new Date(Date.now() - durationMs).toISOString(),
    endDatetime: new Date().toISOString(),
  }
}

async function fetchPlatformHistory(range) {
  const { startDatetime, endDatetime } = buildWindow(range)
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--http1.1',
    '--request',
    'POST',
    '--url',
    FULL_PLATFORM_STATS_URL,
    '--header',
    'accept: application/json, text/plain, */*',
    '--header',
    'accept-language: en-US,en;q=0.9',
    '--header',
    'content-type: application/json',
    '--header',
    'origin: https://ads.bloxbiz.com',
    '--header',
    'referer: https://ads.bloxbiz.com/',
    '--header',
    'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    '--data-binary',
    JSON.stringify({
      start_datetime: startDatetime,
      end_datetime: endDatetime,
    }),
  ]

  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 10 * 1024 * 1024,
  })

  const payload = JSON.parse(stdout)
  const history = Array.isArray(payload?.data?.ccu_history) ? payload.data.ccu_history : []

  return history
    .filter((entry) => Number.isFinite(entry?.playing) && entry?.process_timestamp)
    .map((entry) => ({
      timestamp: entry.process_timestamp,
      value: entry.playing,
    }))
}

async function postImport(url, token, payload) {
  const response = await fetch(`${url.replace(/\/$/, '')}/api/admin/import-history`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  const parsed = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`Platform import failed: ${response.status} ${JSON.stringify(parsed).slice(0, 500)}`)
  }

  return parsed
}

const args = parseArgs(process.argv.slice(2))

if (!args.url || !args.token) {
  printUsage()
  process.exit(1)
}

const points = await fetchPlatformHistory(args.range)

console.log(`Fetched ${points.length} platform points for ${args.range}.`)

for (let index = 0; index < points.length; index += args.batchSize) {
  const batch = points.slice(index, index + args.batchSize)
  const result = await postImport(args.url, args.token, {
    platformHistoryPoints: batch,
    platformDefaultSource: args.defaultSource,
  })

  console.log(`Imported ${Math.min(index + batch.length, points.length)}/${points.length} platform points`, result)
}

console.log('Platform history import complete.')
