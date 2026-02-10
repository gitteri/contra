import { useState, useEffect } from 'react';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  userCount: number;
  onUserCountChange: (count: number) => void;
  liveTransactionsActive: boolean;
  onToggleLiveTransactions: () => void;
}

export function SettingsDrawer({
  open,
  onClose,
  userCount,
  onUserCountChange,
  liveTransactionsActive,
  onToggleLiveTransactions,
}: SettingsDrawerProps) {
  const [inputValue, setInputValue] = useState(String(userCount));

  useEffect(() => {
    setInputValue(String(userCount));
  }, [userCount]);

  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleCountBlur = () => {
    const n = parseInt(inputValue, 10);
    if (!isNaN(n) && n >= 2 && n <= 50) {
      onUserCountChange(n);
    } else {
      setInputValue(String(userCount));
    }
  };

  const handleCountKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCountBlur();
    }
  };

  return (
    <>
      <div
        className={`settings-overlay ${open ? 'settings-overlay--open' : ''}`}
        onClick={onClose}
      />
      <div className={`settings-drawer ${open ? 'settings-drawer--open' : ''}`}>
        <div className="settings-drawer-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-field">
            <label className="settings-label">
              Number of Users
              <div className="settings-label-hint">Between 2 and 50 simulated users</div>
            </label>
            <input
              className="settings-input"
              type="number"
              min={2}
              max={50}
              value={inputValue}
              onChange={handleCountChange}
              onBlur={handleCountBlur}
              onKeyDown={handleCountKeyDown}
            />
          </div>

          <div className="settings-divider" />

          <div className="settings-field">
            <label className="settings-label">
              Live Transactions
              <div className="settings-label-hint">
                Simulate random USDA transfers between users
              </div>
            </label>
            <button
              className={`live-tx-button ${liveTransactionsActive ? 'live-tx-button--active' : ''}`}
              onClick={onToggleLiveTransactions}
              type="button"
            >
              <span
                className={`live-tx-indicator ${
                  liveTransactionsActive ? 'live-tx-indicator--active' : ''
                }`}
              />
              {liveTransactionsActive ? 'Stop Live Transactions' : 'Start Live Transactions'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
