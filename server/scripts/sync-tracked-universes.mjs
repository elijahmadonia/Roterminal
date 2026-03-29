import { DatabaseSync } from 'node:sqlite'

import { DB_PATH, TRACKED_UNIVERSE_CAP } from '../config.mjs'

function parseArgs(argv) {
  const args = {
    limit: TRACKED_UNIVERSE_CAP,
    source: 'combined',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if ((token === '--limit' || token === '-n') && argv[index + 1]) {
      args.limit = Math.max(Number(argv[index + 1]) || args.limit, 1)
      index += 1
      continue
    }

    if ((token === '--source' || token === '-s') && argv[index + 1]) {
      args.source = argv[index + 1]
      index += 1
    }
  }

  return args
}

function selectWarehouseUniverseIds(db, limit) {
  return db.prepare(`
    SELECT ucm.universe_id
    FROM universe_current_metrics ucm
    ORDER BY ucm.playing DESC, ucm.observed_at DESC
    LIMIT ?
  `).all(limit).map((row) => row.universe_id)
}

function selectExternalUniverseIds(db, limit) {
  return db.prepare(`
    SELECT latest.universe_id
    FROM (
      SELECT e.universe_id, e.playing, e.observed_at
      FROM external_history_observations e
      INNER JOIN (
        SELECT universe_id, MAX(observed_at) AS latest_observed_at
        FROM external_history_observations
        GROUP BY universe_id
      ) recent
        ON recent.universe_id = e.universe_id
       AND recent.latest_observed_at = e.observed_at
    ) latest
    ORDER BY latest.playing DESC, latest.observed_at DESC
    LIMIT ?
  `).all(limit).map((row) => row.universe_id)
}

function selectCatalogUniverseIds(db, limit) {
  return db.prepare(`
    SELECT universe_id
    FROM universe_catalog
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(limit).map((row) => row.universe_id)
}

function replaceTrackedUniverseIds(db, universeIds) {
  const uniqueIds = [...new Set(universeIds.filter((value) => Number.isFinite(value) && value > 0))]

  db.exec('BEGIN IMMEDIATE')

  try {
    db.prepare('DELETE FROM tracked_universes').run()
    const insertStmt = db.prepare(`
      INSERT INTO tracked_universes (universe_id, sort_order)
      VALUES (?, ?)
      ON CONFLICT(universe_id) DO UPDATE SET sort_order = excluded.sort_order
    `)

    uniqueIds.forEach((universeId, index) => {
      insertStmt.run(universeId, index)
    })

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return uniqueIds
}

function buildTrackedUniverseIds(db, source, limit) {
  if (source === 'warehouse') {
    return selectWarehouseUniverseIds(db, limit)
  }

  if (source === 'external') {
    return selectExternalUniverseIds(db, limit)
  }

  if (source === 'catalog') {
    return selectCatalogUniverseIds(db, limit)
  }

  const combined = [
    ...selectWarehouseUniverseIds(db, limit),
    ...selectExternalUniverseIds(db, limit),
    ...selectCatalogUniverseIds(db, limit),
  ]

  return [...new Set(combined)].slice(0, limit)
}

const args = parseArgs(process.argv.slice(2))
const db = new DatabaseSync(DB_PATH)

const trackedUniverseIds = buildTrackedUniverseIds(db, args.source, args.limit)
const savedUniverseIds = replaceTrackedUniverseIds(db, trackedUniverseIds)

const payload = {
  source: args.source,
  requestedLimit: args.limit,
  savedTrackedUniverseCount: savedUniverseIds.length,
  warehouseUniverseCount: selectWarehouseUniverseIds(db, args.limit).length,
  externalUniverseCount: selectExternalUniverseIds(db, args.limit).length,
  catalogUniverseCount: selectCatalogUniverseIds(db, args.limit).length,
}

console.log(JSON.stringify(payload, null, 2))
