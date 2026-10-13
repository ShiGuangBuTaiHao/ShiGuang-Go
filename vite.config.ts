import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'iconv-lite': fileURLToPath(new URL('./src/services/sgf-browser-optional.cjs', import.meta.url)),
      'jschardet': fileURLToPath(new URL('./src/services/sgf-browser-optional.cjs', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
