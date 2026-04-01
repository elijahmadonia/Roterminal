function parseArgs(argv) {
  const args = {
    url: process.env.ROTERMINAL_IMPORT_URL ?? 'https://www.roterminal.co',
    token: process.env.ROTERMINAL_IMPORT_TOKEN ?? '',
    range: '24h',
    minValue: 10_000_000,
    apply: false,
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

    if (token === '--min-value' && argv[index + 1]) {
      args.minValue = Math.max(0, Number(argv[index + 1]) || args.minValue)
      index += 1
      continue
    }

    if (token === '--apply') {
      args.apply = true
    }
  }

  return args
}

const RANGE_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

function printUsage() {
  console.log(`Usage:
  node server/scripts/clean-platform-history.mjs [--url https://www.roterminal.co] [--token <token>] [--range 24h] [--min-value 10000000] [--apply]`)
}

async function fetchPlatformTimeline(url, range) {
  const response = await fetch(
    `${url.replace(/\/$/, '')}/api/live/platform?range=${encodeURIComponent(range)}`,
  )
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`Platform timeline fetch failed: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`)
  }

  return Array.isArray(payload?.timeline) ? payload.timeline : []
}

async function deletePlatformPointsByThreshold(url, token, minValue, afterTimestamp) {
  const response = await fetch(`${url.replace(/\/$/, '')}/api/admin/import-history`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deletePlatformHistoryBelowValue: minValue,
      deletePlatformHistoryAfter: afterTimestamp,
    }),
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`Platform cleanup failed: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`)
  }

  return payload
}

const args = parseArgs(process.argv.slice(2))

if (!args.url) {
  printUsage()
  process.exit(1)
}

const timeline = await fetchPlatformTimeline(args.url, args.range)
const suspectPoints = timeline.filter((point) => Number(point?.value) < args.minValue)

console.log(
  `Found ${suspectPoints.length} suspect platform points below ${args.minValue.toLocaleString('en-US')} in ${args.range}.`,
)

if (suspectPoints.length > 0) {
  console.log(
    suspectPoints
      .map((point) => `${point.timestamp}\t${Number(point.value).toLocaleString('en-US')}`)
      .join('\n'),
  )
}

if (!args.apply) {
  console.log('Dry run only. Re-run with --apply to delete these timestamps from production.')
  process.exit(0)
}

if (!args.token) {
  printUsage()
  throw new Error('Missing ROTERMINAL_IMPORT_TOKEN for cleanup apply mode.')
}

const afterTimestamp = new Date(
  Date.now() - (RANGE_MS[args.range] ?? RANGE_MS['24h']),
).toISOString()
const result = await deletePlatformPointsByThreshold(
  args.url,
  args.token,
  args.minValue,
  afterTimestamp,
)

console.log('Cleanup complete.', result)
