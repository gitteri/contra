# User UI Backend Integration - Master Plan

**Last Updated:** 2026-02-10

**Status:** Planning Phase

---

## Important Note: Solana Development Support

Throughout this implementation, use the **solana-dev Claude Code skill** as needed. This skill provides:
- Up-to-date Solana best practices (Jan 2026)
- Modern framework-kit patterns (@solana/client + @solana/react-hooks)
- Preferred @solana/kit for client/RPC/transaction code
- Wallet-standard-first connection patterns
- Anchor/Pinocchio program guidance
- Codama-based client generation
- Testing patterns (LiteSVM/Mollusk/Surfpool)
- Security checklists

To invoke: Use the Skill tool with `skill: "solana-dev"` when working on Solana-specific implementations.

---

## Overview

**Current State:**
- User UI is a sophisticated React 19 prototype with 100% mocked data
- LocalStorage-based persistence with in-memory state
- Network visualization with transaction animations
- Admin dashboard with payout management

**Target State:**
- Real Solana wallets using modern @solana/kit tools
- Live data from Contra RPC endpoints and WebSocket streaming
- Actual onchain transactions for earnings collection and payouts
- Seamless integration following patterns from admin-ui and demo-ui

---

## Phase 1: Wallet Infrastructure & Admin Configuration

**Goal:** Replace fake public keys with real Solana wallets and configure admin wallet via environment variables.

### 1.1 Dependencies & Configuration
**Files to modify:**
- `user-ui/package.json` - Add dependencies
- `user-ui/.env.example` - Document required env vars
- `user-ui/vite.config.ts` - Configure environment variables
- `user-ui/server.mjs` - Update proxy configuration

**New dependencies needed:**
```json
{
  "@solana/kit": "latest",
  "@solana/web3.js": "^2.x",
  "@solana/addresses": "^2.x",
  "@solana/signers": "^2.x",
  "@solana/codecs-strings": "^2.x",
  "@wallet-standard/react": "^1.x",
  "@solana/wallet-adapter-react": "^0.15.x",
  "@solana/wallet-adapter-wallets": "^0.19.x"
}
```

**Environment variables:**
```env
VITE_CONTRA_READ_URL=/contra-read
VITE_CONTRA_WRITE_URL=/contra-write
VITE_CONTRA_WS_URL=wss://streamer.onlyoncontra.xyz/ws
VITE_ADMIN_WALLET=[base58 string or keypair array]
```

### 1.2 Wallet Infrastructure Setup
**New files to create:**
- `user-ui/src/utils/contraRpc.ts` - Contra RPC client setup (following admin-ui pattern)
- `user-ui/src/context/ClusterContext.tsx` - Network selection provider
- `user-ui/src/context/SolanaContext.tsx` - RPC provider
- `user-ui/src/hooks/useWallet.ts` - Wallet adapter integration
- `user-ui/src/hooks/useWalletStandardAccount.ts` - Wallet standard bridge

**Implementation details:**
- Dual RPC endpoints (read/write separation)
- Pre-built clients: `contraReadRpc` and `contraWriteRpc`
- URL normalization for dev/prod proxy support
- Proper provider nesting: ClusterProvider → WalletProviders → App

### 1.3 Admin Wallet Configuration
**Files to modify:**
- `user-ui/src/hooks/useUsers.ts` - Update admin state management

**Implementation:**
```typescript
// Load admin wallet from env
const ADMIN_WALLET = import.meta.env.VITE_ADMIN_WALLET;
// Support both base58 string or keypair array format
// Validate on app initialization
// Store in context (not localStorage for security)
```

### 1.4 User Wallet Creation in UI
**Files to modify:**
- `user-ui/src/components/SettingsDrawer.tsx` - Add wallet creation flow
- `user-ui/src/utils/nameGenerator.ts` - Update to generate real keypairs

**Implementation:**
```typescript
import { generateKeyPairSigner } from '@solana/signers';

// Replace fake public key generation with:
const keypair = await generateKeyPairSigner();
const wallet = {
  publicKey: keypair.address, // Real Address type
  secretKey: keypair.secretKey // Store securely (not in localStorage plaintext)
};
```

**UI flow:**
1. User adjusts user count in settings
2. For new users, generate real keypairs
3. Store keypairs in secure browser storage (IndexedDB encrypted or sessionStorage)
4. Display real addresses in UI

### 1.5 Wallet Security & Persistence
**New files to create:**
- `user-ui/src/utils/walletStorage.ts` - Secure keypair storage

**Implementation considerations:**
- **Option A:** Store keypairs in IndexedDB (encrypted with user-provided password)
- **Option B:** Store in sessionStorage (cleared on tab close)
- **Option C:** Generate deterministic keypairs from seed phrase
- Display warning about non-production usage

**Recommended:** Option B (sessionStorage) for demo/testing purposes with clear disclaimers.

---

## Phase 2: Real Data Integration

**Goal:** Replace all mocked data with actual blockchain queries via Contra RPC and WebSocket streaming.

### 2.1 RPC Query Infrastructure
**New files to create:**
- `user-ui/src/utils/queries.ts` - Reusable query functions
- `user-ui/src/hooks/useBalances.ts` - Balance fetching hook
- `user-ui/src/hooks/useTransactionHistory.ts` - Transaction history hook
- `user-ui/src/hooks/usePendingPayouts.ts` - Pending payout queries

**Query functions needed:**
```typescript
// Get token balance for a wallet
async function getTokenBalance(
  address: Address,
  mint: Address,
  rpc: Rpc
): Promise<bigint>

// Get transaction history for wallet
async function getTransactionHistory(
  address: Address,
  rpc: Rpc,
  limit: number = 50
): Promise<Transaction[]>

// Get pending payout amount
async function getPendingPayout(
  address: Address,
  instanceAddress: Address,
  rpc: Rpc
): Promise<bigint>

// Get admin/treasury balance
async function getTreasuryBalance(
  adminAddress: Address,
  mint: Address,
  rpc: Rpc
): Promise<bigint>
```

### 2.2 WebSocket Streaming Integration
**Files to create:**
- `user-ui/src/hooks/useActivityFeed.ts` - Real-time transaction streaming

**Implementation (following admin-ui pattern):**
```typescript
const CONTRA_WS_URL = import.meta.env.VITE_CONTRA_WS_URL;

// WebSocket connection with exponential backoff
const ws = new WebSocket(CONTRA_WS_URL);
ws.onmessage = (event) => {
  const transaction = JSON.parse(event.data);
  // Update activity feed
  addTransaction(transaction);

  // If transaction involves current user, update balance
  if (isUserTransaction(transaction, currentUser.address)) {
    refetchBalance();
  }
};

// Reconnection logic with backoff: 500ms → 1s → 2s → ... → 30s max
```

**Backoff constants:**
- Initial: 500ms
- Max: 30,000ms
- Multiplier: 2x on each retry

### 2.3 Update useUsers Hook
**Files to modify:**
- `user-ui/src/hooks/useUsers.ts` - Replace all mocked data sources

**Major changes:**
1. Remove `generateUsers()` - fetch real user list
2. Remove fake balance generation - query actual balances
3. Remove fake transaction generation - fetch from blockchain
4. Remove localStorage for balances - derive from on-chain state
5. Keep localStorage only for: selected user, payout mode preferences

**New data flow:**
```typescript
// On mount:
1. Load user keypairs from secure storage
2. Query balances for all users in parallel
3. Fetch pending payouts from escrow contract
4. Subscribe to WebSocket for real-time updates
5. Poll balances every 10 seconds for missed updates

// On user action:
1. Optimistically update UI
2. Submit transaction
3. Poll for confirmation
4. Revert on failure or update on success
```

### 2.4 Contract State Queries
**New files needed:**
- `user-ui/src/utils/contractState.ts` - Escrow contract queries

**Implementation notes:**
- Use Codama-generated code from `@contra-escrow` if available
- Query escrow state for pending payouts
- Query instance configuration
- Use modern `getAccountInfo` with proper decoding

**Data availability check:**
If any required data is NOT available from Contra:
- [ ] User pending payout amounts per wallet
- [ ] Treasury total balance
- [ ] Escrow contract state
- [ ] Transaction history with proper typing

**Action:** Document missing data and pause implementation until endpoints/contracts are updated.

### 2.5 Network Visualization Updates
**Files to modify:**
- `user-ui/src/components/NetworkView.tsx` - Use real transaction stream

**Changes:**
1. Subscribe to WebSocket transaction feed
2. Filter transactions relevant to current instance
3. Animate real transactions (not mocked)
4. Update node sizes based on real balances
5. Show actual wallet addresses on hover

---

## Phase 3: Onchain Transaction Execution

**Goal:** Replace simulated transactions with real blockchain transactions using modern Solana tools.

### 3.1 Transaction Building Infrastructure
**New files to create:**
- `user-ui/src/utils/transactions.ts` - Transaction builders

**Transaction types needed:**
```typescript
// User collects pending earnings
async function buildCollectEarningsTransaction(
  userSigner: TransactionSigner,
  instance: Address,
  amount: bigint
): Promise<TransactionMessage>

// Admin pays out to user
async function buildPayoutTransaction(
  adminSigner: TransactionSigner,
  userAddress: Address,
  amount: bigint,
  instance: Address
): Promise<TransactionMessage>

// Admin pays all pending
async function buildPayAllTransaction(
  adminSigner: TransactionSigner,
  users: Array<{ address: Address; amount: bigint }>,
  instance: Address
): Promise<TransactionMessage>
```

**Use @solana/kit pipe pattern:**
```typescript
import { pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, ... } from '@solana/kit';

const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  (m) => appendTransactionMessageInstruction(instruction, m)
);
```

### 3.2 Transaction Signing & Submission
**Files to modify:**
- `user-ui/src/hooks/useUsers.ts` - Update action handlers

**Implementation for user actions:**
```typescript
const collectEarnings = async () => {
  try {
    // 1. Build transaction
    setLoading(true);
    const tx = await buildCollectEarningsTransaction(userSigner, instance, pendingAmount);

    // 2. Sign and send
    assertIsTransactionMessageWithSingleSendingSigner(tx);
    const signatureBytes = await signAndSendTransactionMessageWithSigners(tx);
    const signature = getBase58Decoder().decode(signatureBytes);

    // 3. Optimistically update UI
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, balance: u.balance + pendingAmount, pending: 0 } : u
    ));

    // 4. Wait for confirmation
    await pollForConfirmation(signature, contraReadRpc);

    // 5. Refetch actual balance to ensure correctness
    const actualBalance = await getTokenBalance(userAddress, mintAddress, contraReadRpc);
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, balance: actualBalance } : u
    ));

    // 6. Show success notification
    showNotification('Earnings collected!');

  } catch (error) {
    // 7. Revert optimistic update on failure
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, balance: u.balance - pendingAmount, pending: pendingAmount } : u
    ));
    showError('Failed to collect earnings');
  } finally {
    setLoading(false);
  }
};
```

### 3.3 Admin Transaction Handlers
**Files to modify:**
- `user-ui/src/components/AdminDashboard.tsx` - Wire up real transactions

**Implementation:**
1. Get admin signer from wallet context
2. Build payout transaction(s)
3. Show confirmation modal before sending
4. Submit and show loading state
5. Update UI on confirmation
6. Handle errors gracefully

**Batch payout strategy:**
- Option A: Multiple transactions in sequence
- Option B: Single transaction with multiple instructions (if supported by escrow)
- Recommended: Option A with progress indicator

### 3.4 Transaction Confirmation & Polling
**New files to create:**
- `user-ui/src/utils/confirmation.ts` - Confirmation helpers

**Implementation:**
```typescript
async function pollForConfirmation(
  signature: string,
  rpc: Rpc,
  maxPolls: number = 30,
  interval: number = 1000
): Promise<boolean> {
  for (let i = 0; i < maxPolls; i++) {
    const status = await rpc.getSignatureStatuses([signature]).send();
    if (status.value[0]?.confirmationStatus === 'confirmed') {
      return true;
    }
    await sleep(interval);
  }
  return false;
}
```

### 3.5 Error Handling & User Feedback
**Files to create:**
- `user-ui/src/hooks/useNotifications.ts` - Toast notifications

**Error scenarios to handle:**
1. Insufficient balance for fees
2. Wallet not connected
3. Transaction timeout
4. Network errors
5. Signature declined by user
6. Invalid escrow state

**UI feedback:**
- Loading spinners during transaction
- Success toast with transaction link
- Error toast with actionable message
- Disable buttons during pending transactions
- Show estimated fees before confirmation

---

## Implementation Dependencies & Order

### Phase 1 Dependencies:
- External: None
- Internal: Must complete 1.1 → 1.2 → 1.3 → 1.4 → 1.5 sequentially

### Phase 2 Dependencies:
- Requires: Phase 1 complete (wallet infrastructure)
- Requires: Contra RPC endpoints accessible
- Requires: WebSocket endpoint accessible
- Blockers: Missing contract state APIs (TBD)

### Phase 3 Dependencies:
- Requires: Phase 1 complete (wallet signing)
- Requires: Phase 2 complete (data fetching for transaction validation)
- Requires: Escrow program deployed with instruction builders available
- Blockers: Instruction builders from `@contra-escrow` package (TBD)

---

## Data Availability Checklist

**Before proceeding with Phase 2, verify these are available:**

- [ ] **RPC Endpoints:**
  - [ ] Read endpoint returns valid responses
  - [ ] Write endpoint accepts transactions
  - [ ] Both accessible from user-ui (CORS configured)

- [ ] **WebSocket Endpoint:**
  - [ ] Streams transactions in real-time
  - [ ] Message format documented
  - [ ] Reconnection supported

- [ ] **On-chain Programs:**
  - [ ] Escrow program address known
  - [ ] Token mint address for USDA known
  - [ ] Instance address for this deployment known

- [ ] **Query Capabilities:**
  - [ ] Can query token balances via `getTokenAccountsByOwner`
  - [ ] Can query pending payouts (contract state)
  - [ ] Can query transaction history (signatures or indexer)
  - [ ] Can query treasury balance

- [ ] **Transaction Capabilities:**
  - [ ] Instruction builders available from `@contra-escrow`
  - [ ] Collect earnings instruction defined
  - [ ] Payout instruction defined
  - [ ] Transaction fees reasonable

**If ANY item is unavailable, STOP and document what's missing.**

---

## Risk Mitigation

### Security Risks:
1. **Keypair storage in browser** → Use sessionStorage, show warnings, never production keys
2. **Admin wallet exposure** → Environment variable only, never commit, validate on load
3. **Transaction replay** → Use recent blockhashes, validate nonces
4. **Insufficient validation** → Check balances before TX, validate all inputs

### Performance Risks:
1. **Too many RPC calls** → Batch queries, cache with TTL, debounce updates
2. **WebSocket reconnection storms** → Exponential backoff, max retry limit
3. **Large transaction history** → Paginate, limit to recent 50-100
4. **Network visualization lag** → Throttle animations, limit visible transactions

### UX Risks:
1. **Long confirmation times** → Show progress, set expectations (15-30s)
2. **Failed transactions** → Clear error messages, retry options
3. **Balance sync delays** → Optimistic updates with rollback
4. **Wallet connection flow** → Graceful fallback, clear instructions

---

## Testing Strategy

### Phase 1 Testing:
- [ ] Environment variables load correctly
- [ ] RPC clients initialize without errors
- [ ] Admin wallet parses correctly (both formats)
- [ ] User keypairs generate valid addresses
- [ ] Keypairs persist in secure storage
- [ ] Wallet UI displays real addresses

### Phase 2 Testing:
- [ ] Balance queries return correct values
- [ ] Transaction history fetches without errors
- [ ] WebSocket connects and receives messages
- [ ] WebSocket reconnects after disconnect
- [ ] Pending payouts query correctly
- [ ] Data updates reflect in UI immediately

### Phase 3 Testing:
- [ ] Transactions build without errors
- [ ] Signatures verify correctly
- [ ] Transactions submit successfully
- [ ] Confirmations detected within timeout
- [ ] Balances update after confirmation
- [ ] Errors display helpful messages
- [ ] Optimistic updates rollback on failure

---

## Success Criteria

**Phase 1 Complete When:**
- ✅ All dependencies installed
- ✅ Admin wallet configurable via .env
- ✅ User wallets generated with real keypairs
- ✅ Wallet addresses displayed in UI
- ✅ No fake public keys remain

**Phase 2 Complete When:**
- ✅ All balances from RPC, not mocked
- ✅ All transactions from blockchain, not generated
- ✅ Pending payouts from contract state
- ✅ WebSocket streaming live transactions
- ✅ Network view shows real data
- ✅ No localStorage for blockchain data

**Phase 3 Complete When:**
- ✅ Users can collect earnings on-chain
- ✅ Admin can execute payouts on-chain
- ✅ All transactions confirm successfully
- ✅ Errors handled gracefully
- ✅ UI updates reflect blockchain state
- ✅ No simulated transactions remain

---

## Key Patterns from admin-ui and demo-ui

### Wallet Management:
- Wallet Adapter + Wallet Standard bridge for signing
- `useWallet()` → `useWalletStandardAccount()` → `useWalletAccountTransactionSendingSigner()`

### RPC Integration:
- Dual endpoints (read/write separation)
- URL normalization for dev/prod proxy
- Vite proxy configuration to avoid CORS

### WebSocket:
- Exponential backoff reconnection (500ms → 30s)
- Cleanup on unmount
- Parse JSON messages with error handling

### Transaction Building:
- @solana/kit pipe pattern
- Always set fee payer and lifetime
- Assert single sending signer before send

### State Management:
- useRef for mutable, long-lived state (keypairs)
- useState for UI state (balances, loading)
- Optimistic updates with rollback

---

## Next Steps

1. **Review this master plan** - Confirm approach and priorities ✅
2. **Identify data gaps** - Check what's available from Contra
3. **Create Phase 1 detailed plan** - Break down into specific tasks
4. **Execute Phase 1** - Implement wallet infrastructure
5. **Create Phase 2 detailed plan** - After Phase 1 validation
6. **Execute Phase 2** - Implement data fetching
7. **Create Phase 3 detailed plan** - After Phase 2 validation
8. **Execute Phase 3** - Implement transactions
9. **Integration testing** - End-to-end validation
10. **Production deployment** - With proper monitoring

---

## References

**Codebase Patterns:**
- Admin UI: `/Users/ilan/Code/contra/admin-ui/`
- Demo UI: `/Users/ilan/Code/contra/demo-ui/`
- User UI: `/Users/ilan/Code/contra/user-ui/`

**Key Files to Reference:**
- `admin-ui/src/utils/contraRpc.ts` - RPC setup pattern
- `admin-ui/src/hooks/useActivityFeed.ts` - WebSocket pattern
- `admin-ui/src/components/AdminFunctions.tsx` - Transaction building
- `demo-ui/src/hooks/useLoadTest.ts` - Wallet generation & balance tracking
- `demo-ui/src/utils/solana.ts` - Transaction builders

**Documentation:**
- Solana Web3.js v2: https://solana-labs.github.io/solana-web3.js/
- @solana/kit: Modern transaction building
- Wallet Standard: https://github.com/wallet-standard/wallet-standard
