import { useState, useEffect, useRef, useCallback } from 'react';
import { createSolanaRpc } from '@solana/rpc';
import { address } from '@solana/addresses';
import { CONTRA_READ_URL } from '../utils/contraRpc';
import { useSolana } from './useSolana';
import type { ActivityTransaction, ActivityStats } from '../types/activity';
import {
  CONTRA_ESCROW_PROGRAM_PROGRAM_ADDRESS,
  ContraEscrowProgramInstruction,
} from '@contra-escrow';

const MAX_TRANSACTIONS = 150;
const POLL_INTERVAL_MS = 4000;

/** Map discriminator byte to a human-readable type. */
function escrowInstructionType(
  discrim: number
): ActivityTransaction['type'] {
  switch (discrim) {
    case ContraEscrowProgramInstruction.CreateInstance:
      return 'create_instance';
    case ContraEscrowProgramInstruction.AllowMint:
      return 'allow_mint';
    case ContraEscrowProgramInstruction.BlockMint:
      return 'block_mint';
    case ContraEscrowProgramInstruction.AddOperator:
      return 'add_operator';
    case ContraEscrowProgramInstruction.RemoveOperator:
      return 'remove_operator';
    case ContraEscrowProgramInstruction.SetNewAdmin:
      return 'set_admin';
    case ContraEscrowProgramInstruction.Deposit:
      return 'deposit';
    case ContraEscrowProgramInstruction.ReleaseFunds:
      return 'release';
    case ContraEscrowProgramInstruction.ResetSmtRoot:
      return 'reset_smt';
    default:
      return 'unknown';
  }
}

function computeStats(txs: ActivityTransaction[]): ActivityStats {
  const wallets = new Set<string>();
  let deposits = 0;
  let releases = 0;
  let transfers = 0;
  let otherActions = 0;

  for (const tx of txs) {
    if (tx.from) wallets.add(tx.from);
    if (tx.to) wallets.add(tx.to);
    switch (tx.type) {
      case 'deposit':
        deposits++;
        break;
      case 'release':
        releases++;
        break;
      case 'transfer':
        transfers++;
        break;
      default:
        otherActions++;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const recentThroughput = txs.filter((t) => now - t.timestamp < 60).length;

  return {
    totalTransactions: txs.length,
    deposits,
    releases,
    transfers,
    otherActions,
    uniqueWallets: wallets.size,
    recentThroughput,
  };
}

export function useActivityFeed(instancePubkey: string | null, _solanaEndpoint?: string) {
  const { rpc: solanaRpc } = useSolana();
  const [transactions, setTransactions] = useState<ActivityTransaction[]>([]);
  const [stats, setStats] = useState<ActivityStats>(computeStats([]));
  const [isPolling, setIsPolling] = useState(false);

  const seenSigs = useRef(new Set<string>());
  const lastSolanaSig = useRef<string | undefined>(undefined);
  const lastContraSig = useRef<string | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addTransactions = useCallback((incoming: ActivityTransaction[]) => {
    setTransactions((prev) => {
      const novel = incoming.filter((t) => !seenSigs.current.has(t.signature));
      if (novel.length === 0) return prev;

      for (const t of novel) seenSigs.current.add(t.signature);
      const merged = [...novel, ...prev].slice(0, MAX_TRANSACTIONS);
      setStats(computeStats(merged));
      return merged;
    });
  }, []);

  /** Poll Solana for escrow program activity on the loaded instance. */
  const pollSolana = useCallback(async () => {
    if (!instancePubkey) return;

    try {
      const sigOpts: { limit: number; until?: string } = { limit: 25 };
      if (lastSolanaSig.current) sigOpts.until = lastSolanaSig.current;
      const result = await solanaRpc
        .getSignaturesForAddress(address(instancePubkey), sigOpts)
        .send();

      if (!result || result.length === 0) return;

      // Update cursor to newest signature
      lastSolanaSig.current = result[0].signature;

      const newTxs: ActivityTransaction[] = [];

      for (const sig of result) {
        if (seenSigs.current.has(sig.signature)) continue;

        // Try to get transaction details for richer data
        let txType: ActivityTransaction['type'] = 'unknown';
        let from = '';
        let to = '';

        try {
          const txDetail = await solanaRpc
            .getTransaction(sig.signature as Parameters<typeof solanaRpc.getTransaction>[0], {
              maxSupportedTransactionVersion: 0,
            })
            .send();

          if (txDetail?.transaction?.message) {
            const msg = txDetail.transaction.message;
            const accountKeys = msg.accountKeys || [];

            // First account is typically the fee payer / signer
            from = accountKeys[0] ?? '';

            // Check if this is an escrow program instruction
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const instructions = (msg as any).instructions || [];
            for (const ix of instructions) {
              const progIdx = ix.programIdIndex;
              if (accountKeys[progIdx] === CONTRA_ESCROW_PROGRAM_PROGRAM_ADDRESS) {
                // Decode discriminator from instruction data
                if (ix.data) {
                  try {
                    const dataBytes = atob(ix.data);
                    const discriminator = dataBytes.charCodeAt(0);
                    txType = escrowInstructionType(discriminator);
                  } catch {
                    // ignore decode errors
                  }
                }

                // Extract 'to' from accounts based on instruction type
                if (txType === 'deposit' || txType === 'release') {
                  // user is typically account[1] for deposit, account at index 6 for release
                  const accountIndices = ix.accounts || [];
                  if (txType === 'release' && accountIndices.length > 6) {
                    to = accountKeys[accountIndices[6]] ?? '';
                  }
                }
                break;
              }
            }
          }
        } catch {
          // Fall back to basic info
        }

        newTxs.push({
          signature: sig.signature,
          chain: 'solana',
          type: txType,
          from,
          to,
          amount: null,
          mint: null,
          timestamp: sig.blockTime ?? Math.floor(Date.now() / 1000),
          status: sig.err ? 'failed' : 'confirmed',
        });
      }

      if (newTxs.length > 0) addTransactions(newTxs);
    } catch (err) {
      console.error('[ActivityFeed] Solana poll error:', err);
    }
  }, [instancePubkey, solanaRpc, addTransactions]);

  /** Poll Contra chain for SPL transfer activity. */
  const pollContra = useCallback(async () => {
    if (!instancePubkey) return;

    try {
      const contraRpc = createSolanaRpc(CONTRA_READ_URL);

      // Poll recent signatures for the instance address on Contra
      const contraSigOpts: { limit: number; until?: string } = { limit: 25 };
      if (lastContraSig.current) contraSigOpts.until = lastContraSig.current;
      const result = await contraRpc
        .getSignaturesForAddress(address(instancePubkey), contraSigOpts)
        .send();

      if (!result || result.length === 0) return;

      lastContraSig.current = result[0].signature;

      const newTxs: ActivityTransaction[] = [];

      for (const sig of result) {
        if (seenSigs.current.has(sig.signature)) continue;

        newTxs.push({
          signature: sig.signature,
          chain: 'contra',
          type: 'transfer', // Most Contra activity is SPL transfers
          from: '',
          to: '',
          amount: null,
          mint: null,
          timestamp: sig.blockTime ?? Math.floor(Date.now() / 1000),
          status: sig.err ? 'failed' : 'confirmed',
        });
      }

      if (newTxs.length > 0) addTransactions(newTxs);
    } catch (err) {
      console.error('[ActivityFeed] Contra poll error:', err);
    }
  }, [instancePubkey, addTransactions]);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    setIsPolling(true);

    // Immediate first poll
    pollSolana();
    pollContra();

    intervalRef.current = setInterval(() => {
      pollSolana();
      pollContra();
    }, POLL_INTERVAL_MS);
  }, [pollSolana, pollContra]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Reset when instance changes
  useEffect(() => {
    seenSigs.current.clear();
    lastSolanaSig.current = undefined;
    lastContraSig.current = undefined;
    setTransactions([]);
    setStats(computeStats([]));

    // If polling was active, restart for the new instance
    if (intervalRef.current) {
      stop();
      if (instancePubkey) {
        // Small delay to let state settle
        setTimeout(start, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancePubkey]);

  return { transactions, stats, isPolling, start, stop };
}
