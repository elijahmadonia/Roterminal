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
    url: process.env.ROTERMINAL_IMPORT_URL ?? 'https://www.roterminal.co',
    token: process.env.ROTERMINAL_IMPORT_TOKEN ?? '',
    range: '30d',
    batchSize: 1000,
    startIndex: 0,
    retryCount: 20,
    retryDelayMs: 5_000,
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

    if (token === '--start-index' && argv[index + 1]) {
      args.startIndex = Math.max(0, Number(argv[index + 1]) || args.startIndex)
      index += 1
      continue
    }

    if (token === '--retry-count' && argv[index + 1]) {
      args.retryCount = Math.max(0, Number(argv[index + 1]) || args.retryCount)
      index += 1
      continue
    }

    if (token === '--retry-delay-ms' && argv[index + 1]) {
      args.retryDelayMs = Math.max(0, Number(argv[index + 1]) || args.retryDelayMs)
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
  node server/scripts/push-platform-history.mjs [--url https://www.roterminal.co] [--token <token>] [--range 30d] [--batch-size 1000] [--start-index 0] [--retry-count 20] [--retry-delay-ms 5000] [--source local_platform_sync]`)
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
  let parsed

  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }

  if (!response.ok) {
    throw new Error(`Platform import failed: ${response.status} ${JSON.stringify(parsed).slice(0, 500)}`)
  }

  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function postImportWithRetries(url, token, payload, retryCount, retryDelayMs) {
  let attempt = 0

  while (true) {
    try {
      return await postImport(url, token, payload)
    } catch (error) {
      const message = String(error?.message ?? '')
      const shouldRetry =
        attempt < retryCount &&
        (message.includes(' 502 ') || message.includes(' 503 ') || message.includes(' 504 '))

      if (!shouldRetry) {
        throw error
      }

      attempt += 1
      console.warn(`Retrying platform import after transient failure (${attempt}/${retryCount})...`)
      await sleep(retryDelayMs)
    }
  }
}

const args = parseArgs(process.argv.slice(2))

if (!args.url || !args.token) {
  printUsage()
  process.exit(1)
}

const points = await fetchPlatformHistory(args.range)

console.log(`Fetched ${points.length} platform points for ${args.range}.`)

for (let index = args.startIndex; index < points.length; index += args.batchSize) {
  const batch = points.slice(index, index + args.batchSize)
  const result = await postImportWithRetries(args.url, args.token, {
    platformHistoryPoints: batch,
    platformDefaultSource: args.defaultSource,
  }, args.retryCount, args.retryDelayMs)

  console.log(`Imported ${Math.min(index + batch.length, points.length)}/${points.length} platform points`, result)
}

console.log('Platform history import complete.')
