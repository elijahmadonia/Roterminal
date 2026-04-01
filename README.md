# RoTerminal

RoTerminal is a React and TypeScript app for Roblox market intelligence. The frontend ships as a Vite app, and the backend is a Node server that ingests Roblox public data into a local SQLite warehouse so the product can serve live views and retain historical observations.

## Stack

- Vite
- React 19
- TypeScript
- Node HTTP server in `server/index.mjs`
- SQLite via Node's built-in `node:sqlite`
- Plain CSS with design tokens in `src/index.css`

## Running locally

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts both the Vite client and the backend. If you only want the backend, run:

```bash
npm run start:server
```

For the scale-ready split, run the API and ingestion worker separately:

```bash
npm run start:api
npm run start:worker
```

`npm run dev` now starts three processes:

- Vite client
- API server with scheduled ingestion disabled
- dedicated ingestion worker

`npm run start:server` is still available as a single-process fallback that serves requests and performs ingestion in one process.

## Build

```bash
npm run build
```

## Project structure

- `server/index.mjs`: API routes, Roblox fetch orchestration, and payload shaping
- `server/worker.mjs`: scheduled Roblox ingestion worker
- `server/config.mjs`: backend runtime configuration and paths
- `server/lib/bootstrap.mjs`: legacy snapshot migration and startup bootstrap helpers
- `server/lib/database.mjs`: SQLite migrations, warehouse schema, and repository helpers
- `data/roterminal.db`: local SQLite database
- `src/pages/*`: app-level frontend pages
- `src/components/market-ui/*`: reusable market/terminal primitives
- `src/api/roblox.ts`: frontend API client

## Data model

The backend now stores data in layers:

- `tracked_universes`: the watchlist / board universe set
- `snapshots`: hot snapshot cache used to preserve compatibility with the current app
- `universe_catalog`: normalized experience metadata
- `universe_current_metrics`: latest known metrics per universe
- `universe_observations`: historical time-series observations for charting and future analytics
- `ingest_runs`: operational history for each backend ingestion cycle

On startup, the backend backfills the normalized warehouse tables from any existing `snapshots` data so historical records are preserved during upgrades.

## Environment

The backend can be tuned with `.env`:

- `ROTERMINAL_SERVER_PORT`: backend port, default `8787`
- `ROTERMINAL_DB_PATH`: SQLite file path, default `./data/roterminal.db`
- `ROTERMINAL_SERVER_ENABLE_SCHEDULED_INGEST`: enable polling inside the API server, default `true`
- `ROTERMINAL_INGEST_INTERVAL_MINUTES`: polling frequency, default `5`
- `ROTERMINAL_INGEST_STALE_AFTER_MS`: marks ingest unhealthy if no successful run lands within this window, default `max(interval x 3, 20m)`
- `ROTERMINAL_SNAPSHOT_RETENTION_DAYS`: local history retention window, default `30`
- `ROTERMINAL_REQUEST_TIMEOUT_MS`: upstream Roblox request timeout, default `8000`
- `ROTERMINAL_IMPORT_TOKEN`: shared bearer token that authorizes `/api/admin/import-history`
- `ROTERMINAL_IMPORT_URL`: target import base URL for local collector scripts, default `https://www.roterminal.co`
- `ROBLOX_SECURITY_COOKIE`: optional single `.ROBLOSECURITY` cookie for one Roblox seed account
- `ROBLOX_SECURITY_COOKIES`: optional newline-separated `.ROBLOSECURITY` cookies for multiple Roblox seed accounts

Without a Roblox security cookie, the app only covers public Explore/Discover feeds. With one or more seed-account cookies, the backend also calls Roblox's authenticated Home recommendations endpoint and merges those universes into the tracked board, which materially increases coverage for games that surface on Home but not in the public sort set. Use burner accounts, not production owner accounts.

## Production

The current production-safe deployment path is a single always-on backend service with a persistent disk:

1. Deploy the repo as a Render web service using [render.yaml](/Users/lij/Desktop/Roterminal/render.yaml).
2. Keep `startCommand` on `npm run start:server` so the API and scheduled ingest run in the same process.
3. Keep the SQLite database on the mounted disk via `ROTERMINAL_DB_PATH=/opt/render/project/src/data/roterminal.db`.
4. Use `/health` for the Render deployment health check. Keep `/ready` for operational checks that include ingest freshness.

This is the right move for now because the app currently uses SQLite. Splitting API and worker into separate services requires moving the warehouse to a network database like Postgres first. Until then, one always-on service plus persistent disk is the correct "legit" setup.

## Platform collector

Render’s web service can be blocked by Cloudflare on the third-party full-platform CCU endpoint. The production-safe workaround is to import platform history from a machine that can reach the provider, then let the API serve that stored history from Postgres.

1. Set the same `ROTERMINAL_IMPORT_TOKEN` in the Render web service and in your local `.env`.
2. Optionally set `ROTERMINAL_IMPORT_URL` locally if you want to push somewhere other than `https://www.roterminal.co`.
3. Run a one-off sync or backfill from your Mac:

```bash
npm run sync:platform-history -- --range 24h --source mac_platform_sync
```

4. Install the recurring macOS collector:

```bash
npm run install:platform-collector
```

The launch agent runs every 5 minutes, loads `.env` from the repo, and writes logs to `~/Library/Logs/com.roterminal.platform-collector.out.log` and `~/Library/Logs/com.roterminal.platform-collector.err.log`.

To remove it later:

```bash
npm run remove:platform-collector
```

On production, keep `ROTERMINAL_ALLOW_LIVE_READ_FALLBACK=false` so the API prefers imported platform history instead of repeatedly hitting the blocked provider from Render.

## Next scale steps

1. Add a proper API/database boundary with typed route modules instead of a single server entrypoint.
2. Introduce auth, saved watchlists, alerts, and derived aggregate tables once the product model is locked.
3. Promote the warehouse from local SQLite to Postgres/Timescale once you need multi-instance writes or longer retention.
4. Add long-horizon rollups so charts and screeners do not depend on raw 5-minute points forever.
