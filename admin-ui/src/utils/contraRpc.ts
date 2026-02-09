import { createSolanaRpc } from '@solana/rpc';

function normalizeUrl(raw: string, fallback: string): string {
  const url = raw || fallback;
  // Relative paths (e.g. /contra-read from vite proxy) are valid as-is
  if (url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
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

/** Pre-built RPC client for reading from Contra. */
export const contraReadRpc = createSolanaRpc(CONTRA_READ_URL);

/** Pre-built RPC client for writing to Contra. */
export const contraWriteRpc = createSolanaRpc(CONTRA_WRITE_URL);
