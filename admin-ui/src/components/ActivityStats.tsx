import type { ActivityStats as Stats } from '../types/activity';

interface ActivityStatsProps {
  stats: Stats;
  isPolling: boolean;
  onStart: () => void;
  onStop: () => void;
  instancePubkey: string | null;
}

export function ActivityStats({
  stats,
  isPolling,
  onStart,
  onStop,
  instancePubkey,
}: ActivityStatsProps) {
  return (
    <div className="card">
      <div className="activity-stats-header">
        <div>
          <h2>Network Activity</h2>
          <p className="card-description">
            Real-time escrow events (Solana) and transfers (Contra)
          </p>
        </div>
        <div className="activity-stats-controls">
          {isPolling ? (
            <button className="button button-danger" onClick={onStop}>
              <span className="polling-dot" /> Stop
            </button>
          ) : (
            <button
              className="button button-success"
              onClick={onStart}
              disabled={!instancePubkey}
            >
              Start Polling
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-card-value">{stats.totalTransactions}</span>
          <span className="stat-card-label">Total</span>
        </div>
        <div className="stat-card stat-card-success">
          <span className="stat-card-value">{stats.deposits}</span>
          <span className="stat-card-label">Deposits</span>
        </div>
        <div className="stat-card stat-card-info">
          <span className="stat-card-value">{stats.releases}</span>
          <span className="stat-card-label">Releases</span>
        </div>
        <div className="stat-card stat-card-info">
          <span className="stat-card-value">{stats.transfers}</span>
          <span className="stat-card-label">Transfers</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-value">{stats.uniqueWallets}</span>
          <span className="stat-card-label">Wallets</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-value">{stats.recentThroughput}</span>
          <span className="stat-card-label">TX / min</span>
        </div>
      </div>
    </div>
  );
}
