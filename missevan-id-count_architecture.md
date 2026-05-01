# M&M Toolkit Architecture

Last updated: 2026-04-30

## Project Snapshot
- **Name**: M&M Toolkit (`missevan-counter`)
- **Version**: 1.4.1
- **Runtime model**: Express backend + React SPA + optional Electron desktop shell
- **Primary source roots**:
  - `server.js` for backend routing, cache orchestration, Upstash access, cooldown state, and task execution
  - `src/` for the browser UI
  - `shared/` for code shared across backend and frontend feature domains
  - `electron/` for the desktop shell and Excel export IPC workflow
  - `manboIndexStore.js` for Manbo index synchronization and lookup
  - `envConfig.js` for controlled environment loading

This document describes the current implementation, not the historical evolution of the repo. Generated outputs and temporary notes that happen to live in the repository are called out separately under **Repository Boundaries** and are not treated as source architecture.

## Runtime Topology

### Browser and SPA Boot Flow
1. `src/main.jsx` mounts the React application and the global toast layer.
2. `src/app/RootApp.jsx` fetches `/app-config`, compares frontend/backend versions, and decides whether to show:
   - `LandingView` for the public landing page
   - `ToolView` for the actual toolbox UI
3. `src/app/ToolView.jsx` is the main workspace shell. It hosts the active tabs for:
   - Missevan search and analysis
   - Manbo search and analysis
   - Ongoing titles
   - Ranks and trends
   - Desktop-only Excel report generation

### Backend Boot Flow
1. `server.js` loads environment values through `loadLocalEnv()`.
2. It initializes Express, CORS, JSON body parsing, runtime directories, caches, Upstash clients, and store objects.
3. It exposes all JSON APIs plus the static SPA build from `dist/`.
4. It sets `X-Backend-Version` on every response and uses frontend version input to compute version mismatch state.

### Electron Desktop Flow
1. `electron/main.mjs` creates the desktop window and registers Excel IPC handlers.
2. It starts the Express backend through `startServer(0)` on an ephemeral localhost port.
3. It waits for `/health` to respond, then opens `/tool` in the browser window.
4. Desktop-only Excel actions call into `electron/excelReport.mjs` through IPC and never bypass the backend UI flow.

### Development Flow
- `vite.config.js` injects `__APP_VERSION__` from `package.json`.
- The Vite dev server proxies API paths such as `/app-config`, `/search`, `/manbo/*`, `/ranks`, `/ranks/trends`, `/ongoing`, `/stat-tasks`, and `/usage-log` to the Express server.

## Repository Layout

### Core Runtime Modules
- `server.js`: single backend entrypoint and service composition root
- `src/main.jsx`: frontend entrypoint
- `src/app/RootApp.jsx`: landing/tool bootstrap
- `src/app/ToolView.jsx`: primary interaction shell
- `src/app/RanksPanel.jsx`: ranks UI
- `src/app/OngoingPanel.jsx`: ongoing titles UI
- `src/app/rankTrendUi.jsx`: reusable trend dialog and charting UI
- `electron/main.mjs`: Electron main process
- `electron/excelReport.mjs`: template parsing and report workbook generation

### Shared Domain Modules
- `shared/episodeRules.js`: paid/member/main-episode rules and danmaku overflow heuristics
- `shared/ranksTrendUtils.js`: rank trend window calculation and metric normalization
- `shared/ongoingUtils.js`: ongoing-title aggregation and window delta shaping
- `shared/excelReportMeta.js`: Excel sheet names, headers, and theme metadata

### Data and Support Files
- `data/`: checked-in seed/reference JSON snapshots
- `scripts/`: developer utilities such as seed-building helpers
- `logs/`: runtime usage logging output when present
- `runtime/`: mutable runtime JSON fallback storage when present

## Backend API Surface

The backend currently exposes these route families.

### Configuration, Health, and Landing
- `GET /app-config`: frontend feature flags, brand text, desktop metadata, cooldown info, version mismatch state
- `GET /health`: backend liveness
- `GET /landing/regions`: multi-region cooldown status snapshots for landing nodes

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
- `GET /manbo/search`: index-backed Manbo search
- `GET /manbo/index/meta`: index metadata for the UI
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
- `GET /ranks/trends`: return historical metrics and rank history for one title
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
- Search uses the Manbo index built by `manboIndexStore.js`.
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

These runtime locations resolve relative to `APP_DATA_DIR` when running in desktop mode, or the project directory in local server mode.

### Persistent Store Model

| Store | Primary backing | Fallback | Purpose |
| --- | --- | --- | --- |
| `manboInfoStore` | Upstash `manbo:info:v1` | `runtime/manbo-drama-info.json` | Searchable Manbo title metadata |
| `missevanInfoStore` | Upstash `missevan:info:v1` | `runtime/missevan-drama-info.json` | Searchable Missevan title metadata |
| `newDramaIdsStore` | Upstash `new:dramaIDs` | `runtime/new-drama-ids.json` | Captured new IDs |
| `manboIndexStore` | Upstash-backed sync model | runtime-backed local state | Manbo search index and metadata |
| cooldown state | Upstash `missevan:cooldown:v1` and region keys | in-memory only when persistence disabled | Access-denial recovery state |
| ranks and ongoing snapshots | Upstash `ranks:latest`, `ranks:index`, `ranks:metrics:*`, `ranks:list:*`, `ongoing:*` | none | Rank, trend, and ongoing APIs |

### Multi-Region Cooldown State
- The landing page exposes three region snapshots: `area1`, `area2`, and `area3`.
- Their persistent keys are:
  - `missevan:cooldown:render:area1`
  - `missevan:cooldown:render:area2`
  - `missevan:cooldown:render:area3`
- This state is advisory for routing users toward healthier nodes and is separate from the main Missevan cooldown key.

## In-Memory Caches and Runtime Limits

### Cache Windows

| Cache or limit | Default |
| --- | --- |
| drama, sound summary, reward summary, reward detail | 30 minutes |
| Missevan search API cache | 10 minutes |
| Manbo drama, set, and danmaku caches | 30 minutes |
| ranks cache | 30 minutes |
| ongoing cache | 1 minute |
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
- The backend tags the response with schema version `3`.
- The frontend renders this data in `src/app/RanksPanel.jsx`.

### Trend System
- `GET /ranks/trends` reads per-date metric and list snapshots from `ranks:metrics:*` and `ranks:list:*` keys.
- The backend tags the trend response with schema version `4`.
- Shared shaping logic lives in `shared/ranksTrendUtils.js`.
- The dialog and visualization layer lives in `src/app/rankTrendUi.jsx`.

### Ongoing System
- `GET /ongoing` reads configured ongoing IDs plus rank metric snapshots and computes 3-day, 7-day, and 30-day windows.
- The backend tags the response with schema version `3`.
- Shared shaping logic lives in `shared/ongoingUtils.js`.
- The frontend renders this data in `src/app/OngoingPanel.jsx`.

## Desktop Excel Export Workflow

The desktop report workflow is only active inside the Electron shell.

### IPC Surface
- `desktop-excel:pick-input-workbook`
- `desktop-excel:pick-save-workbook`
- `desktop-excel:read-file`
- `desktop-excel:parse-template-workbook`
- `desktop-excel:write-file`
- `desktop-excel:write-report-workbook`
- `desktop-excel:open-file`

### Report Generation Flow
1. The user selects an Excel template workbook.
2. `parseTemplateWorkbook()` reads the Missevan and Manbo input sheets and validates title/type/ID columns.
3. The UI groups calculated rows by platform and payment category.
4. `buildReportWorkbook()` emits themed output sheets defined by `shared/excelReportMeta.js`.
5. The desktop shell writes the generated file and can optionally open it on disk.

## Environment and Deployment Model

### Supported Environment Keys
`envConfig.js` only loads a controlled allowlist of keys. Major knobs include:
- runtime placement: `APP_DATA_DIR`, `DESKTOP_APP`, `DESKTOP_EXE_DIR`, `DESKTOP_PACKAGED_APP`
- backend exposure: `PORT`, `JSON_BODY_LIMIT`, `START_SERVER_ON_IMPORT`, `ENABLE_MISSEVAN`
- feature links: `MISSEVAN_DESKTOP_APP_URL`, `FEATURE_SUGGESTION_URL`
- persistence: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- cooldown: `MISSEVAN_PERSISTENT_COOLDOWN`, `MISSEVAN_COOLDOWN_KEY`, `MISSEVAN_COOLDOWN_HOURS`
- cache and sync tuning: `INFO_STORE_SYNC_INTERVAL_MS`, `MANBO_INDEX_SYNC_INTERVAL_MS`, `RANKS_CACHE_TTL_MS`
- Manbo runtime tuning: `MANBO_FETCH_TIMEOUT_MS`, `MANBO_DANMAKU_PAGE_CONCURRENCY`, `MANBO_STATS_EPISODE_CONCURRENCY`

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
- `tmp-manbo-json-method-note.md`: historical scratch note from an abandoned experiment

`RELEASE.md` explicitly states that packaged executables should be published as release assets and should not be committed as normal source changes.

## Confirmed Redundancy Audit Summary

This pass records confirmed redundancy or low-value leftovers, but does not remove them.

| Finding | Current state | Risk if simplified later |
| --- | --- | --- |
| `src/utils/episodeRules.js` | Pure re-export wrapper over `shared/episodeRules.js` with no added logic | Low |
| duplicate CV text helpers in `server.js` | `buildRankMainCvText()` and `buildMainCvText()` perform the same string-assembly job in different regions | Low |
| duplicated version normalizer | `server.js` and `src/app/app-utils.js` both implement the same `normalizeVersion()` rule | Medium |
| `release/` committed artifacts | Packaging outputs live next to source even though they are not part of the application architecture | Low |
| `tmp-manbo-json-method-note.md` | Historical experiment note kept in repo root but not used by runtime code | Low |

### Follow-Up Guidance
- Safe simplification candidates: wrapper re-exports, duplicate helper consolidation, and stronger ignore rules for build outputs
- Higher-care refactor candidate: moving duplicated version-normalization logic into a shared module that both backend and frontend can consume cleanly
- No code removal is performed in this documentation pass
