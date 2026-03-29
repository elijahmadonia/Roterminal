import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api/live': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/search': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/screener': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/game-page': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/game-icon': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/watchlist': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/developers': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/genres': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/alerts': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/ops': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/roblox-search': {
        target: 'https://apis.roblox.com/search-api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/roblox-search/, ''),
      },
      '/api/roblox-universes': {
        target: 'https://apis.roblox.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/roblox-universes/, ''),
      },
      '/api/roblox': {
        target: 'https://games.roblox.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/roblox/, '/v1'),
      },
      '/api/roblox-thumbnails': {
        target: 'https://thumbnails.roblox.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/roblox-thumbnails/, '/v1'),
      },
    },
  },
})
