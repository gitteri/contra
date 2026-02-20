# Phase 3: Transaction Execution on Contra

## Overview
Phase 3 focuses on making real transactions happen on Contra. This includes:
1. **Payout transactions**: Admin wallet sending tokens to users on Contra (SPL token transfers)
2. **Withdrawal transactions**: Users withdrawing tokens from Contra to Solana mainnet

## Prerequisites
- Phase 1 complete: Real wallet infrastructure in place
- Phase 2 complete: Real balance data being fetched
- Admin wallet has private key stored in sessionStorage
- User wallets have private keys stored in sessionStorage
- Contra RPC endpoints configured

## Phase 3 Architecture

### Transaction Flow
```
User Action (UI)
    ↓
Transaction Builder (utils/transactions.ts)
    ↓
Sign Transaction (wallet signer)
    ↓
Send to Contra Write RPC
    ↓
Confirm Transaction
    ↓
Update UI + Refetch Balances
```

### Key Dependencies to Add
Based on admin-ui patterns:
- `@solana-program/system` - System program utilities
- Already have: `@solana-program/token` - Token program utilities (added in Phase 2)
- `@solana/react` - React hooks for wallet integration
- Contra program clients (via path alias)

---

## Task Breakdown

### Task 3.1: Add Dependencies and Configuration

#### Install packages:
```bash
pnpm add @solana-program/system @solana/react
```

#### Configure Contra program client paths in vite.config.ts:
```typescript
resolve: {
  alias: {
    '@contra-withdraw': path.resolve(__dirname, '../contra-withdraw-program/clients/typescript/src/generated'),
    '@contra-escrow': path.resolve(__dirname, '../contra-escrow-program/clients/typescript/src/generated'),
  }
}
```

#### Update tsconfig.app.json with path mappings:
```json
{
  "compilerOptions": {
    "paths": {
      "@contra-withdraw": ["../contra-withdraw-program/clients/typescript/src/generated"],
      "@contra-escrow": ["../contra-escrow-program/clients/typescript/src/generated"]
    }
  }
}
```

---

### Task 3.2: Create Transaction Utilities

Create `src/utils/transactions.ts` with helper functions:

#### 3.2.1: Build Payout Transaction
```typescript
/**
 * Build a payout transaction (admin sends tokens to user on Contra)
 * This is a standard SPL token transfer on the Contra network
 */
export async function buildPayoutTransaction(
  from: TransactionSigner,
  to: Address,
  amount: bigint,
  mintAddress: Address,
  rpc: Rpc<any>
): Promise<TransactionMessage> {
  // 1. Find source ATA (admin's token account)
  const [sourceAta] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: from.address,
    tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
  });

  // 2. Find destination ATA (user's token account)
  const [destinationAta] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: to,
    tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
  });

  // 3. Check if destination ATA exists
  const destinationAtaInfo = await rpc
    .getAccountInfo(destinationAta, { encoding: 'base64' })
    .send();

  // 4. Get recent blockhash
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();

  // 5. Build transaction message
  const instructions = [];

  // Create ATA if it doesn't exist
  if (!destinationAtaInfo.value) {
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: from,
        ata: destinationAta,
        owner: to,
        mint: mintAddress,
      })
    );
  }

  // Add transfer instruction
  instructions.push(
    getTransferInstruction({
      source: sourceAta,
      destination: destinationAta,
      authority: from,
      amount,
    })
  );

  // Build transaction using pipe pattern
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => instructions.reduce(
      (msg, ix) => appendTransactionMessageInstruction(ix, msg),
      m
    )
  );
}
```

#### 3.2.2: Send and Confirm Transaction
```typescript
/**
 * Send transaction to Contra and confirm
 */
export async function sendAndConfirmTransaction(
  transactionMessage: TransactionMessage,
  rpc: Rpc<any>
): Promise<string> {
  // Assert single sending signer
  assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

  // Sign and send
  const signatureBytes = await signAndSendTransactionMessageWithSigners(
    transactionMessage
  );

  // Convert to base58
  const signature = getBase58Decoder().decode(signatureBytes);

  // Wait for confirmation (Contra should be fast)
  await waitForConfirmation(signature, rpc);

  return signature;
}

/**
 * Wait for transaction confirmation
 */
async function waitForConfirmation(
  signature: string,
  rpc: Rpc<any>,
  maxAttempts: number = 30
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await (rpc as any)
        .getSignatureStatuses([signature])
        .send();

      if (status.value[0]?.confirmationStatus === 'confirmed' ||
          status.value[0]?.confirmationStatus === 'finalized') {
        return;
      }

      if (status.value[0]?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value[0].err)}`);
      }
    } catch (error) {
      console.warn(`Confirmation attempt ${i + 1} failed:`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Transaction confirmation timeout');
}
```

---

### Task 3.3: Create Admin Wallet Signer Hook

Create `src/hooks/useAdminSigner.ts`:

```typescript
import { useMemo } from 'react';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import type { TransactionSigner } from '@solana/signers';

const ADMIN_WALLET_STORAGE_KEY = 'contra:admin-wallet';

/**
 * Get admin wallet signer for transaction signing
 *
 * The admin wallet is loaded/generated on app initialization and stored in sessionStorage.
 * This hook retrieves it for transaction signing.
 */
export function useAdminSigner(): TransactionSigner | null {
  return useMemo(() => {
    // Load admin wallet from sessionStorage
    const storedKey = sessionStorage.getItem(ADMIN_WALLET_STORAGE_KEY);
    if (!storedKey) {
      console.warn('Admin wallet not found in sessionStorage - was it initialized?');
      return null;
    }

    try {
      const keyBytes = Uint8Array.from(JSON.parse(storedKey));
      return createKeyPairSignerFromBytes(keyBytes);
    } catch (error) {
      console.error('Failed to create admin signer:', error);
      return null;
    }
  }, []);
}
```

**Note**: The admin wallet is automatically loaded/generated during app initialization in `useUsers`. It checks:
1. SessionStorage for existing wallet (persists during session)
2. `VITE_ADMIN_PRIVATE_KEY` env var if you want a consistent wallet
3. Generates a new temporary wallet if neither exists

To use a consistent admin wallet across sessions, add to `.env`:
```env
VITE_ADMIN_PRIVATE_KEY=[1,2,3,...,64]  # 64-byte keypair
```

⚠️ **Demo only** - never commit private keys to git!

---

### Task 3.4: Update useUsers Hook with Payout Logic

Update `src/hooks/useUsers.ts`:

#### 3.4.1: Import transaction utilities
```typescript
import { useAdminSigner } from './useAdminSigner';
import { buildPayoutTransaction, sendAndConfirmTransaction } from '../utils/transactions';
import { address } from '@solana/addresses';
import { useSolana } from '../context/SolanaContext';
```

#### 3.4.2: Add admin signer
```typescript
const adminSigner = useAdminSigner();
```

#### 3.4.3: Update payOutUser function
Replace the mock implementation with real transaction:

```typescript
const payOutUser = useCallback(async (userId: string) => {
  const user = users.find(u => u.id === userId);
  if (!user) return;

  const pendingAmount = adminState.pendingPayouts[userId] ?? 0;
  if (pendingAmount <= 0) return;

  if (!adminSigner) {
    console.error('Admin signer not available');
    return;
  }

  try {
    // Set loading state
    setPayoutInProgress(userId);

    // Convert to lamports
    const amountLamports = toLamports(pendingAmount);

    // Build transaction
    const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);
    const userAddr = address(user.wallet.publicKey);

    const transactionMessage = await buildPayoutTransaction(
      adminSigner,
      userAddr,
      amountLamports,
      mintAddr,
      rpc
    );

    // Send and confirm
    const signature = await sendAndConfirmTransaction(transactionMessage, rpc);

    console.log('Payout successful:', signature);

    // Update UI state
    setAdminState((prev) => ({
      ...prev,
      pendingPayouts: { ...prev.pendingPayouts, [userId]: 0 },
    }));

    // Add transaction to user's history
    const tx: Transaction = {
      id: signature,
      type: 'earning',
      amount: pendingAmount,
      timestamp: Date.now(),
      from: 'admin',
    };

    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        return {
          ...u,
          transactions: [tx, ...u.transactions].slice(0, 50),
        };
      })
    );

    // Fire animation
    firePayoutAnimation(userId, pendingAmount);

    // Refetch balances after transaction
    setTimeout(() => refetchBalances(), 1000);
  } catch (error) {
    console.error('Payout failed:', error);
    setPayoutError(userId, error);
  } finally {
    clearPayoutInProgress(userId);
  }
}, [users, adminState, adminSigner, rpc, refetchBalances]);
```

#### 3.4.4: Update payOutAll function
Similar pattern, execute payouts sequentially or in batches:

```typescript
const payOutAll = useCallback(async () => {
  const usersToPay = users.filter(u => {
    const pending = adminState.pendingPayouts[u.id] ?? 0;
    return pending > 0;
  });

  if (usersToPay.length === 0) return;

  if (!adminSigner) {
    console.error('Admin signer not available');
    return;
  }

  // Execute payouts sequentially to avoid nonce issues
  for (const user of usersToPay) {
    await payOutUser(user.id);
  }
}, [users, adminState, adminSigner, payOutUser]);
```

#### 3.4.5: Update Live Transactions Generator for Auto Mode

The live transactions effect in `useUsers` currently creates mock transactions in auto mode.
Update it to create **real transactions** when in auto mode:

```typescript
useEffect(() => {
  if (!liveTransactionsActive) return;

  let timeout: ReturnType<typeof setTimeout>;

  async function tick() {
    const currentUsers = usersRef.current;
    if (currentUsers.length === 0) {
      timeout = setTimeout(tick, 1000);
      return;
    }

    const randomUser = currentUsers[Math.floor(Math.random() * currentUsers.length)];
    const amount = Math.round((Math.random() * 40 + 5) * 100) / 100;
    const isAuto = payoutModeRef.current === 'auto';

    // Always fire network animation
    firePayoutAnimation(randomUser.id, amount);

    if (isAuto && adminSigner) {
      // Auto mode: Execute REAL transaction
      try {
        const amountLamports = toLamports(amount);
        const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);
        const userAddr = address(randomUser.wallet.publicKey);

        // Build transaction
        const transactionMessage = await buildPayoutTransaction(
          adminSigner,
          userAddr,
          amountLamports,
          mintAddr,
          rpc
        );

        // Send and confirm in background
        sendAndConfirmTransaction(transactionMessage, rpc)
          .then((signature) => {
            console.log('Auto payout transaction confirmed:', signature);

            // Add to user's transaction history
            setUsers((prev) =>
              prev.map((u) => {
                if (u.id !== randomUser.id) return u;
                const tx: Transaction = {
                  id: signature,
                  type: 'earning',
                  amount,
                  timestamp: Date.now(),
                  from: 'marketplace',
                };
                return {
                  ...u,
                  transactions: [tx, ...u.transactions].slice(0, 50),
                };
              })
            );

            // Balances will update via polling/WebSocket
            setTimeout(() => refetchBalances(), 1000);
          })
          .catch((error) => {
            console.error('Auto payout failed:', error);
          });
      } catch (error) {
        console.error('Failed to build auto payout transaction:', error);
      }
    } else {
      // Manual mode: Accumulate pending
      setAdminState((prev) => ({
        ...prev,
        pendingPayouts: {
          ...prev.pendingPayouts,
          [randomUser.id]: (prev.pendingPayouts[randomUser.id] ?? 0) + amount,
        },
      }));
    }

    const nextDelay = 800 + Math.random() * 1200;
    timeout = setTimeout(tick, nextDelay);
  }

  const firstDelay = 400 + Math.random() * 600;
  timeout = setTimeout(tick, firstDelay);

  return () => clearTimeout(timeout);
}, [liveTransactionsActive, firePayoutAnimation, adminSigner, rpc, refetchBalances]);
```

**Key changes**:
- In auto mode, build and send real transactions
- Don't manually update balances - let polling/WebSocket handle it
- Transaction confirmation happens in background (non-blocking)
- If transaction fails, log error but don't break the generator
- Manual mode remains unchanged (accumulate pending)

---

### Task 3.5: Add Payout Loading States

Add state tracking for payout operations:

```typescript
const [payoutsInProgress, setPayoutsInProgress] = useState<Set<string>>(new Set());
const [payoutErrors, setPayoutErrors] = useState<Map<string, Error>>(new Map());

const setPayoutInProgress = (userId: string) => {
  setPayoutsInProgress(prev => new Set(prev).add(userId));
};

const clearPayoutInProgress = (userId: string) => {
  setPayoutsInProgress(prev => {
    const next = new Set(prev);
    next.delete(userId);
    return next;
  });
};

const setPayoutError = (userId: string, error: Error) => {
  setPayoutErrors(prev => new Map(prev).set(userId, error));
};
```

Return these in useUsers:
```typescript
return {
  // ... existing returns
  payoutsInProgress,
  payoutErrors,
};
```

---

### Task 3.6: Update Admin Dashboard UI

Update `src/components/AdminDashboard.tsx`:

#### 3.6.1: Add loading indicators
```typescript
const isPayingOut = payoutsInProgress.has(user.id);
const payoutError = payoutErrors.get(user.id);

<button
  className={`pay-button${!isPending || isPayingOut ? ' pay-button--disabled' : ''}`}
  onClick={() => onPayOutUser(user.id)}
  disabled={!isPending || isPayingOut}
  type="button"
>
  {isPayingOut ? 'Processing...' : 'Pay'}
</button>

{payoutError && (
  <div className="payout-error-inline">
    {payoutError.message}
  </div>
)}
```

#### 3.6.2: Add "Pay All" loading state
```typescript
const isPayingAll = Array.from(payoutsInProgress).length > 0;

<button
  className={`pay-all-button${!hasPending || isPayingAll ? ' pay-all-button--disabled' : ''}`}
  onClick={onPayOutAll}
  disabled={!hasPending || isPayingAll}
  type="button"
>
  {isPayingAll ? 'Processing...' : 'Pay All'}
</button>
```

---

### Task 3.7: Add Transaction Confirmation UI

Create `src/components/TransactionToast.tsx`:

```typescript
interface TransactionToastProps {
  signature: string;
  message: string;
  onClose: () => void;
}

export function TransactionToast({ signature, message, onClose }: TransactionToastProps) {
  const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=custom`;

  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="transaction-toast">
      <div className="transaction-toast-icon">✓</div>
      <div className="transaction-toast-content">
        <div className="transaction-toast-message">{message}</div>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transaction-toast-link"
        >
          View on Explorer
        </a>
      </div>
      <button
        className="transaction-toast-close"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
```

Add toast state management in App.tsx or useUsers:
```typescript
const [transactionToasts, setTransactionToasts] = useState<Array<{
  id: string;
  signature: string;
  message: string;
}>>([]);

const addTransactionToast = (signature: string, message: string) => {
  setTransactionToasts(prev => [...prev, {
    id: signature,
    signature,
    message,
  }]);
};

const removeTransactionToast = (id: string) => {
  setTransactionToasts(prev => prev.filter(t => t.id !== id));
};
```

---

### Task 3.8: Error Handling and Retry Logic

Add comprehensive error handling:

```typescript
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly signature?: string,
    public readonly logs?: string[]
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

export async function sendWithRetry(
  buildTx: () => Promise<TransactionMessage>,
  rpc: Rpc<any>,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const tx = await buildTx();
      return await sendAndConfirmTransaction(tx, rpc);
    } catch (error) {
      console.warn(`Transaction attempt ${i + 1} failed:`, error);
      lastError = error as Error;

      // Don't retry on certain errors
      if (error instanceof Error) {
        if (error.message.includes('insufficient funds') ||
            error.message.includes('invalid signature')) {
          throw error;
        }
      }

      // Wait before retry (exponential backoff)
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
  }

  throw new TransactionError(
    `Transaction failed after ${maxRetries} attempts: ${lastError?.message}`,
  );
}
```

---

### Task 3.9: Integration Testing Checklist

Before considering Phase 3 complete:

- [ ] Admin wallet signer loads correctly from sessionStorage
- [ ] Payout transaction builds successfully
- [ ] Transaction is signed by admin wallet
- [ ] Transaction sends to Contra write RPC
- [ ] Transaction confirms within reasonable time
- [ ] User balance updates after payout
- [ ] Admin balance decreases after payout
- [ ] Transaction appears in user's transaction history
- [ ] Network animation plays for real transaction
- [ ] Loading states show during transaction processing
- [ ] Error states display for failed transactions
- [ ] Transaction signature can be viewed on explorer
- [ ] "Pay All" executes multiple payouts correctly
- [ ] Nonce issues don't occur with sequential payouts
- [ ] WebSocket updates trigger after transaction confirms

---

## Task 3.10: Documentation

Update PHASE_3_COMPLETION_SUMMARY.md with:
- Transaction flow diagram
- Error handling strategies
- Known limitations
- Next steps for Phase 4

---

## Dependencies Summary

### New packages to install:
```json
{
  "@solana-program/system": "^0.10.0",
  "@solana/react": "^5.0.0"
}
```

### Path aliases to configure:
```json
{
  "@contra-withdraw": "../contra-withdraw-program/clients/typescript/src/generated",
  "@contra-escrow": "../contra-escrow-program/clients/typescript/src/generated"
}
```

---

## Key Patterns from admin-ui

### Transaction Building Pattern:
```typescript
const tx = pipe(
  createTransactionMessage({ version: 'legacy' }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) => appendTransactionMessageInstruction(instruction1, m),
  (m) => appendTransactionMessageInstruction(instruction2, m)
);
```

### Signing and Sending Pattern:
```typescript
assertIsTransactionMessageWithSingleSendingSigner(tx);
const signatureBytes = await signAndSendTransactionMessageWithSigners(tx);
const signature = getBase58Decoder().decode(signatureBytes);
```

### ATA Handling Pattern:
```typescript
// Find ATA
const [ata] = await findAssociatedTokenPda({
  mint: mintAddress,
  owner: walletAddress,
  tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
});

// Check if exists
const ataInfo = await rpc.getAccountInfo(ata).send();

// Create if needed
if (!ataInfo.value) {
  const createIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: signer,
    ata,
    owner: walletAddress,
    mint: mintAddress,
  });
  // Add to transaction
}
```

---

## Phase 3 Success Criteria

Phase 3 is complete when:
1. ✅ Admin can send real payout transactions to users on Contra
2. ✅ Transactions confirm successfully
3. ✅ Balances update correctly after transactions
4. ✅ UI shows loading states during transactions
5. ✅ UI shows error states for failed transactions
6. ✅ Transaction signatures are logged and viewable
7. ✅ Multiple payouts can execute without errors
8. ✅ Network animation syncs with real transactions

---

## Notes

- **Admin Key Security**: The demo stores admin private key in sessionStorage. This is ONLY for demo purposes. Production would use proper key management.
- **Transaction Confirmation**: Contra should have fast confirmation times. We poll for ~15 seconds max.
- **Nonce Management**: Execute payouts sequentially to avoid nonce collisions. Consider parallel execution with proper nonce handling in future.
- **Error Recovery**: Failed transactions should not break the UI. User should be able to retry.
- **Balance Refresh**: After transaction confirms, trigger balance refetch to show updated amounts.

---

## Withdrawal Transactions (Future)

Phase 3 focuses on payouts first. Withdrawals (Contra → Mainnet) will be added after payouts are working:

1. Use `getWithdrawFundsInstructionAsync` from `@contra-withdraw`
2. Similar transaction building pattern
3. Withdraw from escrow instance to destination on mainnet
4. Requires understanding escrow program structure

This will be implemented as Task 3.11+ after payout transactions are stable.
