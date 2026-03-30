import {
  DEFAULT_TRACKED_IDS,
  INGEST_RUN_STALE_AFTER_MS,
  SNAPSHOT_RETENTION_MS,
} from '../config.mjs'

function sanitizeUniverseIds(universeIds) {
  return [...new Set(
    (Array.isArray(universeIds) ? universeIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  )]
}

function dedupeSnapshotGames(games) {
  const latestByUniverseId = new Map()

  for (const game of Array.isArray(games) ? games : []) {
    if (!game?.universeId) {
      continue
    }

    latestByUniverseId.set(Number(game.universeId), game)
  }

  return [...latestByUniverseId.values()]
}

function mapSnapshotGame(row) {
  return {
    universeId: row.universe_id,
    name: row.name,
    creatorName: row.creator_name,
    creatorType: row.creator_type,
    genre: row.genre,
    playing: row.playing,
    visits: row.visits,
    favoritedCount: row.favorited_count,
    approval: row.approval,
    updated: row.game_updated_at,
    thumbnailUrl: undefined,
  }
}

function normalizeCatalogEntry(game, observedAt) {
  const universeId = Number(game?.universeId)
  const safeObservedAt =
    typeof observedAt === 'string' && observedAt.length > 0
      ? observedAt
      : new Date().toISOString()

  return {
    universeId,
    name: String(game?.name ?? `Universe ${universeId}`),
    creatorName: String(game?.creatorName ?? 'Unknown creator'),
    creatorType: String(game?.creatorType ?? 'Unknown'),
    genre: String(game?.genre ?? 'Unclassified'),
    firstSeenAt: safeObservedAt,
    lastSeenAt: safeObservedAt,
    lastGameUpdatedAt: String(game?.updated ?? safeObservedAt),
  }
}

function buildObservationRow(game, observedAt) {
  const catalogEntry = normalizeCatalogEntry(game, observedAt)

  return {
    universe_id: catalogEntry.universeId,
    timestamp: catalogEntry.lastSeenAt,
    name: catalogEntry.name,
    creator_name: catalogEntry.creatorName,
    creator_type: catalogEntry.creatorType,
    genre: catalogEntry.genre,
    playing: Number(game?.playing) || 0,
    visits: Number(game?.visits) || 0,
    favorited_count: Number(game?.favoritedCount) || 0,
    approval: Number(game?.approval) || 0,
    updated: catalogEntry.lastGameUpdatedAt,
  }
}

function clonePoint(point) {
  return point == null ? null : { ...point }
}

export async function createMemoryStore() {
  let trackedUniverseIds = [...DEFAULT_TRACKED_IDS]
  const catalogByUniverseId = new Map()
  const currentMetricsByUniverseId = new Map()
  const observationHistoryByUniverseId = new Map()
  const platformHistoryByTimestamp = new Map()
  const ingestLeases = new Map()
  const importJobs = []
  const ingestRuns = []
  let platformCurrentMetric = null
  let nextImportJobId = 1
  let nextIngestRunId = 1

  function countTrackedUniverseIds() {
    return trackedUniverseIds.length
  }

  function getTrackedUniverseIds() {
    return [...trackedUniverseIds]
  }

  function replaceTrackedUniverseIds(universeIds) {
    trackedUniverseIds = sanitizeUniverseIds(universeIds)
  }

  function appendTrackedUniverseIds(universeIds, maxCount = Number.POSITIVE_INFINITY) {
    const incomingIds = sanitizeUniverseIds(universeIds)

    if (incomingIds.length === 0) {
      return getTrackedUniverseIds()
    }

    const dedupedIds = [
      ...trackedUniverseIds.filter((universeId) => !incomingIds.includes(universeId)),
      ...incomingIds,
    ]
    trackedUniverseIds = Number.isFinite(maxCount)
      ? dedupedIds.slice(-Math.max(Math.floor(maxCount), 1))
      : dedupedIds

    return getTrackedUniverseIds()
  }

  function upsertCatalog(universeId, nextCatalogEntry) {
    const existing = catalogByUniverseId.get(universeId)
    const merged = existing
      ? {
          ...existing,
          ...nextCatalogEntry,
          firstSeenAt:
            Date.parse(nextCatalogEntry.firstSeenAt) < Date.parse(existing.firstSeenAt)
              ? nextCatalogEntry.firstSeenAt
              : existing.firstSeenAt,
          lastSeenAt:
            Date.parse(nextCatalogEntry.lastSeenAt) > Date.parse(existing.lastSeenAt)
              ? nextCatalogEntry.lastSeenAt
              : existing.lastSeenAt,
          lastGameUpdatedAt:
            Date.parse(nextCatalogEntry.lastGameUpdatedAt) >= Date.parse(existing.lastGameUpdatedAt)
              ? nextCatalogEntry.lastGameUpdatedAt
              : existing.lastGameUpdatedAt,
        }
      : nextCatalogEntry

    catalogByUniverseId.set(universeId, merged)
    return merged
  }

  function upsertCurrentMetric(universeId, metric) {
    const existing = currentMetricsByUniverseId.get(universeId)

    if (
      !existing ||
      Date.parse(metric.observed_at) >= Date.parse(existing.observed_at)
    ) {
      currentMetricsByUniverseId.set(universeId, metric)
    }
  }

  function pruneObservationHistory(retentionMs = SNAPSHOT_RETENTION_MS) {
    if (!retentionMs) {
      return
    }

    const cutoffMs = Date.now() - retentionMs

    for (const [universeId, rowsByTimestamp] of observationHistoryByUniverseId.entries()) {
      for (const [timestamp] of rowsByTimestamp.entries()) {
        if (Date.parse(timestamp) < cutoffMs) {
          rowsByTimestamp.delete(timestamp)
        }
      }

      if (rowsByTimestamp.size === 0) {
        observationHistoryByUniverseId.delete(universeId)
      }
    }

    for (const [timestamp] of platformHistoryByTimestamp.entries()) {
      if (Date.parse(timestamp) < cutoffMs) {
        platformHistoryByTimestamp.delete(timestamp)
      }
    }
  }

  function recordSnapshots(
    games,
    {
      observedAt = new Date().toISOString(),
      source = 'live',
      retentionMs = SNAPSHOT_RETENTION_MS,
    } = {},
  ) {
    const uniqueGames = dedupeSnapshotGames(games)

    for (const game of uniqueGames) {
      const universeId = Number(game?.universeId)

      if (!Number.isFinite(universeId) || universeId <= 0) {
        continue
      }

      const row = buildObservationRow(game, observedAt)
      const catalogEntry = upsertCatalog(universeId, normalizeCatalogEntry(game, observedAt))
      const rowsByTimestamp = observationHistoryByUniverseId.get(universeId) ?? new Map()

      rowsByTimestamp.set(row.timestamp, {
        ...row,
        name: catalogEntry.name,
        creator_name: catalogEntry.creatorName,
        creator_type: catalogEntry.creatorType,
        genre: catalogEntry.genre,
      })
      observationHistoryByUniverseId.set(universeId, rowsByTimestamp)
      upsertCurrentMetric(universeId, {
        observed_at: row.timestamp,
        playing: row.playing,
        visits: row.visits,
        favorited_count: row.favorited_count,
        approval: row.approval,
        game_updated_at: row.updated,
        source,
      })
    }

    pruneObservationHistory(retentionMs)
  }

  function importLegacySnapshot(universeId, snapshot) {
    recordSnapshots(
      [{
        ...snapshot,
        universeId: Number(universeId),
      }],
      {
        observedAt: String(snapshot?.timestamp ?? new Date().toISOString()),
        source: 'legacy_import',
      },
    )
  }

  function getHistoryMap(universeIds, cutoffIso) {
    const uniqueIds = sanitizeUniverseIds(universeIds)
    const cutoffMs = typeof cutoffIso === 'string' ? Date.parse(cutoffIso) : Number.NaN
    const historyMap = new Map()

    for (const universeId of uniqueIds) {
      const rowsByTimestamp = observationHistoryByUniverseId.get(universeId)

      if (!rowsByTimestamp) {
        continue
      }

      const rows = [...rowsByTimestamp.values()]
        .filter((row) => !Number.isFinite(cutoffMs) || Date.parse(row.timestamp) >= cutoffMs)
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        .map((row) => ({ ...row }))

      if (rows.length > 0) {
        historyMap.set(universeId, rows)
      }
    }

    return historyMap
  }

  function getLatestSnapshotGames(universeIds) {
    return sanitizeUniverseIds(universeIds)
      .map((universeId) => {
        const catalogEntry = catalogByUniverseId.get(universeId)
        const metric = currentMetricsByUniverseId.get(universeId)

        if (!catalogEntry || !metric) {
          return null
        }

        return mapSnapshotGame({
          universe_id: universeId,
          name: catalogEntry.name,
          creator_name: catalogEntry.creatorName,
          creator_type: catalogEntry.creatorType,
          genre: catalogEntry.genre,
          playing: metric.playing,
          visits: metric.visits,
          favorited_count: metric.favorited_count,
          approval: metric.approval,
          game_updated_at: metric.game_updated_at,
        })
      })
      .filter(Boolean)
      .sort((left, right) => right.playing - left.playing || left.universeId - right.universeId)
  }

  function searchLocalGames(query, limit = 8) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()

    if (normalizedQuery.length === 0) {
      return []
    }

    return [...catalogByUniverseId.entries()]
      .map(([universeId, catalogEntry]) => {
        const metric = currentMetricsByUniverseId.get(universeId)

        if (!metric) {
          return null
        }

        return {
          universeId,
          name: catalogEntry.name,
          creatorName: catalogEntry.creatorName,
          playing: metric.playing,
          approval: metric.approval,
        }
      })
      .filter(Boolean)
      .filter((entry) =>
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.creatorName.toLowerCase().includes(normalizedQuery),
      )
      .sort((left, right) => right.playing - left.playing || left.universeId - right.universeId)
      .slice(0, limit)
      .map((entry) => ({
        universeId: entry.universeId,
        rootPlaceId: 0,
        name: entry.name,
        creatorName: entry.creatorName,
        playerCount: entry.playing,
        approval: entry.approval,
      }))
  }

  function countSnapshots() {
    return countObservations()
  }

  function countObservations() {
    return [...observationHistoryByUniverseId.values()].reduce(
      (total, rowsByTimestamp) => total + rowsByTimestamp.size,
      0,
    )
  }

  function countCatalogEntries() {
    return catalogByUniverseId.size
  }

  function countDailyMetrics() {
    const dayKeys = new Set()

    for (const [universeId, rowsByTimestamp] of observationHistoryByUniverseId.entries()) {
      for (const row of rowsByTimestamp.values()) {
        dayKeys.add(`${universeId}:${row.timestamp.slice(0, 10)}`)
      }
    }

    return dayKeys.size
  }

  function countMetadataHistory() {
    return 0
  }

  function countDerivedHistory() {
    return 0
  }

  function countExternalHistory() {
    return 0
  }

  function countExternalImportRuns() {
    return 0
  }

  function enqueueImportJob(jobType, payload) {
    const id = nextImportJobId
    nextImportJobId += 1
    importJobs.push({
      id,
      job_type: jobType,
      status: 'queued',
      attempts: 0,
      created_at: new Date().toISOString(),
      payload,
      finished_at: null,
      error_message: null,
    })

    return id
  }

  function getImportJobStats() {
    const stats = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    }

    for (const job of importJobs) {
      if (Object.hasOwn(stats, job.status)) {
        stats[job.status] += 1
      }
    }

    return stats
  }

  function startIngestRun(trigger = 'scheduler') {
    const id = nextIngestRunId
    nextIngestRunId += 1
    ingestRuns.push({
      id,
      trigger,
      status: 'running',
      source: null,
      started_at: new Date().toISOString(),
      finished_at: null,
      tracked_universe_count: 0,
      discovered_universe_count: 0,
      observation_count: countObservations(),
      snapshot_count: countSnapshots(),
      error_message: null,
    })

    return id
  }

  function finishIngestRun(
    ingestRunId,
    {
      status,
      source = null,
      trackedUniverseCount = 0,
      discoveredUniverseCount = 0,
      observationCount = countObservations(),
      snapshotCount = countSnapshots(),
      errorMessage = null,
    } = {},
  ) {
    const ingestRun = ingestRuns.find((entry) => entry.id === ingestRunId)

    if (!ingestRun) {
      return
    }

    ingestRun.status = status
    ingestRun.source = source
    ingestRun.finished_at = new Date().toISOString()
    ingestRun.tracked_universe_count = trackedUniverseCount
    ingestRun.discovered_universe_count = discoveredUniverseCount
    ingestRun.observation_count = observationCount
    ingestRun.snapshot_count = snapshotCount
    ingestRun.error_message = errorMessage
  }

  function getLatestIngestRun() {
    return ingestRuns.length > 0 ? { ...ingestRuns.at(-1) } : null
  }

  function recoverStaleIngestRuns(staleAfterMs = INGEST_RUN_STALE_AFTER_MS) {
    const cutoffMs = Date.now() - staleAfterMs
    let recoveredCount = 0

    for (const ingestRun of ingestRuns) {
      if (
        ingestRun.status === 'running' &&
        Date.parse(ingestRun.started_at) < cutoffMs
      ) {
        ingestRun.status = 'failed'
        ingestRun.source = ingestRun.source ?? 'recovery'
        ingestRun.finished_at = ingestRun.finished_at ?? new Date().toISOString()
        ingestRun.error_message =
          ingestRun.error_message ??
          'Marked failed during startup recovery after exceeding the stale run timeout.'
        recoveredCount += 1
      }
    }

    return recoveredCount
  }

  function tryAcquireIngestLease(
    leaseKey,
    ownerId,
    {
      ownerLabel = 'scheduler',
      ttlMs = Math.max(INGEST_RUN_STALE_AFTER_MS, 60_000),
      acquiredAt = new Date().toISOString(),
    } = {},
  ) {
    const existing = ingestLeases.get(leaseKey)
    const acquiredAtMs = Date.parse(acquiredAt)

    if (
      existing &&
      existing.owner_id !== ownerId &&
      Date.parse(existing.expires_at) > acquiredAtMs
    ) {
      return false
    }

    const expiresAt = new Date(acquiredAtMs + ttlMs).toISOString()
    ingestLeases.set(leaseKey, {
      lease_key: leaseKey,
      owner_id: ownerId,
      owner_label: ownerLabel,
      acquired_at:
        existing?.owner_id === ownerId ? existing.acquired_at : acquiredAt,
      heartbeat_at: acquiredAt,
      expires_at: expiresAt,
    })

    return true
  }

  function getActiveIngestLease(leaseKey = 'scheduler') {
    const lease = ingestLeases.get(leaseKey)
    return lease ? { ...lease } : null
  }

  function recordPlatformCurrentMetric(point) {
    if (!point?.timestamp || !Number.isFinite(Number(point?.value))) {
      return
    }

    platformCurrentMetric = {
      value: Math.round(Number(point.value)),
      timestamp: String(point.timestamp),
      source: String(point.source ?? 'live'),
    }
  }

  function getPlatformCurrentMetric() {
    return clonePoint(platformCurrentMetric)
  }

  function recordPlatformHistoryPoints(points, source = 'live') {
    if (!Array.isArray(points) || points.length === 0) {
      return 0
    }

    let importedCount = 0
    let latestPoint = null

    for (const point of points) {
      const timestamp = String(point?.timestamp ?? point?.observedAt ?? point?.observed_at ?? '')
      const value = Number(point?.value ?? point?.playing)

      if (!timestamp || !Number.isFinite(value)) {
        continue
      }

      const normalizedPoint = {
        timestamp,
        value: Math.round(value),
        source: String(point?.source ?? source),
      }

      platformHistoryByTimestamp.set(timestamp, normalizedPoint)
      importedCount += 1

      if (!latestPoint || Date.parse(timestamp) >= Date.parse(latestPoint.timestamp)) {
        latestPoint = normalizedPoint
      }
    }

    if (latestPoint) {
      recordPlatformCurrentMetric(latestPoint)
    }

    pruneObservationHistory(SNAPSHOT_RETENTION_MS)
    return importedCount
  }

  function getPlatformHistoryPoints(cutoffIso) {
    const cutoffMs = typeof cutoffIso === 'string' ? Date.parse(cutoffIso) : Number.NaN

    return [...platformHistoryByTimestamp.values()]
      .filter((point) => !Number.isFinite(cutoffMs) || Date.parse(point.timestamp) >= cutoffMs)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .map((point) => ({ ...point }))
  }

  function recordGamePageSnapshot() {
    // The in-memory backend intentionally avoids persisting request-time page history.
  }

  return {
    db: null,
    countCatalogEntries,
    countDailyMetrics,
    countDerivedHistory,
    countExternalHistory,
    countExternalImportRuns,
    countMetadataHistory,
    countObservations,
    countSnapshots,
    countTrackedUniverseIds,
    appendTrackedUniverseIds,
    enqueueImportJob,
    finishIngestRun,
    getActiveIngestLease,
    getHistoryMap,
    getImportJobStats,
    getLatestIngestRun,
    getLatestSnapshotGames,
    getPlatformCurrentMetric,
    getPlatformHistoryPoints,
    getTrackedUniverseIds,
    importLegacySnapshot,
    recordGamePageSnapshot,
    recordPlatformCurrentMetric,
    recordPlatformHistoryPoints,
    recordSnapshots,
    recoverStaleIngestRuns,
    replaceTrackedUniverseIds,
    searchLocalGames,
    startIngestRun,
    tryAcquireIngestLease,
  }
}
