import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import type { Rpc } from '@solana/rpc';
import type { RpcSubscriptions } from '@solana/rpc-subscriptions';
import { useCluster } from './ClusterContext';

export interface SolanaContextType {
  rpc: Rpc<any>;
  rpcWrite: Rpc<any>;
  rpcSubscriptions: RpcSubscriptions<any>;
}

const SolanaContext = createContext<SolanaContextType | undefined>(undefined);

export function SolanaProvider({ children }: { children: ReactNode }) {
  const { endpoint, wsEndpoint } = useCluster();

  const rpc = useMemo(() => createSolanaRpc(endpoint), [endpoint]);

  // Create write RPC for sending transactions
  const rpcWrite = useMemo(() => {
    const writeUrl = import.meta.env.VITE_CONTRA_WRITE_URL || 'https://write.onlyoncontra.xyz';
    return createSolanaRpc(writeUrl);
  }, []);

  const rpcSubscriptions = useMemo(() => {
    const wsUrl = wsEndpoint || endpoint.replace('https://', 'wss://').replace('http://', 'ws://');
    return createSolanaRpcSubscriptions(wsUrl);
  }, [endpoint, wsEndpoint]);

  const value: SolanaContextType = {
    rpc,
    rpcWrite,
    rpcSubscriptions,
  };

  return (
    <SolanaContext.Provider value={value}>
      {children}
    </SolanaContext.Provider>
  );
}

export function useSolana(): SolanaContextType {
  const context = useContext(SolanaContext);
  if (!context) {
    throw new Error('useSolana must be used within SolanaProvider');
  }
  return context;
}
