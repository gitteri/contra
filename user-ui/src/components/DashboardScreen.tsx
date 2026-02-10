import type { User } from '../types/user.ts';
import type { PayoutMode } from '../utils/persistence.ts';
import { truncateAddress } from '../utils/formatters.ts';
import { BalanceCard } from './BalanceCard.tsx';
import { ActivityList } from './ActivityList.tsx';
import { BottomNavBar } from './BottomNavBar.tsx';

interface DashboardScreenProps {
  user: User;
  pendingEarnings: number;
  onCollectEarnings: () => void;
  payoutMode: PayoutMode;
}

export function DashboardScreen({ user, pendingEarnings, onCollectEarnings, payoutMode }: DashboardScreenProps) {
  const isManual = payoutMode === 'manual';
  const hasPending = isManual && pendingEarnings > 0;

  return (
    <>
      <div className="dashboard">
        <div className="dashboard-header">
          <div className="dashboard-greeting">Hi, {user.firstName}</div>
          <div className="dashboard-wallet">
            <span className="dashboard-wallet-address">
              {truncateAddress(user.wallet.publicKey, 6)}
            </span>
            <button className="dashboard-wallet-copy" type="button" title="Copy address">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                />
              </svg>
            </button>
          </div>
        </div>

        <BalanceCard balance={user.balance} />

        {hasPending && (
          <div className="pending-card">
            <div className="pending-card-label">Pending Earnings</div>
            <div>
              <span className="pending-card-amount">
                {pendingEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="pending-card-currency">USDA</span>
            </div>
          </div>
        )}

        {isManual && (
          <button
            className={`collect-button${hasPending ? '' : ' collect-button--disabled'}`}
            type="button"
            disabled={!hasPending}
            onClick={hasPending ? onCollectEarnings : undefined}
          >
            Collect Earnings
          </button>
        )}

        <ActivityList transactions={user.transactions} />
      </div>
      <BottomNavBar />
    </>
  );
}
