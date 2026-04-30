import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

import { loadLocalEnv } from "./envConfig.js";

await loadLocalEnv({ projectRoot: path.resolve(__dirname) });

const packageJson = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")
);
const backendTarget = `http://localhost:${Number(process.env.PORT) || 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(String(packageJson.version || "0.0.0")),
  },
  server: {
    proxy: {
      "/search": backendTarget,
      "/getdramacards": backendTarget,
      "/getdramas": backendTarget,
      "/getsoundsummary": backendTarget,
      "/getrewardsummary": backendTarget,
      "/getrewardmeta": backendTarget,
      "/getsounddanmaku": backendTarget,
      "/getdanmaku": backendTarget,
      "/image-proxy": backendTarget,
      "/app-config": backendTarget,
      "/usage-log": backendTarget,
      "/register-new-drama-ids": backendTarget,
      "/stat-tasks": backendTarget,
      "/ongoing": backendTarget,
      "/ranks/trends": backendTarget,
      "/ranks": backendTarget,
      "/landing": backendTarget,
      "/manbo": backendTarget,
    },
  },
});
