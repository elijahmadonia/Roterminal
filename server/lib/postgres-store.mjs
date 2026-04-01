import { Pool } from 'pg'

import {
  INGEST_RUN_STALE_AFTER_MS,
  POSTGRES_IDLE_TIMEOUT_MS,
  POSTGRES_POOL_MAX,
  POSTGRES_URL,
  SNAPSHOT_RETENTION_MS,
} from '../config.mjs'

const PLATFORM_METRIC_KEY = 'platform_ccu'
const DEGRADED_PLATFORM_SOURCES = ['board_fallback', 'stored_fallback', 'empty_fallback']

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

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function normalizeCatalogEntry(game, observedAt) {
  const universeId = Number(game?.universeId)
  const safeObservedAt = normalizeTimestamp(observedAt)
  const safeUpdatedAt = normalizeTimestamp(game?.updated, safeObservedAt)

  return {
    universeId,
    name: String(game?.name ?? `Universe ${universeId}`),
    creatorName: String(game?.creatorName ?? 'Unknown creator'),
    creatorType: String(game?.creatorType ?? 'Unknown'),
    genre: String(game?.genre ?? 'Unclassified'),
    firstSeenAt: safeObservedAt,
    lastSeenAt: safeObservedAt,
    lastGameUpdatedAt: safeUpdatedAt,
  }
}

function buildObservationRow(game, observedAt) {
  const catalogEntry = normalizeCatalogEntry(game, observedAt)

  return {
    universeId: catalogEntry.universeId,
    observedAt: catalogEntry.lastSeenAt,
    name: catalogEntry.name,
    creatorName: catalogEntry.creatorName,
    creatorType: catalogEntry.creatorType,
    genre: catalogEntry.genre,
    playing: Number(game?.playing) || 0,
    visits: Number(game?.visits) || 0,
    favoritedCount: Number(game?.favoritedCount) || 0,
    approval: Number(game?.approval) || 0,
    updated: catalogEntry.lastGameUpdatedAt,
  }
}

function mapSnapshotGame(row) {
  return {
    universeId: Number(row.universe_id),
    name: row.name,
    creatorName: row.creator_name,
    creatorType: row.creator_type,
    genre: row.genre,
    playing: Number(row.playing) || 0,
    visits: Number(row.visits) || 0,
    favoritedCount: Number(row.favorited_count) || 0,
    approval: Number(row.approval) || 0,
    updated: normalizeTimestamp(row.game_updated_at),
    thumbnailUrl: undefined,
  }
}

function clonePoint(point) {
  return point == null ? null : { ...point }
}

function buildValuesClause(rowCount, columnCount, startIndex = 1) {
  let placeholderIndex = startIndex

  return Array.from({ length: rowCount }, () => {
    const placeholders = Array.from({ length: columnCount }, () => `$${placeholderIndex++}`)
    return `(${placeholders.join(', ')})`
  }).join(', ')
}

function flattenRows(rows) {
  return rows.flatMap((row) => row)
}

async function withTransaction(pool, callback) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function mapHistoryRows(rows) {
  const historyMap = new Map()

  for (const row of rows) {
    const universeId = Number(row.universe_id)
    const history = historyMap.get(universeId) ?? []

    history.push({
      timestamp: normalizeTimestamp(row.observed_at),
      name: row.name,
      creator_name: row.creator_name,
      creator_type: row.creator_type,
      genre: row.genre,
      playing: Number(row.playing) || 0,
      visits: Number(row.visits) || 0,
      favorited_count: Number(row.favorited_count) || 0,
      approval: Number(row.approval) || 0,
      updated: normalizeTimestamp(row.game_updated_at),
    })

    historyMap.set(universeId, history)
  }

  return historyMap
}

function mapIngestRun(row) {
  if (!row) {
    return null
  }

  return {
    id: Number(row.id),
    trigger: row.trigger,
    status: row.status,
    source: row.source,
    started_at: normalizeTimestamp(row.started_at),
    finished_at: row.finished_at ? normalizeTimestamp(row.finished_at) : null,
    tracked_universe_count: Number(row.tracked_universe_count) || 0,
    discovered_universe_count: Number(row.discovered_universe_count) || 0,
    observation_count: Number(row.observation_count) || 0,
    snapshot_count: Number(row.snapshot_count) || 0,
    error_message: row.error_message,
  }
}

function mapLease(row) {
  if (!row) {
    return null
  }

  return {
    lease_key: row.lease_key,
    owner_id: row.owner_id,
    owner_label: row.owner_label,
    acquired_at: normalizeTimestamp(row.acquired_at),
    heartbeat_at: normalizeTimestamp(row.heartbeat_at),
    expires_at: normalizeTimestamp(row.expires_at),
  }
}

async function applyMigrations(pool) {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS tracked_universes (
        universe_id BIGINT PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS tracking_tier TEXT NOT NULL DEFAULT 'tier_d'
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS poll_interval_minutes INTEGER NOT NULL DEFAULT 60
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS priority_score DOUBLE PRECISION NOT NULL DEFAULT 0
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS last_known_playing INTEGER NOT NULL DEFAULT 0
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'manual'
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS first_discovered_at TIMESTAMPTZ
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS last_discovered_at TIMESTAMPTZ
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS last_promoted_at TIMESTAMPTZ
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ
    `,
    `
      ALTER TABLE tracked_universes
      ADD COLUMN IF NOT EXISTS manually_pinned BOOLEAN NOT NULL DEFAULT FALSE
    `,
    `
      UPDATE tracked_universes
      SET
        first_discovered_at = COALESCE(first_discovered_at, updated_at, NOW()),
        last_discovered_at = COALESCE(last_discovered_at, updated_at, NOW())
      WHERE first_discovered_at IS NULL OR last_discovered_at IS NULL
    `,
    `
      CREATE TABLE IF NOT EXISTS universe_catalog (
        universe_id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        creator_type TEXT NOT NULL,
        genre TEXT NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        last_game_updated_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS universe_current_metrics (
        universe_id BIGINT PRIMARY KEY,
        observed_at TIMESTAMPTZ NOT NULL,
        playing INTEGER NOT NULL,
        visits BIGINT NOT NULL,
        favorited_count BIGINT NOT NULL,
        approval DOUBLE PRECISION NOT NULL,
        game_updated_at TIMESTAMPTZ NOT NULL,
        source TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS universe_observations (
        universe_id BIGINT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        name TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        creator_type TEXT NOT NULL,
        genre TEXT NOT NULL,
        playing INTEGER NOT NULL,
        visits BIGINT NOT NULL,
        favorited_count BIGINT NOT NULL,
        approval DOUBLE PRECISION NOT NULL,
        game_updated_at TIMESTAMPTZ NOT NULL,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (universe_id, observed_at)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS platform_current_metrics (
        metric_key TEXT PRIMARY KEY,
        observed_at TIMESTAMPTZ NOT NULL,
        playing INTEGER NOT NULL,
        source TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS platform_history_points (
        metric_key TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        playing INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (metric_key, observed_at)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        observed_at TIMESTAMPTZ NOT NULL,
        source TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ingest_runs (
        id BIGSERIAL PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        tracked_universe_count INTEGER NOT NULL DEFAULT 0,
        discovered_universe_count INTEGER NOT NULL DEFAULT 0,
        observation_count BIGINT NOT NULL DEFAULT 0,
        snapshot_count BIGINT NOT NULL DEFAULT 0,
        error_message TEXT
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ingest_leases (
        lease_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_label TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL,
        heartbeat_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS tracked_universes_sort_order_idx
      ON tracked_universes (sort_order ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS tracked_universes_priority_idx
      ON tracked_universes (sort_order ASC, priority_score DESC, last_known_playing DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS tracked_universes_due_poll_idx
      ON tracked_universes (tracking_tier, last_polled_at, poll_interval_minutes)
    `,
    `
      CREATE INDEX IF NOT EXISTS universe_observations_universe_observed_idx
      ON universe_observations (universe_id, observed_at ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS universe_observations_observed_idx
      ON universe_observations (observed_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS platform_history_points_metric_observed_idx
      ON platform_history_points (metric_key, observed_at ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS ingest_runs_started_idx
      ON ingest_runs (started_at DESC)
    `,
  ]

  for (const statement of statements) {
    await pool.query(statement)
  }
}

export async function createPostgresStore() {
  if (!POSTGRES_URL) {
    throw new Error('ROTERMINAL_POSTGRES_URL or DATABASE_URL must be set for the postgres backend.')
  }

  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: POSTGRES_POOL_MAX,
    idleTimeoutMillis: POSTGRES_IDLE_TIMEOUT_MS,
    ssl: POSTGRES_URL.includes('render.com')
      ? { rejectUnauthorized: false }
      : undefined,
  })

  await pool.query('SELECT 1')
  await applyMigrations(pool)

  async function countTrackedUniverseIds() {
    const result = await pool.query('SELECT COUNT(*)::INT AS total FROM tracked_universes')
    return Number(result.rows[0]?.total) || 0
  }

  async function getTrackedUniverseIds() {
    const result = await pool.query(`
      SELECT universe_id
      FROM tracked_universes
      ORDER BY sort_order ASC
    `)

    return result.rows.map((row) => Number(row.universe_id)).filter((value) => Number.isFinite(value))
  }

  async function getTrackedUniverseRecords() {
    const result = await pool.query(`
      SELECT
        universe_id,
        sort_order,
        tracking_tier,
        poll_interval_minutes,
        priority_score,
        last_known_playing,
        discovery_source,
        first_discovered_at,
        last_discovered_at,
        last_promoted_at,
        last_polled_at,
        manually_pinned
      FROM tracked_universes
      ORDER BY sort_order ASC, priority_score DESC, last_known_playing DESC, universe_id ASC
    `)

    return result.rows.map((row) => ({
      universeId: Number(row.universe_id),
      sortOrder: Number(row.sort_order) || 0,
      trackingTier: row.tracking_tier ?? 'tier_d',
      pollIntervalMinutes: Number(row.poll_interval_minutes) || 60,
      priorityScore: Number(row.priority_score) || 0,
      lastKnownPlaying: Number(row.last_known_playing) || 0,
      discoverySource: row.discovery_source ?? 'manual',
      firstDiscoveredAt: normalizeTimestamp(row.first_discovered_at),
      lastDiscoveredAt: normalizeTimestamp(row.last_discovered_at),
      lastPromotedAt: row.last_promoted_at ? normalizeTimestamp(row.last_promoted_at) : null,
      lastPolledAt: row.last_polled_at ? normalizeTimestamp(row.last_polled_at) : null,
      manuallyPinned: Boolean(row.manually_pinned),
    }))
  }

  async function getTrackedTierCounts() {
    const result = await pool.query(`
      SELECT tracking_tier, COUNT(*)::INT AS total
      FROM tracked_universes
      GROUP BY tracking_tier
      ORDER BY tracking_tier ASC
    `)

    return result.rows.reduce((counts, row) => {
      counts[row.tracking_tier] = Number(row.total) || 0
      return counts
    }, {})
  }

  async function getTrackedDiscoverySourceCounts() {
    const result = await pool.query(`
      SELECT discovery_source, COUNT(*)::INT AS total
      FROM tracked_universes
      GROUP BY discovery_source
      ORDER BY total DESC, discovery_source ASC
    `)

    return result.rows.reduce((counts, row) => {
      counts[row.discovery_source] = Number(row.total) || 0
      return counts
    }, {})
  }

  function normalizeTrackedUniverseRecords(records) {
    const nowIso = new Date().toISOString()
    return sanitizeUniverseIds(records.map((record) => record?.universeId)).map((universeId, index) => {
      const record = records.find((entry) => Number(entry?.universeId) === universeId) ?? {}
      return {
        universeId,
        sortOrder: Number.isFinite(record.sortOrder) ? Number(record.sortOrder) : index,
        trackingTier:
          typeof record.trackingTier === 'string' && record.trackingTier.length > 0
            ? record.trackingTier
            : 'tier_d',
        pollIntervalMinutes:
          Number.isFinite(record.pollIntervalMinutes) && Number(record.pollIntervalMinutes) > 0
            ? Number(record.pollIntervalMinutes)
            : 60,
        priorityScore: Number.isFinite(record.priorityScore) ? Number(record.priorityScore) : 0,
        lastKnownPlaying:
          Number.isFinite(record.lastKnownPlaying) && Number(record.lastKnownPlaying) >= 0
            ? Number(record.lastKnownPlaying)
            : 0,
        discoverySource:
          typeof record.discoverySource === 'string' && record.discoverySource.length > 0
            ? record.discoverySource
            : 'manual',
        firstDiscoveredAt: record.firstDiscoveredAt ?? nowIso,
        lastDiscoveredAt: record.lastDiscoveredAt ?? record.firstDiscoveredAt ?? nowIso,
        lastPromotedAt: record.lastPromotedAt ?? null,
        lastPolledAt: record.lastPolledAt ?? null,
        manuallyPinned: Boolean(record.manuallyPinned),
      }
    })
  }

  async function replaceTrackedUniverseIds(universeIds) {
    const existingById = new Map(
      (await getTrackedUniverseRecords()).map((record) => [record.universeId, record]),
    )
    const records = sanitizeUniverseIds(universeIds).map((universeId, index) => ({
      ...(existingById.get(universeId) ?? {}),
      universeId,
      sortOrder: index,
    }))

    await replaceTrackedUniverseRecords(records)
    return records.map((record) => record.universeId)
  }

  async function appendTrackedUniverseIds(universeIds, maxCount = Number.POSITIVE_INFINITY) {
    const currentIds = await getTrackedUniverseIds()
    const incomingIds = sanitizeUniverseIds(universeIds)

    if (incomingIds.length === 0) {
      return currentIds
    }

    const dedupedIds = [
      ...currentIds.filter((universeId) => !incomingIds.includes(universeId)),
      ...incomingIds,
    ]
    const limitedIds = Number.isFinite(maxCount)
      ? dedupedIds.slice(-Math.max(Math.floor(maxCount), 1))
      : dedupedIds

    await replaceTrackedUniverseIds(limitedIds)
    return limitedIds
  }

  async function replaceTrackedUniverseRecords(records) {
    const normalizedRecords = normalizeTrackedUniverseRecords(records)

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM tracked_universes')

      if (normalizedRecords.length === 0) {
        return
      }

      const rows = normalizedRecords.map((record, index) => [
        record.universeId,
        Number.isFinite(record.sortOrder) ? Number(record.sortOrder) : index,
        record.trackingTier,
        record.pollIntervalMinutes,
        record.priorityScore,
        record.lastKnownPlaying,
        record.discoverySource,
        record.firstDiscoveredAt,
        record.lastDiscoveredAt,
        record.lastPromotedAt,
        record.lastPolledAt,
        record.manuallyPinned,
      ])

      await client.query(
        `
          INSERT INTO tracked_universes (
            universe_id,
            sort_order,
            tracking_tier,
            poll_interval_minutes,
            priority_score,
            last_known_playing,
            discovery_source,
            first_discovered_at,
            last_discovered_at,
            last_promoted_at,
            last_polled_at,
            manually_pinned
          )
          VALUES ${buildValuesClause(rows.length, 12)}
          ON CONFLICT (universe_id) DO UPDATE SET
            sort_order = EXCLUDED.sort_order,
            tracking_tier = EXCLUDED.tracking_tier,
            poll_interval_minutes = EXCLUDED.poll_interval_minutes,
            priority_score = EXCLUDED.priority_score,
            last_known_playing = EXCLUDED.last_known_playing,
            discovery_source = EXCLUDED.discovery_source,
            first_discovered_at = LEAST(tracked_universes.first_discovered_at, EXCLUDED.first_discovered_at),
            last_discovered_at = GREATEST(tracked_universes.last_discovered_at, EXCLUDED.last_discovered_at),
            last_promoted_at = COALESCE(EXCLUDED.last_promoted_at, tracked_universes.last_promoted_at),
            last_polled_at = COALESCE(EXCLUDED.last_polled_at, tracked_universes.last_polled_at),
            manually_pinned = EXCLUDED.manually_pinned,
            updated_at = NOW()
        `,
        flattenRows(rows),
      )
    })

    return normalizedRecords.map((record) => record.universeId)
  }

  async function countCatalogEntries() {
    const result = await pool.query('SELECT COUNT(*)::INT AS total FROM universe_catalog')
    return Number(result.rows[0]?.total) || 0
  }

  async function countObservations() {
    const result = await pool.query('SELECT COUNT(*)::INT AS total FROM universe_observations')
    return Number(result.rows[0]?.total) || 0
  }

  async function countSnapshots() {
    return countObservations()
  }

  async function recordSnapshots(
    games,
    {
      observedAt = new Date().toISOString(),
      source = 'live',
      retentionMs = SNAPSHOT_RETENTION_MS,
    } = {},
  ) {
    const uniqueGames = dedupeSnapshotGames(games)

    if (uniqueGames.length === 0) {
      return
    }

    const normalizedObservedAt = normalizeTimestamp(observedAt)
    const catalogRows = []
    const currentMetricRows = []
    const observationRows = []

    for (const game of uniqueGames) {
      const catalogEntry = normalizeCatalogEntry(game, normalizedObservedAt)
      const observation = buildObservationRow(game, normalizedObservedAt)

      catalogRows.push([
        catalogEntry.universeId,
        catalogEntry.name,
        catalogEntry.creatorName,
        catalogEntry.creatorType,
        catalogEntry.genre,
        catalogEntry.firstSeenAt,
        catalogEntry.lastSeenAt,
        catalogEntry.lastGameUpdatedAt,
      ])
      currentMetricRows.push([
        observation.universeId,
        observation.observedAt,
        observation.playing,
        observation.visits,
        observation.favoritedCount,
        observation.approval,
        observation.updated,
        source,
      ])
      observationRows.push([
        observation.universeId,
        observation.observedAt,
        observation.name,
        observation.creatorName,
        observation.creatorType,
        observation.genre,
        observation.playing,
        observation.visits,
        observation.favoritedCount,
        observation.approval,
        observation.updated,
        source,
      ])
    }

    await withTransaction(pool, async (client) => {
      await client.query(
        `
          INSERT INTO universe_catalog (
            universe_id,
            name,
            creator_name,
            creator_type,
            genre,
            first_seen_at,
            last_seen_at,
            last_game_updated_at
          )
          VALUES ${buildValuesClause(catalogRows.length, 8)}
          ON CONFLICT (universe_id) DO UPDATE SET
            name = EXCLUDED.name,
            creator_name = EXCLUDED.creator_name,
            creator_type = EXCLUDED.creator_type,
            genre = EXCLUDED.genre,
            first_seen_at = LEAST(universe_catalog.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(universe_catalog.last_seen_at, EXCLUDED.last_seen_at),
            last_game_updated_at = GREATEST(universe_catalog.last_game_updated_at, EXCLUDED.last_game_updated_at),
            updated_at = NOW()
        `,
        flattenRows(catalogRows),
      )

      await client.query(
        `
          INSERT INTO universe_current_metrics (
            universe_id,
            observed_at,
            playing,
            visits,
            favorited_count,
            approval,
            game_updated_at,
            source
          )
          VALUES ${buildValuesClause(currentMetricRows.length, 8)}
          ON CONFLICT (universe_id) DO UPDATE SET
            observed_at = EXCLUDED.observed_at,
            playing = EXCLUDED.playing,
            visits = EXCLUDED.visits,
            favorited_count = EXCLUDED.favorited_count,
            approval = EXCLUDED.approval,
            game_updated_at = EXCLUDED.game_updated_at,
            source = EXCLUDED.source,
            updated_at = NOW()
          WHERE EXCLUDED.observed_at >= universe_current_metrics.observed_at
        `,
        flattenRows(currentMetricRows),
      )

      await client.query(
        `
          INSERT INTO universe_observations (
            universe_id,
            observed_at,
            name,
            creator_name,
            creator_type,
            genre,
            playing,
            visits,
            favorited_count,
            approval,
            game_updated_at,
            source
          )
          VALUES ${buildValuesClause(observationRows.length, 12)}
          ON CONFLICT (universe_id, observed_at) DO UPDATE SET
            name = EXCLUDED.name,
            creator_name = EXCLUDED.creator_name,
            creator_type = EXCLUDED.creator_type,
            genre = EXCLUDED.genre,
            playing = EXCLUDED.playing,
            visits = EXCLUDED.visits,
            favorited_count = EXCLUDED.favorited_count,
            approval = EXCLUDED.approval,
            game_updated_at = EXCLUDED.game_updated_at,
            source = EXCLUDED.source
        `,
        flattenRows(observationRows),
      )

      if (retentionMs) {
        const cutoffIso = new Date(Date.now() - retentionMs).toISOString()
        await client.query(
          'DELETE FROM universe_observations WHERE observed_at < $1',
          [cutoffIso],
        )
        await client.query(
          'DELETE FROM platform_history_points WHERE observed_at < $1',
          [cutoffIso],
        )
      }
    })
  }

  async function getHistoryMap(universeIds, cutoffIso) {
    const sanitizedIds = sanitizeUniverseIds(universeIds)

    if (sanitizedIds.length === 0) {
      return new Map()
    }

    const params = [sanitizedIds]
    let cutoffClause = ''

    if (typeof cutoffIso === 'string' && cutoffIso.length > 0) {
      params.push(normalizeTimestamp(cutoffIso))
      cutoffClause = 'AND observed_at >= $2'
    }

    const result = await pool.query(
      `
        SELECT
          universe_id,
          observed_at,
          name,
          creator_name,
          creator_type,
          genre,
          playing,
          visits,
          favorited_count,
          approval,
          game_updated_at
        FROM universe_observations
        WHERE universe_id = ANY($1::BIGINT[])
          ${cutoffClause}
        ORDER BY universe_id ASC, observed_at ASC
      `,
      params,
    )

    return mapHistoryRows(result.rows)
  }

  async function getLatestSnapshotGames(universeIds) {
    const sanitizedIds = sanitizeUniverseIds(universeIds)

    if (sanitizedIds.length === 0) {
      return []
    }

    const result = await pool.query(
      `
        SELECT
          c.universe_id,
          c.name,
          c.creator_name,
          c.creator_type,
          c.genre,
          m.playing,
          m.visits,
          m.favorited_count,
          m.approval,
          m.game_updated_at
        FROM universe_catalog c
        INNER JOIN universe_current_metrics m
          ON m.universe_id = c.universe_id
        WHERE c.universe_id = ANY($1::BIGINT[])
        ORDER BY m.playing DESC, c.universe_id ASC
      `,
      [sanitizedIds],
    )

    return result.rows.map(mapSnapshotGame)
  }

  async function searchLocalGames(query, limit = 8) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()

    if (normalizedQuery.length === 0) {
      return []
    }

    const result = await pool.query(
      `
        SELECT
          c.universe_id,
          c.name,
          c.creator_name,
          m.playing,
          m.approval
        FROM universe_catalog c
        INNER JOIN universe_current_metrics m
          ON m.universe_id = c.universe_id
        WHERE LOWER(c.name) LIKE $1 OR LOWER(c.creator_name) LIKE $1
        ORDER BY m.playing DESC, c.universe_id ASC
        LIMIT $2
      `,
      [`%${normalizedQuery}%`, limit],
    )

    return result.rows.map((row) => ({
      universeId: Number(row.universe_id),
      rootPlaceId: 0,
      name: row.name,
      creatorName: row.creator_name,
      playerCount: Number(row.playing) || 0,
      approval: Number(row.approval) || 0,
    }))
  }

  async function startIngestRun(trigger = 'scheduler') {
    const observationCount = await countObservations()
    const snapshotCount = observationCount
    const result = await pool.query(
      `
        INSERT INTO ingest_runs (
          trigger,
          status,
          source,
          started_at,
          finished_at,
          tracked_universe_count,
          discovered_universe_count,
          observation_count,
          snapshot_count,
          error_message
        )
        VALUES ($1, 'running', NULL, $2, NULL, 0, 0, $3, $4, NULL)
        RETURNING id
      `,
      [trigger, new Date().toISOString(), observationCount, snapshotCount],
    )

    return Number(result.rows[0]?.id)
  }

  async function finishIngestRun(
    ingestRunId,
    {
      status,
      source = null,
      trackedUniverseCount = 0,
      discoveredUniverseCount = 0,
      observationCount = null,
      snapshotCount = null,
      errorMessage = null,
    } = {},
  ) {
    const resolvedObservationCount =
      observationCount == null ? await countObservations() : observationCount
    const resolvedSnapshotCount =
      snapshotCount == null ? await countSnapshots() : snapshotCount

    await pool.query(
      `
        UPDATE ingest_runs
        SET
          status = $2,
          source = $3,
          finished_at = $4,
          tracked_universe_count = $5,
          discovered_universe_count = $6,
          observation_count = $7,
          snapshot_count = $8,
          error_message = $9
        WHERE id = $1
      `,
      [
        ingestRunId,
        status,
        source,
        new Date().toISOString(),
        trackedUniverseCount,
        discoveredUniverseCount,
        resolvedObservationCount,
        resolvedSnapshotCount,
        errorMessage,
      ],
    )
  }

  async function getLatestIngestRun() {
    const result = await pool.query(
      `
        SELECT *
        FROM ingest_runs
        ORDER BY id DESC
        LIMIT 1
      `,
    )

    return mapIngestRun(result.rows[0])
  }

  async function recoverStaleIngestRuns(staleAfterMs = INGEST_RUN_STALE_AFTER_MS) {
    const cutoffIso = new Date(Date.now() - staleAfterMs).toISOString()
    const result = await pool.query(
      `
        UPDATE ingest_runs
        SET
          status = 'failed',
          source = COALESCE(source, 'recovery'),
          finished_at = COALESCE(finished_at, NOW()),
          error_message = COALESCE(
            error_message,
            'Marked failed during startup recovery after exceeding the stale run timeout.'
          )
        WHERE status = 'running' AND started_at < $1
      `,
      [cutoffIso],
    )

    return Number(result.rowCount) || 0
  }

  async function tryAcquireIngestLease(
    leaseKey,
    ownerId,
    {
      ownerLabel = 'scheduler',
      ttlMs = Math.max(INGEST_RUN_STALE_AFTER_MS, 60_000),
      acquiredAt = new Date().toISOString(),
    } = {},
  ) {
    const normalizedAcquiredAt = normalizeTimestamp(acquiredAt)
    const expiresAt = new Date(Date.parse(normalizedAcquiredAt) + ttlMs).toISOString()
    const result = await pool.query(
      `
        INSERT INTO ingest_leases (
          lease_key,
          owner_id,
          owner_label,
          acquired_at,
          heartbeat_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $4, $5)
        ON CONFLICT (lease_key) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          owner_label = EXCLUDED.owner_label,
          acquired_at = CASE
            WHEN ingest_leases.owner_id = EXCLUDED.owner_id
              THEN ingest_leases.acquired_at
            ELSE EXCLUDED.acquired_at
          END,
          heartbeat_at = EXCLUDED.heartbeat_at,
          expires_at = EXCLUDED.expires_at
        WHERE ingest_leases.owner_id = EXCLUDED.owner_id
          OR ingest_leases.expires_at <= EXCLUDED.heartbeat_at
        RETURNING lease_key
      `,
      [leaseKey, ownerId, ownerLabel, normalizedAcquiredAt, expiresAt],
    )

    return result.rowCount > 0
  }

  async function getActiveIngestLease(leaseKey = 'scheduler') {
    const result = await pool.query(
      `
        SELECT *
        FROM ingest_leases
        WHERE lease_key = $1
      `,
      [leaseKey],
    )

    return mapLease(result.rows[0])
  }

  async function recordPlatformCurrentMetric(point) {
    if (!point?.timestamp || !Number.isFinite(Number(point?.value))) {
      return
    }

    await pool.query(
      `
        INSERT INTO platform_current_metrics (
          metric_key,
          observed_at,
          playing,
          source
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (metric_key) DO UPDATE SET
          observed_at = EXCLUDED.observed_at,
          playing = EXCLUDED.playing,
          source = EXCLUDED.source,
          updated_at = NOW()
        WHERE CASE
          WHEN platform_current_metrics.source = ANY($5::text[])
            AND EXCLUDED.source <> ALL($6::text[])
            THEN TRUE
          WHEN platform_current_metrics.source <> ALL($7::text[])
            AND EXCLUDED.source = ANY($8::text[])
            THEN FALSE
          ELSE EXCLUDED.observed_at >= platform_current_metrics.observed_at
        END
      `,
      [
        PLATFORM_METRIC_KEY,
        normalizeTimestamp(point.timestamp),
        Math.round(Number(point.value)),
        String(point.source ?? 'live'),
        DEGRADED_PLATFORM_SOURCES,
        DEGRADED_PLATFORM_SOURCES,
        DEGRADED_PLATFORM_SOURCES,
        DEGRADED_PLATFORM_SOURCES,
      ],
    )
  }

  async function getPlatformCurrentMetric() {
    const result = await pool.query(
      `
        SELECT observed_at, playing, source
        FROM platform_current_metrics
        WHERE metric_key = $1
      `,
      [PLATFORM_METRIC_KEY],
    )
    const row = result.rows[0]

    if (!row) {
      return null
    }

    return {
      value: Number(row.playing) || 0,
      timestamp: normalizeTimestamp(row.observed_at),
      source: row.source ?? 'live',
    }
  }

  async function getBoardSnapshot(range = '24h') {
    const result = await pool.query(
      `
        SELECT payload_json
        FROM app_state
        WHERE state_key = $1
      `,
      [`board_snapshot:${range}`],
    )

    return result.rows[0]?.payload_json ?? null
  }

  async function recordBoardSnapshot(
    range,
    payload,
    {
      observedAt = new Date().toISOString(),
      source = 'worker_live',
    } = {},
  ) {
    if (!range || payload == null) {
      return
    }

    await pool.query(
      `
        INSERT INTO app_state (
          state_key,
          observed_at,
          source,
          payload_json
        )
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (state_key) DO UPDATE SET
          observed_at = EXCLUDED.observed_at,
          source = EXCLUDED.source,
          payload_json = EXCLUDED.payload_json,
          updated_at = NOW()
        WHERE EXCLUDED.observed_at >= app_state.observed_at
      `,
      [
        `board_snapshot:${range}`,
        normalizeTimestamp(observedAt),
        String(source),
        JSON.stringify(payload),
      ],
    )
  }

  async function recordPlatformHistoryPoints(points, source = 'live') {
    if (!Array.isArray(points) || points.length === 0) {
      return 0
    }

    const rows = []
    let latestPoint = null

    for (const point of points) {
      const timestamp = normalizeTimestamp(
        point?.timestamp ?? point?.observedAt ?? point?.observed_at,
        '',
      )
      const value = Number(point?.value ?? point?.playing)

      if (!timestamp || !Number.isFinite(value)) {
        continue
      }

      const normalizedPoint = {
        timestamp,
        value: Math.round(value),
        source: String(point?.source ?? source),
      }

      rows.push([
        PLATFORM_METRIC_KEY,
        normalizedPoint.timestamp,
        normalizedPoint.value,
        normalizedPoint.source,
      ])

      if (!latestPoint || Date.parse(normalizedPoint.timestamp) >= Date.parse(latestPoint.timestamp)) {
        latestPoint = normalizedPoint
      }
    }

    if (rows.length === 0) {
      return 0
    }

    await withTransaction(pool, async (client) => {
      await client.query(
        `
          INSERT INTO platform_history_points (
            metric_key,
            observed_at,
            playing,
            source
          )
          VALUES ${buildValuesClause(rows.length, 4)}
          ON CONFLICT (metric_key, observed_at) DO UPDATE SET
            playing = EXCLUDED.playing,
            source = EXCLUDED.source
        `,
        flattenRows(rows),
      )

      if (latestPoint) {
        await client.query(
          `
            INSERT INTO platform_current_metrics (
              metric_key,
              observed_at,
              playing,
              source
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (metric_key) DO UPDATE SET
              observed_at = EXCLUDED.observed_at,
              playing = EXCLUDED.playing,
              source = EXCLUDED.source,
              updated_at = NOW()
            WHERE EXCLUDED.observed_at >= platform_current_metrics.observed_at
          `,
          [
            PLATFORM_METRIC_KEY,
            latestPoint.timestamp,
            latestPoint.value,
            latestPoint.source,
          ],
        )
      }

      const cutoffIso = new Date(Date.now() - SNAPSHOT_RETENTION_MS).toISOString()
      await client.query(
        'DELETE FROM platform_history_points WHERE observed_at < $1',
        [cutoffIso],
      )
    })

    return rows.length
  }

  async function deletePlatformHistoryPoints(timestamps) {
    if (!Array.isArray(timestamps) || timestamps.length === 0) {
      return 0
    }

    const normalizedTimestamps = [...new Set(
      timestamps
        .map((timestamp) => normalizeTimestamp(timestamp, ''))
        .filter((timestamp) => timestamp.length > 0),
    )]

    if (normalizedTimestamps.length === 0) {
      return 0
    }

    const result = await pool.query(
      `
        DELETE FROM platform_history_points
        WHERE metric_key = $1
          AND observed_at = ANY($2::timestamptz[])
      `,
      [PLATFORM_METRIC_KEY, normalizedTimestamps],
    )

    return result.rowCount ?? 0
  }

  async function getPlatformHistoryPoints(cutoffIso) {
    const params = [PLATFORM_METRIC_KEY]
    let cutoffClause = ''

    if (typeof cutoffIso === 'string' && cutoffIso.length > 0) {
      params.push(normalizeTimestamp(cutoffIso))
      cutoffClause = 'AND observed_at >= $2'
    }

    const result = await pool.query(
      `
        SELECT observed_at, playing, source
        FROM platform_history_points
        WHERE metric_key = $1
          ${cutoffClause}
        ORDER BY observed_at ASC
      `,
      params,
    )

    return result.rows.map((row) => ({
      timestamp: normalizeTimestamp(row.observed_at),
      value: Number(row.playing) || 0,
      source: row.source ?? 'live',
    }))
  }

  function countDailyMetrics() {
    return 0
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

  function enqueueImportJob() {
    return 0
  }

  function getImportJobStats() {
    return {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    }
  }

  function importLegacySnapshot() {
    return null
  }

  function recordGamePageSnapshot() {
    return null
  }

  return {
    db: pool,
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
    getBoardSnapshot,
    enqueueImportJob,
    finishIngestRun,
    getActiveIngestLease,
    getHistoryMap,
    getImportJobStats,
    getLatestIngestRun,
    getLatestSnapshotGames,
    getPlatformCurrentMetric,
    getPlatformHistoryPoints,
    deletePlatformHistoryPoints,
    getTrackedDiscoverySourceCounts,
    getTrackedTierCounts,
    getTrackedUniverseRecords,
    getTrackedUniverseIds,
    importLegacySnapshot,
    recordBoardSnapshot,
    recordGamePageSnapshot,
    recordPlatformCurrentMetric,
    recordPlatformHistoryPoints,
    recordSnapshots,
    recoverStaleIngestRuns,
    replaceTrackedUniverseRecords,
    replaceTrackedUniverseIds,
    searchLocalGames,
    startIngestRun,
    tryAcquireIngestLease,
  }
}
