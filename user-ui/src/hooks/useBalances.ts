import { useState, useEffect, useCallback } from 'react';
import type { Address } from '@solana/addresses';
import { useSolana } from '../context/SolanaContext';
import { getTokenBalances, formatBalance } from '../utils/queries';
import { address } from '@solana/addresses';

const MINT_ADDRESS = import.meta.env.VITE_MINT_ADDRESS as string;
const POLL_INTERVAL = 10000; // 10 seconds

export function useBalances(walletAddresses: Address[]) {
  const { rpc } = useSolana();
  const [balances, setBalances] = useState<Map<Address, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchBalances = useCallback(async () => {
    if (walletAddresses.length === 0) {
      setIsLoading(false);
      return;
    }

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
