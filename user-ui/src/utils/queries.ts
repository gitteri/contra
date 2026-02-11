import type { Address } from '@solana/addresses';
import { address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';
import { findAssociatedTokenPda } from '@solana-program/token';

const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;

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
