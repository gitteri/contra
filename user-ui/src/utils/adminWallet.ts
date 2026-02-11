import { address, type Address } from '@solana/addresses';
import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/signers';
import { getBase58Encoder, getBase58Decoder } from '@solana/codecs-strings';

/**
 * Admin wallet configuration
 * Supports loading from env var or generating fresh wallet
 */

const ADMIN_WALLET_STORAGE_KEY = 'contra:admin-wallet';

let adminAddressCache: Address | null = null;

/**
 * Generate Ed25519 keypair bytes using Web Crypto with extractable keys
 * Returns 64 bytes: [private_key_seed_32_bytes, public_key_32_bytes]
 */
async function generateExtractableKeypairBytes(): Promise<Uint8Array> {
  const keypair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true, // extractable
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
 * Load or generate admin wallet
 * Priority:
 * 1. Check sessionStorage for existing admin wallet
 * 2. Check VITE_ADMIN_PRIVATE_KEY env var
 * 3. Generate new wallet and store in sessionStorage
 */
export async function loadOrGenerateAdminWallet(): Promise<KeyPairSigner> {
  // Check sessionStorage first
  const stored = sessionStorage.getItem(ADMIN_WALLET_STORAGE_KEY);
  if (stored) {
    try {
      const privateKeyBytes = Uint8Array.from(JSON.parse(stored));
      const signer = await createKeyPairSignerFromBytes(privateKeyBytes);
      console.log('Admin wallet loaded from sessionStorage:', signer.address);
      adminAddressCache = signer.address;
      return signer;
    } catch (error) {
      console.warn('Failed to load admin wallet from storage:', error);
    }
  }

  // Check env var for private key
  const envPrivateKey = import.meta.env.VITE_ADMIN_PRIVATE_KEY;
  if (envPrivateKey) {
    try {
      let privateKeyBytes: Uint8Array;

      // Try base58 format first (most common - from Phantom or solana-keygen)
      if (!envPrivateKey.startsWith('[')) {
        try {
          const encoded = getBase58Encoder().encode(envPrivateKey);
          privateKeyBytes = new Uint8Array(encoded);
          console.log('Decoded base58 private key');
        } catch {
          throw new Error('Invalid base58 private key format');
        }
      } else {
        // Parse as JSON byte array (from solana-keygen new --outfile)
        privateKeyBytes = Uint8Array.from(JSON.parse(envPrivateKey));
        console.log('Parsed JSON byte array private key');
      }

      // Validate length
      if (privateKeyBytes.length !== 64) {
        throw new Error(`Admin private key must be 64 bytes, got ${privateKeyBytes.length}`);
      }

      const signer = await createKeyPairSignerFromBytes(privateKeyBytes);

      // Store in sessionStorage for future use
      sessionStorage.setItem(ADMIN_WALLET_STORAGE_KEY, JSON.stringify(Array.from(privateKeyBytes)));

      console.log('Admin wallet loaded from env var:', signer.address);
      adminAddressCache = signer.address;
      return signer;
    } catch (error) {
      console.error('Failed to load admin wallet from env var:', error);
      console.error('Supported formats:');
      console.error('  - Base58 string: "5Kd7...(87 chars total)"');
      console.error('  - JSON byte array: "[1,2,3,...,64]"');
    }
  }

  // Generate new wallet
  console.log('Generating new admin wallet...');
  const privateKeyBytes = await generateExtractableKeypairBytes();
  const signer = await createKeyPairSignerFromBytes(privateKeyBytes);

  // Store in sessionStorage
  sessionStorage.setItem(ADMIN_WALLET_STORAGE_KEY, JSON.stringify(Array.from(privateKeyBytes)));

  console.log('Generated admin wallet:', signer.address);
  console.log('⚠️ Admin wallet is temporary - will change on session refresh');
  adminAddressCache = signer.address;

  return signer;
}

/**
 * Get admin wallet address (for display purposes)
 * This uses VITE_ADMIN_WALLET if available, or returns the generated wallet address
 */
export function getAdminAddress(): Address | null {
  // Return cached value if available
  if (adminAddressCache) {
    return adminAddressCache;
  }

  // Check if we have a stored admin wallet
  const stored = sessionStorage.getItem(ADMIN_WALLET_STORAGE_KEY);
  if (stored) {
    try {
      const privateKeyBytes = Uint8Array.from(JSON.parse(stored));
      // Create a temporary signer to get the address
      // This is synchronous extraction, but createKeyPairSignerFromBytes is async
      // So we'll need to reconstruct the address from the public key bytes

      // Extract public key (last 32 bytes)
      const publicKeyBytes = privateKeyBytes.slice(32, 64);

      // Convert bytes to base58 string
      const base58Decoder = getBase58Decoder();
      const publicKeyBase58 = base58Decoder.decode(publicKeyBytes);
      const addr = address(publicKeyBase58);

      adminAddressCache = addr;
      return addr;
    } catch (error) {
      console.warn('Failed to extract admin address from storage:', error);
    }
  }

  // Fall back to VITE_ADMIN_WALLET if it's just a public key
  const adminWalletEnv = import.meta.env.VITE_ADMIN_WALLET;
  if (adminWalletEnv && !adminWalletEnv.startsWith('[')) {
    try {
      const addr = address(adminWalletEnv);
      adminAddressCache = addr;
      return addr;
    } catch (error) {
      console.error('Failed to parse VITE_ADMIN_WALLET:', error);
    }
  }

  // Will be set when loadOrGenerateAdminWallet is called
  return null;
}

/**
 * Clear cached admin wallet (for testing)
 */
export function clearAdminWalletCache(): void {
  adminAddressCache = null;
  sessionStorage.removeItem(ADMIN_WALLET_STORAGE_KEY);
}
