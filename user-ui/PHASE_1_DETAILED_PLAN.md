# Phase 1: Wallet Infrastructure & Admin Configuration - Detailed Implementation Plan

**Goal:** Replace fake public keys with real Solana wallets and configure admin wallet via environment variables.

**Prerequisites:**
- User UI currently running successfully
- Access to Contra RPC endpoints
- Admin wallet keypair available for testing

---

## Task 1.1: Add Dependencies

### 1.1.1 Update package.json

**File:** `user-ui/package.json`

**Action:** Add the following dependencies to the `dependencies` section:

```json
{
  "dependencies": {
    "@solana/kit": "^0.0.12",
    "@solana/web3.js": "^2.0.0",
    "@solana/addresses": "^2.0.0",
    "@solana/signers": "^2.0.0",
    "@solana/codecs-strings": "^2.0.0",
    "@solana/rpc-types": "^2.0.0",
    "@wallet-standard/react": "^1.1.0",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-wallets": "^0.19.32",
    "@solana/wallet-adapter-base": "^0.9.23"
  }
}
```

**Note:** Check for latest compatible versions before installing. Use the solana-dev skill if needed for version compatibility.

### 1.1.2 Install Dependencies

**Command:**
```bash
cd user-ui && npm install
```

**Verification:**
- All packages install without errors
- No peer dependency warnings
- Application still builds successfully

---

## Task 1.2: Environment Configuration

### 1.2.1 Create .env.example

**File:** `user-ui/.env.example`

**Action:** Create new file with the following content:

```env
# Contra RPC Endpoints
# In development, these will be proxied through Vite dev server
# In production, these will be proxied through Express server
VITE_CONTRA_READ_URL=/contra-read
VITE_CONTRA_WRITE_URL=/contra-write

# Contra WebSocket Endpoint
# For real-time transaction streaming
VITE_CONTRA_WS_URL=wss://streamer.onlyoncontra.xyz/ws

# Admin Wallet Configuration
# Option 1: Base58 encoded string (public key only for display)
# VITE_ADMIN_WALLET=YourBase58PublicKeyHere

# Option 2: Full keypair as JSON array (for signing transactions)
# VITE_ADMIN_WALLET=[123,45,67,89,...]

# WARNING: Never commit .env file with real private keys!
# This is for testing/demo purposes only.

# Token Mint Address (USDA)
VITE_MINT_ADDRESS=YourMintAddressHere

# Escrow Instance Address
VITE_INSTANCE_ADDRESS=YourInstanceAddressHere
```

### 1.2.2 Create .env file

**File:** `user-ui/.env`

**Action:** Copy `.env.example` to `.env` and fill in actual values.

**Note:** Ensure `.env` is in `.gitignore` (it should be already).

### 1.2.3 Update vite.config.ts

**File:** `user-ui/vite.config.ts`

**Current state:** Check existing proxy configuration.

**Action:** Update the `server.proxy` section to include Contra RPC proxying:

```typescript
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Determine Contra endpoints
  const contraReadUrl = env.CONTRA_READ_URL || 'https://read.onlyoncontra.xyz';
  const contraWriteUrl = env.CONTRA_WRITE_URL || 'https://write.onlyoncontra.xyz';
  const contraWsUrl = env.CONTRA_WS_URL || 'wss://streamer.onlyoncontra.xyz/ws';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/contra-read': {
          target: contraReadUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/contra-read/, ''),
        },
        '/contra-write': {
          target: contraWriteUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/contra-write/, ''),
        },
      },
    },
    define: {
      'import.meta.env.VITE_CONTRA_READ_URL': JSON.stringify('/contra-read'),
      'import.meta.env.VITE_CONTRA_WRITE_URL': JSON.stringify('/contra-write'),
      'import.meta.env.VITE_CONTRA_WS_URL': JSON.stringify(contraWsUrl),
    },
  };
});
```

### 1.2.4 Update server.mjs (Production Server)

**File:** `user-ui/server.mjs`

**Current state:** Already has basic proxy setup for `/contra-read` and `/contra-write`.

**Action:** Verify the existing proxy configuration is correct:

```javascript
// Proxy Contra RPC endpoints
app.use('/contra-read', createProxyMiddleware({
  target: process.env.CONTRA_READ_URL || 'https://read.onlyoncontra.xyz',
  changeOrigin: true,
  pathRewrite: { '^/contra-read': '' },
  logLevel: 'silent',
}));

app.use('/contra-write', createProxyMiddleware({
  target: process.env.CONTRA_WRITE_URL || 'https://write.onlyoncontra.xyz',
  changeOrigin: true,
  pathRewrite: { '^/contra-write': '' },
  logLevel: 'silent',
}));
```

**Verification:**
- Dev server starts without errors
- Production server builds and runs
- Environment variables are accessible via `import.meta.env.VITE_*`

---

## Task 1.3: Create RPC Infrastructure

### 1.3.1 Create contraRpc.ts utility

**File:** `user-ui/src/utils/contraRpc.ts`

**Action:** Create new file following admin-ui pattern:

```typescript
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/web3.js';

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
```

**Verification:**
```typescript
// Test import in a component:
import { contraReadRpc } from '@/utils/contraRpc';
console.log('Contra Read RPC initialized:', contraReadRpc);
```

---

## Task 1.4: Create Context Providers

### 1.4.1 Create ClusterContext

**File:** `user-ui/src/context/ClusterContext.tsx`

**Action:** Create new file for network/cluster management:

```typescript
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
```

### 1.4.2 Create SolanaContext

**File:** `user-ui/src/context/SolanaContext.tsx`

**Action:** Create new file for RPC client management:

```typescript
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/web3.js';
import type { Rpc, RpcSubscriptions } from '@solana/web3.js';
import { useCluster } from './ClusterContext';

export interface SolanaContextType {
  rpc: Rpc;
  rpcSubscriptions: RpcSubscriptions;
}

const SolanaContext = createContext<SolanaContextType | undefined>(undefined);

export function SolanaProvider({ children }: { children: ReactNode }) {
  const { endpoint, wsEndpoint } = useCluster();

  const rpc = useMemo(() => createSolanaRpc(endpoint), [endpoint]);

  const rpcSubscriptions = useMemo(() => {
    const wsUrl = wsEndpoint || endpoint.replace('https://', 'wss://').replace('http://', 'ws://');
    return createSolanaRpcSubscriptions(wsUrl);
  }, [endpoint, wsEndpoint]);

  const value: SolanaContextType = {
    rpc,
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
```

---

## Task 1.5: Update Application Providers

### 1.5.1 Update main.tsx

**File:** `user-ui/src/main.tsx`

**Action:** Wrap the application with ClusterProvider and SolanaProvider:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ClusterProvider } from './context/ClusterContext';
import { SolanaProvider } from './context/SolanaContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClusterProvider>
      <SolanaProvider>
        <App />
      </SolanaProvider>
    </ClusterProvider>
  </StrictMode>
);
```

**Verification:**
- Application starts without errors
- Contexts are accessible in components
- RPC clients are initialized

---

## Task 1.6: Admin Wallet Configuration

### 1.6.1 Create adminWallet utility

**File:** `user-ui/src/utils/adminWallet.ts`

**Action:** Create utility to load and manage admin wallet:

```typescript
import { address, type Address } from '@solana/addresses';
import { generateKeyPairSigner, type KeyPairSigner } from '@solana/signers';

/**
 * Admin wallet configuration
 * Can be either:
 * 1. Base58 public key string (for display only)
 * 2. JSON array of 64 bytes (full keypair for signing)
 */

let adminWalletCache: { address: Address; signer?: KeyPairSigner } | null = null;

/**
 * Parse admin wallet from environment variable
 * Returns address and optionally a signer if full keypair provided
 */
export async function getAdminWallet(): Promise<{ address: Address; signer?: KeyPairSigner } | null> {
  // Return cached value if available
  if (adminWalletCache) {
    return adminWalletCache;
  }

  const adminWalletEnv = import.meta.env.VITE_ADMIN_WALLET;

  if (!adminWalletEnv) {
    console.warn('VITE_ADMIN_WALLET not configured');
    return null;
  }

  try {
    // Try parsing as JSON array (full keypair)
    if (adminWalletEnv.startsWith('[')) {
      const keypairBytes = JSON.parse(adminWalletEnv) as number[];

      if (!Array.isArray(keypairBytes) || keypairBytes.length !== 64) {
        throw new Error('Invalid keypair format: must be 64-byte array');
      }

      // Create keypair from bytes
      const secretKey = new Uint8Array(keypairBytes);
      const signer = await generateKeyPairSigner();

      // TODO: Replace with actual keypair restoration when @solana/signers supports it
      // For now, we'll need a helper function or use web3.js Keypair.fromSecretKey
      console.warn('Full keypair parsing not yet implemented - using address only');

      // Extract public key (first 32 bytes of secret key in Ed25519)
      const publicKeyBytes = secretKey.slice(32, 64);
      const addr = address(Buffer.from(publicKeyBytes).toString('base64'));

      adminWalletCache = { address: addr };
      return adminWalletCache;
    }

    // Otherwise treat as base58 public key string
    const addr = address(adminWalletEnv);
    adminWalletCache = { address: addr };
    return adminWalletCache;

  } catch (error) {
    console.error('Failed to parse admin wallet:', error);
    return null;
  }
}

/**
 * Get admin address only (for display purposes)
 */
export async function getAdminAddress(): Promise<Address | null> {
  const wallet = await getAdminWallet();
  return wallet?.address ?? null;
}

/**
 * Clear cached admin wallet (for testing)
 */
export function clearAdminWalletCache(): void {
  adminWalletCache = null;
}
```

**Note:** The full keypair restoration requires additional work with @solana/signers. For Phase 1, we focus on getting the address working. We'll complete signing in Phase 3.

### 1.6.2 Update useUsers hook to use admin wallet

**File:** `user-ui/src/hooks/useUsers.ts`

**Action:** Add admin wallet initialization:

```typescript
// Add at top of file
import { getAdminAddress } from '@/utils/adminWallet';

// Add to useUsers hook
const [adminAddress, setAdminAddress] = useState<string | null>(null);

// Add useEffect to load admin wallet
useEffect(() => {
  async function loadAdminWallet() {
    const address = await getAdminAddress();
    if (address) {
      setAdminAddress(address);
      console.log('Admin wallet loaded:', address);
    }
  }
  loadAdminWallet();
}, []);

// Update adminState to include real address
const adminState = {
  address: adminAddress || 'Not configured',
  balance: 1000000, // Still mocked for now
  pendingPayouts: users.reduce((sum, user) => sum + user.pendingEarnings, 0),
  // ... rest of admin state
};
```

**Verification:**
- Admin address loads from environment variable
- Address displays in admin dashboard
- Console shows admin wallet initialization

---

## Task 1.7: User Wallet Generation

### 1.7.1 Create wallet storage utility

**File:** `user-ui/src/utils/walletStorage.ts`

**Action:** Create secure storage for user wallets:

```typescript
import { generateKeyPairSigner, type KeyPairSigner } from '@solana/signers';
import type { Address } from '@solana/addresses';

const STORAGE_KEY = 'contra:user-wallets';
const STORAGE_TYPE: 'sessionStorage' | 'localStorage' = 'sessionStorage'; // Clear on tab close

export interface StoredWallet {
  id: string;
  address: string; // Base58 string for serialization
  secretKey: number[]; // Array of bytes
}

/**
 * Generate a new user wallet
 */
export async function generateUserWallet(userId: string): Promise<KeyPairSigner> {
  const signer = await generateKeyPairSigner();

  // Store in browser storage
  await saveWallet(userId, signer);

  return signer;
}

/**
 * Save wallet to storage
 */
async function saveWallet(userId: string, signer: KeyPairSigner): Promise<void> {
  const wallets = loadWalletsFromStorage();

  // Convert signer to storable format
  const storedWallet: StoredWallet = {
    id: userId,
    address: signer.address,
    secretKey: Array.from(signer.secretKey || new Uint8Array()), // TODO: Extract secret key properly
  };

  // Add or update wallet
  const index = wallets.findIndex(w => w.id === userId);
  if (index >= 0) {
    wallets[index] = storedWallet;
  } else {
    wallets.push(storedWallet);
  }

  // Save to storage
  const storage = STORAGE_TYPE === 'sessionStorage' ? sessionStorage : localStorage;
  storage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

/**
 * Load wallet for a user
 */
export async function loadUserWallet(userId: string): Promise<KeyPairSigner | null> {
  const wallets = loadWalletsFromStorage();
  const stored = wallets.find(w => w.id === userId);

  if (!stored) {
    return null;
  }

  // TODO: Restore signer from stored secret key
  // For now, we'll need to generate a new one (temporary limitation)
  console.warn('Wallet restoration not fully implemented - generating new wallet');
  return await generateKeyPairSigner();
}

/**
 * Load all stored wallets
 */
function loadWalletsFromStorage(): StoredWallet[] {
  const storage = STORAGE_TYPE === 'sessionStorage' ? sessionStorage : localStorage;
  const stored = storage.getItem(STORAGE_KEY);

  if (!stored) {
    return [];
  }

  try {
    return JSON.parse(stored) as StoredWallet[];
  } catch (error) {
    console.error('Failed to parse stored wallets:', error);
    return [];
  }
}

/**
 * Clear all stored wallets
 */
export function clearAllWallets(): void {
  const storage = STORAGE_TYPE === 'sessionStorage' ? sessionStorage : localStorage;
  storage.removeItem(STORAGE_KEY);
}

/**
 * Get all wallet addresses (for display)
 */
export function getAllWalletAddresses(): Map<string, string> {
  const wallets = loadWalletsFromStorage();
  const map = new Map<string, string>();

  wallets.forEach(w => {
    map.set(w.id, w.address);
  });

  return map;
}
```

**Note:** Full keypair serialization/deserialization needs additional implementation. For Phase 1, we focus on address generation and display.

### 1.7.2 Update nameGenerator to create real wallets

**File:** `user-ui/src/utils/nameGenerator.ts`

**Action:** Update to generate real wallet addresses instead of fake ones:

```typescript
// Add import
import { generateKeyPairSigner } from '@solana/signers';
import type { KeyPairSigner } from '@solana/signers';

// Update User type to include signer
export interface UserWithWallet {
  id: string;
  firstName: string;
  lastName: string;
  avatarColor: string;
  wallet: {
    publicKey: string;
    signer?: KeyPairSigner; // Optional - only available when generated
  };
}

// Update generateUsers function
export async function generateUsers(count: number): Promise<UserWithWallet[]> {
  const users: UserWithWallet[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const avatarColor = avatarColors[i % avatarColors.length];

    // Generate real wallet
    const signer = await generateKeyPairSigner();

    users.push({
      id: `user-${i}`,
      firstName,
      lastName,
      avatarColor,
      wallet: {
        publicKey: signer.address,
        signer, // Store temporarily
      },
    });
  }

  return users;
}
```

### 1.7.3 Update useUsers to generate real wallets

**File:** `user-ui/src/hooks/useUsers.ts`

**Action:** Update user generation to use real wallets:

```typescript
// Add import
import { generateUsers } from '@/utils/nameGenerator';

// Update initialization
const [users, setUsers] = useState<User[]>([]);
const [isGeneratingWallets, setIsGeneratingWallets] = useState(false);

// Add function to initialize users with real wallets
const initializeUsers = useCallback(async (count: number) => {
  setIsGeneratingWallets(true);

  try {
    // Generate users with real wallets
    const generatedUsers = await generateUsers(count);

    // Convert to User type (without signer)
    const users: User[] = generatedUsers.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      avatarColor: u.avatarColor,
      wallet: {
        publicKey: u.wallet.publicKey,
      },
      balance: 0, // Start with 0 balance
      pendingEarnings: 0,
      transactions: [],
    }));

    setUsers(users);

    // Store wallet signers separately if needed
    // TODO: Implement wallet storage

  } catch (error) {
    console.error('Failed to generate wallets:', error);
  } finally {
    setIsGeneratingWallets(false);
  }
}, []);

// Update useEffect to initialize users on mount
useEffect(() => {
  const storedUsers = loadFromStorage<User[]>('users', []);

  if (storedUsers.length > 0) {
    setUsers(storedUsers);
  } else {
    // Generate initial users with real wallets
    initializeUsers(userCount);
  }
}, [userCount, initializeUsers]);
```

---

## Task 1.8: Update UI to Display Real Addresses

### 1.8.1 Update User Dashboard

**File:** `user-ui/src/components/DashboardScreen.tsx`

**Action:** Verify wallet address display is working:

```typescript
// The wallet address display should already be working
// Just verify the address is shown correctly:
<div className="text-xs text-neutral-500">
  {selectedUser.wallet.publicKey.slice(0, 6)}...
  {selectedUser.wallet.publicKey.slice(-6)}
</div>
```

**Verification:**
- Real Solana addresses display (not fake ones)
- Addresses are valid base58 strings
- Truncation works correctly

### 1.8.2 Update Admin Dashboard

**File:** `user-ui/src/components/AdminDashboard.tsx`

**Action:** Update to show real wallet addresses:

```typescript
// Update wallet address display in user table
<div className="font-mono text-xs text-neutral-500">
  {user.wallet.publicKey.slice(0, 4)}...
  {user.wallet.publicKey.slice(-4)}
</div>
```

**Verification:**
- All user addresses are real Solana addresses
- Admin address displays correctly
- No fake addresses remain

### 1.8.3 Update Network View

**File:** `user-ui/src/components/NetworkView.tsx`

**Action:** Verify tooltips show real addresses:

```typescript
// In node hover tooltip
<title>
  {user.firstName} {user.lastName}
  {'\n'}
  {user.wallet.publicKey}
  {'\n'}
  Balance: {formatBalance(user.balance)}
</title>
```

**Verification:**
- Hover tooltips show real addresses
- Admin node shows real admin address
- All addresses are valid

---

## Task 1.9: Add Security Warnings

### 1.9.1 Add warning banner to settings

**File:** `user-ui/src/components/SettingsDrawer.tsx`

**Action:** Add security warning about wallet storage:

```typescript
// Add warning banner at top of settings drawer
<div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
  <div className="flex items-start gap-2">
    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
    <div className="text-sm text-yellow-800">
      <p className="font-medium mb-1">Demo Wallets - Not for Production</p>
      <p className="text-xs">
        Wallets are stored in browser session storage and will be cleared when you close this tab.
        Never use these wallets for real funds or on mainnet.
      </p>
    </div>
  </div>
</div>
```

### 1.9.2 Add console warning

**File:** `user-ui/src/main.tsx`

**Action:** Add console warning about security:

```typescript
// Add after imports
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
```

---

## Task 1.10: Testing & Verification

### 1.10.1 Manual Testing Checklist

**Environment Setup:**
- [ ] `.env` file created with values from `.env.example`
- [ ] Admin wallet configured (at minimum public key)
- [ ] Application builds without errors: `npm run build`
- [ ] Dev server starts without errors: `npm run dev`

**Wallet Generation:**
- [ ] New users generate real Solana addresses
- [ ] Addresses are valid base58 strings (44 characters)
- [ ] Each user has unique address
- [ ] Addresses persist in session storage
- [ ] Addresses clear when tab is closed

**UI Display:**
- [ ] User dashboard shows real wallet address
- [ ] Admin dashboard shows real admin address
- [ ] Network view tooltips show real addresses
- [ ] All truncated addresses display correctly

**Admin Configuration:**
- [ ] Admin address loads from environment variable
- [ ] Admin address displays in UI
- [ ] Console shows admin wallet initialization
- [ ] Invalid admin wallet shows warning

**Security:**
- [ ] Warning banner displays in settings
- [ ] Console warning displays on app load
- [ ] `.env` file is in `.gitignore`
- [ ] No private keys logged to console

### 1.10.2 Automated Testing

**File:** `user-ui/src/utils/__tests__/walletGeneration.test.ts`

**Action:** Create basic tests:

```typescript
import { describe, it, expect } from 'vitest';
import { generateKeyPairSigner } from '@solana/signers';

describe('Wallet Generation', () => {
  it('should generate valid keypair signer', async () => {
    const signer = await generateKeyPairSigner();
    expect(signer.address).toBeDefined();
    expect(typeof signer.address).toBe('string');
    expect(signer.address.length).toBeGreaterThan(32);
  });

  it('should generate unique addresses', async () => {
    const signer1 = await generateKeyPairSigner();
    const signer2 = await generateKeyPairSigner();
    expect(signer1.address).not.toBe(signer2.address);
  });
});
```

**Run tests:**
```bash
npm test
```

---

## Task 1.11: Documentation Updates

### 1.11.1 Update README

**File:** `user-ui/README.md`

**Action:** Add section about environment configuration:

```markdown
## Environment Configuration

This application requires environment variables to connect to Contra blockchain:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure the following variables:
   - `VITE_CONTRA_READ_URL` - Contra read RPC endpoint
   - `VITE_CONTRA_WRITE_URL` - Contra write RPC endpoint
   - `VITE_CONTRA_WS_URL` - Contra WebSocket streaming endpoint
   - `VITE_ADMIN_WALLET` - Admin wallet public key or keypair
   - `VITE_MINT_ADDRESS` - USDA token mint address
   - `VITE_INSTANCE_ADDRESS` - Escrow instance address

3. **Security Note:** Never commit `.env` file with real private keys. Use for testing only.

## Wallet Management

User wallets are generated in-browser using `@solana/signers` and stored in session storage.

**Important:**
- Wallets are cleared when you close the browser tab
- These wallets are for TESTING ONLY
- Never send real funds to these addresses
- Never use on mainnet
```

---

## Phase 1 Completion Checklist

- [ ] All dependencies installed successfully
- [ ] Environment variables configured
- [ ] Vite and Express proxy setup working
- [ ] RPC clients initialize without errors
- [ ] Cluster and Solana contexts working
- [ ] Admin wallet loads from environment
- [ ] User wallets generate real addresses
- [ ] All UI displays real addresses
- [ ] Security warnings displayed
- [ ] No fake addresses remain in codebase
- [ ] Tests pass
- [ ] Documentation updated

---

## Known Limitations & Next Steps

**Current Limitations:**
1. **Keypair Serialization:** Full keypair save/restore not yet implemented. For Phase 1, we generate addresses but signers may not persist perfectly.
2. **Transaction Signing:** Admin signing not fully implemented. Will be completed in Phase 3.
3. **Wallet Recovery:** No seed phrase or backup mechanism. Wallets are ephemeral.

**Next Steps (Phase 2):**
1. Query real balances from blockchain
2. Fetch transaction history from RPC
3. Integrate WebSocket for real-time updates
4. Query escrow contract state for pending payouts
5. Replace all mocked data with blockchain queries

---

## Troubleshooting

**Issue: "VITE_ADMIN_WALLET is not defined"**
- Solution: Create `.env` file and add `VITE_ADMIN_WALLET=YourPublicKeyHere`

**Issue: "Failed to parse admin wallet"**
- Solution: Verify wallet format is either valid base58 string or JSON array of 64 numbers

**Issue: "Wallet addresses not displaying"**
- Solution: Check browser console for wallet generation errors

**Issue: "RPC connection failed"**
- Solution: Verify proxy configuration in `vite.config.ts` and `server.mjs`

**Issue: "Module not found: @solana/kit"**
- Solution: Run `npm install` and verify all dependencies installed

---

## Reference Files

**Pattern Examples:**
- `admin-ui/src/utils/contraRpc.ts` - RPC client setup
- `admin-ui/src/context/ClusterContext.tsx` - Cluster context
- `admin-ui/src/context/SolanaContext.tsx` - Solana context
- `demo-ui/src/utils/solana.ts` - Wallet generation patterns

**For Help:**
- Use the solana-dev Claude Code skill: `skill: "solana-dev"`
- Check Solana Web3.js v2 docs: https://solana-labs.github.io/solana-web3.js/
- Check @solana/kit documentation
