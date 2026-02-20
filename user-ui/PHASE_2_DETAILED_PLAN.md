# Phase 2: Real Data Integration - Detailed Implementation Plan

**Goal:** Replace all mocked data with actual blockchain queries via Contra RPC and WebSocket streaming.

**Prerequisites:**
- Phase 1 complete (wallet infrastructure working)
- Contra RPC endpoints accessible and configured
- WebSocket endpoint accessible
- Token mint address and instance address known

---

## Pre-Implementation: Data Availability Verification

### Task 0.1: Verify Environment Configuration

**Action:** Check that required environment variables are set in `.env`:

```env
VITE_CONTRA_READ_URL=read-node-production.up.railway.app
VITE_CONTRA_WRITE_URL=write-node-production.up.railway.app
VITE_CONTRA_WS_URL=wss://zonal-consideration-production-9032.up.railway.app/ws
VITE_ADMIN_WALLET=DsfzDL6z4miyrcr1JvshKj4PkNvHUgjg3MwMaNT5C9WU
VITE_MINT_ADDRESS=9uQfWVVxsGoaFUUwmLdc2c3iBhQP68aeQ9tsHJFbk2Ri
VITE_INSTANCE_ADDRESS=TWuCvf6pZ2JJs8SJ7PXdX3CwyZZcnbyw2EFSkgivVjX
```

**Verification:**
- [ ] All variables are set
- [ ] Mint address is valid base58 string
- [ ] Instance address is valid base58 string
- [ ] Admin wallet address is valid base58 string

### Task 0.2: Test RPC Connectivity

**Action:** Create a simple test to verify RPC endpoints are accessible.

**File:** `user-ui/src/utils/__tests__/rpcConnectivity.test.ts`

```typescript
import { contraReadRpc, contraWriteRpc } from '../contraRpc';

describe('RPC Connectivity', () => {
  it('should connect to read RPC', async () => {
    const slot = await contraReadRpc.getSlot().send();
    expect(typeof slot).toBe('bigint');
  });

  it('should connect to write RPC', async () => {
    const slot = await contraWriteRpc.getSlot().send();
    expect(typeof slot).toBe('bigint');
  });
});
```

**Run:**
```bash
pnpm test
```

**Verification:**
- [ ] Read RPC returns valid slot number
- [ ] Write RPC returns valid slot number
- [ ] No CORS errors

### Task 0.3: Document Available Data Sources

**Action:** Create a checklist of what data is available from Contra.

**Questions to answer:**
1. How do we query token balances? (`getTokenAccountsByOwner` or `getAccountInfo`?)
2. How do we query pending payouts? (Account state? Program-specific query?)
3. Is there a transaction indexer or do we use `getSignaturesForAddress`?
4. What format does the WebSocket use? (JSON? Specific schema?)

**If any data source is unavailable, STOP and document what's needed.**

---

## Task 2.1: Create RPC Query Infrastructure

### 2.1.1 Create queries utility file

**File:** `user-ui/src/utils/queries.ts`

**Action:** Create reusable query functions for blockchain data.

```typescript
import type { Address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';
import { address } from '@solana/addresses';

/**
 * Get SPL token balance for a wallet
 * Returns balance in smallest unit (e.g., lamports for USDA with decimals)
 */
export async function getTokenBalance(
  walletAddress: Address,
  mintAddress: Address,
  rpc: Rpc<any>
): Promise<bigint> {
  try {
    // Get token accounts owned by the wallet for this mint
    const response = await rpc.getTokenAccountsByOwner(
      walletAddress,
      { mint: mintAddress },
      { encoding: 'jsonParsed' }
    ).send();

    if (response.value.length === 0) {
      // No token account exists yet - balance is 0
      return 0n;
    }

    // Get the first token account (should only be one for a given mint)
    const tokenAccount = response.value[0];
    const balance = tokenAccount.account.data.parsed.info.tokenAmount.amount;

    return BigInt(balance);
  } catch (error) {
    console.error('Failed to fetch token balance:', error);
    return 0n;
  }
}

/**
 * Get multiple token balances in parallel
 */
export async function getTokenBalances(
  walletAddresses: Address[],
  mintAddress: Address,
  rpc: Rpc<any>
): Promise<Map<Address, bigint>> {
  const balances = new Map<Address, bigint>();

  const promises = walletAddresses.map(async (addr) => {
    const balance = await getTokenBalance(addr, mintAddress, rpc);
    balances.set(addr, balance);
  });

  await Promise.all(promises);

  return balances;
}

/**
 * Get transaction signatures for an address
 * Returns most recent transactions first
 */
export async function getTransactionSignatures(
  walletAddress: Address,
  rpc: Rpc<any>,
  limit: number = 50
): Promise<string[]> {
  try {
    const response = await rpc.getSignaturesForAddress(
      walletAddress,
      { limit }
    ).send();

    return response.map(sig => sig.signature);
  } catch (error) {
    console.error('Failed to fetch transaction signatures:', error);
    return [];
  }
}

/**
 * Get transaction details
 */
export async function getTransaction(
  signature: string,
  rpc: Rpc<any>
): Promise<any> {
  try {
    const response = await rpc.getTransaction(
      signature,
      {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      }
    ).send();

    return response;
  } catch (error) {
    console.error('Failed to fetch transaction:', error);
    return null;
  }
}

/**
 * Format balance from lamports to display amount
 * Assumes 6 decimals for USDA (adjust as needed)
 */
export function formatBalance(lamports: bigint, decimals: number = 6): number {
  const divisor = 10n ** BigInt(decimals);
  return Number(lamports) / Number(divisor);
}

/**
 * Convert display amount to lamports
 */
export function toLamports(amount: number, decimals: number = 6): bigint {
  const multiplier = 10 ** decimals;
  return BigInt(Math.floor(amount * multiplier));
}
```

**Verification:**
- [ ] File created successfully
- [ ] All functions have proper TypeScript types
- [ ] Error handling in place for all async calls

### 2.1.2 Create contract state queries

**File:** `user-ui/src/utils/contractState.ts`

**Action:** Create functions to query escrow contract state.

```typescript
import type { Address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';

/**
 * Get pending payout for a user from escrow contract
 *
 * NOTE: This depends on your escrow program's account structure.
 * You may need to:
 * 1. Derive the PDA for the user's escrow account
 * 2. Fetch and decode the account data
 * 3. Extract the pending payout amount
 *
 * Placeholder implementation - update based on your program structure.
 */
export async function getPendingPayout(
  userAddress: Address,
  instanceAddress: Address,
  rpc: Rpc<any>
): Promise<bigint> {
  try {
    // TODO: Implement based on escrow program structure
    // Example pseudocode:
    // 1. Derive user escrow PDA: [instance, user, 'escrow']
    // 2. Fetch account: rpc.getAccountInfo(escrowPda)
    // 3. Decode account data and extract pending amount

    console.warn('getPendingPayout not yet implemented - returning 0');
    return 0n;
  } catch (error) {
    console.error('Failed to fetch pending payout:', error);
    return 0n;
  }
}

/**
 * Get pending payouts for multiple users in parallel
 */
export async function getPendingPayouts(
  userAddresses: Address[],
  instanceAddress: Address,
  rpc: Rpc<any>
): Promise<Map<Address, bigint>> {
  const payouts = new Map<Address, bigint>();

  const promises = userAddresses.map(async (addr) => {
    const payout = await getPendingPayout(addr, instanceAddress, rpc);
    payouts.set(addr, payout);
  });

  await Promise.all(promises);

  return payouts;
}

/**
 * Get instance configuration
 *
 * Fetch escrow instance account data
 */
export async function getInstanceConfig(
  instanceAddress: Address,
  rpc: Rpc<any>
): Promise<any> {
  try {
    const response = await rpc.getAccountInfo(instanceAddress, {
      encoding: 'base64',
    }).send();

    if (!response.value) {
      throw new Error('Instance account not found');
    }

    // TODO: Decode instance account data based on your program structure
    return response.value;
  } catch (error) {
    console.error('Failed to fetch instance config:', error);
    return null;
  }
}
```

**Note:** This file contains placeholders. You'll need to update based on your actual escrow program structure.

**Verification:**
- [ ] File created successfully
- [ ] Placeholder functions documented
- [ ] Clear TODOs for program-specific implementation

### 2.1.3 Create balance fetching hook

**File:** `user-ui/src/hooks/useBalances.ts`

**Action:** Create a hook to manage balance fetching and caching.

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Address } from '@solana/addresses';
import { useSolana } from '../context/SolanaContext';
import { getTokenBalances, formatBalance } from '../utils/queries';
import { address } from '@solana/addresses';

const MINT_ADDRESS = import.meta.env.VITE_MINT_ADDRESS as Address;
const POLL_INTERVAL = 10000; // 10 seconds

export function useBalances(walletAddresses: Address[]) {
  const { rpc } = useSolana();
  const [balances, setBalances] = useState<Map<Address, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchBalances = useCallback(async () => {
    try {
      setError(null);
      const mintAddr = address(MINT_ADDRESS);
      const rawBalances = await getTokenBalances(walletAddresses, mintAddr, rpc);

      // Convert to display format (number)
      const displayBalances = new Map<Address, number>();
      rawBalances.forEach((balance, addr) => {
        displayBalances.set(addr, formatBalance(balance));
      });

      setBalances(displayBalances);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setError(err as Error);
      setIsLoading(false);
    }
  }, [walletAddresses, rpc]);

  // Fetch on mount and when addresses change
  useEffect(() => {
    if (walletAddresses.length > 0) {
      fetchBalances();
    }
  }, [fetchBalances, walletAddresses]);

  // Poll for updates every 10 seconds
  useEffect(() => {
    if (walletAddresses.length === 0) return;

    const interval = setInterval(fetchBalances, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchBalances, walletAddresses]);

  return {
    balances,
    isLoading,
    error,
    refetch: fetchBalances,
  };
}
```

**Verification:**
- [ ] Hook created successfully
- [ ] Polling mechanism in place
- [ ] Proper cleanup on unmount
- [ ] Error handling included

---

## Task 2.2: WebSocket Integration

### 2.2.1 Create WebSocket hook for real-time updates

**File:** `user-ui/src/hooks/useContraWebSocket.ts`

**Action:** Create WebSocket connection with exponential backoff.

```typescript
import { useEffect, useRef, useCallback } from 'react';

const CONTRA_WS_URL = import.meta.env.VITE_CONTRA_WS_URL;
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
```

**Verification:**
- [ ] WebSocket connects on mount
- [ ] Exponential backoff working
- [ ] Reconnection after disconnect
- [ ] Proper cleanup on unmount
- [ ] Console logs show connection status

---

## Task 2.3: Update useUsers Hook

### 2.3.1 Integrate real balance fetching

**File:** `user-ui/src/hooks/useUsers.ts`

**Action:** Replace mocked balances with real RPC queries.

**Changes needed:**

1. **Import new utilities:**
```typescript
import { useBalances } from './useBalances';
import { useSolana } from '../context/SolanaContext';
import { getPendingPayouts } from '../utils/contractState';
import { address } from '@solana/addresses';
```

2. **Add balance hook:**
```typescript
export function useUsers() {
  // ... existing state ...

  // Get all wallet addresses
  const walletAddresses = useMemo(() => {
    return users.map(u => address(u.wallet.publicKey));
  }, [users]);

  // Fetch real balances
  const { balances, isLoading: isLoadingBalances, refetch: refetchBalances } = useBalances(walletAddresses);

  // ... rest of hook ...
}
```

3. **Update balance display:**
```typescript
// When rendering users, use real balances
const usersWithBalances = useMemo(() => {
  return users.map(u => ({
    ...u,
    balance: balances.get(address(u.wallet.publicKey)) ?? 0,
  }));
}, [users, balances]);
```

4. **Remove fake balance generation:**
- Delete the `balance: 0` initialization in `buildUsers`
- Remove any fake balance update logic

**Verification:**
- [ ] Users display real balances from blockchain
- [ ] Balances update when transactions occur
- [ ] Loading state handled properly
- [ ] No more fake balance generation

### 2.3.2 Integrate pending payouts

**Action:** Fetch real pending payouts from escrow contract.

**Add to useUsers:**
```typescript
const [pendingPayouts, setPendingPayouts] = useState<Map<string, number>>(new Map());
const { rpc } = useSolana();

// Fetch pending payouts
useEffect(() => {
  async function fetchPendingPayouts() {
    const instanceAddr = address(import.meta.env.VITE_INSTANCE_ADDRESS);
    const addresses = users.map(u => address(u.wallet.publicKey));

    const payouts = await getPendingPayouts(addresses, instanceAddr, rpc);

    // Convert to display format
    const displayPayouts = new Map<string, number>();
    payouts.forEach((amount, addr) => {
      displayPayouts.set(addr, formatBalance(amount));
    });

    setPendingPayouts(displayPayouts);
  }

  if (users.length > 0) {
    fetchPendingPayouts();

    // Poll every 10 seconds
    const interval = setInterval(fetchPendingPayouts, 10000);
    return () => clearInterval(interval);
  }
}, [users, rpc]);
```

**Update adminState:**
```typescript
const adminState = {
  wallet: { publicKey: adminAddress || 'Not configured' },
  balance: adminBalance ?? 1000000, // Get from real RPC or keep mocked for now
  pendingPayouts: Object.fromEntries(pendingPayouts),
};
```

**Verification:**
- [ ] Pending payouts fetched from contract
- [ ] Admin dashboard shows real pending amounts
- [ ] Polling updates pending payouts
- [ ] UI reflects real escrow state

### 2.3.3 Integrate WebSocket updates

**Action:** Subscribe to real-time transaction updates.

**Add to useUsers:**
```typescript
import { useContraWebSocket } from './useContraWebSocket';

export function useUsers() {
  // ... existing state ...

  // Handle incoming transactions from WebSocket
  const handleWebSocketTransaction = useCallback((tx: ContraTransaction) => {
    console.log('Received transaction:', tx);

    // Check if transaction involves any of our users
    const userAddresses = users.map(u => u.wallet.publicKey);

    if (userAddresses.includes(tx.from) || userAddresses.includes(tx.to)) {
      // Refetch balances for affected users
      refetchBalances();

      // Add to network animation
      addNetworkTransaction({
        id: tx.signature,
        from: tx.from,
        to: tx.to,
        amount: tx.amount ? parseFloat(tx.amount) : 0,
        timestamp: Date.now(),
      });
    }
  }, [users, refetchBalances, addNetworkTransaction]);

  // Connect to WebSocket
  useContraWebSocket(handleWebSocketTransaction, liveTransactionsActive);

  // ... rest of hook ...
}
```

**Verification:**
- [ ] WebSocket connects when live transactions enabled
- [ ] Incoming transactions trigger balance refresh
- [ ] Network animations show real transactions
- [ ] No duplicate balance fetches

---

## Task 2.4: Update Network Visualization

### 2.4.1 Use real transaction data

**File:** `user-ui/src/components/NetworkView.tsx`

**Action:** Update to display real transaction stream.

**Changes:**
1. Remove simulated transaction generation
2. Use real transactions from WebSocket
3. Update node sizes based on real balances
4. Filter transactions by current instance

**Verification:**
- [ ] Network view shows real transactions
- [ ] Node sizes reflect actual balances
- [ ] Animations smooth and performant
- [ ] No fake transaction generation

---

## Task 2.5: Admin Dashboard Updates

### 2.5.1 Display real treasury balance

**File:** `user-ui/src/components/AdminDashboard.tsx`

**Action:** Query and display admin wallet balance.

**Add to component:**
```typescript
import { useBalances } from '../hooks/useBalances';
import { address } from '@solana/addresses';

function AdminDashboard({ adminState, users, ... }) {
  const adminAddr = address(adminState.wallet.publicKey);

  // Fetch admin balance
  const { balances: adminBalances } = useBalances([adminAddr]);
  const treasuryBalance = adminBalances.get(adminAddr) ?? adminState.balance;

  // Display real balance
  return (
    <div>
      <div>Treasury Balance: {formatBalance(treasuryBalance)} USDA</div>
      {/* ... rest of dashboard ... */}
    </div>
  );
}
```

**Verification:**
- [ ] Admin dashboard shows real treasury balance
- [ ] Balance updates on transactions
- [ ] Formatted correctly with decimals

---

## Task 2.6: Remove Mocked Data

### 2.6.1 Audit and remove all fake data generation

**Files to review:**
- `user-ui/src/hooks/useUsers.ts` - Remove fake pending payouts generation
- `user-ui/src/components/NetworkView.tsx` - Remove simulated transactions
- Any other files with mock data

**Checklist:**
- [ ] No more `Math.random()` for amounts
- [ ] No more fake transaction generation
- [ ] No more fake balance updates
- [ ] All data comes from RPC or WebSocket

### 2.6.2 Update persistence logic

**File:** `user-ui/src/utils/persistence.ts`

**Action:** Update to only persist UI state, not blockchain data.

**Changes:**
```typescript
export interface PersistedState {
  selectedId: string;
  userCount: number;
  payoutMode?: PayoutMode;
  // Remove: users, adminState (these come from blockchain now)
}
```

**Update save/load functions accordingly.**

**Verification:**
- [ ] Only UI preferences saved to localStorage
- [ ] Blockchain data never cached locally
- [ ] Fresh data on every reload

---

## Task 2.7: Error Handling & Loading States

### 2.7.1 Add loading indicators

**Files to modify:**
- `user-ui/src/components/DashboardScreen.tsx`
- `user-ui/src/components/AdminDashboard.tsx`

**Action:** Show loading spinners while fetching data.

**Example:**
```typescript
function DashboardScreen({ selectedUser, isLoadingBalances }) {
  if (isLoadingBalances) {
    return (
      <div className="loading-spinner">
        <div>Loading balance...</div>
      </div>
    );
  }

  return (
    // ... normal UI ...
  );
}
```

**Verification:**
- [ ] Loading indicators show during data fetch
- [ ] Smooth transition to loaded state
- [ ] No flickering or layout shifts

### 2.7.2 Add error boundaries

**File:** `user-ui/src/components/ErrorBoundary.tsx`

**Action:** Create error boundary for RPC failures.

```typescript
import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('RPC Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Failed to connect to blockchain</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Wrap App with ErrorBoundary in main.tsx.**

**Verification:**
- [ ] Error boundary catches RPC failures
- [ ] User-friendly error message displayed
- [ ] Reload button recovers app

---

## Task 2.8: Testing & Verification

### 2.8.1 Manual testing checklist

**Balance Fetching:**
- [ ] Users display real balances on load
- [ ] Balances update after transactions
- [ ] Admin treasury balance is accurate
- [ ] Zero balances handled correctly
- [ ] Non-existent token accounts handled (show 0)

**WebSocket:**
- [ ] WebSocket connects successfully
- [ ] Incoming transactions detected
- [ ] Balances refresh on new transactions
- [ ] Reconnection works after disconnect
- [ ] No memory leaks on connect/disconnect

**Pending Payouts:**
- [ ] Pending amounts fetch from contract
- [ ] Admin dashboard shows correct totals
- [ ] Poll updates pending amounts
- [ ] Zero pending handled correctly

**Network Visualization:**
- [ ] Real transactions animate
- [ ] Node sizes reflect balances
- [ ] No fake transactions generated
- [ ] Smooth animations

**Error Handling:**
- [ ] Loading indicators show properly
- [ ] Network errors handled gracefully
- [ ] Error boundary catches failures
- [ ] User can recover from errors

### 2.8.2 Create integration tests

**File:** `user-ui/src/hooks/__tests__/useBalances.test.ts`

**Action:** Test balance fetching hook.

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useBalances } from '../useBalances';
import { address } from '@solana/addresses';

// Mock RPC
jest.mock('../../context/SolanaContext', () => ({
  useSolana: () => ({
    rpc: {
      getTokenAccountsByOwner: jest.fn().mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000', // 1 USDA with 6 decimals
                  },
                },
              },
            },
          },
        }],
      }),
    },
  }),
}));

describe('useBalances', () => {
  it('should fetch balances', async () => {
    const addr = address('11111111111111111111111111111111');
    const { result } = renderHook(() => useBalances([addr]));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.balances.get(addr)).toBe(1);
  });
});
```

**Verification:**
- [ ] Tests pass
- [ ] Coverage for error cases
- [ ] Mock RPC responses working

---

## Phase 2 Completion Checklist

- [ ] All RPC queries implemented and working
- [ ] WebSocket connection stable with reconnection
- [ ] Real balances fetched and displayed
- [ ] Pending payouts queried from contract
- [ ] Admin treasury balance accurate
- [ ] Network visualization uses real data
- [ ] All mocked data removed
- [ ] Loading states implemented
- [ ] Error handling in place
- [ ] Tests pass
- [ ] No console errors
- [ ] Performance acceptable (no lag)

---

## Known Limitations & Next Steps

**Current Limitations:**
1. **Pending payout queries:** Placeholder implementation - needs program-specific logic
2. **Transaction history:** Basic implementation - may need indexer for better UX
3. **Real-time updates:** Polling-based - WebSocket provides better UX but adds complexity

**Next Steps (Phase 3):**
1. Implement transaction building with @solana/kit
2. Add user transaction signing
3. Implement collect earnings functionality
4. Add admin payout execution
5. Full optimistic UI updates with rollback

---

## Troubleshooting

**Issue: "getTokenAccountsByOwner returns empty array"**
- Solution: User may not have a token account yet. Show 0 balance until first deposit.

**Issue: "WebSocket keeps disconnecting"**
- Solution: Check CONTRA_WS_URL is correct. Verify firewall/network settings.

**Issue: "Balances not updating after transaction"**
- Solution: Increase poll interval or check WebSocket message format.

**Issue: "Contract state queries fail"**
- Solution: Verify instance address is correct. Check program deployed on correct cluster.

**Issue: "CORS errors"**
- Solution: Verify proxy configuration in vite.config.ts and server.mjs.

---

## Reference Files

**Pattern Examples:**
- `admin-ui/src/hooks/useActivityFeed.ts` - WebSocket pattern
- `admin-ui/src/utils/contraRpc.ts` - RPC setup
- `demo-ui/src/hooks/useLoadTest.ts` - Balance fetching pattern

**For Help:**
- Use the solana-dev Claude Code skill: `skill: "solana-dev"`
- Check @solana/kit documentation for RPC methods
- Review Contra program documentation for contract queries
