# Admin Wallet Setup for Phase 3

## Problem
Phase 3 requires the admin wallet to sign transactions (payout transfers to users). We only had the admin's public key from `.env`, but needed the private key to sign transactions.

## Solution
Updated `src/utils/adminWallet.ts` to support three modes:

### Mode 1: Temporary Wallet (Default)
- **What**: Generates a new admin wallet on each browser session
- **When**: No `VITE_ADMIN_PRIVATE_KEY` provided in `.env`
- **Pros**: Works out of the box, no setup needed
- **Cons**: Admin address changes on each refresh/session
- **Storage**: sessionStorage (cleared when tab closes)

### Mode 2: Persistent Wallet (Optional)
- **What**: Uses a consistent admin wallet from environment variable
- **When**: `VITE_ADMIN_PRIVATE_KEY` provided in `.env`
- **Pros**: Same admin wallet across sessions
- **Cons**: Requires generating and storing private key
- **Storage**: sessionStorage (loaded from env on each session)

### Mode 3: Session Wallet (Automatic)
- **What**: Reuses wallet from current session if available
- **When**: Admin wallet was already generated/loaded in this session
- **Pros**: Efficient, doesn't regenerate unnecessarily
- **Storage**: sessionStorage

## Implementation Details

### Updated Functions

#### `loadOrGenerateAdminWallet()`
New async function that:
1. Checks sessionStorage for existing admin wallet
2. Checks `VITE_ADMIN_PRIVATE_KEY` env var
3. Generates new wallet if neither exists
4. Returns `KeyPairSigner` ready for transaction signing

#### `getAdminAddress()`
Updated to:
- Return cached address if available
- Extract address from sessionStorage wallet
- Fall back to `VITE_ADMIN_WALLET` public key (if provided)

### Initialization Flow

In `src/hooks/useUsers.ts`:
```typescript
useEffect(() => {
  async function initialize() {
    // Load or generate admin wallet
    const adminSigner = await loadOrGenerateAdminWallet();
    const adminAddress = adminSigner.address;

    // ... rest of initialization
  }
  initialize();
}, []);
```

### Usage in Phase 3

The `useAdminSigner()` hook (to be created) will:
```typescript
export function useAdminSigner(): TransactionSigner | null {
  const storedKey = sessionStorage.getItem('contra:admin-wallet');
  if (!storedKey) return null;

  const keyBytes = Uint8Array.from(JSON.parse(storedKey));
  return createKeyPairSignerFromBytes(keyBytes);
}
```

## Security Considerations

⚠️ **This is for DEMO purposes only!**

- Private keys stored in sessionStorage (cleared on tab close)
- If using `VITE_ADMIN_PRIVATE_KEY`, never commit to git
- Production systems should use:
  - Hardware wallets
  - Key management services (AWS KMS, etc.)
  - Multi-sig wallets
  - Proper key rotation

## Setting Up a Persistent Admin Wallet (Optional)

### Method 1: Using Solana CLI (Recommended)

Generate a new keypair:
```bash
solana-keygen new --outfile ~/.config/solana/contra-admin.json
```

Copy the private key (it's in base58 format):
```bash
# The private key is the full 64-byte keypair in base58
cat ~/.config/solana/contra-admin.json
# Output: [1,2,3,...,64]  (this is the byte array format)

# Or use solana-keygen to get base58:
solana-keygen pubkey ~/.config/solana/contra-admin.json
# Then copy the private key manually from the JSON file
```

**Option A: Base58 format (easiest)**
Add to `.env`:
```env
VITE_ADMIN_PRIVATE_KEY=5Kd7NdwW8ZMqJk...  # 87-88 character base58 string
```

**Option B: JSON byte array format**
Add to `.env`:
```env
VITE_ADMIN_PRIVATE_KEY=[1,2,3,4,5,...,64]  # Copy from the JSON file
```

### Method 2: Export from Phantom Wallet

1. Open Phantom wallet
2. Settings → Export Private Key
3. Copy the base58 string
4. Add to `.env`:
```env
VITE_ADMIN_PRIVATE_KEY=5Kd7NdwW8ZMqJk...
```

### Method 3: Generate in Browser Console

```typescript
// Run this in browser console on the demo site
const keypair = await crypto.subtle.generateKey(
  { name: 'Ed25519' },
  true,
  ['sign', 'verify']
);

const privateKeyData = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
const pkcs8 = new Uint8Array(privateKeyData);
const seed = pkcs8.slice(16, 48);

const publicKeyData = await crypto.subtle.exportKey('raw', keypair.publicKey);
const publicKey = new Uint8Array(publicKeyData);

const combined = new Uint8Array(64);
combined.set(seed, 0);
combined.set(publicKey, 32);

console.log('Private key (JSON array):', JSON.stringify(Array.from(combined)));
```

Add to `.env`:
```env
VITE_ADMIN_PRIVATE_KEY=[1,2,3,...,64]
```

### Funding the Wallet

After setting up the admin wallet:
1. Start the app and check console logs for admin address
2. Send USDA tokens to that address on Contra
3. Verify balance appears in the UI

## Troubleshooting

### "Admin wallet not found in sessionStorage"
- App hasn't initialized yet
- Check browser console for initialization errors
- Hard refresh the page (Cmd+Shift+R)

### "Admin wallet is temporary - will change on session refresh"
- This is expected when not using `VITE_ADMIN_PRIVATE_KEY`
- Add env var if you need a consistent wallet

### "Failed to create admin signer"
- Check that `VITE_ADMIN_PRIVATE_KEY` is valid JSON array
- Verify it's exactly 64 bytes
- Check browser console for detailed error

## Files Modified

- ✅ `src/utils/adminWallet.ts` - Added wallet loading/generation
- ✅ `src/hooks/useUsers.ts` - Initialize admin wallet on mount
- ✅ `.env.example` - Documented `VITE_ADMIN_PRIVATE_KEY`
- ✅ `PHASE_3_DETAILED_PLAN.md` - Updated Task 3.3 with correct approach

## What's Next

With admin wallet setup complete, Phase 3 can proceed:
1. ✅ Admin wallet loads/generates automatically
2. ⏳ Create `useAdminSigner()` hook
3. ⏳ Build payout transactions
4. ⏳ Sign and send to Contra
5. ⏳ Confirm and update UI
