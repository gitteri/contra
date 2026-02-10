import { useState, useEffect, useRef, useCallback } from 'react';
import { address } from '@solana/addresses';
import { getBase58Encoder } from '@solana/codecs-strings';
import type { Signature } from '@solana/keys';
import { CONTRA_WS_URL, contraReadRpc } from '../utils/contraRpc';
import { useSolana } from './useSolana';
import type { ActivityTransaction, ActivityStats } from '../types/activity';
import {
  CONTRA_ESCROW_PROGRAM_PROGRAM_ADDRESS,
  getDepositInstructionDataDecoder,
  getReleaseFundsInstructionDataDecoder,
} from '@contra-escrow';

const MAX_TRANSACTIONS = 150;
const POLL_INTERVAL_MS = 4000;

/** WebSocket reconnection config */
const WS_INITIAL_BACKOFF_MS = 500;
const WS_MAX_BACKOFF_MS = 30_000;

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
      const decoded = getDepositInstructionDataDecoder().decode(dataBytes);
      amount = decoded.amount.toString();
      from = accountKeys[accountIndices[1]] ?? '';
      to = accountKeys[accountIndices[2]] ?? '';
      mint = accountKeys[accountIndices[3]] ?? '';
    } else if (disc === DISC_RELEASE_FUNDS) {
      const decoded = getReleaseFundsInstructionDataDecoder().decode(dataBytes);
      amount = decoded.amount.toString();
      to = decoded.user;
      from = accountKeys[accountIndices[1]] ?? '';
      mint = accountKeys[accountIndices[4]] ?? '';
    } else {
      from = accountKeys[accountIndices[0]] ?? '';
      if (accountIndices.length > 1) {
        to = accountKeys[accountIndices[1]] ?? '';
      }
    }
  } catch (err) {
    console.warn('[ActivityFeed] Failed to decode instruction data:', err);
  }

  return { type: txType, from, to, amount, mint };
}

const EMPTY_STATS: ActivityStats = {
  totalTransactions: 0,
  deposits: 0,
  releases: 0,
  transfers: 0,
  otherActions: 0,
  uniqueWallets: 0,
  recentThroughput: 0,
};

/** Incrementally update running stats with new transactions. */
function accumulateStats(
  prev: ActivityStats,
  incoming: ActivityTransaction[],
  walletSet: Set<string>,
  recentTimestamps: number[],
): ActivityStats {
  let { totalTransactions, deposits, releases, transfers, otherActions } = prev;

  const now = Math.floor(Date.now() / 1000);

  for (const tx of incoming) {
    totalTransactions++;
    if (tx.from) walletSet.add(tx.from);
    if (tx.to) walletSet.add(tx.to);
    switch (tx.type) {
      case 'deposit':   deposits++;   break;
      case 'release':   releases++;   break;
      case 'transfer':  transfers++;  break;
      default:          otherActions++; break;
    }
    recentTimestamps.push(tx.timestamp);
  }

  // Prune timestamps older than 60s for throughput calculation
  while (recentTimestamps.length > 0 && now - recentTimestamps[0] > 60) {
    recentTimestamps.shift();
  }

  return {
    totalTransactions,
    deposits,
    releases,
    transfers,
    otherActions,
    uniqueWallets: walletSet.size,
    recentThroughput: recentTimestamps.length,
  };
}

export function useActivityFeed(instancePubkey: string | null) {
  const { rpc: solanaRpc } = useSolana();
  const [transactions, setTransactions] = useState<ActivityTransaction[]>([]);
  const [stats, setStats] = useState<ActivityStats>(EMPTY_STATS);
  const [isPolling, setIsPolling] = useState(false);
  const [mintDecimals, setMintDecimals] = useState<Record<string, number>>({});

  const seenSigs = useRef(new Set<string>());
  const lastSolanaSig = useRef<Signature | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsBackoffRef = useRef(WS_INITIAL_BACKOFF_MS);
  const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decimalsCache = useRef<Map<string, number>>(new Map());
  const decimalsFetching = useRef<Set<string>>(new Set());
  // Running stats state (not capped by the 150-tx display buffer)
  const statsRef = useRef<ActivityStats>(EMPTY_STATS);
  const walletSetRef = useRef(new Set<string>());
  const recentTimestampsRef = useRef<number[]>([]);

  /**
   * Fetch and cache decimals for a mint.
   * SPL Token mint layout: decimals is a u8 at byte offset 44.
   * For Contra-chain transactions the mint lives on Contra, so we query contraReadRpc.
   * For Solana-chain transactions we query the Solana RPC.
   */
  const fetchMintDecimals = useCallback(async (mint: string, chain: 'solana' | 'contra' = 'solana') => {
    if (decimalsCache.current.has(mint) || decimalsFetching.current.has(mint)) return;
    decimalsFetching.current.add(mint);

    try {
      const rpc = chain === 'contra' ? contraReadRpc : solanaRpc;
      const result = await rpc
        .getAccountInfo(address(mint), { encoding: 'base64' })
        .send();

      if (result?.value?.data) {
        const b64 = Array.isArray(result.value.data) ? result.value.data[0] : result.value.data;
        const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
        if (bytes.length > 44) {
          const dec = bytes[44];
          decimalsCache.current.set(mint, dec);
          setMintDecimals((prev) => ({ ...prev, [mint]: dec }));
        }
      }
    } catch (err) {
      console.warn('[ActivityFeed] Failed to fetch decimals for', mint, `(${chain})`, err);
    } finally {
      decimalsFetching.current.delete(mint);
    }
  }, [solanaRpc]);

  const addTransactions = useCallback((incoming: ActivityTransaction[]) => {
    setTransactions((prev) => {
      const novel = incoming.filter((t) => !seenSigs.current.has(t.signature));
      if (novel.length === 0) return prev;

      for (const t of novel) seenSigs.current.add(t.signature);

      // Update running stats (not bounded by display buffer)
      statsRef.current = accumulateStats(
        statsRef.current,
        novel,
        walletSetRef.current,
        recentTimestampsRef.current,
      );
      setStats({ ...statsRef.current });

      const merged = [...novel, ...prev].slice(0, MAX_TRANSACTIONS);
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
          const txDetail = await solanaRpc
            .getTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0,
              encoding: 'json',
            })
            .send();

          if (txDetail?.transaction?.message) {
            const msg = txDetail.transaction.message;
            const accountKeys: string[] = (msg.accountKeys ?? []).map((k: unknown) =>
              typeof k === 'string' ? k : (k as { pubkey: string }).pubkey ?? String(k)
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const instructions = [...(msg.instructions ?? [])] as any[];

            for (const ix of instructions) {
              const progAddr = accountKeys[ix.programIdIndex];
              if (progAddr === PROGRAM_ID) {
                const dataBytes = decodeBase58Data(ix.data ?? '');
                const ixAccounts: number[] = ix.accounts ?? [];
                info = parseEscrowInstruction(dataBytes, accountKeys, ixAccounts);
                break;
              }
            }

            if (info.type === 'unknown' && accountKeys.length > 0) {
              info.from = accountKeys[0];
            }
          }
        } catch (err) {
          console.warn('[ActivityFeed] Failed to fetch tx detail:', sig.signature, err);
        }

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

  // ---------------------------------------------------------------------------
  // Contra: WebSocket stream from the streamer service
  // ---------------------------------------------------------------------------

  const connectContraWs = useCallback(() => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(CONTRA_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.info('[ActivityFeed] Contra WebSocket connected');
      wsBackoffRef.current = WS_INITIAL_BACKOFF_MS;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);

        // The streamer sends StreamedTransaction objects that match ActivityTransaction
        const tx: ActivityTransaction = {
          signature: data.signature,
          chain: (data.chain ?? 'contra') as ActivityTransaction['chain'],
          type: data.type as ActivityTransaction['type'],
          from: data.from ?? '',
          to: data.to ?? '',
          amount: data.amount ?? null,
          mint: data.mint ?? null,
          timestamp: data.timestamp ?? Math.floor(Date.now() / 1000),
          status: (data.status ?? 'confirmed') as ActivityTransaction['status'],
        };

        // Fetch mint decimals from the Contra chain (where the mint lives)
        if (tx.mint && !decimalsCache.current.has(tx.mint)) {
          fetchMintDecimals(tx.mint, 'contra');
        }

        addTransactions([tx]);
      } catch (err) {
        console.warn('[ActivityFeed] Failed to parse WS message:', err);
      }
    };

    ws.onclose = (event) => {
      console.info('[ActivityFeed] Contra WebSocket closed:', event.code, event.reason);
      wsRef.current = null;

      // Reconnect with exponential backoff
      const backoff = wsBackoffRef.current;
      wsBackoffRef.current = Math.min(backoff * 2, WS_MAX_BACKOFF_MS);
      console.info(`[ActivityFeed] Reconnecting in ${backoff}ms...`);
      wsReconnectTimer.current = setTimeout(connectContraWs, backoff);
    };

    ws.onerror = (err) => {
      console.error('[ActivityFeed] Contra WebSocket error:', err);
      // onclose will fire after onerror, which handles reconnection
    };
  }, [addTransactions, fetchMintDecimals]);

  const disconnectContraWs = useCallback(() => {
    if (wsReconnectTimer.current) {
      clearTimeout(wsReconnectTimer.current);
      wsReconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    wsBackoffRef.current = WS_INITIAL_BACKOFF_MS;
  }, []);

  // ---------------------------------------------------------------------------
  // Start / Stop
  // ---------------------------------------------------------------------------

  const start = useCallback(() => {
    if (intervalRef.current) return;
    setIsPolling(true);

    // Solana: poll on interval
    pollSolana();
    intervalRef.current = setInterval(pollSolana, POLL_INTERVAL_MS);

    // Contra: connect WebSocket stream
    connectContraWs();
  }, [pollSolana, connectContraWs]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    disconnectContraWs();
    setIsPolling(false);
  }, [disconnectContraWs]);

  // Refresh throughput counter every 5s so "TX / min" decays when traffic stops
  useEffect(() => {
    const id = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const ts = recentTimestampsRef.current;
      while (ts.length > 0 && now - ts[0] > 60) ts.shift();
      statsRef.current = { ...statsRef.current, recentThroughput: ts.length };
      setStats({ ...statsRef.current });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      disconnectContraWs();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset when instancePubkey changes
  useEffect(() => {
    seenSigs.current.clear();
    lastSolanaSig.current = undefined;
    statsRef.current = EMPTY_STATS;
    walletSetRef.current.clear();
    recentTimestampsRef.current = [];
    setTransactions([]);
    setStats(EMPTY_STATS);

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
