import { useState, useEffect } from 'react';
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
  const [signer, setSigner] = useState<TransactionSigner | null>(null);

  useEffect(() => {
    async function loadSigner() {
      console.log('[useAdminSigner] Loading admin signer...');

      // Load admin wallet from sessionStorage
      const storedKey = sessionStorage.getItem(ADMIN_WALLET_STORAGE_KEY);
      if (!storedKey) {
        console.warn('[useAdminSigner] Admin wallet not found in sessionStorage - was it initialized?');
        return;
      }

      console.log('[useAdminSigner] Found stored key in sessionStorage');

      try {
        const keyBytes = Uint8Array.from(JSON.parse(storedKey));
        console.log('[useAdminSigner] Parsed key bytes, length:', keyBytes.length);

        const adminSigner = await createKeyPairSignerFromBytes(keyBytes);
        console.log('[useAdminSigner] Created admin signer, address:', adminSigner.address);

        setSigner(adminSigner);
        console.log('[useAdminSigner] Admin signer set successfully');
      } catch (error) {
        console.error('[useAdminSigner] Failed to create admin signer:', error);
      }
    }

    loadSigner();
  }, []);

  return signer;
}
