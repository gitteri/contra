import type { User, AdminState } from '../types/user.ts';
import { UserAvatar } from './UserAvatar.tsx';
import { formatBalance } from '../utils/formatters.ts';

interface UserPanelProps {
  users: User[];
  adminState: AdminState;
  selectedId: string; // 'network', 'admin', or a user id
  onSelect: (id: string) => void;
}

export function UserPanel({ users, adminState, selectedId, onSelect }: UserPanelProps) {
  return (
    <aside className="user-panel">
      <div className="user-panel-header">
        <h2>
          Users
          <span className="user-panel-count">{users.length}</span>
        </h2>
      </div>
      <div className="user-list">
        {/* Network view item */}
        <div
          className={`user-item network-item ${selectedId === 'network' ? 'user-item--selected' : ''}`}
          onClick={() => onSelect('network')}
        >
          <div className="network-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
              />
            </svg>
          </div>
          <div className="user-item-info">
            <div className="user-item-name">Full Network</div>
            <div className="user-item-balance">Live transaction map</div>
          </div>
        </div>

        {/* Contra Admin item */}
        <div
          className={`user-item admin-item ${selectedId === 'admin' ? 'user-item--selected' : ''}`}
          onClick={() => onSelect('admin')}
        >
          <div className="admin-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
          </div>
          <div className="user-item-info">
            <div className="user-item-name">Contra Admin</div>
            <div className="user-item-balance">
              {formatBalance(adminState.balance)} USDA
            </div>
          </div>
        </div>

        <div className="user-list-divider" />

        {/* Individual users */}
        {users.map((user) => (
          <div
            key={user.id}
            className={`user-item ${user.id === selectedId ? 'user-item--selected' : ''}`}
            onClick={() => onSelect(user.id)}
          >
            <UserAvatar
              firstName={user.firstName}
              lastName={user.lastName}
              color={user.avatarColor}
            />
            <div className="user-item-info">
              <div className="user-item-name">
                {user.firstName} {user.lastName}
              </div>
              <div className="user-item-balance">
                {formatBalance(user.balance)} USDA
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
