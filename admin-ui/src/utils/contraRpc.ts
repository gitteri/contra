import { createSolanaRpc } from '@solana/rpc';

function normalizeUrl(raw: string, fallback: string): string {
  const url = raw || fallback;
  // Relative paths (e.g. /contra-read from vite proxy) are valid as-is
  if (url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

function normalizeWsUrl(raw: string, fallback: string): string {
  const url = raw || fallback;
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  return `wss://${url}`;
}

/** Contra chain read endpoint (balance queries, tx lookups, polling). */
export const CONTRA_READ_URL = normalizeUrl(
  import.meta.env.VITE_CONTRA_READ_URL,
  'https://read.onlyoncontra.xyz'
);

/** Contra chain write endpoint (sendTransaction). */
export const CONTRA_WRITE_URL = normalizeUrl(
  import.meta.env.VITE_CONTRA_WRITE_URL,
  'https://write.onlyoncontra.xyz'
);

/** Contra streamer WebSocket endpoint (real-time transaction stream). */
export const CONTRA_WS_URL = normalizeWsUrl(
  import.meta.env.VITE_CONTRA_WS_URL,
  'wss://streamer.onlyoncontra.xyz/ws'
);

/** Pre-built RPC client for reading from Contra. */
export const contraReadRpc = createSolanaRpc(CONTRA_READ_URL);

/** Pre-built RPC client for writing to Contra. */
export const contraWriteRpc = createSolanaRpc(CONTRA_WRITE_URL);
