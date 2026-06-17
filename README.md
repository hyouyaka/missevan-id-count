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
| Excel 报表 | 桌面版批量导出 | 桌面版批量导出 |

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

### 桌面版

```bash
# 启动桌面版（构建 + Electron）
npm run desktop
```

桌面版会在本机内嵌启动 Express 服务，`Missevan` 请求从用户自己的电脑发出，通常比云环境更稳定。


## 猫耳访问受限说明

云端部署的节点遇到猫耳访问受限时，需要等待冷却时间自动恢复，无法手动解锁。
如果配置了 Render 备用代理，主站命中猫耳 418 后会在 cooldown 期间改走备用代理，cooldown 结束后恢复主站本体直连。

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
| `MISSEVAN_PERSISTENT_COOLDOWN` | 是否持久化 cooldown | 本地不启用；Render/Railway 自动启用 |
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

备用代理只用于猫耳 JSON/XML 请求，不用于图片、音频、视频或漫播请求。触发备用代理时，`logs/usage.log` 会写入 `fallbackUsed=true`、`fallbackRoute=render/deno` 和 `fallbackReason`。Render 免费实例冷启动可能需要几十秒；Render 失败后会再尝试 Deno 二级备用。

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
| `MANBO_DANMAKU_CACHE_MAX_ENTRIES` | 弹幕用户缓存最大条目数，托管部署默认更小以降低内存占用 | Render/Railway `20`，本地 `200` |
| `MANBO_STATS_TASK_TTL_MS` | 统计任务结果保留时间，托管部署默认更短以降低内存占用 | Render/Railway `900000`，本地 `3600000` |

### 节点路由

| 变量 | 说明 |
|------|------|
| `VITE_REGION_AREA1_URL` | 节点1工具页地址 |
| `VITE_REGION_AREA2_URL` | 节点2工具页地址 |
| `VITE_REGION_AREA3_URL` | 节点3工具页地址 |

### 运行时变量

`PORT`、`RENDER_*`、`RAILWAY_*`、`DESKTOP_APP`、`APP_DATA_DIR` 属于平台或运行时注入变量，部署时通常不需要手动设置。本地调试可直接访问 `/tool`，不需要额外配置节点变量。

## 本地 `.env`

本地开发支持在项目根目录放置 `.env`，直接运行 `npm start` 或 `npm run desktop` 即可读取，不用每次手动设置环境变量。

示例：

```env
UPSTASH_REDIS_REST_URL=https://your-upstash-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
MISSEVAN_PERSISTENT_COOLDOWN=false
MISSEVAN_COOLDOWN_KEY=missevan:cooldown:v1
FEATURE_SUGGESTION_URL=https://your-feedback-form.example.com
VITE_REGION_AREA1_URL=https://your-area1-service.onrender.com
VITE_REGION_AREA2_URL=https://your-area2-service.onrender.com
VITE_REGION_AREA3_URL=https://your-area3-service.onrender.com
```

桌面版 `.env` 读取优先顺序：

1. `exe` 同目录下的 `.env`
2. `APP_DATA_DIR/.env`
3. 系统已有环境变量

如果都没有配置 Upstash，桌面版不会内置 Manbo 起始库；Manbo 仍可通过 ID / 链接导入。
