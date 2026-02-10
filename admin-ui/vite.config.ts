import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const contraReadUrl = env.CONTRA_READ_URL || env.CONTRA_RPC_URL || 'https://read-node-production.up.railway.app'
  const contraWriteUrl = env.CONTRA_WRITE_URL || env.CONTRA_RPC_URL || 'https://write-node-production.up.railway.app'
  const contraWsUrl = env.CONTRA_WS_URL || 'ws://localhost:8902/ws'

  // Client code always uses /contra-read and /contra-write (relative paths).
  // In dev: Vite dev server proxies these to the real RPC URLs.
  // In prod: server.mjs (Express) proxies these to the real RPC URLs.
  // This avoids CORS entirely since the browser only talks to its own origin.

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@contra-escrow': path.resolve(__dirname, '../contra-escrow-program/clients/typescript/src/generated'),
        '@contra-withdraw': path.resolve(__dirname, '../contra-withdraw-program/clients/typescript/src/generated'),
      },
    },
    define: {
      global: 'globalThis',
      'process.env': {},
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'import.meta.env.VITE_CONTRA_READ_URL': JSON.stringify('/contra-read'),
      'import.meta.env.VITE_CONTRA_WRITE_URL': JSON.stringify('/contra-write'),
      'import.meta.env.VITE_CONTRA_WS_URL': JSON.stringify(contraWsUrl),
    },
    server: {
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
