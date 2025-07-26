import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 相対パスでビルドするように設定
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5173,
  },
  build: {
    // Electronのfile://プロトコル用の設定
    assetsDir: 'assets',
  },
})
