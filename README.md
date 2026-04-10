# M&M Toolkit

一个基于 React + Express 的网页端 / 桌面端工具，用于：

- `Missevan` 的搜索、作品导入、弹幕统计、播放量统计、最低收益预估
- `Manbo` 的本地索引搜索、作品导入、分集筛选、弹幕统计、去重 ID 统计

## 本地启动

```bash
npm install
npm run build
npm start
```

启动后访问 `http://localhost:3000`。

## `dev` 分支

`dev` 分支用于节点状态引导主页。

- 根页面会显示 `节点1`、`节点2`、`节点3` 的状态
- 页面会统一读取首页服务自己的 `/landing/regions`
- 首页只展示节点版本号和 `Missevan` 受限冷却时间
- 选中节点后会直接跳转到对应工具页

这个分支不承担统一 API 网关职责，只做区域状态展示和跳转。

## 猫耳访问受限说明

如果 `Missevan` 显示“访问受限”：

1. 使用任意浏览器打开 `https://www.missevan.com/`
2. 完成猫耳要求的验证
3. 回到工具页面重新尝试

Windows 桌面版会直接在界面中提示这一步。

## 部署环境变量总表

- `VITE_REGION_AREA1_URL`：节点1工具页地址
- `VITE_REGION_AREA2_URL`：节点2工具页地址
- `VITE_REGION_AREA3_URL`：节点3工具页地址
- `ENABLE_MISSEVAN`：是否启用 `Missevan`，`true` 或不设置表示启用，`false` 表示隐藏并禁用相关接口
- `MISSEVAN_COOLDOWN_HOURS`：`Missevan` 命中 418 后的冷却小时数，默认 `4`
- `MISSEVAN_PERSISTENT_COOLDOWN`：是否持久化 cooldown；本地默认不启用，Render / Railway 默认启用
- `MISSEVAN_COOLDOWN_KEY`：当前部署使用的 cooldown key，例如 `missevan:cooldown:render:area1`
- 持久化 cooldown 的 JSON 会额外写入 `appVersion`，供首页节点列表直接显示版本号
- `MISSEVAN_DESKTOP_APP_URL`：网页版提示用户下载桌面版时使用的地址
- `UPSTASH_REDIS_REST_URL`：Upstash Redis 地址，用于持久化 Manbo 轻量索引和 Missevan cooldown
- `UPSTASH_REDIS_REST_TOKEN`：Upstash Redis Token
- `MANBO_INDEX_SYNC_INTERVAL_MS`：多实例环境下刷新远端 Manbo 索引快照的间隔，默认 `30000`
- `MANBO_DANMAKU_PAGE_CONCURRENCY`：Manbo 弹幕分页抓取并发，默认 `12`
- `MANBO_STATS_EPISODE_CONCURRENCY`：Manbo 统计任务分集并发，默认 `4`
- `MANBO_FETCH_TIMEOUT_MS`：Manbo 请求超时毫秒数，默认 `10000`
- `PORT`：服务监听端口，Render / Railway 通常自动注入

补充说明：

- `PORT`、`RENDER_*`、`RAILWAY_*`、`DESKTOP_APP`、`APP_DATA_DIR` 属于平台或运行时注入变量，部署时通常不需要手动设置
- 本地调试可直接访问 `/tool`，不需要额外配置 localhost 节点变量

未配置 Upstash 时，Manbo 轻量索引库会回退到运行目录下的 `runtime/manbo-index.json`。

## 本地 `.env`

本地开发版支持在项目根目录放置 `.env`，这样可以直接运行 `npm start` 或 `npm run desktop`，不用每次手动设置环境变量。

示例：

```env
UPSTASH_REDIS_REST_URL=https://your-upstash-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
MANBO_INDEX_SYNC_INTERVAL_MS=30000
MISSEVAN_PERSISTENT_COOLDOWN=false
MISSEVAN_COOLDOWN_KEY=missevan:cooldown:v1
VITE_REGION_AREA1_URL=https://your-area1-service.onrender.com
VITE_REGION_AREA2_URL=https://your-area2-service.onrender.com
VITE_REGION_AREA3_URL=https://your-area3-service.onrender.com
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
  - `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:render:area1`

部署完成后可以访问 `/app-config` 确认配置是否生效。

如果你把另外两个服务部署为节点2和节点3，推荐：

- `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:render:area2`
- `MISSEVAN_COOLDOWN_KEY=missevan:cooldown:render:area3`

节点主页所在站点需要额外配置：

- `VITE_REGION_AREA1_URL=https://your-area1-service.onrender.com`
- `VITE_REGION_AREA2_URL=https://your-area2-service.onrender.com`
- `VITE_REGION_AREA3_URL=https://your-area3-service.onrender.com`

首页会固定读取以下 3 个 cooldown key 来展示节点信息：

- `missevan:cooldown:render:area1`
- `missevan:cooldown:render:area2`
- `missevan:cooldown:render:area3`

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
