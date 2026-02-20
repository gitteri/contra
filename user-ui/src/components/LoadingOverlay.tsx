interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
}

export function LoadingOverlay({ isLoading, message = 'Loading...' }: LoadingOverlayProps) {
  if (!isLoading) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <div className="loading-message">{message}</div>
    </div>
  );
}
