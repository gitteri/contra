import type { Address } from '@solana/addresses';
import { address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';
import { findAssociatedTokenPda } from '@solana-program/token';

const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;

/** Module-level cache: mint address → decimals */
const mintDecimalsCache = new Map<string, number>();

/** Known mint decimals for specific tokens */
const KNOWN_MINT_DECIMALS: Record<string, number> = {
  // USDA on Contra
  'FYRfAYrmGVZ5zQV7L3CnKFvFtwCZYrDXFqFfsbMhi87g': 9,
};

/**
 * Get the decimals for a mint. Fetches from the RPC once and caches.
 * Falls back to reading the mint account directly at byte offset 44.
 */
export async function getMintDecimals(
  mintAddress: Address,
  rpc: Rpc<any>
): Promise<number> {
  const key = mintAddress.toString();
  const cached = mintDecimalsCache.get(key);
  if (cached !== undefined) return cached;

  // Check if we have a known value for this mint
  const known = KNOWN_MINT_DECIMALS[key];
  if (known !== undefined) {
    mintDecimalsCache.set(key, known);
    return known;
  }

  try {
    const response = await (rpc as any).getAccountInfo(mintAddress, {
      encoding: 'base64',
    }).send();

    if (response.value?.data?.[0]) {
      const data = Buffer.from(response.value.data[0], 'base64');
      if (data.length >= 45) {
        const decimals = data[44];
        mintDecimalsCache.set(key, decimals);
        return decimals;
      }
    }
  } catch (error) {
    console.error('Failed to fetch mint decimals:', error);
  }

  // Fallback: default to 9 but don't cache it so we retry next time
  console.warn(`Could not determine decimals for mint ${key}, defaulting to 9`);
  return 9;
}

/**
 * Get SPL token balance for a wallet using getTokenAccountBalance
 * This queries the Associated Token Account (ATA) balance
 */
export async function getTokenBalance(
  walletAddress: Address,
  mintAddress: Address,
  rpc: Rpc<any>
): Promise<bigint> {
  try {
    // Find the associated token account for the wallet
    const [ata] = await findAssociatedTokenPda({
      mint: mintAddress,
      owner: walletAddress,
      tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
    });

    // Fetch the token account balance
    const tokenAccountBalance = await (rpc as any)
      .getTokenAccountBalance(ata)
      .send();

    if (tokenAccountBalance.value) {
      // Opportunistically cache decimals from the RPC response
      const decimals = tokenAccountBalance.value.decimals;
      if (typeof decimals === 'number') {
        mintDecimalsCache.set(mintAddress.toString(), decimals);
      }
      return BigInt(tokenAccountBalance.value.amount);
    }

    return 0n;
  } catch (error: any) {
    // If method not found, the RPC doesn't support this method
    if (error?.message?.includes('Method not found') || error?.message?.includes('does not exist')) {
      console.warn('getTokenAccountBalance not supported by RPC - balance queries disabled');
      return 0n;
    }
    // Token account might not exist yet - that's okay, balance is 0
    if (error?.message?.includes('could not find account') || error?.message?.includes('Invalid param')) {
      return 0n;
    }
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
    const response = await (rpc as any).getSignaturesForAddress(
      walletAddress,
      { limit }
    ).send();

    return response.map((sig: any) => sig.signature);
  } catch (error: any) {
    if (error?.message?.includes('Method not found') || error?.message?.includes('does not exist')) {
      console.warn('getSignaturesForAddress not supported by RPC endpoint');
      return [];
    }
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
    const response = await (rpc as any).getTransaction(
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
 * Format balance from lamports to display amount.
 * `decimals` is required — use getMintDecimals() to obtain it.
 */
export function formatBalance(lamports: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  return Number(lamports) / Number(divisor);
}

/**
 * Convert display amount to lamports.
 * `decimals` is required — use getMintDecimals() to obtain it.
 */
export function toLamports(amount: number, decimals: number): bigint {
  const multiplier = 10 ** decimals;
  return BigInt(Math.floor(amount * multiplier));
}

/**
 * Get SOL balance for a wallet (native balance)
 */
export async function getSolBalance(
  walletAddress: Address,
  rpc: Rpc<any>
): Promise<bigint> {
  try {
    const response = await (rpc as any).getBalance(walletAddress).send();
    return BigInt(response.value);
  } catch (error) {
    console.error('Failed to fetch SOL balance:', error);
    return 0n;
  }
}
