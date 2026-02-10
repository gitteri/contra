export function PhoneStatusBar() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = `${hours % 12 || 12}:${minutes.toString().padStart(2, '0')}`;

  return (
    <div className="phone-status-bar">
      <span className="phone-status-bar-time">{time}</span>
      <div className="phone-status-bar-icons">
        {/* Signal bars */}
        <svg viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="11" width="2.5" height="4" rx="0.5" />
          <rect x="5" y="8" width="2.5" height="7" rx="0.5" />
          <rect x="9" y="5" width="2.5" height="10" rx="0.5" />
          <rect x="13" y="1" width="2.5" height="14" rx="0.5" />
        </svg>
        {/* WiFi */}
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-3.54-2.46a5 5 0 0 1 7.08 0l-.71.71a4 4 0 0 0-5.66 0l-.71-.71Zm-2.12-2.12a8 8 0 0 1 11.32 0l-.71.71a7 7 0 0 0-9.9 0l-.71-.71Z" />
        </svg>
        {/* Battery */}
        <svg viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="2.5" y="5.5" width="9" height="5" rx="0.5" />
          <rect x="14" y="6" width="1.5" height="4" rx="0.5" />
        </svg>
      </div>
    </div>
  );
}
