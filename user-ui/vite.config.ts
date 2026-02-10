import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const contraReadUrl = env.CONTRA_READ_URL || 'https://read-node-production.up.railway.app'
  const contraWriteUrl = env.CONTRA_WRITE_URL || 'https://write-node-production.up.railway.app'
  const contraWsUrl = env.CONTRA_WS_URL || (mode === 'development' ? 'ws://localhost:8902/ws' : '')

  return {
    plugins: [react()],
    define: {
      global: 'globalThis',
      'process.env': {},
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'import.meta.env.VITE_CONTRA_READ_URL': JSON.stringify('/contra-read'),
      'import.meta.env.VITE_CONTRA_WRITE_URL': JSON.stringify('/contra-write'),
      ...(contraWsUrl ? { 'import.meta.env.VITE_CONTRA_WS_URL': JSON.stringify(contraWsUrl) } : {}),
    },
    server: {
      port: 3001,
      proxy: {
        '/contra-read': {
          target: contraReadUrl,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/contra-read/, ''),
        },
        '/contra-write': {
          target: contraWriteUrl,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/contra-write/, ''),
        },
      },
    },
  }
})
