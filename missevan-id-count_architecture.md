# M&M Toolkit Architecture

Last updated: 2026-07-15

## Project Snapshot
- **Name**: M&M Toolkit (`missevan-counter`)
- **Version**: 1.7.5
- **Runtime model**: Express backend + React SPA + optional Electron desktop shell
- **Primary source roots**:
  - `server.js` as the stable backend facade, with `server/application.js` providing composition and `server/routes/` holding extracted route groups
  - `src/` for the browser UI
  - `shared/` for code shared across backend and frontend feature domains
  - `electron/` for the desktop shell
  - `envConfig.js` for controlled environment loading

This document describes the current implementation, not the historical evolution of the repo. Generated outputs and temporary notes that happen to live in the repository are called out separately under **Repository Boundaries** and are not treated as source architecture.

## Runtime Topology

### Browser and SPA Boot Flow
1. `src/main.jsx` mounts the React application and the global toast layer.
2. `src/app/RootApp.jsx` fetches `/app-config`, compares frontend/backend versions, and opens `ToolView`.
3. `src/app/ToolView.jsx` is the main workspace shell. It hosts the active tabs for:
   - Missevan search and analysis
   - Manbo search and analysis
   - Ongoing titles
   - Ranks and trends

### Backend Boot Flow
1. `server/application.js` loads environment values through `loadLocalEnv()`; `server.js` re-exports its public entrypoint for hosted and desktop callers.
2. It initializes Express, local request security, JSON body parsing, runtime directories, caches, Upstash clients, and store objects.
3. It exposes all JSON APIs plus the static SPA build from `dist/`.
4. It sets `X-Backend-Version` on every response and uses frontend version input to compute version mismatch state.

### Hosted Deployment
- The browser application is deployed as one Railway web service.
- Render is not an application host; it is the primary Missevan fallback proxy used after a direct HTTP 418.
- Deno is the secondary Missevan fallback proxy.

### Electron Desktop Flow
1. `electron/main.mjs` creates the desktop window with sandboxing and isolated context enabled.
2. It starts the Express backend through `startServer(0, { host: "127.0.0.1" })` on an ephemeral localhost port.
3. It waits for `/health` to respond, then opens `/tool` in the browser window.

### Development Flow
- `vite.config.js` injects `__APP_VERSION__` from `package.json`.
- The Vite dev server proxies API paths such as `/app-config`, `/search`, `/manbo/*`, `/ranks`, `/ranks/trends`, `/ongoing`, `/stat-tasks`, and `/usage-log` to the Express server.

## Repository Layout

### Core Runtime Modules
- `server.js`: stable backend facade
- `server/application.js`: backend service composition root and remaining route implementation
- `server/routes/systemRoutes.js`: extracted app-config and desktop/system routes
- `server/routes/statsRoutes.js`: extracted ranks, ongoing, admin metrics, health, and statistics-task routes
- `server/routes/missevanRoutes.js`: extracted Missevan content lookup, play-count, reward, and danmaku routes
- `server/routes/manboRoutes.js`: extracted Manbo input, search, content lookup, play-count, and danmaku routes
- `server/stats/taskExecution.js`: injected Missevan/Manbo statistics task execution and revenue aggregation
- `server/services/weeklyPlaybackService.js`: indexed/MGET weekly playback loading with legacy daily-key SCAN compatibility and a five-minute in-memory cache
- `src/main.jsx`: frontend entrypoint
- `src/app/RootApp.jsx`: application configuration and ToolView bootstrap
- `src/app/ToolView.jsx`: primary interaction shell
- `src/app/navigation.jsx`: desktop navigation and mobile drawer components
- `src/app/RanksPanel.jsx`: ranks UI
- `src/app/OngoingPanel.jsx`: ongoing titles UI
- `src/app/rankTrendUi.jsx`: reusable trend dialog and charting UI
- `electron/main.mjs`: Electron main process

### Shared Domain Modules
- `shared/episodeRules.js`: paid/member/main-episode rules and danmaku overflow heuristics
- `shared/ranksTrendUtils.js`: rank trend window calculation and metric normalization
- `shared/weeklyPlaybackUtils.js`: weekly playback normalization, recent non-repeated metric classification, weekly windows, and same-date metric fallback shaping
- `shared/ongoingUtils.js`: ongoing-title aggregation and window delta shaping

### Data and Support Files
- `scripts/`: developer utilities such as seed-building helpers
- `logs/`: runtime usage logging output when present
- `runtime/`: mutable runtime JSON fallback storage when present

## Backend API Surface

The backend currently exposes these route families.

### Configuration and Health
- `GET /app-config`: frontend feature flags, brand text, desktop metadata, cooldown info, version mismatch state
- `GET /health`: backend liveness

### Missevan Search and Content APIs
- `GET /search`: library-backed search with fallback to Missevan public search API when needed
- `POST /getdramacards`: normalized drama card lookup
- `POST /getdramas`: full drama detail plus episode metadata
- `POST /getsoundsummary`: per-sound play counts
- `POST /getrewardsummary`: reward total lookup
- `POST /getrewardmeta`: reward count metadata lookup
- `POST /getsounddanmaku`: danmaku fetch and unique-user aggregation

### Manbo Search and Content APIs
- `POST /manbo/resolve-input`: normalize shared links, URLs, and raw IDs
- `GET /manbo/search`: info-store-backed Manbo search
- `POST /manbo/getdramacards`: normalized Manbo drama cards
- `POST /manbo/getdramas`: full drama detail plus episode/set metadata
- `POST /manbo/getsetsummary`: per-set play counts
- `POST /manbo/getsetdanmaku`: paginated danmaku fetch and unique-user aggregation

### Async Statistics Task APIs
- `POST /stat-tasks`: create a Missevan task
- `GET /stat-tasks/:taskId`: poll Missevan task status
- `POST /stat-tasks/:taskId/cancel`: cancel a Missevan task
- `POST /manbo/stat-tasks`: create a Manbo task
- `GET /manbo/stat-tasks/:taskId`: poll Manbo task status
- `POST /manbo/stat-tasks/:taskId/cancel`: cancel a Manbo task

### Rankings and Discovery APIs
- `GET /ranks`: return normalized rank categories for both platforms
- `GET /ranks/trends`: return historical metrics and rank history for one title; titles with fewer than five valid, non-repeated metric dates in the latest 30 calendar days use `kind=weekly_playback` semantics
- `GET /ranks/trends/availability`: return trend-eligible IDs and their `metric` or `weekly_playback` kind
- `GET /ongoing`: return ongoing-title cards with 3d/7d/30d deltas
- `POST /register-new-drama-ids`: persist newly discovered titles

### Utility and Telemetry APIs
- `GET /image-proxy`: controlled image proxy with hostname allowlist
- `POST /usage-log`: append lightweight usage telemetry to `logs/usage.log`
- `GET *`: serve `dist/index.html` for the SPA shell

## Frontend-Backend Contract
- The frontend appends `frontendVersion` to API URLs through `buildVersionedUrl()`.
- The backend also accepts the same version through `X-Frontend-Version`.
- Every backend response sets `X-Backend-Version`.
- `RootApp` and `ToolView` compare frontend and backend versions and surface a mismatch banner when they diverge.
- Read-heavy APIs use response-specific cache behavior:
  - `/ranks`: cacheable response headers based on rank snapshot freshness
  - `/ranks/trends`: cacheable response headers keyed by drama and latest date
  - `/ongoing`: `no-store` because it is intentionally short-lived and UI-driven

## Search, Content, and Enrichment Flow

### Missevan
- Primary search path is the local/upstash-backed info store.
- If library search is unavailable or insufficient, `/search` can fall back to the Missevan public search API.
- Full detail fetches then enrich cards with episode, play-count, reward, and danmaku data.
- Paid/member classification and episode filtering rely on `shared/episodeRules.js`.

### Manbo
- Inputs can start as raw IDs, app share payloads, or URLs and are normalized by `/manbo/resolve-input`.
- Search uses Manbo metadata from `manboInfoStore.records`.
- Detail fetches combine legacy and v530 API shapes into a normalized UI contract.
- Danmaku is paginated and fetched concurrently, with a dedicated in-memory cache and in-flight deduplication.

### New Drama Tracking
- `POST /register-new-drama-ids` records titles that should become part of future lookups.
- The store persists through Upstash when configured, with JSON fallback files under `runtime/`.

## Data Stores and Persistence

### Mutable Runtime Locations
- `logs/usage.log`: append-only usage telemetry
- `runtime/manbo-drama-info.json`: Manbo info fallback storage
- `runtime/missevan-drama-info.json`: Missevan info fallback storage
- `runtime/new-drama-ids.json`: new-drama ID fallback storage
- `runtime/stats-tasks.json`: local statistics task recovery snapshots

These runtime locations resolve relative to `APP_DATA_DIR` when running in desktop mode, or the project directory in local server mode.

### Persistent Store Model

| Store | Primary backing | Fallback | Purpose |
| --- | --- | --- | --- |
| `manboInfoStore` | Upstash `manbo:info:meta:v2` + `manbo:info:v2`; fallback `manbo:info:v1` | `runtime/manbo-drama-info.json` | Searchable Manbo title metadata |
| `missevanInfoStore` | Upstash `missevan:info:meta:v2` + `missevan:info:v2`; fallback `missevan:info:v1` | `runtime/missevan-drama-info.json` | Searchable Missevan title metadata |
| `newDramaIdsStore` | Upstash `new:dramaIDs` | `runtime/new-drama-ids.json` | Captured new IDs |
| cooldown state | Upstash `missevan:cooldown:v1` | in-memory only when persistence disabled | Direct, Render fallback, and Deno fallback access-denial recovery state |
| ranks and ongoing snapshots | Latest/common keys plus v2 Hash `ranks:trend:{platform}:v2`, `ranks:trend:cv:v2`, `ranks:trend:peak:missevan:v2`; fallback v1 aggregate Strings | none | Rank, trend, and ongoing APIs |
| weekly playback snapshots | Upstash Hash `{platform}:watchcount:history` | canonical `{platform}:watchcount:index`, legacy weekly index, then `SCAN` | Weekly playback fallback for titles without five valid metric dates |
| statistics task snapshots | Per-instance Upstash Hash `stats:tasks:v2:{instanceId}`; one-way startup migration from `stats:tasks:v1:{instanceId}` | `runtime/stats-tasks.json` | Queued, running, and terminal task recovery snapshots |

### Missevan Cooldown State
- Railway stores the direct, Render fallback, and Deno fallback cooldown fields in one `missevan:cooldown:v1` JSON value.
- Requests prefer direct Missevan access, then Render, then Deno.
- When all enabled routes are cooling down, the API returns the nearest retry time.

## In-Memory Caches and Runtime Limits

### Cache Windows

| Cache or limit | Default |
| --- | --- |
| drama, sound summary, reward summary, reward detail | 30 minutes |
| Missevan search API cache | 10 minutes |
| Manbo drama, set, and danmaku caches | 30 minutes |
| ranks cache | 30 minutes |
| ongoing cache | 1 minute |
| weekly playback store cache | 5 minutes |
| JSON request body limit | `1mb` |
| default port | `3000` |

### Concurrency and Capacity Controls
- `MANBO_DANMAKU_PAGE_CONCURRENCY`: default 12
- `MANBO_STATS_EPISODE_CONCURRENCY`: default 4
- `MANBO_FETCH_TIMEOUT_MS`: default 10 seconds
- `MANBO_DANMAKU_CACHE_MAX_ENTRIES`: hosted deployments default to 20, local mode defaults to 200

## Task Execution Engine

The backend exposes one normalized task model even though the UI presents separate platform flows.

### Supported Task Types
- `id`: unique-user counting from danmaku data
- `play_count`: episode or set play-count aggregation
- `revenue`: estimated revenue and payment-mode analysis

### Task Lifecycle
1. A task is created by `POST /stat-tasks` or `POST /manbo/stat-tasks`.
2. The backend normalizes `taskType`, `episodes`, and `dramaIds` before creating the task object.
3. The UI polls task state through the corresponding `GET` endpoint.
4. Polling refreshes a heartbeat to prevent stale tasks from lingering forever.
5. Cancellation uses the corresponding `POST .../cancel` endpoint and transitions the task to `cancelled` unless it already completed.

### Task Retention
- Hosted deployment default task TTL: 15 minutes
- Local/developer default task TTL: 1 hour
- Heartbeat timeout: 5 minutes

### Platform-Specific Notes
- Missevan task creation refreshes cooldown state before execution.
- Manbo task creation defaults to `id` if the UI does not provide a task type.
- Output rendering is centralized in `src/app/OutputPanel.jsx`.

## Rankings, Trends, and Ongoing Titles

This subsystem is backed by shared domain utilities and Upstash snapshot keys.

### Rank System
- `GET /ranks` returns normalized categories for both platforms.
- The backend tags the response with schema version `5`.
- The frontend renders this data in `src/app/RanksPanel.jsx`.

### Trend System
- `GET /ranks/trends` uses one `HMGET` to read only the requested entity from the v2 Hash: ordinary drama, CV name, or peak series. Missing or malformed v2 data falls back to the corresponding v1 aggregate String without changing the HTTP response schema.
- Ordinary metric trends are classified as `metric` only after at least five dates in the latest 30 calendar days contain a finite configured platform metric and are not repeated snapshots. Otherwise the backend loads weekly playback; at least two valid playback points are required before it returns `kind: "weekly_playback"` with playback-only 3/7/30-week windows.
- The weekly consumer first reads requested drama IDs from `{platform}:watchcount:history` with one `HMGET`. Its fallback order is canonical `{platform}:watchcount:index` + `MGET`, legacy `{platform}:watchcount:weekly:index`, then `SCAN` + `MGET`; results and concurrent requests share a five-minute per-platform/per-ID cache.
- A weekly response prefers watchcount values. When the compare flow explicitly requests `kind=weekly_playback`, same-date metric view counts fill missing weekly points so mixed comparisons share one real-date axis.
- The backend tags trend and availability responses with schema version `7`; this version requires at least two valid weekly playback points and treats `无需抓取` paid-ID samples as unavailable current values.
- Shared shaping logic lives in `shared/ranksTrendUtils.js` and `shared/weeklyPlaybackUtils.js`; the Upstash read/cache boundary lives in `server/services/weeklyPlaybackService.js`.
- The single trend dialog can switch lazily between daily multi-metric data and weekly playback-only data, while the compare dialog switches to 3/7/30-week playback windows when mixed data is present.

#### Weekly playback consumer contract

The canonical index fallback accepts this structure:

```json
{
  "version": 1,
  "platform": "missevan",
  "granularity": "weekly",
  "dates": ["2026-05-10", "2026-05-17"],
  "keys": {
    "2026-05-10": "missevan:watchcount:2026-05-10",
    "2026-05-17": "missevan:watchcount:2026-05-17"
  }
}
```

Snapshot values may expose `view_count`, `watch_count`, or `play_count` records keyed by drama ID. The compatibility fallbacks remain available while production and older clients coexist.

### Ongoing System
- `GET /ongoing` first reads `ongoing:{platform}` IDs, then requests only those fields from `ranks:trend:{platform}:v2`; invalid v2 falls back to `ranks:trend:{platform}`. It computes 3-day, 7-day, and 30-day windows without changing the response schema.
- The backend tags the response with schema version `3`.
- Shared shaping logic lives in `shared/ongoingUtils.js`.
- The frontend renders this data in `src/app/OngoingPanel.jsx`.

## Environment and Deployment Model

### Supported Environment Keys
`envConfig.js` only loads a controlled allowlist of keys. Major knobs include:
- runtime placement: `APP_DATA_DIR`, `DESKTOP_APP`, `DESKTOP_EXE_DIR`, `DESKTOP_PACKAGED_APP`
- backend exposure: `PORT`, `JSON_BODY_LIMIT`, `START_SERVER_ON_IMPORT`, `ENABLE_MISSEVAN`
- feature links: `MISSEVAN_DESKTOP_APP_URL`, `FEATURE_SUGGESTION_URL`
- persistence: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Upstash read migration: `UPSTASH_DATA_READ_MODE` (`prefer-v2` by default, `legacy` for rollback), `INFO_STORE_META_POLL_INTERVAL_MS` (5 minutes by default)
- cooldown: `MISSEVAN_PERSISTENT_COOLDOWN`, `MISSEVAN_COOLDOWN_KEY`, `MISSEVAN_COOLDOWN_HOURS`
- cache and sync tuning: `INFO_STORE_SYNC_INTERVAL_MS`, `RANKS_CACHE_TTL_MS`, `WEEKLY_PLAYBACK_CACHE_TTL_MS`
- Manbo runtime tuning: `MANBO_FETCH_TIMEOUT_MS`, `MANBO_DANMAKU_PAGE_CONCURRENCY`, `MANBO_STATS_EPISODE_CONCURRENCY`
- task persistence tuning: `STATS_TASK_PERSISTENCE_DEBOUNCE_MS` (10 seconds by default, clamped to 1–60 seconds)

### Environment Resolution Order
- Desktop mode checks `.env` under the executable directory and app data directory first.
- Local project mode checks the project root `.env`.
- Only supported keys are imported into `process.env`.

## Repository Boundaries

The following items may exist in the repository or on disk, but they are not part of the maintained source architecture:

- `dist/`: generated frontend build output served by Express when present
- `release/`: desktop packaging output and builder metadata; this is not source-of-truth application logic
- `logs/`: runtime telemetry output
- `runtime/`: mutable fallback storage created by the running app

`RELEASE.md` explicitly states that packaged executables should be published as release assets and should not be committed as normal source changes.
