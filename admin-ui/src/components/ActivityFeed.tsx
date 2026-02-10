import type { ActivityTransaction } from '../types/activity';

interface ActivityFeedProps {
  transactions: ActivityTransaction[];
  mintDecimals: Record<string, number>;
}

const TYPE_LABELS: Record<ActivityTransaction['type'], string> = {
  deposit: 'Deposit',
  release: 'Release',
  transfer: 'Transfer',
  withdraw: 'Withdraw',
  allow_mint: 'Allow Mint',
  block_mint: 'Block Mint',
  add_operator: 'Add Operator',
  remove_operator: 'Remove Operator',
  create_instance: 'Create Instance',
  reset_smt: 'Reset SMT',
  set_admin: 'Set Admin',
  unknown: 'Unknown',
};

const TYPE_CLASSES: Record<string, string> = {
  deposit: 'badge-success',
  release: 'badge-info',
  transfer: 'badge-info',
  withdraw: 'badge-warning',
  allow_mint: 'badge-accent',
  block_mint: 'badge-error',
  add_operator: 'badge-accent',
  remove_operator: 'badge-error',
  create_instance: 'badge-accent',
  reset_smt: 'badge-warning',
  set_admin: 'badge-warning',
  unknown: 'badge-muted',
};

function truncateAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format a raw token amount using mint decimals. */
function formatAmount(raw: string, decimals?: number): string {
  try {
    if (decimals !== undefined && decimals > 0) {
      const n = BigInt(raw);
      const divisor = 10n ** BigInt(decimals);
      const whole = n / divisor;
      const frac = n % divisor;
      const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
      return fracStr
        ? `${whole.toLocaleString()}.${fracStr}`
        : whole.toLocaleString();
    }
    return BigInt(raw).toLocaleString();
  } catch {
    return raw;
  }
}

export function ActivityFeed({ transactions, mintDecimals }: ActivityFeedProps) {
  return (
    <div className="card activity-feed-card">
      <h2>Live Activity</h2>
      <p className="card-description">
        {transactions.length === 0
          ? 'No transactions observed yet. Start polling to see activity.'
          : `${transactions.length} transactions observed`}
      </p>

      <div className="activity-feed-list">
        {transactions.map((tx) => (
          <div key={tx.signature} className={`activity-row ${tx.status === 'failed' ? 'activity-row-failed' : ''}`}>
            <div className="activity-row-left">
              <span className={`activity-badge ${TYPE_CLASSES[tx.type] ?? 'badge-muted'}`}>
                {TYPE_LABELS[tx.type]}
              </span>
              <span className={`activity-chain ${tx.chain === 'solana' ? 'chain-solana' : 'chain-contra'}`}>
                {tx.chain === 'solana' ? 'SOL' : 'CTR'}
              </span>
            </div>

            <div className="activity-row-center">
              {tx.from && (
                <span className="activity-addr" title={tx.from}>
                  {truncateAddr(tx.from)}
                </span>
              )}
              {tx.from && tx.to && <span className="activity-arrow">&rarr;</span>}
              {tx.to && (
                <span className="activity-addr" title={tx.to}>
                  {truncateAddr(tx.to)}
                </span>
              )}
              {tx.amount && (
                <span className="activity-amount">
                  {formatAmount(tx.amount, tx.mint ? mintDecimals[tx.mint] : undefined)}
                </span>
              )}
              {tx.mint && (
                <span className="activity-mint" title={tx.mint}>
                  {truncateAddr(tx.mint)}
                </span>
              )}
            </div>

            <div className="activity-row-right">
              <span className="activity-time">{formatTimestamp(tx.timestamp)}</span>
              <a
                className="activity-sig"
                href={
                  tx.chain === 'solana'
                    ? `https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`
                    : `#${tx.signature}`
                }
                target="_blank"
                rel="noopener noreferrer"
                title={tx.signature}
              >
                {tx.signature.slice(0, 8)}...
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
