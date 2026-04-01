import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  DB_PATH,
  INGEST_RUN_STALE_AFTER_MS,
  SNAPSHOT_RETENTION_MS,
} from '../config.mjs'

const PLATFORM_METRIC_KEY = 'platform_ccu'
const DEGRADED_PLATFORM_SOURCES = ['board_fallback', 'stored_fallback', 'empty_fallback']

function hasTableColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName)
}

const MIGRATIONS = [
  {
    id: '001_base_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tracked_universes (
          universe_id INTEGER PRIMARY KEY,
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          universe_id INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          name TEXT NOT NULL,
          creator_name TEXT NOT NULL,
          creator_type TEXT NOT NULL,
          genre TEXT NOT NULL,
          playing INTEGER NOT NULL,
          visits INTEGER NOT NULL,
          favorited_count INTEGER NOT NULL,
          approval REAL NOT NULL,
          updated TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_universe_timestamp
          ON snapshots(universe_id, timestamp);
      `)
    },
  },
  {
    id: '002_normalized_warehouse',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS universe_catalog (
          universe_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          creator_name TEXT NOT NULL,
          creator_type TEXT NOT NULL,
          genre TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_game_updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS universe_current_metrics (
          universe_id INTEGER PRIMARY KEY,
          observed_at TEXT NOT NULL,
          playing INTEGER NOT NULL,
          visits INTEGER NOT NULL,
          favorited_count INTEGER NOT NULL,
          approval REAL NOT NULL,
          game_updated_at TEXT NOT NULL,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (universe_id) REFERENCES universe_catalog(universe_id)
        );

        CREATE TABLE IF NOT EXISTS universe_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          playing INTEGER NOT NULL,
          visits INTEGER NOT NULL,
          favorited_count INTEGER NOT NULL,
          approval REAL NOT NULL,
          game_updated_at TEXT NOT NULL,
          source TEXT NOT NULL,
          inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(universe_id, observed_at),
          FOREIGN KEY (universe_id) REFERENCES universe_catalog(universe_id)
        );

        CREATE INDEX IF NOT EXISTS idx_universe_observations_universe_observed
          ON universe_observations(universe_id, observed_at);

        CREATE INDEX IF NOT EXISTS idx_universe_current_metrics_playing
          ON universe_current_metrics(playing DESC);

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
        SELECT
          latest.universe_id,
          latest.name,
          latest.creator_name,
          latest.creator_type,
          latest.genre,
          bounds.first_seen_at,
          bounds.last_seen_at,
          latest.updated
        FROM (
          SELECT universe_id, MIN(timestamp) AS first_seen_at, MAX(timestamp) AS last_seen_at
          FROM snapshots
          GROUP BY universe_id
        ) bounds
        INNER JOIN snapshots latest
          ON latest.universe_id = bounds.universe_id
         AND latest.timestamp = bounds.last_seen_at
        ON CONFLICT(universe_id) DO UPDATE SET
          name = excluded.name,
          creator_name = excluded.creator_name,
          creator_type = excluded.creator_type,
          genre = excluded.genre,
          first_seen_at = MIN(universe_catalog.first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(universe_catalog.last_seen_at, excluded.last_seen_at),
          last_game_updated_at = excluded.last_game_updated_at,
          updated_at = CURRENT_TIMESTAMP;

        INSERT OR IGNORE INTO universe_observations (
          universe_id,
          observed_at,
          playing,
          visits,
          favorited_count,
          approval,
          game_updated_at,
          source
        )
        SELECT
          universe_id,
          timestamp,
          playing,
          visits,
          favorited_count,
          approval,
          updated,
          'snapshot_backfill'
        FROM snapshots;

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
        SELECT
          latest.universe_id,
          latest.timestamp,
          latest.playing,
          latest.visits,
          latest.favorited_count,
          latest.approval,
          latest.updated,
          'snapshot_backfill'
        FROM snapshots latest
        INNER JOIN (
          SELECT universe_id, MAX(timestamp) AS latest_timestamp
          FROM snapshots
          GROUP BY universe_id
        ) recent
          ON recent.universe_id = latest.universe_id
         AND recent.latest_timestamp = latest.timestamp
        ON CONFLICT(universe_id) DO UPDATE SET
          observed_at = excluded.observed_at,
          playing = excluded.playing,
          visits = excluded.visits,
          favorited_count = excluded.favorited_count,
          approval = excluded.approval,
          game_updated_at = excluded.game_updated_at,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP;
      `)
    },
  },
  {
    id: '003_ingest_runs',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingest_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          tracked_universe_count INTEGER NOT NULL DEFAULT 0,
          discovered_universe_count INTEGER NOT NULL DEFAULT 0,
          observation_count INTEGER NOT NULL DEFAULT 0,
          snapshot_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ingest_runs_started_at
          ON ingest_runs(started_at DESC);
      `)
    },
  },
  {
    id: '004_daily_rollups_and_history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_game_metrics (
          universe_id INTEGER NOT NULL,
          day TEXT NOT NULL,
          first_observed_at TEXT NOT NULL,
          last_observed_at TEXT NOT NULL,
          observation_count INTEGER NOT NULL,
          min_playing INTEGER NOT NULL,
          max_playing INTEGER NOT NULL,
          playing_sum REAL NOT NULL,
          avg_playing REAL NOT NULL,
          first_visits INTEGER NOT NULL,
          last_visits INTEGER NOT NULL,
          visits_delta INTEGER NOT NULL,
          first_favorited_count INTEGER NOT NULL,
          last_favorited_count INTEGER NOT NULL,
          favorited_delta INTEGER NOT NULL,
          min_approval REAL NOT NULL,
          max_approval REAL NOT NULL,
          approval_sum REAL NOT NULL,
          avg_approval REAL NOT NULL,
          last_game_updated_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (universe_id, day),
          FOREIGN KEY (universe_id) REFERENCES universe_catalog(universe_id)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_game_metrics_day
          ON daily_game_metrics(day DESC, max_playing DESC);

        CREATE TABLE IF NOT EXISTS game_metadata_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          root_place_id INTEGER,
          name TEXT NOT NULL,
          description TEXT,
          creator_id INTEGER,
          creator_name TEXT NOT NULL,
          creator_type TEXT NOT NULL,
          creator_has_verified_badge INTEGER NOT NULL DEFAULT 0,
          genre TEXT NOT NULL,
          genre_primary TEXT,
          genre_secondary TEXT,
          price INTEGER,
          max_players INTEGER,
          created TEXT,
          game_updated_at TEXT NOT NULL,
          create_vip_servers_allowed INTEGER NOT NULL DEFAULT 0,
          thumbnail_url TEXT,
          banner_url TEXT,
          seo_image_url TEXT,
          screenshot_urls_json TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE INDEX IF NOT EXISTS idx_game_metadata_history_universe_observed
          ON game_metadata_history(universe_id, observed_at DESC);

        CREATE TABLE IF NOT EXISTS vote_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          up_votes INTEGER NOT NULL,
          down_votes INTEGER NOT NULL,
          approval REAL NOT NULL,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS page_meta_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          seller_name TEXT,
          seller_id INTEGER,
          root_place_id INTEGER,
          can_create_server INTEGER,
          private_server_price INTEGER,
          private_server_product_id INTEGER,
          seo_image_url TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS age_rating_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          label TEXT,
          minimum_age INTEGER,
          display_name TEXT,
          descriptors_json TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS creator_profile_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          creator_id INTEGER,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          profile_url TEXT,
          creator_type TEXT,
          name TEXT,
          display_name TEXT,
          has_verified_badge INTEGER,
          member_count INTEGER,
          created TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS creator_portfolio_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          total_count INTEGER NOT NULL,
          games_json TEXT NOT NULL,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS store_inventory_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          inventory_type TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          total_count INTEGER NOT NULL,
          items_json TEXT NOT NULL,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at, inventory_type)
        );

        CREATE TABLE IF NOT EXISTS server_sample_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          page_count INTEGER,
          sampled_server_count INTEGER,
          sampled_player_count INTEGER,
          exact_active_server_count INTEGER,
          estimated_active_server_count INTEGER,
          average_players_per_server REAL,
          fill_rate REAL,
          servers_json TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS social_discovery_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          note TEXT,
          youtube TEXT,
          tiktok TEXT,
          x TEXT,
          roblox_search_trend TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );

        CREATE TABLE IF NOT EXISTS derived_metrics_history (
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          rblx_score REAL,
          estimated_dau REAL,
          estimated_mau REAL,
          daily_visits_observed REAL,
          average_session_length_minutes REAL,
          growth_7d_ccu REAL,
          growth_30d_ccu REAL,
          growth_90d_ccu REAL,
          estimated_daily_revenue_mid_usd REAL,
          estimated_monthly_revenue_mid_usd REAL,
          estimated_annual_run_rate_mid_usd REAL,
          estimated_valuation_mid_usd REAL,
          monetization_strategy TEXT,
          financial_confidence TEXT,
          growth_classification TEXT,
          comparables_json TEXT,
          payload_json TEXT,
          PRIMARY KEY (universe_id, observed_at)
        );
      `)
    },
  },
  {
    id: '005_ingest_leases',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingest_leases (
          lease_key TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_label TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },
  {
    id: '006_external_history_imports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS external_history_sources (
          source_key TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS external_history_import_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_key TEXT NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          universe_count INTEGER NOT NULL DEFAULT 0,
          observation_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          FOREIGN KEY (source_key) REFERENCES external_history_sources(source_key)
        );

        CREATE INDEX IF NOT EXISTS idx_external_history_import_runs_started
          ON external_history_import_runs(started_at DESC);

        CREATE TABLE IF NOT EXISTS external_history_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          universe_id INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          playing INTEGER NOT NULL,
          visits INTEGER,
          favorited_count INTEGER,
          up_votes INTEGER,
          down_votes INTEGER,
          approval REAL,
          source_key TEXT NOT NULL,
          payload_json TEXT,
          imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (universe_id, observed_at, source_key),
          FOREIGN KEY (universe_id) REFERENCES universe_catalog(universe_id),
          FOREIGN KEY (source_key) REFERENCES external_history_sources(source_key)
        );

        CREATE INDEX IF NOT EXISTS idx_external_history_observations_universe_observed
          ON external_history_observations(universe_id, observed_at);
      `)
    },
  },
  {
    id: '007_platform_current_metrics',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS platform_current_metrics (
          metric_key TEXT PRIMARY KEY,
          observed_at TEXT NOT NULL,
          playing INTEGER NOT NULL,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },
  {
    id: '008_tracked_universe_metadata',
    up(db) {
      db.exec(`
        ALTER TABLE tracked_universes ADD COLUMN tracking_tier TEXT NOT NULL DEFAULT 'tier_d';
        ALTER TABLE tracked_universes ADD COLUMN poll_interval_minutes INTEGER NOT NULL DEFAULT 60;
        ALTER TABLE tracked_universes ADD COLUMN priority_score REAL NOT NULL DEFAULT 0;
        ALTER TABLE tracked_universes ADD COLUMN last_known_playing INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tracked_universes ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE tracked_universes ADD COLUMN first_discovered_at TEXT;
        ALTER TABLE tracked_universes ADD COLUMN last_discovered_at TEXT;
        ALTER TABLE tracked_universes ADD COLUMN last_promoted_at TEXT;
        ALTER TABLE tracked_universes ADD COLUMN last_polled_at TEXT;
        ALTER TABLE tracked_universes ADD COLUMN manually_pinned INTEGER NOT NULL DEFAULT 0;

        UPDATE tracked_universes
        SET
          first_discovered_at = COALESCE(first_discovered_at, created_at, CURRENT_TIMESTAMP),
          last_discovered_at = COALESCE(last_discovered_at, created_at, CURRENT_TIMESTAMP),
          discovery_source = COALESCE(discovery_source, 'manual'),
          tracking_tier = COALESCE(tracking_tier, 'tier_d'),
          poll_interval_minutes = COALESCE(poll_interval_minutes, 60),
          priority_score = COALESCE(priority_score, 0),
          last_known_playing = COALESCE(last_known_playing, 0),
          manually_pinned = COALESCE(manually_pinned, 0);

        CREATE INDEX IF NOT EXISTS idx_tracked_universes_priority
          ON tracked_universes(sort_order ASC, priority_score DESC, last_known_playing DESC);

        CREATE INDEX IF NOT EXISTS idx_tracked_universes_due_poll
          ON tracked_universes(tracking_tier, last_polled_at, poll_interval_minutes);
      `)
    },
  },
  {
    id: '009_app_state',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          state_key TEXT PRIMARY KEY,
          observed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },
  {
    id: '010_platform_history_points',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS platform_history_points (
          metric_key TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          playing INTEGER NOT NULL,
          source TEXT NOT NULL,
          PRIMARY KEY (metric_key, observed_at)
        );

        CREATE INDEX IF NOT EXISTS idx_platform_history_points_metric_observed
          ON platform_history_points(metric_key, observed_at ASC);
      `)
    },
  },
]

function applyMigrations(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations ORDER BY applied_at ASC').all().map((row) => row.id),
  )
  const insertMigrationStmt = db.prepare(`
    INSERT INTO schema_migrations (id)
    VALUES (?)
  `)

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue
    }

    db.exec('BEGIN IMMEDIATE')

    try {
      migration.up(db)
      insertMigrationStmt.run(migration.id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function sanitizeUniverseIds(universeIds) {
  return [...new Set(universeIds.filter((value) => Number.isFinite(value) && value > 0))]
}

function dedupeSnapshotGames(games) {
  const latestByUniverseId = new Map()

  for (const game of games) {
    if (!game?.universeId) {
      continue
    }

    latestByUniverseId.set(game.universeId, game)
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

function mapTrackedUniverseRecord(row) {
  return {
    universeId: row.universe_id,
    sortOrder: row.sort_order,
    trackingTier: row.tracking_tier,
    pollIntervalMinutes: row.poll_interval_minutes,
    priorityScore: row.priority_score,
    lastKnownPlaying: row.last_known_playing,
    discoverySource: row.discovery_source,
    firstDiscoveredAt: row.first_discovered_at,
    lastDiscoveredAt: row.last_discovered_at,
    lastPromotedAt: row.last_promoted_at,
    lastPolledAt: row.last_polled_at,
    manuallyPinned: Boolean(row.manually_pinned),
  }
}

function toJsonText(value) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return JSON.stringify(null)
  }
}

function toBit(value) {
  return value ? 1 : 0
}

export async function createDatabase() {
  await mkdir(path.dirname(DB_PATH), { recursive: true })

  const db = new DatabaseSync(DB_PATH)
  applyMigrations(db)

  const getTrackedStmt = db.prepare(`
    SELECT universe_id
    FROM tracked_universes
    ORDER BY sort_order ASC
  `)

  const getTrackedRecordsStmt = db.prepare(`
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

  const countTrackedStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM tracked_universes
  `)

  const trackedTierCountsStmt = db.prepare(`
    SELECT
      tracking_tier,
      COUNT(*) AS total
    FROM tracked_universes
    GROUP BY tracking_tier
    ORDER BY tracking_tier ASC
  `)

  const trackedDiscoverySourceCountsStmt = db.prepare(`
    SELECT
      discovery_source,
      COUNT(*) AS total
    FROM tracked_universes
    GROUP BY discovery_source
    ORDER BY total DESC, discovery_source ASC
  `)

  const insertTrackedStmt = db.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(universe_id) DO UPDATE SET
      sort_order = excluded.sort_order,
      tracking_tier = excluded.tracking_tier,
      poll_interval_minutes = excluded.poll_interval_minutes,
      priority_score = excluded.priority_score,
      last_known_playing = excluded.last_known_playing,
      discovery_source = excluded.discovery_source,
      first_discovered_at = CASE
        WHEN tracked_universes.first_discovered_at IS NULL
          THEN excluded.first_discovered_at
        ELSE MIN(tracked_universes.first_discovered_at, excluded.first_discovered_at)
      END,
      last_discovered_at = MAX(tracked_universes.last_discovered_at, excluded.last_discovered_at),
      last_promoted_at = COALESCE(excluded.last_promoted_at, tracked_universes.last_promoted_at),
      last_polled_at = COALESCE(excluded.last_polled_at, tracked_universes.last_polled_at),
      manually_pinned = MAX(tracked_universes.manually_pinned, excluded.manually_pinned)
  `)

  const deleteTrackedStmt = db.prepare(`
    DELETE FROM tracked_universes
  `)

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO snapshots (
      universe_id,
      timestamp,
      name,
      creator_name,
      creator_type,
      genre,
      playing,
      visits,
      favorited_count,
      approval,
      updated
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const pruneSnapshotsStmt = db.prepare(`
    DELETE FROM snapshots
    WHERE timestamp < ?
  `)

  const countSnapshotsStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM snapshots
  `)

  const countObservationsStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM universe_observations
  `)

  const countCatalogStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM universe_catalog
  `)

  const countDailyMetricsStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM daily_game_metrics
  `)

  const countMetadataHistoryStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM game_metadata_history
  `)

  const countDerivedHistoryStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM derived_metrics_history
  `)

  const countExternalHistoryStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM external_history_observations
  `)

  const countExternalImportRunsStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM external_history_import_runs
  `)

  const upsertUniverseCatalogStmt = db.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(universe_id) DO UPDATE SET
      name = excluded.name,
      creator_name = excluded.creator_name,
      creator_type = excluded.creator_type,
      genre = excluded.genre,
      first_seen_at = MIN(universe_catalog.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(universe_catalog.last_seen_at, excluded.last_seen_at),
      last_game_updated_at = excluded.last_game_updated_at,
      updated_at = CURRENT_TIMESTAMP
  `)

  const upsertUniverseCurrentMetricsStmt = db.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(universe_id) DO UPDATE SET
      observed_at = excluded.observed_at,
      playing = excluded.playing,
      visits = excluded.visits,
      favorited_count = excluded.favorited_count,
      approval = excluded.approval,
      game_updated_at = excluded.game_updated_at,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
    WHERE excluded.observed_at >= universe_current_metrics.observed_at
  `)

  const getPlatformCurrentMetricStmt = db.prepare(`
    SELECT
      observed_at,
      playing,
      source
    FROM platform_current_metrics
    WHERE metric_key = ?
  `)

  const upsertPlatformCurrentMetricStmt = db.prepare(`
    INSERT INTO platform_current_metrics (
      metric_key,
      observed_at,
      playing,
      source
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(metric_key) DO UPDATE SET
      observed_at = excluded.observed_at,
      playing = excluded.playing,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
    WHERE CASE
      WHEN platform_current_metrics.source IN (${DEGRADED_PLATFORM_SOURCES.map(() => '?').join(', ')})
        AND excluded.source NOT IN (${DEGRADED_PLATFORM_SOURCES.map(() => '?').join(', ')})
        THEN 1
      WHEN platform_current_metrics.source NOT IN (${DEGRADED_PLATFORM_SOURCES.map(() => '?').join(', ')})
        AND excluded.source IN (${DEGRADED_PLATFORM_SOURCES.map(() => '?').join(', ')})
        THEN 0
      ELSE excluded.observed_at >= platform_current_metrics.observed_at
    END
  `)

  const upsertPlatformHistoryPointStmt = db.prepare(`
    INSERT INTO platform_history_points (
      metric_key,
      observed_at,
      playing,
      source
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(metric_key, observed_at) DO UPDATE SET
      playing = excluded.playing,
      source = excluded.source
  `)

  const getPlatformHistoryPointsStmt = db.prepare(`
    SELECT
      observed_at,
      playing,
      source
    FROM platform_history_points
    WHERE metric_key = ?
      AND observed_at >= ?
    ORDER BY observed_at ASC
  `)

  const getAllPlatformHistoryPointsStmt = db.prepare(`
    SELECT
      observed_at,
      playing,
      source
    FROM platform_history_points
    WHERE metric_key = ?
    ORDER BY observed_at ASC
  `)

  const prunePlatformHistoryPointsStmt = db.prepare(`
    DELETE FROM platform_history_points
    WHERE metric_key = ?
      AND observed_at < ?
  `)

  const getAppStateStmt = db.prepare(`
    SELECT
      observed_at,
      source,
      payload_json
    FROM app_state
    WHERE state_key = ?
  `)

  const upsertAppStateStmt = db.prepare(`
    INSERT INTO app_state (
      state_key,
      observed_at,
      source,
      payload_json
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      observed_at = excluded.observed_at,
      source = excluded.source,
      payload_json = excluded.payload_json,
      updated_at = CURRENT_TIMESTAMP
    WHERE excluded.observed_at >= app_state.observed_at
  `)

  const insertObservationStmt = db.prepare(`
    INSERT OR IGNORE INTO universe_observations (
      universe_id,
      observed_at,
      playing,
      visits,
      favorited_count,
      approval,
      game_updated_at,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const upsertDailyGameMetricsStmt = db.prepare(`
    INSERT INTO daily_game_metrics (
      universe_id,
      day,
      first_observed_at,
      last_observed_at,
      observation_count,
      min_playing,
      max_playing,
      playing_sum,
      avg_playing,
      first_visits,
      last_visits,
      visits_delta,
      first_favorited_count,
      last_favorited_count,
      favorited_delta,
      min_approval,
      max_approval,
      approval_sum,
      avg_approval,
      last_game_updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(universe_id, day) DO UPDATE SET
      first_observed_at = CASE
        WHEN excluded.first_observed_at < daily_game_metrics.first_observed_at
          THEN excluded.first_observed_at
        ELSE daily_game_metrics.first_observed_at
      END,
      last_observed_at = CASE
        WHEN excluded.last_observed_at > daily_game_metrics.last_observed_at
          THEN excluded.last_observed_at
        ELSE daily_game_metrics.last_observed_at
      END,
      observation_count = daily_game_metrics.observation_count + 1,
      min_playing = MIN(daily_game_metrics.min_playing, excluded.min_playing),
      max_playing = MAX(daily_game_metrics.max_playing, excluded.max_playing),
      playing_sum = daily_game_metrics.playing_sum + excluded.playing_sum,
      avg_playing =
        (daily_game_metrics.playing_sum + excluded.playing_sum) /
        (daily_game_metrics.observation_count + 1),
      first_visits = CASE
        WHEN excluded.first_observed_at < daily_game_metrics.first_observed_at
          THEN excluded.first_visits
        ELSE daily_game_metrics.first_visits
      END,
      last_visits = CASE
        WHEN excluded.last_observed_at >= daily_game_metrics.last_observed_at
          THEN excluded.last_visits
        ELSE daily_game_metrics.last_visits
      END,
      visits_delta =
        (CASE
          WHEN excluded.last_observed_at >= daily_game_metrics.last_observed_at
            THEN excluded.last_visits
          ELSE daily_game_metrics.last_visits
        END) -
        (CASE
          WHEN excluded.first_observed_at < daily_game_metrics.first_observed_at
            THEN excluded.first_visits
          ELSE daily_game_metrics.first_visits
        END),
      first_favorited_count = CASE
        WHEN excluded.first_observed_at < daily_game_metrics.first_observed_at
          THEN excluded.first_favorited_count
        ELSE daily_game_metrics.first_favorited_count
      END,
      last_favorited_count = CASE
        WHEN excluded.last_observed_at >= daily_game_metrics.last_observed_at
          THEN excluded.last_favorited_count
        ELSE daily_game_metrics.last_favorited_count
      END,
      favorited_delta =
        (CASE
          WHEN excluded.last_observed_at >= daily_game_metrics.last_observed_at
            THEN excluded.last_favorited_count
          ELSE daily_game_metrics.last_favorited_count
        END) -
        (CASE
          WHEN excluded.first_observed_at < daily_game_metrics.first_observed_at
            THEN excluded.first_favorited_count
          ELSE daily_game_metrics.first_favorited_count
        END),
      min_approval = MIN(daily_game_metrics.min_approval, excluded.min_approval),
      max_approval = MAX(daily_game_metrics.max_approval, excluded.max_approval),
      approval_sum = daily_game_metrics.approval_sum + excluded.approval_sum,
      avg_approval =
        (daily_game_metrics.approval_sum + excluded.approval_sum) /
        (daily_game_metrics.observation_count + 1),
      last_game_updated_at = CASE
        WHEN excluded.last_game_updated_at > daily_game_metrics.last_game_updated_at
          THEN excluded.last_game_updated_at
        ELSE daily_game_metrics.last_game_updated_at
      END,
      updated_at = CURRENT_TIMESTAMP
  `)

  const insertGameMetadataHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO game_metadata_history (
      universe_id,
      observed_at,
      source,
      root_place_id,
      name,
      description,
      creator_id,
      creator_name,
      creator_type,
      creator_has_verified_badge,
      genre,
      genre_primary,
      genre_secondary,
      price,
      max_players,
      created,
      game_updated_at,
      create_vip_servers_allowed,
      thumbnail_url,
      banner_url,
      seo_image_url,
      screenshot_urls_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertVoteHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO vote_history (
      universe_id,
      observed_at,
      source,
      up_votes,
      down_votes,
      approval
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertPageMetaHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO page_meta_history (
      universe_id,
      observed_at,
      status,
      source,
      note,
      seller_name,
      seller_id,
      root_place_id,
      can_create_server,
      private_server_price,
      private_server_product_id,
      seo_image_url,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAgeRatingHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO age_rating_history (
      universe_id,
      observed_at,
      status,
      source,
      note,
      label,
      minimum_age,
      display_name,
      descriptors_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertCreatorProfileHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO creator_profile_history (
      universe_id,
      observed_at,
      creator_id,
      status,
      source,
      note,
      profile_url,
      creator_type,
      name,
      display_name,
      has_verified_badge,
      member_count,
      created,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertCreatorPortfolioHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO creator_portfolio_history (
      universe_id,
      observed_at,
      status,
      source,
      note,
      total_count,
      games_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertStoreInventoryHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO store_inventory_history (
      universe_id,
      observed_at,
      inventory_type,
      status,
      source,
      note,
      total_count,
      items_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertServerSampleHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO server_sample_history (
      universe_id,
      observed_at,
      status,
      source,
      note,
      page_count,
      sampled_server_count,
      sampled_player_count,
      exact_active_server_count,
      estimated_active_server_count,
      average_players_per_server,
      fill_rate,
      servers_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSocialDiscoveryHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO social_discovery_history (
      universe_id,
      observed_at,
      status,
      source,
      note,
      youtube,
      tiktok,
      x,
      roblox_search_trend,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertDerivedMetricsHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO derived_metrics_history (
      universe_id,
      observed_at,
      source,
      rblx_score,
      estimated_dau,
      estimated_mau,
      daily_visits_observed,
      average_session_length_minutes,
      growth_7d_ccu,
      growth_30d_ccu,
      growth_90d_ccu,
      estimated_daily_revenue_mid_usd,
      estimated_monthly_revenue_mid_usd,
      estimated_annual_run_rate_mid_usd,
      estimated_valuation_mid_usd,
      monetization_strategy,
      financial_confidence,
      growth_classification,
      comparables_json,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const upsertExternalHistorySourceStmt = db.prepare(`
    INSERT INTO external_history_sources (
      source_key,
      kind,
      display_name,
      status,
      notes
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      kind = excluded.kind,
      display_name = excluded.display_name,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `)

  const startExternalHistoryImportRunStmt = db.prepare(`
    INSERT INTO external_history_import_runs (
      source_key,
      trigger,
      status,
      started_at
    )
    VALUES (?, ?, 'running', ?)
  `)

  const finishExternalHistoryImportRunStmt = db.prepare(`
    UPDATE external_history_import_runs
    SET
      status = ?,
      finished_at = ?,
      universe_count = ?,
      observation_count = ?,
      error_message = ?
    WHERE id = ?
  `)

  const insertExternalHistoryObservationStmt = db.prepare(`
    INSERT OR REPLACE INTO external_history_observations (
      universe_id,
      observed_at,
      playing,
      visits,
      favorited_count,
      up_votes,
      down_votes,
      approval,
      source_key,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const getLeaseStmt = db.prepare(`
    SELECT lease_key, owner_id, owner_label, acquired_at, heartbeat_at, expires_at
    FROM ingest_leases
    WHERE lease_key = ?
  `)

  const acquireLeaseStmt = db.prepare(`
    INSERT INTO ingest_leases (
      lease_key,
      owner_id,
      owner_label,
      acquired_at,
      heartbeat_at,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(lease_key) DO UPDATE SET
      owner_id = excluded.owner_id,
      owner_label = excluded.owner_label,
      acquired_at = CASE
        WHEN ingest_leases.owner_id = excluded.owner_id
          THEN ingest_leases.acquired_at
        ELSE excluded.acquired_at
      END,
      heartbeat_at = excluded.heartbeat_at,
      expires_at = excluded.expires_at,
      updated_at = CURRENT_TIMESTAMP
    WHERE ingest_leases.owner_id = excluded.owner_id
       OR ingest_leases.expires_at <= excluded.acquired_at
  `)

  const releaseLeaseStmt = db.prepare(`
    DELETE FROM ingest_leases
    WHERE lease_key = ? AND owner_id = ?
  `)

  const pruneObservationsStmt = db.prepare(`
    DELETE FROM universe_observations
    WHERE observed_at < ?
  `)

  const pruneMetadataHistoryStmt = db.prepare(`
    DELETE FROM game_metadata_history
    WHERE observed_at < ?
  `)

  const pruneVoteHistoryStmt = db.prepare(`
    DELETE FROM vote_history
    WHERE observed_at < ?
  `)

  const prunePageMetaHistoryStmt = db.prepare(`
    DELETE FROM page_meta_history
    WHERE observed_at < ?
  `)

  const pruneAgeRatingHistoryStmt = db.prepare(`
    DELETE FROM age_rating_history
    WHERE observed_at < ?
  `)

  const pruneCreatorProfileHistoryStmt = db.prepare(`
    DELETE FROM creator_profile_history
    WHERE observed_at < ?
  `)

  const pruneCreatorPortfolioHistoryStmt = db.prepare(`
    DELETE FROM creator_portfolio_history
    WHERE observed_at < ?
  `)

  const pruneStoreInventoryHistoryStmt = db.prepare(`
    DELETE FROM store_inventory_history
    WHERE observed_at < ?
  `)

  const pruneServerSampleHistoryStmt = db.prepare(`
    DELETE FROM server_sample_history
    WHERE observed_at < ?
  `)

  const pruneSocialDiscoveryHistoryStmt = db.prepare(`
    DELETE FROM social_discovery_history
    WHERE observed_at < ?
  `)

  const pruneDerivedMetricsHistoryStmt = db.prepare(`
    DELETE FROM derived_metrics_history
    WHERE observed_at < ?
  `)

  const startIngestRunStmt = db.prepare(`
    INSERT INTO ingest_runs (
      trigger,
      status,
      started_at
    )
    VALUES (?, 'running', ?)
  `)

  const finishIngestRunStmt = db.prepare(`
    UPDATE ingest_runs
    SET
      status = ?,
      source = ?,
      finished_at = ?,
      tracked_universe_count = ?,
      discovered_universe_count = ?,
      observation_count = ?,
      snapshot_count = ?,
      error_message = ?
    WHERE id = ?
  `)

  const latestIngestRunStmt = db.prepare(`
    SELECT
      id,
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
    FROM ingest_runs
    ORDER BY started_at DESC
    LIMIT 1
  `)

  const recoverStaleIngestRunsStmt = db.prepare(`
    UPDATE ingest_runs
    SET
      status = 'failed',
      source = COALESCE(source, 'recovery'),
      finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
      error_message = COALESCE(
        error_message,
        'Marked failed during startup recovery after exceeding the stale run timeout.'
      )
    WHERE status = 'running' AND started_at < ?
  `)

  const allObservationRowsStmt = db.prepare(`
    SELECT
      universe_id,
      observed_at,
      playing,
      visits,
      favorited_count,
      approval,
      game_updated_at
    FROM universe_observations
    ORDER BY universe_id ASC, observed_at ASC
  `)

  function getUniverseRootPlaceMap(universeIds) {
    const uniqueIds = sanitizeUniverseIds(universeIds)

    if (uniqueIds.length === 0) {
      return new Map()
    }

    const placeholders = uniqueIds.map(() => '?').join(', ')
    const metadataRows = db.prepare(`
      SELECT gm.universe_id, gm.root_place_id
      FROM game_metadata_history gm
      INNER JOIN (
        SELECT universe_id, MAX(observed_at) AS latest_observed_at
        FROM game_metadata_history
        WHERE universe_id IN (${placeholders}) AND root_place_id IS NOT NULL
        GROUP BY universe_id
      ) latest
        ON latest.universe_id = gm.universe_id
       AND latest.latest_observed_at = gm.observed_at
    `).all(...uniqueIds)

    const rootPlaceMap = new Map()

    for (const row of metadataRows) {
      if (row.root_place_id != null) {
        rootPlaceMap.set(row.universe_id, row.root_place_id)
      }
    }

    const missingUniverseIds = uniqueIds.filter((universeId) => !rootPlaceMap.has(universeId))

    if (missingUniverseIds.length > 0) {
      const missingPlaceholders = missingUniverseIds.map(() => '?').join(', ')
      const pageMetaRows = db.prepare(`
        SELECT pm.universe_id, pm.root_place_id
        FROM page_meta_history pm
        INNER JOIN (
          SELECT universe_id, MAX(observed_at) AS latest_observed_at
          FROM page_meta_history
          WHERE universe_id IN (${missingPlaceholders}) AND root_place_id IS NOT NULL
          GROUP BY universe_id
        ) latest
          ON latest.universe_id = pm.universe_id
         AND latest.latest_observed_at = pm.observed_at
      `).all(...missingUniverseIds)

      for (const row of pageMetaRows) {
        if (row.root_place_id != null) {
          rootPlaceMap.set(row.universe_id, row.root_place_id)
        }
      }
    }

    return rootPlaceMap
  }

  function runInTransaction(callback) {
    db.exec('BEGIN IMMEDIATE')

    try {
      callback()
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function countDailyMetrics() {
    return countDailyMetricsStmt.get().total
  }

  function getTrackedTierCounts() {
    const rows = trackedTierCountsStmt.all()
    return rows.reduce((counts, row) => {
      counts[row.tracking_tier] = row.total
      return counts
    }, {})
  }

  function getTrackedDiscoverySourceCounts() {
    const rows = trackedDiscoverySourceCountsStmt.all()
    return rows.reduce((counts, row) => {
      counts[row.discovery_source] = row.total
      return counts
    }, {})
  }

  function countMetadataHistory() {
    return countMetadataHistoryStmt.get().total
  }

  function countDerivedHistory() {
    return countDerivedHistoryStmt.get().total
  }

  function countExternalHistory() {
    return countExternalHistoryStmt.get().total
  }

  function countExternalImportRuns() {
    return countExternalImportRunsStmt.get().total
  }

  function recoverStaleIngestRuns(staleAfterMs = INGEST_RUN_STALE_AFTER_MS) {
    const cutoffIso = new Date(Date.now() - staleAfterMs).toISOString()
    const result = recoverStaleIngestRunsStmt.run(cutoffIso)
    return result.changes ?? 0
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
    const expiresAt = new Date(new Date(acquiredAt).getTime() + ttlMs).toISOString()
    const result = acquireLeaseStmt.run(
      leaseKey,
      ownerId,
      ownerLabel,
      acquiredAt,
      acquiredAt,
      expiresAt,
    )

    return (result.changes ?? 0) > 0
  }

  function releaseIngestLease(leaseKey, ownerId) {
    releaseLeaseStmt.run(leaseKey, ownerId)
  }

  function getActiveIngestLease(leaseKey = 'scheduler') {
    return getLeaseStmt.get(leaseKey) ?? null
  }

  function recordDailyGameMetric(universeId, snapshot, observedAt) {
    const day = observedAt.slice(0, 10)
    const playing = Number(snapshot.playing) || 0
    const visits = Number(snapshot.visits) || 0
    const favoritedCount = Number(snapshot.favoritedCount) || 0
    const approval = Number(snapshot.approval) || 0

    upsertDailyGameMetricsStmt.run(
      universeId,
      day,
      observedAt,
      observedAt,
      1,
      playing,
      playing,
      playing,
      playing,
      visits,
      visits,
      0,
      favoritedCount,
      favoritedCount,
      0,
      approval,
      approval,
      approval,
      approval,
      snapshot.updated ?? observedAt,
    )
  }

  function persistBaseHistory(universeId, snapshot, observedAt, source) {
    insertGameMetadataHistoryStmt.run(
      universeId,
      observedAt,
      source,
      snapshot.rootPlaceId ?? null,
      snapshot.name,
      snapshot.description ?? null,
      snapshot.creatorId ?? null,
      snapshot.creatorName,
      snapshot.creatorType ?? 'Unknown',
      toBit(snapshot.creatorHasVerifiedBadge),
      snapshot.genre ?? 'Unclassified',
      snapshot.genrePrimary ?? snapshot.genre ?? 'Unclassified',
      snapshot.genreSecondary ?? null,
      snapshot.price ?? null,
      snapshot.maxPlayers ?? null,
      snapshot.created ?? null,
      snapshot.updated ?? observedAt,
      toBit(snapshot.createVipServersAllowed),
      snapshot.thumbnailUrl ?? null,
      snapshot.bannerUrl ?? null,
      snapshot.seoImageUrl ?? null,
      toJsonText(snapshot.screenshotUrls ?? []),
      toJsonText(snapshot),
    )

    insertVoteHistoryStmt.run(
      universeId,
      observedAt,
      source,
      Number(snapshot.upVotes) || 0,
      Number(snapshot.downVotes) || 0,
      Number(snapshot.approval) || 0,
    )
  }

  function getTrackedUniverseIds() {
    return getTrackedStmt.all().map((row) => row.universe_id)
  }

  function getTrackedUniverseRecords() {
    return getTrackedRecordsStmt.all().map(mapTrackedUniverseRecord)
  }

  function normalizeTrackedUniverseRecords(records) {
    const nowIso = new Date().toISOString()
    return sanitizeUniverseIds(records.map((record) => record?.universeId)).map((universeId, index) => {
      const record = records.find((entry) => Number(entry?.universeId) === universeId) ?? {}
      return {
        universeId,
        sortOrder: Number.isFinite(record.sortOrder) ? Number(record.sortOrder) : index,
        trackingTier: typeof record.trackingTier === 'string' && record.trackingTier.length > 0
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
        manuallyPinned: record.manuallyPinned ? 1 : 0,
      }
    })
  }

  function replaceTrackedUniverseRecords(records) {
    const normalizedRecords = normalizeTrackedUniverseRecords(records)

    runInTransaction(() => {
      deleteTrackedStmt.run()
      normalizedRecords.forEach((record, index) => {
        insertTrackedStmt.run(
          record.universeId,
          Number.isFinite(record.sortOrder) ? record.sortOrder : index,
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
        )
      })
    })

    return normalizedRecords.map((record) => record.universeId)
  }

  function replaceTrackedUniverseIds(universeIds) {
    const existingById = new Map(
      getTrackedUniverseRecords().map((record) => [record.universeId, record]),
    )
    const records = sanitizeUniverseIds(universeIds).map((universeId, index) => ({
      ...(existingById.get(universeId) ?? {}),
      universeId,
      sortOrder: index,
    }))

    replaceTrackedUniverseRecords(records)
  }

  function appendTrackedUniverseIds(universeIds, maxCount = Number.POSITIVE_INFINITY) {
    const incomingIds = sanitizeUniverseIds(universeIds)

    if (incomingIds.length === 0) {
      return getTrackedUniverseIds()
    }

    const existingRecords = getTrackedUniverseRecords()
    const existingById = new Map(existingRecords.map((record) => [record.universeId, record]))
    const dedupedIds = [
      ...existingRecords.map((record) => record.universeId).filter((universeId) => !incomingIds.includes(universeId)),
      ...incomingIds,
    ]
    const limitedIds = Number.isFinite(maxCount)
      ? dedupedIds.slice(-Math.max(Math.floor(maxCount), 1))
      : dedupedIds
    const nextRecords = limitedIds.map((universeId, index) => ({
      ...(existingById.get(universeId) ?? {}),
      universeId,
      sortOrder: index,
      lastDiscoveredAt: existingById.get(universeId)?.lastDiscoveredAt ?? new Date().toISOString(),
    }))

    replaceTrackedUniverseRecords(nextRecords)
    return limitedIds
  }

  function getHistoryMap(universeIds, cutoffIso) {
    const uniqueIds = sanitizeUniverseIds(universeIds)

    if (uniqueIds.length === 0) {
      return new Map()
    }

    const placeholders = uniqueIds.map(() => '?').join(', ')
    const params = [...uniqueIds]
    let cutoffClause = ''

    if (cutoffIso) {
      cutoffClause = ' AND o.observed_at >= ?'
      params.push(cutoffIso)
    }

    const rows = db
      .prepare(
        `
          SELECT
            o.universe_id,
            o.observed_at AS timestamp,
            c.name,
            c.creator_name,
            c.creator_type,
            c.genre,
            o.playing,
            o.visits,
            o.favorited_count,
            o.approval,
            o.game_updated_at AS updated
          FROM universe_observations o
          INNER JOIN universe_catalog c
            ON c.universe_id = o.universe_id
          WHERE o.universe_id IN (${placeholders})${cutoffClause}
          ORDER BY o.universe_id ASC, o.observed_at ASC
        `,
      )
      .all(...params)

    const externalRows = db
      .prepare(
        `
          SELECT
            e.universe_id,
            e.observed_at AS timestamp,
            c.name,
            c.creator_name,
            c.creator_type,
            c.genre,
            e.playing,
            COALESCE(e.visits, m.visits, 0) AS visits,
            COALESCE(e.favorited_count, m.favorited_count, 0) AS favorited_count,
            COALESCE(e.approval, m.approval, 0) AS approval,
            COALESCE(m.game_updated_at, c.last_game_updated_at, e.observed_at) AS updated
          FROM external_history_observations e
          INNER JOIN universe_catalog c
            ON c.universe_id = e.universe_id
          LEFT JOIN universe_current_metrics m
            ON m.universe_id = e.universe_id
          WHERE e.universe_id IN (${placeholders})${cutoffClause.replaceAll('o.', 'e.')}
          ORDER BY e.universe_id ASC, e.observed_at ASC
        `,
      )
      .all(...params)

    const historyMap = new Map()

    const appendRows = (inputRows, priority) => {
      for (const row of inputRows) {
        const current = historyMap.get(row.universe_id) ?? new Map()
        const existing = current.get(row.timestamp)

        if (!existing || priority < existing.priority) {
          current.set(row.timestamp, {
            ...row,
            priority,
          })
        }

        historyMap.set(row.universe_id, current)
      }
    }

    appendRows(externalRows, 1)
    appendRows(rows, 0)

    return new Map(
      [...historyMap.entries()].map(([universeId, rowMap]) => [
        universeId,
        [...rowMap.values()]
          .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
          .map(({ priority, ...row }) => row),
      ]),
    )
  }

  function getLatestSnapshotGames(universeIds) {
    const uniqueIds = sanitizeUniverseIds(universeIds)

    if (uniqueIds.length === 0) {
      return []
    }

    const placeholders = uniqueIds.map(() => '?').join(', ')
    const rows = db
      .prepare(
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
          FROM universe_current_metrics m
          INNER JOIN universe_catalog c
            ON c.universe_id = m.universe_id
          WHERE c.universe_id IN (${placeholders})
          ORDER BY m.playing DESC, c.universe_id ASC
        `,
      )
      .all(...uniqueIds)

    return rows.map(mapSnapshotGame)
  }

  function getPlatformCurrentMetric() {
    const row = getPlatformCurrentMetricStmt.get(PLATFORM_METRIC_KEY)

    if (!row) {
      return null
    }

    return {
      value: row.playing,
      timestamp: row.observed_at,
      source: row.source,
    }
  }

  function recordPlatformCurrentMetric(point) {
    if (!point?.timestamp || !Number.isFinite(point?.value)) {
      return
    }

    upsertPlatformCurrentMetricStmt.run(
      PLATFORM_METRIC_KEY,
      point.timestamp,
      Math.round(point.value),
      point.source ?? 'live',
      ...DEGRADED_PLATFORM_SOURCES,
      ...DEGRADED_PLATFORM_SOURCES,
      ...DEGRADED_PLATFORM_SOURCES,
      ...DEGRADED_PLATFORM_SOURCES,
    )
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

      upsertPlatformHistoryPointStmt.run(
        PLATFORM_METRIC_KEY,
        normalizedPoint.timestamp,
        normalizedPoint.value,
        normalizedPoint.source,
      )
      importedCount += 1

      if (!latestPoint || Date.parse(timestamp) >= Date.parse(latestPoint.timestamp)) {
        latestPoint = normalizedPoint
      }
    }

    if (latestPoint) {
      recordPlatformCurrentMetric(latestPoint)
    }

    prunePlatformHistoryPointsStmt.run(
      PLATFORM_METRIC_KEY,
      new Date(Date.now() - SNAPSHOT_RETENTION_MS).toISOString(),
    )

    return importedCount
  }

  function deletePlatformHistoryPoints(timestamps) {
    if (!Array.isArray(timestamps) || timestamps.length === 0) {
      return 0
    }

    const normalizedTimestamps = [...new Set(
      timestamps
        .map((timestamp) => String(timestamp ?? ''))
        .filter((timestamp) => timestamp.length > 0),
    )]

    if (normalizedTimestamps.length === 0) {
      return 0
    }

    const placeholders = normalizedTimestamps.map(() => '?').join(', ')
    const deleteStmt = db.prepare(`
      DELETE FROM platform_history_points
      WHERE metric_key = ?
        AND observed_at IN (${placeholders})
    `)
    const result = deleteStmt.run(PLATFORM_METRIC_KEY, ...normalizedTimestamps)
    return result.changes ?? 0
  }

  function getPlatformHistoryPoints(cutoffIso) {
    const rows =
      typeof cutoffIso === 'string' && cutoffIso.length > 0
        ? getPlatformHistoryPointsStmt.all(PLATFORM_METRIC_KEY, cutoffIso)
        : getAllPlatformHistoryPointsStmt.all(PLATFORM_METRIC_KEY)

    return rows.map((row) => ({
      timestamp: row.observed_at,
      value: Number(row.playing) || 0,
      source: row.source ?? 'live',
    }))
  }

  function getBoardSnapshot(range = '24h') {
    const row = getAppStateStmt.get(`board_snapshot:${range}`)

    if (!row?.payload_json) {
      return null
    }

    try {
      return JSON.parse(row.payload_json)
    } catch {
      return null
    }
  }

  function recordBoardSnapshot(
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

    upsertAppStateStmt.run(
      `board_snapshot:${range}`,
      observedAt,
      source,
      toJsonText(payload),
    )
  }

  function searchLocalGames(query, limit = 8) {
    const normalized = `%${query.trim().toLowerCase()}%`
    const rows = db
      .prepare(
        `
          SELECT
            c.universe_id,
            c.name,
            c.creator_name,
            m.playing,
            m.approval
          FROM universe_current_metrics m
          INNER JOIN universe_catalog c
            ON c.universe_id = m.universe_id
          WHERE LOWER(c.name) LIKE ?
             OR LOWER(c.creator_name) LIKE ?
          ORDER BY m.playing DESC
          LIMIT ?
        `,
      )
      .all(normalized, normalized, limit)

    return rows.map((row) => ({
      universeId: row.universe_id,
      rootPlaceId: 0,
      name: row.name,
      creatorName: row.creator_name,
      playerCount: row.playing,
      approval: row.approval,
    }))
  }

  function countSnapshots() {
    return countSnapshotsStmt.get().total
  }

  function countObservations() {
    return countObservationsStmt.get().total
  }

  function countCatalogEntries() {
    return countCatalogStmt.get().total
  }

  function getLatestIngestRun() {
    return latestIngestRunStmt.get() ?? null
  }

  function startIngestRun(trigger = 'scheduler') {
    const startedAt = new Date().toISOString()
    const result = startIngestRunStmt.run(trigger, startedAt)
    return result.lastInsertRowid
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
    if (ingestRunId == null) {
      return
    }

    finishIngestRunStmt.run(
      status,
      source,
      new Date().toISOString(),
      trackedUniverseCount,
      discoveredUniverseCount,
      observationCount,
      snapshotCount,
      errorMessage,
      ingestRunId,
    )
  }

  function startExternalHistoryImportRun(sourceKey, trigger = 'manual') {
    const startedAt = new Date().toISOString()
    upsertExternalHistorySourceStmt.run(sourceKey, 'unknown', sourceKey, 'active', null)
    const result = startExternalHistoryImportRunStmt.run(sourceKey, trigger, startedAt)
    return result.lastInsertRowid
  }

  function finishExternalHistoryImportRun(
    importRunId,
    {
      status,
      universeCount = 0,
      observationCount = 0,
      errorMessage = null,
    } = {},
  ) {
    if (importRunId == null) {
      return
    }

    finishExternalHistoryImportRunStmt.run(
      status,
      new Date().toISOString(),
      universeCount,
      observationCount,
      errorMessage,
      importRunId,
    )
  }

  function persistSnapshotRecord(universeId, snapshot, observedAt, source) {
    const timestamp = snapshot.timestamp ?? observedAt
    const updated = snapshot.updated ?? timestamp

    upsertUniverseCatalogStmt.run(
      universeId,
      snapshot.name,
      snapshot.creatorName,
      snapshot.creatorType ?? 'Unknown',
      snapshot.genre ?? 'Unclassified',
      timestamp,
      observedAt,
      updated,
    )

    upsertUniverseCurrentMetricsStmt.run(
      universeId,
      observedAt,
      snapshot.playing,
      snapshot.visits,
      snapshot.favoritedCount ?? 0,
      snapshot.approval ?? 0,
      updated,
      source,
    )

    const observationResult = insertObservationStmt.run(
      universeId,
      observedAt,
      snapshot.playing,
      snapshot.visits,
      snapshot.favoritedCount ?? 0,
      snapshot.approval ?? 0,
      updated,
      source,
    )

    if ((observationResult.changes ?? 0) > 0) {
      recordDailyGameMetric(universeId, snapshot, observedAt)
      persistBaseHistory(universeId, snapshot, observedAt, source)
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

    runInTransaction(() => {
      for (const game of uniqueGames) {
        persistSnapshotRecord(game.universeId, game, observedAt, source)
      }

      if (retentionMs) {
        const cutoffIso = new Date(Date.now() - retentionMs).toISOString()
        pruneSnapshotsStmt.run(cutoffIso)
        pruneObservationsStmt.run(cutoffIso)
        pruneMetadataHistoryStmt.run(cutoffIso)
        pruneVoteHistoryStmt.run(cutoffIso)
        prunePageMetaHistoryStmt.run(cutoffIso)
        pruneAgeRatingHistoryStmt.run(cutoffIso)
        pruneCreatorProfileHistoryStmt.run(cutoffIso)
        pruneCreatorPortfolioHistoryStmt.run(cutoffIso)
        pruneStoreInventoryHistoryStmt.run(cutoffIso)
        pruneServerSampleHistoryStmt.run(cutoffIso)
        pruneSocialDiscoveryHistoryStmt.run(cutoffIso)
        pruneDerivedMetricsHistoryStmt.run(cutoffIso)
      }
    })
  }

  function recordExternalHistory(
    sourceKey,
    observations,
    {
      displayName = sourceKey,
      kind = 'api',
      status = 'active',
      notes = null,
    } = {},
  ) {
    if (!sourceKey || !Array.isArray(observations) || observations.length === 0) {
      return { universeCount: 0, observationCount: 0 }
    }

    const uniqueUniverseIds = new Set()
    let observationCount = 0

    runInTransaction(() => {
      upsertExternalHistorySourceStmt.run(sourceKey, kind, displayName, status, notes)

      for (const observation of observations) {
        if (!observation?.universeId || !observation?.observedAt) {
          continue
        }

        const observedAt = observation.observedAt
        const updatedAt = observation.updated ?? observedAt
        const approval =
          observation.approval != null
            ? observation.approval
            : (Number(observation.upVotes) || 0) + (Number(observation.downVotes) || 0) > 0
              ? ((Number(observation.upVotes) || 0) /
                  ((Number(observation.upVotes) || 0) + (Number(observation.downVotes) || 0))) *
                100
              : 0

        upsertUniverseCatalogStmt.run(
          observation.universeId,
          observation.name ?? `Universe ${observation.universeId}`,
          observation.creatorName ?? 'Unknown creator',
          observation.creatorType ?? 'Unknown',
          observation.genre ?? 'Unclassified',
          observedAt,
          observedAt,
          updatedAt,
        )

        insertExternalHistoryObservationStmt.run(
          observation.universeId,
          observedAt,
          Number(observation.playing) || 0,
          observation.visits == null ? null : Number(observation.visits),
          observation.favoritedCount == null ? null : Number(observation.favoritedCount),
          observation.upVotes == null ? null : Number(observation.upVotes),
          observation.downVotes == null ? null : Number(observation.downVotes),
          approval,
          sourceKey,
          toJsonText(observation.payload ?? observation),
        )

        if (observation.upVotes != null || observation.downVotes != null) {
          insertVoteHistoryStmt.run(
            observation.universeId,
            observedAt,
            sourceKey,
            Number(observation.upVotes) || 0,
            Number(observation.downVotes) || 0,
            approval,
          )
        }

        uniqueUniverseIds.add(observation.universeId)
        observationCount += 1
      }
    })

    return {
      universeCount: uniqueUniverseIds.size,
      observationCount,
    }
  }

  function importLegacySnapshot(universeId, snapshot) {
    const observedAt = snapshot.timestamp

    runInTransaction(() => {
      persistSnapshotRecord(
        universeId,
        {
          ...snapshot,
          favoritedCount: snapshot.favoritedCount ?? 0,
        },
        observedAt,
        'legacy_import',
      )

      insertSnapshotStmt.run(
        universeId,
        observedAt,
        snapshot.name,
        snapshot.creatorName,
        snapshot.creatorType ?? 'Unknown',
        snapshot.genre ?? 'Unclassified',
        snapshot.playing,
        snapshot.visits,
        snapshot.favoritedCount ?? 0,
        snapshot.approval ?? 0,
        snapshot.updated ?? observedAt,
      )
    })
  }

  function backfillDailyMetricsIfNeeded() {
    if (countDailyMetrics() > 0 || countObservations() === 0) {
      return
    }

    runInTransaction(() => {
      for (const row of allObservationRowsStmt.all()) {
        recordDailyGameMetric(
          row.universe_id,
          {
            playing: row.playing,
            visits: row.visits,
            favoritedCount: row.favorited_count,
            approval: row.approval,
            updated: row.game_updated_at,
          },
          row.observed_at,
        )
      }
    })
  }

  function recordGamePageSnapshot(
    payload,
    {
      observedAt = new Date().toISOString(),
      source = 'game_page',
    } = {},
  ) {
    if (!payload?.game?.universeId) {
      return
    }

    const universeId = payload.game.universeId
    const sections = payload.dataSections ?? {}

    runInTransaction(() => {
      persistBaseHistory(universeId, payload.game, observedAt, source)

      insertPageMetaHistoryStmt.run(
        universeId,
        observedAt,
        sections.pageMeta?.status ?? 'unavailable',
        sections.pageMeta?.source ?? source,
        sections.pageMeta?.note ?? null,
        sections.pageMeta?.sellerName ?? null,
        sections.pageMeta?.sellerId ?? null,
        sections.pageMeta?.rootPlaceId ?? payload.game.rootPlaceId ?? null,
        sections.pageMeta?.canCreateServer == null ? null : toBit(sections.pageMeta.canCreateServer),
        sections.pageMeta?.privateServerPrice ?? null,
        sections.pageMeta?.privateServerProductId ?? null,
        sections.pageMeta?.seoImageUrl ?? payload.game.seoImageUrl ?? null,
        toJsonText(sections.pageMeta ?? null),
      )

      insertAgeRatingHistoryStmt.run(
        universeId,
        observedAt,
        sections.ageRating?.status ?? 'unavailable',
        sections.ageRating?.source ?? source,
        sections.ageRating?.note ?? null,
        sections.ageRating?.label ?? null,
        sections.ageRating?.minimumAge ?? null,
        sections.ageRating?.displayName ?? null,
        toJsonText(sections.ageRating?.descriptors ?? []),
        toJsonText(sections.ageRating ?? null),
      )

      insertCreatorProfileHistoryStmt.run(
        universeId,
        observedAt,
        sections.creatorProfile?.id ?? payload.game.creatorId ?? null,
        sections.creatorProfile?.status ?? 'unavailable',
        sections.creatorProfile?.source ?? source,
        sections.creatorProfile?.note ?? null,
        sections.creatorProfile?.profileUrl ?? null,
        sections.creatorProfile?.type ?? payload.game.creatorType ?? null,
        sections.creatorProfile?.name ?? payload.game.creatorName ?? null,
        sections.creatorProfile?.displayName ?? null,
        sections.creatorProfile?.hasVerifiedBadge == null
          ? null
          : toBit(sections.creatorProfile.hasVerifiedBadge),
        sections.creatorProfile?.memberCount ?? null,
        sections.creatorProfile?.created ?? null,
        toJsonText(sections.creatorProfile ?? null),
      )

      insertCreatorPortfolioHistoryStmt.run(
        universeId,
        observedAt,
        sections.creatorPortfolio?.status ?? 'unavailable',
        sections.creatorPortfolio?.source ?? source,
        sections.creatorPortfolio?.note ?? null,
        sections.creatorPortfolio?.totalCount ?? 0,
        toJsonText(sections.creatorPortfolio?.games ?? []),
        toJsonText(sections.creatorPortfolio ?? null),
      )

      insertStoreInventoryHistoryStmt.run(
        universeId,
        observedAt,
        'gamePasses',
        sections.store?.gamePasses?.status ?? 'unavailable',
        sections.store?.gamePasses?.source ?? source,
        sections.store?.gamePasses?.note ?? null,
        sections.store?.gamePasses?.totalCount ?? 0,
        toJsonText(sections.store?.gamePasses?.items ?? []),
        toJsonText(sections.store?.gamePasses ?? null),
      )

      insertStoreInventoryHistoryStmt.run(
        universeId,
        observedAt,
        'developerProducts',
        sections.store?.developerProducts?.status ?? 'unavailable',
        sections.store?.developerProducts?.source ?? source,
        sections.store?.developerProducts?.note ?? null,
        sections.store?.developerProducts?.totalCount ?? 0,
        toJsonText(sections.store?.developerProducts?.items ?? []),
        toJsonText(sections.store?.developerProducts ?? null),
      )

      insertServerSampleHistoryStmt.run(
        universeId,
        observedAt,
        sections.servers?.status ?? 'unavailable',
        sections.servers?.source ?? source,
        sections.servers?.note ?? null,
        sections.servers?.pageCount ?? null,
        sections.servers?.sampledServerCount ?? null,
        sections.servers?.sampledPlayerCount ?? null,
        sections.servers?.exactActiveServerCount ?? null,
        sections.servers?.estimatedActiveServerCount ?? null,
        sections.servers?.averagePlayersPerServer ?? null,
        sections.servers?.fillRate ?? null,
        toJsonText(sections.servers?.servers ?? []),
        toJsonText(sections.servers ?? null),
      )

      insertSocialDiscoveryHistoryStmt.run(
        universeId,
        observedAt,
        sections.socialDiscovery?.status ?? 'unavailable',
        sections.socialDiscovery?.source ?? source,
        sections.socialDiscovery?.note ?? null,
        sections.socialDiscovery?.youtube ?? null,
        sections.socialDiscovery?.tiktok ?? null,
        sections.socialDiscovery?.x ?? null,
        sections.socialDiscovery?.robloxSearchTrend ?? null,
        toJsonText(sections.socialDiscovery ?? null),
      )

      insertDerivedMetricsHistoryStmt.run(
        universeId,
        observedAt,
        source,
        payload.game.rblxScore ?? null,
        sections.players?.estimatedDAU ?? null,
        sections.players?.estimatedMAU ?? null,
        sections.players?.dailyVisitsObserved ?? null,
        sections.players?.averageSessionLengthMinutes ?? null,
        sections.growth?.growth7d?.ccu ?? null,
        sections.growth?.growth30d?.ccu ?? null,
        sections.growth?.growth90d?.ccu ?? null,
        sections.financials?.estimatedDailyRevenueUsd?.mid ?? null,
        sections.financials?.estimatedMonthlyRevenueUsd?.mid ?? null,
        sections.financials?.estimatedAnnualRunRateUsd?.mid ?? null,
        sections.financials?.estimatedValuationUsd?.mid ?? null,
        sections.monetization?.strategy ?? null,
        sections.financials?.confidence ?? null,
        sections.growth?.classification ?? null,
        toJsonText(sections.comparables?.games ?? []),
        toJsonText({
          players: sections.players ?? null,
          growth: sections.growth ?? null,
          financials: sections.financials ?? null,
          monetization: sections.monetization ?? null,
          comparables: sections.comparables ?? null,
          developerSummary: sections.developerSummary ?? null,
        }),
      )
    })
  }

  backfillDailyMetricsIfNeeded()

  return {
    db,
    countCatalogEntries,
    countDailyMetrics,
    countDerivedHistory,
    countExternalHistory,
    countExternalImportRuns,
    countMetadataHistory,
    countObservations,
    countSnapshots,
    countTrackedUniverseIds: () => countTrackedStmt.get().total,
    appendTrackedUniverseIds,
    getBoardSnapshot,
    getTrackedDiscoverySourceCounts,
    getTrackedTierCounts,
    finishExternalHistoryImportRun,
    finishIngestRun,
    getActiveIngestLease,
    getHistoryMap,
    getLatestIngestRun,
    getLatestSnapshotGames,
    getPlatformCurrentMetric,
    getPlatformHistoryPoints,
    deletePlatformHistoryPoints,
    getTrackedUniverseRecords,
    getUniverseRootPlaceMap,
    getTrackedUniverseIds,
    importLegacySnapshot,
    recordBoardSnapshot,
    recordGamePageSnapshot,
    recordPlatformCurrentMetric,
    recordPlatformHistoryPoints,
    recordExternalHistory,
    recordSnapshots,
    recoverStaleIngestRuns,
    releaseIngestLease,
    replaceTrackedUniverseRecords,
    replaceTrackedUniverseIds,
    searchLocalGames,
    startExternalHistoryImportRun,
    startIngestRun,
    tryAcquireIngestLease,
  }
}
