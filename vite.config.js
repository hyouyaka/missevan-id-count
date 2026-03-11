import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/search': 'http://localhost:3000',
      '/getdramas': 'http://localhost:3000',
      '/getdanmaku': 'http://localhost:3000',
    },
  },
})
