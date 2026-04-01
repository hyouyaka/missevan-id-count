# M&M Toolkit

一个基于 Vue 3 + Express 的网页端 / 桌面端工具，用于：

- `Missevan` 的搜索、作品导入、弹幕统计、播放量统计、最低收益预估
- `Manbo` 的本地索引搜索、作品导入、分集筛选、弹幕统计、去重 ID 统计

## 本地启动

```bash
npm install
npm run build
npm start
```

启动后访问 `http://localhost:3000`。

## 猫耳访问受限说明

如果 `Missevan` 显示“访问受限”：

1. 使用任意浏览器打开 `https://www.missevan.com/`
2. 完成猫耳要求的验证
3. 回到工具页面重新尝试

Windows 桌面版会直接在界面中提示这一步。

## 环境变量

- `ENABLE_MISSEVAN=true` 或不设置：显示 `Missevan + Manbo`
- `ENABLE_MISSEVAN=false`：隐藏 `Missevan`，并禁用相关后端接口
- `MISSEVAN_COOLDOWN_HOURS=4`：线上环境猫耳 418 冷却时间，默认 4 小时
- `MISSEVAN_PERSISTENT_COOLDOWN`：可选，显式控制是否启用持久化 cooldown；本地默认不启用，Render / Railway 默认启用
- `MISSEVAN_COOLDOWN_KEY`：可选，指定当前部署环境使用的 cooldown key，例如 `missevan:cooldown:render`
- `PORT`：服务监听端口，Render / Railway 会自动注入
- `UPSTASH_REDIS_REST_URL`：可选，配置后用于持久化 Manbo 轻量索引库
- `UPSTASH_REDIS_REST_TOKEN`：可选，配合 Upstash Redis 持久化 Manbo 轻量索引库与 Missevan cooldown
- `MANBO_INDEX_SYNC_INTERVAL_MS=30000`：可选，多实例环境下刷新远端 Manbo 索引快照的间隔

未配置 Upstash 时，Manbo 轻量索引库会回退到运行目录下的 `runtime/manbo-index.json`。

## 本地 `.env`

本地开发版支持在项目根目录放置 `.env`，这样可以直接运行 `npm start` 或 `npm run desktop`，不用每次手动设置环境变量。

示例：

```env
UPSTASH_REDIS_REST_URL=https://your-upstash-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
MANBO_INDEX_SYNC_INTERVAL_MS=30000
MISSEVAN_PERSISTENT_COOLDOWN=false
MISSEVAN_COOLDOWN_KEY=missevan:cooldown:local
```

Windows 桌面版支持以下优先顺序：

1. `exe` 同目录下的 `.env`
2. `APP_DATA_DIR/.env`
3. 系统已有环境变量

如果都没有配置 Upstash，桌面版会继续回退到本地 runtime 索引文件，再回退到内置的 `data/manbo-index.seed.json`。

## Render 部署

项目已包含 `render.yaml`，默认配置为：

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- 推荐环境变量：`ENABLE_MISSEVAN=false`
- 私用猫耳版推荐额外配置：
  - `MISSEVAN_PERSISTENT_COOLDOWN=true`
  - `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:render`

部署完成后可以访问 `/app-config` 确认配置是否生效。

## Railway 部署

项目已整理为可直接部署到 Railway 的 Node Web 服务。

推荐配置：

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Healthcheck Path: `/health`

推荐环境变量：

- 私用猫耳版：`ENABLE_MISSEVAN=true`
- 公开版：`ENABLE_MISSEVAN=false`
- `MISSEVAN_COOLDOWN_HOURS=4`
- 私用猫耳版推荐额外配置：
  - `MISSEVAN_PERSISTENT_COOLDOWN=true`
  - `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:railway`

说明：

- Railway 部署时不需要运行 Electron
- 网页版入口始终是 `server.js`
- 只要 `npm start` 正常即可

## Windows 桌面版

项目保留 Electron 打包配置。

本地启动桌面版：

```bash
npm run desktop
```

打包 Windows 便携版：

```bash
npm run pack:win
```

输出文件位于：

- `release/M&M-Toolkit-<version>.exe`

说明：

- 桌面版会在本机内嵌启动 Express 服务
- `Missevan` 请求从用户自己的电脑发出，通常比云环境更稳定
- 图标文件为 `windowsapp.ico`
- 打包后的桌面版会内置 `data/manbo-index.seed.json` 作为默认 Manbo 起始库
