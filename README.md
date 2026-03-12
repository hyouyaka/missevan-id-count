# 小猫分析

一个基于 Vue 3 + Express 的小工具，用于搜索猫耳剧集、导入分集，并统计播放量、弹幕去重 ID 数以及最低收益预估。

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 启动后端

```bash
npm start
```

3. 新开终端启动前端开发服务器

```bash
npm run dev
```

前端默认通过 Vite 代理访问本地 `3000` 端口的 Express 服务。

## 生产构建

```bash
npm run build
npm start
```

Express 会托管 `dist` 目录中的静态文件，并保留 SPA 回退路由。

## 说明

- 猫耳接口可能出现访问限制，页面会给出提示。
- 收益为工具侧最低收益预估，不代表真实结算数据。
