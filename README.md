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

### 桌面版

```bash
# 启动桌面版（构建 + Electron）
npm run desktop
```

桌面版会在本机内嵌启动 Express 服务，`Missevan` 请求从用户自己的电脑发出，通常比云环境更稳定。


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
| `FEATURE_SUGGESTION_URL` | 功能建议收集链接 | — |

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

Render 不承载本项目网页主站，只作为猫耳 418 时的一级备用代理；Deno 是二级备用代理。两者只代理猫耳 JSON/XML 请求，不用于图片、音频、视频或漫播请求。触发备用代理时，`logs/usage.log` 会写入 `fallbackUsed=true`、`fallbackRoute=render/deno` 和 `fallbackReason`。Render 免费实例冷启动可能需要几十秒；Render 失败后会再尝试 Deno。

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

启动主站后访问任意猫耳 JSON/XML 功能，检查 `logs/usage.log` 是否出现：

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

未配置 Upstash 或不可用时，猫耳搜索会直接调用猫耳搜索 API，Manbo 搜索会提示不可用并仅支持通过 ID / 链接导入。

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
| `MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES` | 猫耳弹幕用户缓存最大条目数 | Railway `20`，本地 `200` |
| `STATS_TASK_MAX_ITEMS` | 单个统计任务允许的最大作品或分集数 | `1000` |
| `MISSEVAN_STATS_MAX_CONCURRENCY` | 同时运行的猫耳统计任务数 | `2` |
| `MANBO_STATS_MAX_CONCURRENCY` | 同时运行的漫播统计任务数 | `3` |
| `STATS_TASK_QUEUE_MAX` | 每个平台等待队列最大任务数 | `20` |
| `STATS_TASK_CLIENT_QUEUE_MAX` | 每个 IP 在单个平台最多排队任务数 | `3` |
| `IMAGE_PROXY_MAX_BYTES` | 图片代理最大响应字节数 | `10485760`（10 MiB） |

统计任务创建接口按 IP 每 2 分钟最多接受 10 次请求。猫耳每个 IP 同时运行 1 个任务，漫播每个 IP 同时运行 2 个任务；超出的任务进入平台队列，不会降低已经运行任务的抓取并发。

队列已满、单个 IP 排队已满或创建过于频繁时，接口返回 `429`，同时提供 `Retry-After`、稳定错误码和中文提示。单任务超过 `STATS_TASK_MAX_ITEMS` 时返回 `400 TASK_ITEM_LIMIT_EXCEEDED`。

统计任务会异步保存恢复快照：Upstash 可用时按当前实例保存，否则写入 `runtime/stats-tasks.json`。服务重启后，未完成任务使用原任务 ID 从头重新排队；进度快照最多每 2 秒写入一次，不阻塞分集抓取。使用 `ADMIN_CACHE_REFRESH_TOKEN` 访问 `GET /admin/task-metrics` 可读取不含 IP 和任务输入的队列指标。

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
FEATURE_SUGGESTION_URL=https://your-feedback-form.example.com
```

桌面版 `.env` 读取优先顺序：

1. `exe` 同目录下的 `.env`
2. `APP_DATA_DIR/.env`
3. 系统已有环境变量

如果都没有配置 Upstash，桌面版不会内置 Manbo 起始库；Manbo 仍可通过 ID / 链接导入。
