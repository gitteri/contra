import type { Transaction } from '../types/user.ts';
import { formatBalance, formatRelativeTime } from '../utils/formatters.ts';

interface ActivityListProps {
  transactions: Transaction[];
}

export function ActivityList({ transactions }: ActivityListProps) {
  return (
    <div className="activity-section">
      <div className="activity-section-title">Recent Activity</div>
      {transactions.length === 0 ? (
        <div className="activity-empty">
          <div className="activity-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <div className="activity-empty-text">
            No transactions yet.<br />
            Collect earnings or start live transactions.
          </div>
        </div>
      ) : (
        transactions.map((tx) => (
          <div key={tx.id} className="activity-item">
            <div className="activity-item-left">
              <div
                className={`activity-item-icon ${
                  tx.type === 'earning'
                    ? 'activity-item-icon--earning'
                    : 'activity-item-icon--transfer'
                }`}
              >
                {tx.type === 'earning' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7 7-7 7 7" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                    />
                  </svg>
                )}
              </div>
              <div>
                <div className="activity-item-label">
                  {tx.type === 'earning' ? 'Earnings Received' : 'Transfer'}
                </div>
                <div className="activity-item-time">{formatRelativeTime(tx.timestamp)}</div>
              </div>
            </div>
            <div
              className={`activity-item-amount ${
                tx.type === 'earning'
                  ? 'activity-item-amount--positive'
                  : 'activity-item-amount--negative'
              }`}
            >
              {tx.type === 'earning' ? '+' : '-'}
              {formatBalance(tx.amount)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
