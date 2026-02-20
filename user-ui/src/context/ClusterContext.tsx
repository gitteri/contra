import { createContext, useContext, useState, type ReactNode } from 'react';

export type NetworkType = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet' | 'custom';

export interface ClusterContextType {
  network: NetworkType;
  endpoint: string;
  wsEndpoint: string;
  setNetwork: (network: NetworkType) => void;
  customEndpoint: string;
  setCustomEndpoint: (endpoint: string) => void;
}

const ClusterContext = createContext<ClusterContextType | undefined>(undefined);

const CLUSTER_URLS: Record<NetworkType, { http: string; ws: string }> = {
  'mainnet-beta': {
    http: 'https://api.mainnet-beta.solana.com',
    ws: 'wss://api.mainnet-beta.solana.com',
  },
  'devnet': {
    http: 'https://api.devnet.solana.com',
    ws: 'wss://api.devnet.solana.com',
  },
  'testnet': {
    http: 'https://api.testnet.solana.com',
    ws: 'wss://api.testnet.solana.com',
  },
  'localnet': {
    http: 'http://127.0.0.1:8899',
    ws: 'ws://127.0.0.1:8900',
  },
  'custom': {
    http: '',
    ws: '',
  },
};

export function ClusterProvider({ children }: { children: ReactNode }) {
  // Default to custom (Contra)
  const [network, setNetwork] = useState<NetworkType>('custom');
  const [customEndpoint, setCustomEndpoint] = useState<string>(
    import.meta.env.VITE_CONTRA_READ_URL || 'https://read.onlyoncontra.xyz'
  );

  const endpoint = network === 'custom'
    ? customEndpoint
    : CLUSTER_URLS[network].http;

  const wsEndpoint = network === 'custom'
    ? import.meta.env.VITE_CONTRA_WS_URL || 'wss://streamer.onlyoncontra.xyz/ws'
    : CLUSTER_URLS[network].ws;

  const value: ClusterContextType = {
    network,
    endpoint,
    wsEndpoint,
    setNetwork,
    customEndpoint,
    setCustomEndpoint,
  };

  return (
    <ClusterContext.Provider value={value}>
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster(): ClusterContextType {
  const context = useContext(ClusterContext);
  if (!context) {
    throw new Error('useCluster must be used within ClusterProvider');
  }
  return context;
}
