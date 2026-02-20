interface ErrorBannerProps {
  error: Error | null;
  onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="error-banner">
      <div className="error-banner-icon">⚠️</div>
      <div className="error-banner-content">
        <div className="error-banner-title">Error Loading Data</div>
        <div className="error-banner-message">{error.message}</div>
      </div>
      {onRetry && (
        <button className="error-banner-retry" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}
