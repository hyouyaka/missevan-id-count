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
