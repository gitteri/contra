import { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  link?: {
    href: string;
    label: string;
  };
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

export function ToastItem({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.duration) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div className={`toast toast--${toast.type}`}>
      <div className="toast-header">
        <span className="toast-icon">
          {toast.type === 'success' && '✓'}
          {toast.type === 'error' && '⚠'}
          {toast.type === 'info' && 'ℹ'}
        </span>
        <span className="toast-title">{toast.title}</span>
        <button
          className="toast-close"
          onClick={() => onDismiss(toast.id)}
          type="button"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {toast.message && <div className="toast-message">{toast.message}</div>}
      {toast.link && (
        <div className="toast-link">
          <a href={toast.link.href} target="_blank" rel="noopener noreferrer">
            {toast.link.label} →
          </a>
        </div>
      )}
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
