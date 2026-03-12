import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/search": "http://localhost:3000",
      "/getdramacards": "http://localhost:3000",
      "/getdramas": "http://localhost:3000",
      "/getsoundsummary": "http://localhost:3000",
      "/getrewardsummary": "http://localhost:3000",
      "/getsounddanmaku": "http://localhost:3000",
      "/getdanmaku": "http://localhost:3000",
      "/image-proxy": "http://localhost:3000",
    },
  },
});
