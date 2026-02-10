import { useState, useEffect, useRef, useCallback } from 'react';
import { createSolanaRpc } from '@solana/rpc';
import { address } from '@solana/addresses';
import { getBase58Encoder } from '@solana/codecs-strings';
import type { Signature } from '@solana/keys';
import { CONTRA_READ_URL } from '../utils/contraRpc';
import { useSolana } from './useSolana';
import type { ActivityTransaction, ActivityStats } from '../types/activity';
import {
  CONTRA_ESCROW_PROGRAM_PROGRAM_ADDRESS,
  getDepositInstructionDataDecoder,
  getReleaseFundsInstructionDataDecoder,
} from '@contra-escrow';

const MAX_TRANSACTIONS = 150;
const POLL_INTERVAL_MS = 4000;

// Discriminator values (byte 0 of instruction data)
const DISC_CREATE_INSTANCE = 0;
const DISC_ALLOW_MINT = 1;
const DISC_BLOCK_MINT = 2;
const DISC_ADD_OPERATOR = 3;
const DISC_REMOVE_OPERATOR = 4;
const DISC_SET_NEW_ADMIN = 5;
const DISC_DEPOSIT = 6;
const DISC_RELEASE_FUNDS = 7;
const DISC_RESET_SMT = 8;

const PROGRAM_ID = CONTRA_ESCROW_PROGRAM_PROGRAM_ADDRESS;

function discToType(disc: number): ActivityTransaction['type'] {
  switch (disc) {
    case DISC_CREATE_INSTANCE: return 'create_instance';
    case DISC_ALLOW_MINT: return 'allow_mint';
    case DISC_BLOCK_MINT: return 'block_mint';
    case DISC_ADD_OPERATOR: return 'add_operator';
    case DISC_REMOVE_OPERATOR: return 'remove_operator';
    case DISC_SET_NEW_ADMIN: return 'set_admin';
    case DISC_DEPOSIT: return 'deposit';
    case DISC_RELEASE_FUNDS: return 'release';
    case DISC_RESET_SMT: return 'reset_smt';
    default: return 'unknown';
  }
}

const b58Encoder = getBase58Encoder();

/** Convert a base58-encoded string to raw bytes. */
function decodeBase58Data(b58: string): Uint8Array {
  try {
    return new Uint8Array(b58Encoder.encode(b58));
  } catch {
    return new Uint8Array(0);
  }
}

interface ParsedInfo {
  type: ActivityTransaction['type'];
  from: string;
  to: string;
  amount: string | null;
  mint: string | null;
}

/**
 * Parse an escrow program instruction from a compiled transaction.
 *
 * Deposit accounts:  [payer(0), user(1), instance(2), mint(3), allowedMint(4), userAta(5), instanceAta(6), ...]
 * Release accounts:  [payer(0), operator(1), instance(2), operatorPda(3), mint(4), allowedMint(5), userAta(6), instanceAta(7), ...]
 */
function parseEscrowInstruction(
  dataBytes: Uint8Array,
  accountKeys: string[],
  accountIndices: number[],
): ParsedInfo {
  const disc = dataBytes[0];
  const txType = discToType(disc);

  let from = '';
  let to = '';
  let amount: string | null = null;
  let mint: string | null = null;

  try {
    if (disc === DISC_DEPOSIT) {
      // Deposit: data = [disc(1), amount(8), recipient(option)]
      const decoded = getDepositInstructionDataDecoder().decode(dataBytes);
      amount = decoded.amount.toString();

      // Account indices: payer=0, user=1, instance=2, mint=3
      from = accountKeys[accountIndices[1]] ?? ''; // user
      to = accountKeys[accountIndices[2]] ?? '';   // instance (escrow)
      mint = accountKeys[accountIndices[3]] ?? '';
    } else if (disc === DISC_RELEASE_FUNDS) {
      // ReleaseFunds: data = [disc(1), amount(8), user(32), ...]
      const decoded = getReleaseFundsInstructionDataDecoder().decode(dataBytes);
      amount = decoded.amount.toString();
      to = decoded.user; // user address is in the instruction data

      // Account indices: payer=0, operator=1, instance=2, operatorPda=3, mint=4
      from = accountKeys[accountIndices[1]] ?? ''; // operator
      mint = accountKeys[accountIndices[4]] ?? '';
    } else {
      // For other instructions, just get payer and relevant accounts
      from = accountKeys[accountIndices[0]] ?? '';

      // Admin-type instructions: index 1 is typically the subject
      if (accountIndices.length > 1) {
        to = accountKeys[accountIndices[1]] ?? '';
      }
    }
  } catch (err) {
    console.warn('[ActivityFeed] Failed to decode instruction data:', err);
  }

  return { type: txType, from, to, amount, mint };
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
      case 'deposit':   deposits++;   break;
      case 'release':   releases++;   break;
      case 'transfer':  transfers++;  break;
      default:          otherActions++; break;
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

export function useActivityFeed(instancePubkey: string | null) {
  const { rpc: solanaRpc } = useSolana();
  const [transactions, setTransactions] = useState<ActivityTransaction[]>([]);
  const [stats, setStats] = useState<ActivityStats>(computeStats([]));
  const [isPolling, setIsPolling] = useState(false);
  const [mintDecimals, setMintDecimals] = useState<Record<string, number>>({});

  const seenSigs = useRef(new Set<string>());
  const lastSolanaSig = useRef<Signature | undefined>(undefined);
  const lastContraSlot = useRef<bigint>(0n);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const decimalsCache = useRef<Map<string, number>>(new Map());
  const decimalsFetching = useRef<Set<string>>(new Set());

  /** Fetch and cache decimals for a mint. SPL Token mint layout: decimals is a u8 at byte offset 44. */
  const fetchMintDecimals = useCallback(async (mint: string) => {
    if (decimalsCache.current.has(mint) || decimalsFetching.current.has(mint)) return;
    decimalsFetching.current.add(mint);

    try {
      const result = await solanaRpc
        .getAccountInfo(address(mint), { encoding: 'base64' })
        .send();

      if (result?.value?.data) {
        // data is [base64string, "base64"]
        const b64 = Array.isArray(result.value.data) ? result.value.data[0] : result.value.data;
        const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
        // SPL Token Mint layout: decimals is at byte offset 44
        if (bytes.length > 44) {
          const dec = bytes[44];
          decimalsCache.current.set(mint, dec);
          setMintDecimals((prev) => ({ ...prev, [mint]: dec }));
        }
      }
    } catch (err) {
      console.warn('[ActivityFeed] Failed to fetch decimals for', mint, err);
    } finally {
      decimalsFetching.current.delete(mint);
    }
  }, [solanaRpc]);

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
      const opts: { limit: number; until?: Signature } = { limit: 25 };
      if (lastSolanaSig.current) opts.until = lastSolanaSig.current;

      const result = await solanaRpc
        .getSignaturesForAddress(address(instancePubkey), opts)
        .send();

      if (!result || result.length === 0) return;

      lastSolanaSig.current = result[0].signature;

      const newTxs: ActivityTransaction[] = [];

      for (const sig of result) {
        if (seenSigs.current.has(sig.signature)) continue;

        let info: ParsedInfo = { type: 'unknown', from: '', to: '', amount: null, mint: null };

        try {
          // Fetch with 'json' encoding -- gives us compiled message format
          // with accountKeys as string[], instructions with programIdIndex/accounts/data
          const txDetail = await solanaRpc
            .getTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0,
              encoding: 'json',
            })
            .send();

          if (txDetail?.transaction?.message) {
            const msg = txDetail.transaction.message;
            // accountKeys is string[] in json encoding
            const accountKeys: string[] = (msg.accountKeys ?? []).map((k: unknown) =>
              typeof k === 'string' ? k : (k as { pubkey: string }).pubkey ?? String(k)
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const instructions = [...(msg.instructions ?? [])] as any[];

            for (const ix of instructions) {
              // In json encoding: programIdIndex is an index into accountKeys
              const progAddr = accountKeys[ix.programIdIndex];
              if (progAddr === PROGRAM_ID) {
                // ix.data is base58-encoded instruction data
                // ix.accounts is number[] of account indices
                const dataBytes = decodeBase58Data(ix.data ?? '');
                const ixAccounts: number[] = ix.accounts ?? [];
                info = parseEscrowInstruction(dataBytes, accountKeys, ixAccounts);
                break;
              }
            }

            // If we didn't find our program but have account keys, at least show payer
            if (info.type === 'unknown' && accountKeys.length > 0) {
              info.from = accountKeys[0];
            }
          }
        } catch (err) {
          console.warn('[ActivityFeed] Failed to fetch tx detail:', sig.signature, err);
        }

        // Fetch mint decimals if we haven't seen this mint before
        if (info.mint && !decimalsCache.current.has(info.mint)) {
          fetchMintDecimals(info.mint);
        }

        newTxs.push({
          signature: sig.signature,
          chain: 'solana',
          type: info.type,
          from: info.from,
          to: info.to,
          amount: info.amount,
          mint: info.mint,
          timestamp: Number(sig.blockTime ?? Math.floor(Date.now() / 1000)),
          status: sig.err ? 'failed' : 'confirmed',
        });
      }

      if (newTxs.length > 0) addTransactions(newTxs);
    } catch (err) {
      console.error('[ActivityFeed] Solana poll error:', err);
    }
  }, [instancePubkey, solanaRpc, addTransactions, fetchMintDecimals]);

  /**
   * Parse all transactions from a single block into ActivityTransaction[].
   * Extracts SPL Token transfers and escrow instructions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseContraBlock = useCallback((block: any): ActivityTransaction[] => {
    if (!block?.transactions) return [];

    const blockTime = Number(block.blockTime ?? Math.floor(Date.now() / 1000));
    const results: ActivityTransaction[] = [];

    for (const txWrap of block.transactions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txWrap as any;
      const sig = tx.transaction?.signatures?.[0];
      if (!sig || seenSigs.current.has(sig)) continue;

      const msg = tx.transaction?.message;
      if (!msg) continue;

      const accountKeys: string[] = (msg.accountKeys ?? []).map((k: unknown) =>
        typeof k === 'string' ? k : (k as { pubkey: string }).pubkey ?? String(k)
      );

      let txType: ActivityTransaction['type'] = 'unknown';
      let from = accountKeys[0] ?? '';
      let to = '';
      let amount: string | null = null;
      let mint: string | null = null;
      const failed = tx.meta?.err != null;

      const instructions = [...(msg.instructions ?? [])];
      for (const ix of instructions) {
        const progAddr = accountKeys[ix.programIdIndex];

        // SPL Token Program
        if (progAddr === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
          const dataBytes = decodeBase58Data(ix.data ?? '');
          if (dataBytes.length === 0) continue;

          const ixDiscrim = dataBytes[0];
          const ixAccounts: number[] = ix.accounts ?? [];

          // Transfer (disc=3): [source, dest, authority], data: [disc(1), amount(8)]
          if (ixDiscrim === 3 && dataBytes.length >= 9) {
            txType = 'transfer';
            const view = new DataView(dataBytes.buffer, dataBytes.byteOffset);
            amount = view.getBigUint64(1, true).toString();
            from = accountKeys[ixAccounts[2]] ?? from;
            to = accountKeys[ixAccounts[1]] ?? '';
            if (tx.meta?.preTokenBalances?.length > 0) {
              mint = tx.meta.preTokenBalances[0].mint ?? null;
            }
            break;
          }

          // TransferChecked (disc=12): [source, mint, dest, authority], data: [disc(1), amount(8), decimals(1)]
          if (ixDiscrim === 12 && dataBytes.length >= 10) {
            txType = 'transfer';
            const view = new DataView(dataBytes.buffer, dataBytes.byteOffset);
            amount = view.getBigUint64(1, true).toString();
            from = accountKeys[ixAccounts[3]] ?? from;
            to = accountKeys[ixAccounts[2]] ?? '';
            mint = accountKeys[ixAccounts[1]] ?? null;
            break;
          }
        }

        // Escrow program on Contra
        if (progAddr === PROGRAM_ID) {
          const dataBytes = decodeBase58Data(ix.data ?? '');
          const ixAccounts: number[] = ix.accounts ?? [];
          const info = parseEscrowInstruction(dataBytes, accountKeys, ixAccounts);
          txType = info.type;
          from = info.from;
          to = info.to;
          amount = info.amount;
          mint = info.mint;
          break;
        }
      }

      if (mint && !decimalsCache.current.has(mint)) {
        fetchMintDecimals(mint);
      }

      results.push({
        signature: sig,
        chain: 'contra',
        type: txType,
        from,
        to,
        amount,
        mint,
        timestamp: blockTime,
        status: failed ? 'failed' : 'confirmed',
      });
    }

    return results;
  }, [fetchMintDecimals]);

  /**
   * Poll Contra chain by fetching only non-empty slots in the range,
   * then fetching those blocks in parallel (max 5 concurrent).
   */
  const pollContra = useCallback(async () => {
    try {
      const contraRpc = createSolanaRpc(CONTRA_READ_URL);
      const currentSlot = await contraRpc.getSlot({ commitment: 'confirmed' }).send();

      // On first poll, start from recent history
      if (lastContraSlot.current === 0n) {
        lastContraSlot.current = currentSlot > 5n ? currentSlot - 5n : 0n;
      }

      if (currentSlot <= lastContraSlot.current) return;

      // getBlocks returns only slots that produced blocks (skips empty/dead slots)
      const startSlot = lastContraSlot.current + 1n;
      const slots = await contraRpc
        .getBlocks(startSlot, currentSlot)
        .send();

      lastContraSlot.current = currentSlot;

      if (!slots || slots.length === 0) return;

      // Cap to most recent 10 slots if we fell behind
      const slotsToFetch = slots.length > 10 ? slots.slice(-10) : slots;

      // Fetch blocks in parallel (all at once -- they're small on Contra)
      const blockResults = await Promise.allSettled(
        slotsToFetch.map((slot) =>
          contraRpc
            .getBlock(slot, {
              encoding: 'json',
              maxSupportedTransactionVersion: 0,
              transactionDetails: 'full',
            })
            .send()
        )
      );

      const newTxs: ActivityTransaction[] = [];
      for (const result of blockResults) {
        if (result.status === 'fulfilled' && result.value) {
          newTxs.push(...parseContraBlock(result.value));
        }
      }

      if (newTxs.length > 0) addTransactions(newTxs);
    } catch (err) {
      console.error('[ActivityFeed] Contra poll error:', err);
    }
  }, [addTransactions, parseContraBlock]);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    setIsPolling(true);

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

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    seenSigs.current.clear();
    lastSolanaSig.current = undefined;
    lastContraSlot.current = 0n;
    setTransactions([]);
    setStats(computeStats([]));

    if (intervalRef.current) {
      stop();
      if (instancePubkey) {
        setTimeout(start, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancePubkey]);

  return { transactions, stats, isPolling, start, stop, mintDecimals };
}
