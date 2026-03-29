import { resolve } from 'node:path'

import { createDatabase } from '../lib/database.mjs'
import {
  importEmbeddedHistoryHtmlFile,
  importExternalHistoryJsonFile,
  importRbxTrackerHistory,
} from '../lib/external-history.mjs'
import { TRACKED_UNIVERSE_CAP, DB_PATH } from '../config.mjs'
import { DatabaseSync } from 'node:sqlite'

function parseArgs(argv) {
  const args = {
    source: null,
    hours: 168,
    universeIds: [],
    file: null,
    displayName: null,
    sourceKey: null,
    promoteTracked: false,
    trackedLimit: TRACKED_UNIVERSE_CAP,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if ((token === '--source' || token === '-s') && argv[index + 1]) {
      args.source = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--hours' && argv[index + 1]) {
      args.hours = Number(argv[index + 1]) || args.hours
      index += 1
      continue
    }

    if ((token === '--universe' || token === '-u') && argv[index + 1]) {
      args.universeIds.push(Number(argv[index + 1]))
      index += 1
      continue
    }

    if (token === '--file' && argv[index + 1]) {
      args.file = resolve(argv[index + 1])
      index += 1
      continue
    }

    if (token === '--display-name' && argv[index + 1]) {
      args.displayName = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--source-key' && argv[index + 1]) {
      args.sourceKey = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--promote-tracked') {
      args.promoteTracked = true
      continue
    }

    if (token === '--tracked-limit' && argv[index + 1]) {
      args.trackedLimit = Math.max(Number(argv[index + 1]) || args.trackedLimit, 1)
      index += 1
    }
  }

  return args
}

function printUsage() {
  console.log(`Usage:
  node server/scripts/import-external-history.mjs --source rbx-tracker [--hours 168] [--universe 123] [--promote-tracked] [--tracked-limit 10000]
  node server/scripts/import-external-history.mjs --source embedded-html --file ./page.html [--source-key embedded_html_import] [--display-name "Embedded HTML import"] [--promote-tracked]
  node server/scripts/import-external-history.mjs --source json-file --file ./history.json [--source-key licensed_dump] [--display-name "Licensed dump"] [--promote-tracked]`)
}

const args = parseArgs(process.argv.slice(2))

if (!args.source) {
  printUsage()
  process.exit(1)
}

const database = await createDatabase()

try {
  let result

  if (args.source === 'rbx-tracker') {
    result = await importRbxTrackerHistory({
      apiKey: process.env.RBX_TRACKER_API_KEY ?? '',
      universeIds: args.universeIds,
      hours: args.hours,
      database,
      trigger: 'script',
    })
  } else if (args.source === 'json-file') {
    result = await importExternalHistoryJsonFile({
      filePath: args.file,
      database,
      sourceKey: args.sourceKey ?? 'licensed_json_import',
      displayName: args.displayName ?? 'Licensed JSON import',
      trigger: 'script',
    })
  } else if (args.source === 'embedded-html') {
    result = await importEmbeddedHistoryHtmlFile({
      filePath: args.file,
      database,
      sourceKey: args.sourceKey ?? 'embedded_html_import',
      displayName: args.displayName ?? 'Embedded HTML import',
      trigger: 'script',
    })
  } else {
    throw new Error(`Unsupported source: ${args.source}`)
  }

  if (args.promoteTracked) {
    const trackedDb = new DatabaseSync(DB_PATH)
    const combinedIds = trackedDb.prepare(`
      SELECT ucm.universe_id
      FROM universe_current_metrics ucm
      ORDER BY ucm.playing DESC, ucm.observed_at DESC
      LIMIT ?
    `).all(args.trackedLimit).map((row) => row.universe_id)

    const externalIds = trackedDb.prepare(`
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
    `).all(args.trackedLimit).map((row) => row.universe_id)

    const trackedUniverseIds = [...new Set([...combinedIds, ...externalIds])].slice(0, args.trackedLimit)

    trackedDb.exec('BEGIN IMMEDIATE')
    try {
      trackedDb.prepare('DELETE FROM tracked_universes').run()
      const insertStmt = trackedDb.prepare(`
        INSERT INTO tracked_universes (universe_id, sort_order)
        VALUES (?, ?)
        ON CONFLICT(universe_id) DO UPDATE SET sort_order = excluded.sort_order
      `)
      trackedUniverseIds.forEach((universeId, index) => {
        insertStmt.run(universeId, index)
      })
      trackedDb.exec('COMMIT')
    } catch (error) {
      trackedDb.exec('ROLLBACK')
      throw error
    }

    result = {
      ...result,
      promotedTrackedUniverseCount: trackedUniverseIds.length,
    }
  }

  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
