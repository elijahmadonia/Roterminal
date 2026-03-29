import { readFile } from 'node:fs/promises'

const RBX_TRACKER_BASE_URL = 'https://rbxstats.newstargeted.com/api/v1'

function normalizeUniverseIds(universeIds) {
  return [...new Set((universeIds ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
}

async function fetchJson(url, { headers = {}, signal } = {}) {
  const response = await fetch(url, {
    headers,
    signal,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    const error = new Error(`Request failed: ${response.status} ${response.statusText}${message ? ` - ${message.slice(0, 240)}` : ''}`)
    error.statusCode = response.status
    throw error
  }

  return response.json()
}

function toApproval(upVotes, downVotes, approval) {
  if (approval != null && Number.isFinite(Number(approval))) {
    return Number(approval)
  }

  const totalVotes = (Number(upVotes) || 0) + (Number(downVotes) || 0)
  if (totalVotes <= 0) {
    return null
  }

  return ((Number(upVotes) || 0) / totalVotes) * 100
}

function mapRbxTrackerStat(game, stat) {
  return {
    universeId: Number(game.roblox_id),
    observedAt: stat.recorded_at,
    playing: Number(stat.ccu) || 0,
    visits: stat.visits == null ? null : Number(stat.visits),
    favoritedCount: stat.favorites == null ? null : Number(stat.favorites),
    upVotes: stat.likes == null ? null : Number(stat.likes),
    downVotes: stat.dislikes == null ? null : Number(stat.dislikes),
    approval: toApproval(stat.likes, stat.dislikes, stat.approval),
    name: game.name ?? `Universe ${game.roblox_id}`,
    creatorName: 'Unknown creator',
    creatorType: 'Unknown',
    genre: 'Unclassified',
    updated: stat.recorded_at,
    payload: stat,
  }
}

export async function importRbxTrackerHistory({
  apiKey,
  universeIds = [],
  hours = 168,
  database,
  trigger = 'manual',
} = {}) {
  if (!database) {
    throw new Error('Database handle is required.')
  }

  if (!apiKey) {
    throw new Error('RBX Tracker API key is required.')
  }

  const sourceKey = 'rbx_tracker_api'
  const importRunId = database.startExternalHistoryImportRun(sourceKey, trigger)

  try {
    const headers = {
      'X-API-Key': apiKey,
      Accept: 'application/json',
    }
    const requestedUniverseIds = normalizeUniverseIds(universeIds)
    const gamesPayload = await fetchJson(`${RBX_TRACKER_BASE_URL}/games`, { headers })
    const allGames = Array.isArray(gamesPayload.games) ? gamesPayload.games : []
    const selectedGames =
      requestedUniverseIds.length > 0
        ? allGames.filter((game) => requestedUniverseIds.includes(Number(game.roblox_id)))
        : allGames

    const allObservations = []

    for (const game of selectedGames) {
      const statsPayload = await fetchJson(
        `${RBX_TRACKER_BASE_URL}/games/${game.id}/stats?hours=${Math.max(1, Math.min(Number(hours) || 168, 168))}`,
        { headers },
      )
      const stats = Array.isArray(statsPayload.stats) ? statsPayload.stats : []

      for (const stat of stats) {
        if (!stat?.recorded_at) {
          continue
        }
        allObservations.push(mapRbxTrackerStat(game, stat))
      }
    }

    const result = database.recordExternalHistory(sourceKey, allObservations, {
      displayName: 'RBX Tracker API',
      kind: 'api',
      status: 'active',
      notes: 'Imported from licensed RBX Tracker API history.',
    })

    database.finishExternalHistoryImportRun(importRunId, {
      status: 'completed',
      universeCount: result.universeCount,
      observationCount: result.observationCount,
    })

    return {
      sourceKey,
      ...result,
      matchedGames: selectedGames.length,
    }
  } catch (error) {
    database.finishExternalHistoryImportRun(importRunId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function importExternalHistoryJsonFile({
  filePath,
  database,
  sourceKey = 'licensed_json_import',
  displayName = 'Licensed JSON import',
  kind = 'file',
  trigger = 'manual',
} = {}) {
  if (!database) {
    throw new Error('Database handle is required.')
  }

  if (!filePath) {
    throw new Error('filePath is required.')
  }

  const importRunId = database.startExternalHistoryImportRun(sourceKey, trigger)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const observations = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.observations)
        ? parsed.observations
        : []

    const result = database.recordExternalHistory(sourceKey, observations, {
      displayName,
      kind,
      status: 'active',
      notes: parsed.notes ?? 'Imported from external JSON history file.',
    })

    database.finishExternalHistoryImportRun(importRunId, {
      status: 'completed',
      universeCount: result.universeCount,
      observationCount: result.observationCount,
    })

    return {
      sourceKey,
      ...result,
    }
  } catch (error) {
    database.finishExternalHistoryImportRun(importRunId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function extractEmbeddedJsonObject(html, variableName) {
  const marker = `var ${variableName} = `
  const start = html.indexOf(marker)

  if (start === -1) {
    throw new Error(`Could not find ${variableName} in HTML.`)
  }

  const jsonStart = start + marker.length
  const end = html.indexOf(';</script>', jsonStart)

  if (end === -1) {
    throw new Error(`Could not determine end of ${variableName} JSON block.`)
  }

  return JSON.parse(html.slice(jsonStart, end))
}

export async function importEmbeddedHistoryHtmlFile({
  filePath,
  database,
  sourceKey = 'embedded_html_import',
  displayName = 'Embedded HTML history import',
  trigger = 'manual',
} = {}) {
  if (!database) {
    throw new Error('Database handle is required.')
  }

  if (!filePath) {
    throw new Error('filePath is required.')
  }

  const importRunId = database.startExternalHistoryImportRun(sourceKey, trigger)

  try {
    const html = await readFile(filePath, 'utf8')
    const gameHistory = extractEmbeddedJsonObject(html, 'game_history')
    const urlMatch = html.match(/canonical" href="https:\/\/www\.rolimons\.com\/game\/(\d+)"/i)
    const universeId = Number(urlMatch?.[1])

    if (!Number.isFinite(universeId) || universeId <= 0) {
      throw new Error('Could not extract universe ID from HTML canonical URL.')
    }

    const observations = (gameHistory.timestamps ?? []).map((timestamp, index) => {
      const upVotes = gameHistory.upvotes?.[index] ?? null
      const downVotes = gameHistory.downvotes?.[index] ?? null

      return {
        universeId,
        observedAt: new Date(Number(timestamp) * 1000).toISOString(),
        playing: Number(gameHistory.players?.[index]) || 0,
        visits: gameHistory.visits?.[index] == null ? null : Number(gameHistory.visits[index]),
        favoritedCount:
          gameHistory.favorites?.[index] == null ? null : Number(gameHistory.favorites[index]),
        upVotes: upVotes == null ? null : Number(upVotes),
        downVotes: downVotes == null ? null : Number(downVotes),
        approval: toApproval(upVotes, downVotes, null),
        payload: {
          timestamp,
          players: gameHistory.players?.[index] ?? null,
          visits: gameHistory.visits?.[index] ?? null,
          favorites: gameHistory.favorites?.[index] ?? null,
          upvotes: upVotes,
          downvotes: downVotes,
        },
      }
    })

    const result = database.recordExternalHistory(sourceKey, observations, {
      displayName,
      kind: 'html_file',
      status: 'active',
      notes: 'Imported from embedded history data in a local HTML file.',
    })

    database.finishExternalHistoryImportRun(importRunId, {
      status: 'completed',
      universeCount: result.universeCount,
      observationCount: result.observationCount,
    })

    return {
      sourceKey,
      ...result,
    }
  } catch (error) {
    database.finishExternalHistoryImportRun(importRunId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
