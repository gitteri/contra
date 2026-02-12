import { useEffect, useRef, useCallback } from 'react';

const CONTRA_WS_URL = import.meta.env.VITE_CONTRA_WS_URL as string;
const WS_INITIAL_BACKOFF_MS = 500;
const WS_MAX_BACKOFF_MS = 30_000;

export interface ContraTransaction {
  signature: string;
  from: string;
  to: string;
  amount?: string;
  mint?: string;
  timestamp: number;
  type: string;
}

export function useContraWebSocket(
  onTransaction: (tx: ContraTransaction) => void,
  enabled: boolean = true
) {
  const wsRef = useRef<WebSocket | null>(null);
  const wsBackoffRef = useRef(WS_INITIAL_BACKOFF_MS);
  const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTransactionRef = useRef(onTransaction);

  // Update callback ref
  useEffect(() => {
    onTransactionRef.current = onTransaction;
  }, [onTransaction]);

  const disconnectContraWs = useCallback(() => {
    if (wsReconnectTimer.current) {
      clearTimeout(wsReconnectTimer.current);
      wsReconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    wsBackoffRef.current = WS_INITIAL_BACKOFF_MS;
  }, []);

  const connectContraWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    console.log('[ContraWS] Connecting to:', CONTRA_WS_URL);
    const ws = new WebSocket(CONTRA_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.info('[ContraWS] Connected');
      wsBackoffRef.current = WS_INITIAL_BACKOFF_MS; // Reset backoff
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ContraTransaction;
        onTransactionRef.current(data);
      } catch (error) {
        console.error('[ContraWS] Failed to parse message:', error);
      }
    };

    ws.onclose = (event) => {
      console.warn('[ContraWS] Disconnected:', event.code, event.reason);
      wsRef.current = null;

      // Exponential backoff reconnection
      const backoff = wsBackoffRef.current;
      wsBackoffRef.current = Math.min(backoff * 2, WS_MAX_BACKOFF_MS);

      console.info(`[ContraWS] Reconnecting in ${backoff}ms...`);
      wsReconnectTimer.current = setTimeout(connectContraWs, backoff);
    };

    ws.onerror = (err) => {
      console.error('[ContraWS] Error:', err);
      console.warn('[ContraWS] WebSocket connection failed - Railway edge proxy may not be configured for WebSockets');
      // onclose will handle reconnection
    };
  }, []);

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    if (!enabled) {
      disconnectContraWs();
      return;
    }

    connectContraWs();

    return () => {
      disconnectContraWs();
    };
  }, [enabled, connectContraWs, disconnectContraWs]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    disconnect: disconnectContraWs,
    reconnect: connectContraWs,
  };
}
