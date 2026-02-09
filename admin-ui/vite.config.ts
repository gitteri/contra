import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const contraReadUrl = env.CONTRA_READ_URL || env.CONTRA_RPC_URL || 'https://read.onlyoncontra.xyz'
  const contraWriteUrl = env.CONTRA_WRITE_URL || env.CONTRA_RPC_URL || 'https://write.onlyoncontra.xyz'

  // In dev mode, proxy Contra RPC requests to avoid CORS issues.
  // The app code will hit /contra-read and /contra-write instead of the
  // real URLs, and vite's proxy forwards them with proper headers.
  const isDev = mode === 'development'

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
      // In dev, point at the local proxy paths; in production, use the real URLs.
      'import.meta.env.VITE_CONTRA_READ_URL': JSON.stringify(
        isDev ? '/contra-read' : contraReadUrl
      ),
      'import.meta.env.VITE_CONTRA_WRITE_URL': JSON.stringify(
        isDev ? '/contra-write' : contraWriteUrl
      ),
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
