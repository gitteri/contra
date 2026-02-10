import { useMemo } from 'react';
import type { User, AdminState } from '../types/user.ts';
import type { PayoutMode } from '../utils/persistence.ts';
import { UserAvatar } from './UserAvatar.tsx';
import { formatBalance, truncateAddress } from '../utils/formatters.ts';

interface AdminDashboardProps {
  admin: AdminState;
  users: User[];
  payoutMode: PayoutMode;
  onSetPayoutMode: (mode: PayoutMode) => void;
  onPayOutUser: (userId: string) => void;
  onPayOutAll: () => void;
}

export function AdminDashboard({
  admin,
  users,
  payoutMode,
  onSetPayoutMode,
  onPayOutUser,
  onPayOutAll,
}: AdminDashboardProps) {
  const isAuto = payoutMode === 'auto';

  const stats = useMemo(() => {
    let totalCirculation = 0;
    let totalPending = 0;
    let totalTransactions = 0;

    for (const u of users) {
      totalCirculation += u.balance;
      totalTransactions += u.transactions.length;
    }
    for (const amount of Object.values(admin.pendingPayouts)) {
      totalPending += amount;
    }

    return { totalCirculation, totalPending, totalTransactions };
  }, [users, admin.pendingPayouts]);

  const hasPending = stats.totalPending > 0;

  return (
    <div className="admin-dashboard">
      {/* Treasury Balance */}
      <section className="admin-treasury-card">
        <div className="admin-treasury-inner">
          <div className="admin-treasury-label">Treasury Balance</div>
          <div className="admin-treasury-amount-row">
            <span className="admin-treasury-amount">{formatBalance(admin.balance)}</span>
            <span className="admin-treasury-currency">USDA</span>
          </div>
          <div className="admin-treasury-wallet">
            {truncateAddress(admin.wallet.publicKey, 6)}
          </div>
        </div>
      </section>

      {/* Network Stats */}
      <section className="admin-stats-row">
        <div className="stat-card">
          <div className="stat-card-value">{users.length}</div>
          <div className="stat-card-label">Total Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{formatBalance(stats.totalCirculation)}</div>
          <div className="stat-card-label">USDA in Circulation</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{formatBalance(stats.totalPending)}</div>
          <div className="stat-card-label">Pending Payouts</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{stats.totalTransactions}</div>
          <div className="stat-card-label">Transactions Processed</div>
        </div>
      </section>

      {/* Payouts Management */}
      <section className="admin-payouts">
        <div className="admin-payouts-header">
          <h3>Payouts</h3>
          <div className="admin-payouts-controls">
            {/* Auto / Manual toggle */}
            <div className="payout-mode-toggle">
              <button
                className={`payout-mode-option${isAuto ? ' payout-mode-option--active' : ''}`}
                onClick={() => onSetPayoutMode('auto')}
                type="button"
              >
                Auto
              </button>
              <button
                className={`payout-mode-option${!isAuto ? ' payout-mode-option--active' : ''}`}
                onClick={() => onSetPayoutMode('manual')}
                type="button"
              >
                Manual
              </button>
            </div>
            {/* Pay All -- only in manual mode */}
            {!isAuto && (
              <button
                className={`pay-all-button${!hasPending ? ' pay-all-button--disabled' : ''}`}
                onClick={onPayOutAll}
                disabled={!hasPending}
                type="button"
              >
                Pay All
              </button>
            )}
          </div>
        </div>

        <div className="admin-payouts-table">
          {/* Header */}
          <div className={`payout-row payout-row--header${isAuto ? ' payout-row--auto' : ''}`}>
            <div className="payout-cell payout-cell--user">User</div>
            <div className="payout-cell payout-cell--wallet">Wallet</div>
            <div className="payout-cell payout-cell--pending">{isAuto ? 'Last Paid' : 'Pending'}</div>
            <div className="payout-cell payout-cell--status">Status</div>
            {!isAuto && <div className="payout-cell payout-cell--action">Action</div>}
          </div>

          {/* Rows */}
          {users.map((user) => {
            const pending = admin.pendingPayouts[user.id] ?? 0;
            const isPending = pending > 0;

            return (
              <div key={user.id} className={`payout-row${isAuto ? ' payout-row--auto' : ''}`}>
                <div className="payout-cell payout-cell--user">
                  <UserAvatar
                    firstName={user.firstName}
                    lastName={user.lastName}
                    color={user.avatarColor}
                  />
                  <span className="payout-user-name">
                    {user.firstName} {user.lastName}
                  </span>
                </div>
                <div className="payout-cell payout-cell--wallet">
                  <span className="payout-wallet-address">
                    {truncateAddress(user.wallet.publicKey, 4)}
                  </span>
                </div>
                <div className="payout-cell payout-cell--pending">
                  {isAuto ? (
                    <span className="payout-amount">
                      {formatBalance(user.balance)} USDA
                    </span>
                  ) : (
                    <span className={`payout-amount${isPending ? ' payout-amount--active' : ''}`}>
                      {formatBalance(pending)} USDA
                    </span>
                  )}
                </div>
                <div className="payout-cell payout-cell--status">
                  {isAuto ? (
                    <span className="payout-status payout-status--auto">Auto</span>
                  ) : (
                    <span className={`payout-status ${isPending ? 'payout-status--pending' : 'payout-status--paid'}`}>
                      {isPending ? 'Pending' : 'Paid'}
                    </span>
                  )}
                </div>
                {!isAuto && (
                  <div className="payout-cell payout-cell--action">
                    <button
                      className={`pay-button${!isPending ? ' pay-button--disabled' : ''}`}
                      onClick={() => onPayOutUser(user.id)}
                      disabled={!isPending}
                      type="button"
                    >
                      Pay
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
