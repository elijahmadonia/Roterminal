import { gzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

import { DB_PATH } from '../config.mjs'

function parseArgs(argv) {
  const args = {
    url: '',
    token: process.env.ROTERMINAL_IMPORT_TOKEN ?? '',
    dbPath: DB_PATH,
    batchSize: 5000,
    replaceTracked: false,
    defaultSource: 'local_history_import',
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

    if (token === '--db' && argv[index + 1]) {
      args.dbPath = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--batch-size' && argv[index + 1]) {
      args.batchSize = Math.max(1, Number(argv[index + 1]) || args.batchSize)
      index += 1
      continue
    }

    if (token === '--replace-tracked') {
      args.replaceTracked = true
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
  node server/scripts/push-history-bundle.mjs --url https://www.roterminal.co --token <token> [--db ./data/roterminal.db] [--batch-size 5000] [--replace-tracked] [--source local_history_import]`)
}

async function postImport(url, token, payload) {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)))
  const response = await fetch(`${url.replace(/\/$/, '')}/api/admin/import-history`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
    body,
  })

  const text = await response.text()
  let parsed

  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }

  if (!response.ok) {
    throw new Error(`Import request failed: ${response.status} ${JSON.stringify(parsed).slice(0, 500)}`)
  }

  return parsed
}

const args = parseArgs(process.argv.slice(2))

if (!args.url || !args.token) {
  printUsage()
  process.exit(1)
}

const db = new DatabaseSync(args.dbPath)

const catalogEntries = db.prepare(`
  SELECT
    universe_id AS universeId,
    name,
    creator_name AS creatorName,
    creator_type AS creatorType,
    genre,
    first_seen_at AS firstSeenAt,
    last_seen_at AS lastSeenAt,
    last_game_updated_at AS lastGameUpdatedAt
  FROM universe_catalog
  WHERE universe_id IN (
    SELECT DISTINCT universe_id
    FROM universe_observations
  )
  ORDER BY universe_id ASC
`).all()

const trackedUniverseIds = db.prepare(`
  SELECT universe_id
  FROM tracked_universes
  ORDER BY sort_order ASC
`).all().map((row) => row.universe_id)

const observationCount = db.prepare(`
  SELECT COUNT(*) AS total
  FROM universe_observations
`).get().total

console.log(`Uploading catalog (${catalogEntries.length}) and tracked IDs (${trackedUniverseIds.length})...`)

const initialResult = await postImport(args.url, args.token, {
  catalogEntries,
  trackedUniverseIds,
  replaceTracked: args.replaceTracked,
  defaultSource: args.defaultSource,
})

console.log(JSON.stringify(initialResult, null, 2))

let lastId = 0
let importedRows = 0

while (true) {
  const observations = db.prepare(`
    SELECT
      id,
      universe_id AS universeId,
      observed_at AS observedAt,
      playing,
      visits,
      favorited_count AS favoritedCount,
      approval,
      game_updated_at AS gameUpdatedAt,
      source
    FROM universe_observations
    WHERE id > ?
    ORDER BY id ASC
    LIMIT ?
  `).all(lastId, args.batchSize)

  if (observations.length === 0) {
    break
  }

  lastId = observations.at(-1).id
  const payloadObservations = observations.map(({ id: _id, ...row }) => row)
  const result = await postImport(args.url, args.token, {
    observations: payloadObservations,
    defaultSource: args.defaultSource,
  })

  importedRows += payloadObservations.length
  console.log(`Imported ${importedRows}/${observationCount} observations`, result)
}

console.log('History import complete.')
