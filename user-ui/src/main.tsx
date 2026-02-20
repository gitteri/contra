import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ClusterProvider } from './context/ClusterContext';
import { SolanaProvider } from './context/SolanaContext';

// Security warning for wallet usage
console.warn(
  '%c⚠️ SECURITY WARNING',
  'color: red; font-size: 20px; font-weight: bold;',
);
console.warn(
  'This application generates and stores Solana wallets in your browser.\n' +
  'These wallets are for TESTING and DEMO purposes only.\n' +
  'NEVER use these wallets for real funds or on mainnet.\n' +
  'Wallets are stored in session storage and will be cleared when you close the tab.'
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClusterProvider>
      <SolanaProvider>
        <App />
      </SolanaProvider>
    </ClusterProvider>
  </StrictMode>,
);
