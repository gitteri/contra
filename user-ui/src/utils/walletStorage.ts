import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/signers';
import type { Address } from '@solana/addresses';

const STORAGE_KEY = 'contra:user-wallets';
const STORAGE_TYPE: 'sessionStorage' | 'localStorage' = 'sessionStorage'; // Clear on tab close

export interface StoredWallet {
  id: string;
  address: string;
  privateKeyBytes: number[]; // 64-byte Ed25519 keypair (private + public)
}

/**
 * Generate Ed25519 keypair bytes using Web Crypto with extractable keys
 * Returns 64 bytes: [private_key_seed_32_bytes, public_key_32_bytes]
 */
async function generateExtractableKeypairBytes(): Promise<Uint8Array> {
  // Generate Ed25519 keypair with extractable private key
  const keypair = await crypto.subtle.generateKey(
    {
      name: 'Ed25519',
    },
    true, // extractable = true!
    ['sign', 'verify']
  );

  // Export private key in PKCS#8 format
  const privateKeyData = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
  const pkcs8 = new Uint8Array(privateKeyData);

  // Extract the 32-byte seed from PKCS#8 (starts at byte 16)
  const seed = pkcs8.slice(16, 48);

  // Export public key in raw format (32 bytes)
  const publicKeyData = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const publicKey = new Uint8Array(publicKeyData);

  // Combine into 64-byte Solana format
  const combined = new Uint8Array(64);
  combined.set(seed, 0);
  combined.set(publicKey, 32);

  return combined;
}

/**
 * Generate a new user wallet and persist it
 */
export async function generateUserWallet(userId: string): Promise<{ address: Address; signer: KeyPairSigner }> {
  try {
    // Generate 64-byte keypair (seed + public key)
    const privateKeyBytes = await generateExtractableKeypairBytes();

    // Create signer from those bytes
    const signer = await createKeyPairSignerFromBytes(privateKeyBytes);

    // Store the keypair bytes
    await saveWallet(userId, signer.address, privateKeyBytes);

    return {
      address: signer.address,
      signer,
    };
  } catch (error) {
    console.error(`Failed to generate wallet for ${userId}:`, error);
    throw error;
  }
}

/**
 * Save wallet with private key to storage
 */
async function saveWallet(userId: string, address: Address, privateKeyBytes: Uint8Array): Promise<void> {
  const wallets = loadWalletsFromStorage();

  const storedWallet: StoredWallet = {
    id: userId,
    address: address,
    privateKeyBytes: Array.from(privateKeyBytes),
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
 * Load wallet signer for a user from storage
 */
export async function loadUserWallet(userId: string): Promise<KeyPairSigner | null> {
  const wallets = loadWalletsFromStorage();
  const stored = wallets.find(w => w.id === userId);

  if (!stored || !stored.privateKeyBytes) {
    return null;
  }

  try {
    // Recreate signer from stored private key bytes
    const privateKeyBytes = new Uint8Array(stored.privateKeyBytes);
    const signer = await createKeyPairSignerFromBytes(privateKeyBytes);
    return signer;
  } catch (error) {
    console.error('Failed to restore wallet signer:', error);
    return null;
  }
}

/**
 * Load wallet address for a user
 */
export function loadUserWalletAddress(userId: string): string | null {
  const wallets = loadWalletsFromStorage();
  const stored = wallets.find(w => w.id === userId);
  return stored?.address || null;
}

/**
 * Load all wallet signers from storage
 */
export async function loadAllWallets(): Promise<Map<string, KeyPairSigner>> {
  const wallets = loadWalletsFromStorage();
  const signers = new Map<string, KeyPairSigner>();

  for (const stored of wallets) {
    if (stored.privateKeyBytes) {
      try {
        const privateKeyBytes = new Uint8Array(stored.privateKeyBytes);
        const signer = await createKeyPairSignerFromBytes(privateKeyBytes);
        signers.set(stored.id, signer);
      } catch (error) {
        console.error(`Failed to restore wallet for ${stored.id}:`, error);
      }
    }
  }

  return signers;
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

/**
 * Check if wallets are stored
 */
export function hasStoredWallets(): boolean {
  const wallets = loadWalletsFromStorage();
  return wallets.length > 0;
}
