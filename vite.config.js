/* eslint-env node */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: (() => {
    const lifecycle = process.env.npm_lifecycle_event || '';
    const isElectronBuild = ['build:electron', 'package:win', 'package:mac', 'package:linux'].some((name) => lifecycle.includes(name));
    return isElectronBuild ? './' : '/';
  })(),
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
