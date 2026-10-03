# M&M Toolkit

一个基于 React + Express 的网页端 / 桌面端工具，用于 `Missevan`（猫耳）和 `Manbo`（漫播）音频平台的作品数据统计与分析。

## 功能概览

| 功能 | Missevan | Manbo |
|------|----------|-------|
| 搜索与导入 | 关键词搜索 + ID / 链接导入 | 资料库搜索 + ID / 链接导入 |
| 分集分类 | 付费 / 免费 / 会员 | 付费 / 免费 / 会员 |
| 弹幕统计 | 弹幕抓取与去重 ID 统计 | 弹幕抓取与去重 ID 统计 |
| 播放量统计 | 各集播放量汇总 | 各集播放量汇总 |
| 收益预估 | 打赏最低 / 最高收益 | 红豆收益计算 |

## 快速开始

### 本地启动（生产模式）

```bash
npm install
npm run build
npm start
```

启动后访问 `http://localhost:3000`。

### 本地开发

```bash
# 终端 1：启动后端
npm start

# 终端 2：启动 Vite 开发服务器
npm run dev
```

Vite 开发服务器会自动将 API 请求代理到 `http://localhost:3000`。

### Railway 部署

网页主站仅部署在 Railway。仓库中的 `railway.json` 已配置：

- Build Command：`npm install && npm run build`
- Start Command：`npm start`
- Healthcheck Path：`/health`

Railway 环境应使用 `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:v1` 持久化猫耳直连及两级备用代理的 cooldown 状态。

### 结构化日志

后端统一向 stdout/stderr 输出单行 JSON，不再使用 `[usage]` 文本前缀；`info`、`warn` 写入 stdout，`error` 写入 stderr。每条日志都包含 `timestamp`、`level`、`message`、`logSchemaVersion`、`category` 和 `event`；可按场景附带 `requestId`、`taskId`、`operationId`、`platform`、`outcome`、`durationMs` 等字段。

Railway Columns 推荐添加 `category`、`event`、`platform`、`keywordText`、`keyResultText`、`taskType`、`source`。`keywordText` 汇总搜索词、手动导入解析出的剧名、趋势/对比剧名、榜单/更新标题、从链接打开统计界面的剧名、收藏或外链作品名、CV 名称及统计任务剧名；`keyResultText` 仅记录成功统计任务的最终 ID 数、总播放量或收益数字，完整任务详情仍保留在 `result`。

| `category` | 用途 | 本地文件 |
|------|------|------|
| `user_action` | 打开搜索结果、榜单、趋势、对比等主要用户行为 | `logs/usage.log` |
| `task_summary` | 统计任务完成、失败或取消的终态及完整结果 | `logs/usage.log` |
| `operation` | 外部请求、弹幕、图片代理、存储读写和服务运行细节 | `logs/operations.log` |

同一次弹幕操作的请求与汇总共享 `operationId`。正常成功只写一条 `danmaku_summary`；发生重试、fallback、取消或失败时，汇总中额外包含 `attempts`，便于按需排查。首次启用新格式时，旧 `logs/usage.log` 会自动改名为 `logs/usage.legacy-<timestamp>.log`。

Railway 常用过滤：

| 目的 | 查询 |
|------|------|
| 只看主要用户行为和任务结果 | `@category:user_action OR @category:task_summary` |
| 日常运行分析，同时保留所有错误 | `(@category:user_action OR @category:task_summary) OR @level:error` |
| 只看需要排查的后台操作 | `@category:operation AND (@level:warn OR @level:error OR @fallbackUsed:true)` |
| 只看 fallback | `@category:operation AND @fallbackUsed:true` |
| 追踪一次请求/任务/操作 | `@requestId:<id>` / `@taskId:<id>` / `@operationId:<id>` |

### 桌面版

```bash
# 启动桌面版（构建 + Electron）
npm run desktop
```

桌面版会在本机内嵌启动 Express 服务，`Missevan` 请求从用户自己的电脑发出，通常比云环境更稳定。

桌面版只保留计算与统计界面：关键词搜索同时请求猫耳、漫播的剧集 API，支持作品/分集 ID、链接和分享导入，以及分集选择、ID、播放量和收益统计。收藏、查询历史、CV、榜单和趋势功能仅保留在网页版。桌面版不会连接 Upstash、Render 或 Deno，即使旧 `.env` 或系统环境仍有相应凭据；漫播自身的备用 API 域名仍可使用。

桌面统计任务只保存在当前进程内存中，退出后不会恢复。旧收藏 JSON、任务快照、资料库文件和浏览器历史不会读取、迁移或删除；桌面日志仅保留运行诊断，不记录查询词、导入内容和完整统计结果。


## 猫耳访问受限说明

云端部署的节点遇到猫耳访问受限时，需要等待冷却时间自动恢复，无法手动解锁。
Railway 主站命中猫耳 418 后会在 cooldown 期间依次尝试 Render、Deno 备用代理，主站 cooldown 结束后恢复直连。

桌面版或本地运行版可以自行解锁：

1. 使用任意浏览器打开 `https://www.missevan.com/`
2. 完成猫耳要求的验证
3. 回到工具页面重新尝试

Windows 桌面版会直接在界面中提示这一步。

## 环境变量

### 功能配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ENABLE_MISSEVAN` | 是否启用 Missevan 功能 | `true` |
| `MISSEVAN_COOLDOWN_HOURS` | 命中 418 后的冷却小时数 | `4` |
| `MISSEVAN_PERSISTENT_COOLDOWN` | 是否持久化 cooldown | 本地不启用；Railway 自动启用 |
| `MISSEVAN_COOLDOWN_KEY` | 当前部署的 cooldown key | `missevan:cooldown:v1` |
| `MISSEVAN_DESKTOP_APP_URL` | 网页版提示下载桌面版的地址 | — |
| `RESEND_API_KEY` | Resend 服务器 API Key；仅 hosted web feedback 使用 | — |
| `FEEDBACK_FROM_EMAIL` | Resend 发件人地址，例如 `MMToolkit Feedback <feedback@notify.mmtoolkit.app>` | — |
| `FEEDBACK_RECIPIENT_EMAIL` | 管理员私人收件地址 | — |

建议反馈为匿名表单，不保存反馈数据库，也不向浏览器暴露 Resend 配置。以上变量只能配置在 server/Railway 环境中，不要提交 `.env`。

### 猫耳备用代理

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MISSEVAN_FALLBACK_BASE_URL` | 一级 Render 备用代理地址 | `https://msbackup.onrender.com/missevan` |
| `MISSEVAN_FALLBACK_PROXY_TOKEN` | 一级备用代理鉴权 token，必须与 `missevan-backup-call` 的 `PROXY_TOKEN` 一致；为空则禁用一级备用 | — |
| `MISSEVAN_FALLBACK_TIMEOUT_MS` | 一级备用代理请求超时毫秒数，需覆盖 Render 免费实例冷启动 | `90000` |
| `MISSEVAN_SECONDARY_FALLBACK_BASE_URL` | 二级 Deno 备用代理地址 | `https://msbackup.mmtoolkit.deno.net/missevan` |
| `MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN` | 二级备用代理鉴权 token；为空则禁用二级备用 | — |
| `MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS` | 二级备用代理请求超时毫秒数 | `15000` |
| `MISSEVAN_FORCE_FALLBACK` | 本地/灰度强制猫耳 JSON/XML 请求出口：`0` 直连优先，`1` 一级 Render，`2` 二级 Deno | `0` |

Render 不承载本项目网页主站，只作为猫耳 418 时的一级备用代理；Deno 是二级备用代理。两者只代理猫耳 JSON/XML 请求，不用于图片、音频、视频或漫播请求。触发备用代理时，`logs/operations.log` 会写入 `fallbackUsed=true`、`fallbackRoute=render/deno` 和 `fallbackReason`。Render 免费实例冷启动可能需要几十秒；Render 失败后会再尝试 Deno。

本地强制测试链路：

```text
MISSEVAN_FORCE_FALLBACK=0:
猫耳请求 → 主站直连猫耳
✅        ✅

MISSEVAN_FORCE_FALLBACK=1 且一级 token 已配置:
猫耳请求 → Render 一级备用 → 猫耳 API
✅        ✅              ✅

MISSEVAN_FORCE_FALLBACK=2 且二级 token 已配置:
猫耳请求 → Deno 二级备用 → 猫耳 API
✅        ✅            ✅
```

本地 `.env` 示例：

```env
MISSEVAN_FALLBACK_BASE_URL=https://msbackup.onrender.com/missevan
MISSEVAN_FALLBACK_PROXY_TOKEN=replace-with-backup-proxy-token
MISSEVAN_FALLBACK_TIMEOUT_MS=90000
MISSEVAN_SECONDARY_FALLBACK_BASE_URL=https://msbackup.mmtoolkit.deno.net/missevan
MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN=replace-with-secondary-backup-proxy-token
MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS=15000
MISSEVAN_FORCE_FALLBACK=2
```

启动主站后访问任意猫耳 JSON/XML 功能，检查 `logs/operations.log` 是否出现：

```text
fallbackUsed=true
fallbackRoute=render 或 deno
fallbackReason=forced
```

测试结束后删除该变量，或改回：

```env
MISSEVAN_FORCE_FALLBACK=0
```

### Upstash Redis

| 变量 | 说明 |
|------|------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis 地址，用于持久化 Manbo/Missevan 资料库、榜单和 cooldown |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis Token |
| `INFO_STORE_META_POLL_INTERVAL_MS` | v2 资料库版本探针轮询间隔。默认 `300000`（5 分钟） |

以上 Upstash 配置仅适用于网页服务。桌面搜索始终使用猫耳和漫播 API，不依赖资料库；网页服务保留原有资料库优先及 API 回退策略。

### Manbo 性能调优

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MANBO_DANMAKU_PAGE_CONCURRENCY` | 弹幕分页抓取并发数 | `12` |
| `MANBO_STATS_EPISODE_CONCURRENCY` | 统计任务分集并发数 | `4` |
| `MANBO_FETCH_TIMEOUT_MS` | 请求超时毫秒数 | `10000` |
| `MANBO_DANMAKU_CACHE_MAX_ENTRIES` | 弹幕用户缓存最大条目数，托管部署默认更小以降低内存占用 | Railway `20`，本地 `200` |
| `MANBO_STATS_TASK_TTL_MS` | 统计任务结果保留时间，托管部署默认更短以降低内存占用 | Railway `900000`，本地 `3600000` |

### 资源保护

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CACHE_MAX_ENTRIES` | 普通详情、摘要、搜索和趋势缓存最大条目数 | Railway `500`，本地 `1000` |
| `WEEKLY_PLAYBACK_CACHE_TTL_MS` | 周度播放量索引与快照缓存时间 | `300000`（5 分钟） |
| `MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES` | 猫耳弹幕用户缓存最大条目数 | Railway `20`，本地 `200` |
| `STATS_TASK_MAX_ITEMS` | 单个统计任务允许的最大作品或分集数 | `1000` |
| `MISSEVAN_STATS_MAX_CONCURRENCY` | 同时运行的猫耳统计任务数 | `2` |
| `MANBO_STATS_MAX_CONCURRENCY` | 同时运行的漫播统计任务数 | `3` |
| `STATS_TASK_QUEUE_MAX` | 每个平台等待队列最大任务数 | `20` |
| `STATS_TASK_CLIENT_QUEUE_MAX` | 每个 IP 在单个平台最多排队任务数 | `3` |
| `STATS_TASK_PERSISTENCE_DEBOUNCE_MS` | 运行中任务进度快照的最大合并间隔，限制为 1000～60000 毫秒；持续更新不会延后已安排的保存 | `10000`（10 秒） |
| `IMAGE_PROXY_MAX_BYTES` | 图片代理最大响应字节数 | `10485760`（10 MiB） |

统计任务创建接口按 IP 每 2 分钟最多接受 10 次请求。猫耳每个 IP 同时运行 1 个任务，漫播每个 IP 同时运行 2 个任务；超出的任务进入平台队列，不会降低已经运行任务的抓取并发。

队列已满、单个 IP 排队已满或创建过于频繁时，接口返回 `429`，同时提供 `Retry-After`、稳定错误码和中文提示。单任务超过 `STATS_TASK_MAX_ITEMS` 时返回 `400 TASK_ITEM_LIMIT_EXCEEDED`。

网页服务的统计任务会异步保存恢复快照：Upstash 可用时写入实例级 Hash `stats:tasks:v2:{instanceId}`，否则写入 `runtime/stats-tasks.json`。服务启动时会将旧 v1 快照单向迁移到 v2；未完成任务使用原任务 ID 从头重新排队。运行中第一次进度更新安排保存，后续更新不推迟期限，默认 10 秒内保存最新状态；入队、开始运行和终态立即保存。桌面版不创建或恢复这些快照。网页服务可使用 `ADMIN_CACHE_REFRESH_TOKEN` 访问 `GET /admin/task-metrics` 读取不含 IP 和任务输入的队列指标。

普通统计与网页收藏刷新共用任务查询重试：每次 GET 最长 15 秒；网络错误、408、429 和 5xx 按 2、4、8、10 秒退避，之后保持 10 秒，并在剩余预算内遵守 `Retry-After`。成功响应重置连续故障计时。连续故障达 60 秒后停止等待，并尝试取消原任务；只有服务端确认后才显示取消成功。创建任务的 POST 不会自动重试，正常排队/执行时间不受此故障预算限制。

任务取消后状态不会再被迟到的完成或失败回写覆盖；若取消前已经产生部分结果，快照会保留结果并返回 `resultIncomplete=true`。服务恢复期间，统计任务的创建、查询和取消接口会等待快照加载完成，首页与健康检查不受影响。

图片代理根据文件内容识别 JPEG、PNG、WebP、GIF 和 AVIF，不依赖上游 `Content-Type`；重定向的每一跳都会重新验证 HTTPS 与 CDN 主机白名单。响应超过限制时返回 `413 IMAGE_TOO_LARGE`，类型不受支持时返回 `415 IMAGE_TYPE_UNSUPPORTED`。

### 运行时变量

`PORT`、`RAILWAY_*`、`DESKTOP_APP`、`APP_DATA_DIR` 属于平台或运行时注入变量，部署时通常不需要手动设置。

## 本地 `.env`

本地开发支持在项目根目录放置 `.env`，直接运行 `npm start` 或 `npm run desktop` 即可读取，不用每次手动设置环境变量。

示例：

```env
UPSTASH_REDIS_REST_URL=https://your-upstash-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
MISSEVAN_PERSISTENT_COOLDOWN=false
MISSEVAN_COOLDOWN_KEY=missevan:cooldown:v1
RESEND_API_KEY=re_xxxxxxxxx
FEEDBACK_FROM_EMAIL=MMToolkit Feedback <feedback@notify.mmtoolkit.app>
FEEDBACK_RECIPIENT_EMAIL=admin@example.com
```

桌面版环境值优先顺序（已有非空值不会被后续文件覆盖）：

1. 系统已有环境变量
2. `exe` 同目录下的 `.env`
3. `APP_DATA_DIR/.env`

开发启动时还可读取项目 `.env`；打包版不会读取项目目录。桌面运行策略始终禁用云端资料库、云端代理和任务持久化，不受这些文件中的旧凭据影响。
