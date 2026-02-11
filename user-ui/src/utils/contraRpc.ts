import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';

/**
 * Normalizes a URL for Contra RPC endpoints
 * Handles relative paths, HTTP(S) URLs, and WebSocket URLs
 */
function normalizeUrl(envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;

  // If it's already a full URL, return as-is
  if (envValue.startsWith('http://') || envValue.startsWith('https://') ||
      envValue.startsWith('ws://') || envValue.startsWith('wss://')) {
    return envValue;
  }

  // If it's a relative path, construct full URL
  if (envValue.startsWith('/')) {
    const protocol = window.location.protocol;
    const host = window.location.host;
    return `${protocol}//${host}${envValue}`;
  }

  return fallback;
}

// Read endpoint (for queries)
const CONTRA_READ_URL = normalizeUrl(
  import.meta.env.VITE_CONTRA_READ_URL,
  'https://read.onlyoncontra.xyz'
);

// Write endpoint (for transactions)
const CONTRA_WRITE_URL = normalizeUrl(
  import.meta.env.VITE_CONTRA_WRITE_URL,
  'https://write.onlyoncontra.xyz'
);

// WebSocket endpoint (for streaming)
const CONTRA_WS_URL = normalizeUrl(
  import.meta.env.VITE_CONTRA_WS_URL,
  'wss://streamer.onlyoncontra.xyz/ws'
);

// Pre-built RPC clients
export const contraReadRpc = createSolanaRpc(CONTRA_READ_URL);
export const contraWriteRpc = createSolanaRpc(CONTRA_WRITE_URL);

// WebSocket subscriptions client
export const contraRpcSubscriptions = createSolanaRpcSubscriptions(CONTRA_WS_URL);

// Export URLs for direct access if needed
export { CONTRA_READ_URL, CONTRA_WRITE_URL, CONTRA_WS_URL };
