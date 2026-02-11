import { useState, useCallback } from 'react';
import type { Toast, ToastType } from '../components/Toast.tsx';

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((
    type: ToastType,
    title: string,
    options?: {
      message?: string;
      link?: { href: string; label: string };
      duration?: number;
    }
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = {
      id,
      type,
      title,
      message: options?.message,
      link: options?.link,
      duration: options?.duration ?? 5000,
    };

    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback(
    (title: string, options?: Parameters<typeof addToast>[2]) => {
      return addToast('success', title, options);
    },
    [addToast]
  );

  const showError = useCallback(
    (title: string, options?: Parameters<typeof addToast>[2]) => {
      return addToast('error', title, options);
    },
    [addToast]
  );

  const showInfo = useCallback(
    (title: string, options?: Parameters<typeof addToast>[2]) => {
      return addToast('info', title, options);
    },
    [addToast]
  );

  return {
    toasts,
    addToast,
    dismissToast,
    showSuccess,
    showError,
    showInfo,
  };
}
