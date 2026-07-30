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
const packageLock = JSON.parse(
  fs.readFileSync(new URL("./package-lock.json", import.meta.url), "utf8")
);

function collectPackageDependencyNames(rootNames) {
  const names = new Set();

  function visit(name) {
    if (names.has(name)) {
      return;
    }
    names.add(name);
    const metadata = packageLock.packages?.[`node_modules/${name}`];
    Object.keys(metadata?.dependencies || {}).forEach(visit);
  }

  rootNames.forEach(visit);
  return names;
}

function getNodeModulePackageName(normalizedId) {
  const marker = "/node_modules/";
  const markerIndex = normalizedId.lastIndexOf(marker);
  if (markerIndex < 0) {
    return "";
  }
  const [first, second] = normalizedId.slice(markerIndex + marker.length).split("/");
  return first?.startsWith("@") ? `${first}/${second || ""}` : first || "";
}

const markdownVendorPackageNames = collectPackageDependencyNames([
  "react-markdown",
  "remark-gfm",
]);
const backendTarget = `http://localhost:${Number(process.env.PORT) || 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (!normalizedId.includes("/node_modules/")) {
            return undefined;
          }
          if (markdownVendorPackageNames.has(getNodeModulePackageName(normalizedId))) {
            return undefined;
          }
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (
            normalizedId.includes("/node_modules/radix-ui/") ||
            normalizedId.includes("/node_modules/@radix-ui/")
          ) {
            return "vendor-radix";
          }
          if (normalizedId.includes("/node_modules/lucide-react/")) {
            return "vendor-icons";
          }
          if (normalizedId.includes("/node_modules/twikoo/")) {
            return "twikoo";
          }
          return "vendor";
        },
      },
    },
  },
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
      "/unified-search": backendTarget,
      "/cv-profile": backendTarget,
      "/search-card-metrics": backendTarget,
      "/search": backendTarget,
      "/getdramacards": backendTarget,
      "/getdramas": backendTarget,
      "/getsoundsummary": backendTarget,
      "/getrewardsummary": backendTarget,
      "/getrewardmeta": backendTarget,
      "/getsounddanmaku": backendTarget,
      "/image-proxy": backendTarget,
      "/app-config": backendTarget,
      "/usage-log": backendTarget,
      "/register-new-drama-ids": backendTarget,
      "/stat-tasks": backendTarget,
      "/ongoing": backendTarget,
      "/ranks/trends": backendTarget,
      "/ranks": backendTarget,
      "/manbo": backendTarget,
    },
  },
});
