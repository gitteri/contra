/** Which chain a transaction originated on. */
export type ChainSource = 'solana' | 'contra';

/** Unified transaction type for the activity feed. */
export interface ActivityTransaction {
  signature: string;
  chain: ChainSource;
  type:
    | 'deposit'
    | 'release'
    | 'transfer'
    | 'withdraw'
    | 'allow_mint'
    | 'block_mint'
    | 'add_operator'
    | 'remove_operator'
    | 'create_instance'
    | 'reset_smt'
    | 'set_admin'
    | 'unknown';
  from: string;
  to: string;
  amount: string | null; // raw amount string
  mint: string | null;
  timestamp: number; // unix seconds
  status: 'confirmed' | 'failed';
}

/** Aggregated stats for the activity feed. */
export interface ActivityStats {
  totalTransactions: number;
  deposits: number;
  releases: number;
  transfers: number;
  otherActions: number;
  uniqueWallets: number;
  /** Transactions observed in the last 60s */
  recentThroughput: number;
}

/** A single row parsed from a payout CSV. */
export interface PayoutRow {
  id: number;
  address: string;
  amount: string; // raw amount from CSV
  mint?: string; // optional per-row mint override
  status: 'pending' | 'sending' | 'creating_ata' | 'confirmed' | 'failed';
  signature?: string;
  error?: string;
}
