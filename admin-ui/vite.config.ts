import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
      // Split read/write endpoints for Contra chain.
      // Falls back to the single CONTRA_RPC_URL if split vars aren't set.
      'import.meta.env.VITE_CONTRA_READ_URL': JSON.stringify(
        env.CONTRA_READ_URL || env.CONTRA_RPC_URL || 'https://read.onlyoncontra.xyz'
      ),
      'import.meta.env.VITE_CONTRA_WRITE_URL': JSON.stringify(
        env.CONTRA_WRITE_URL || env.CONTRA_RPC_URL || 'https://write.onlyoncontra.xyz'
      ),
    },
  }
})
