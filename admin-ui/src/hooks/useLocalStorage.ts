import { useState, useCallback, useEffect } from 'react';

const STORAGE_PREFIX = 'contra:';

/**
 * React hook that syncs state with localStorage.
 * Falls back to in-memory state if localStorage is unavailable.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const prefixedKey = `${STORAGE_PREFIX}${key}`;

  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(prefixedKey);
      return item !== null ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const nextValue = value instanceof Function ? value(prev) : value;
        try {
          localStorage.setItem(prefixedKey, JSON.stringify(nextValue));
        } catch {
          // quota exceeded or private browsing — silently ignore
        }
        return nextValue;
      });
    },
    [prefixedKey]
  );

  return [storedValue, setValue];
}

/**
 * Append a value to a persisted array, de-duplicating and capping at `max` items.
 * Most-recent first.
 */
export function useRecentItems(
  key: string,
  max = 5
): [string[], (item: string) => void, (item: string) => void] {
  const [items, setItems] = useLocalStorage<string[]>(key, []);

  const addItem = useCallback(
    (item: string) => {
      if (!item) return;
      setItems((prev) => {
        const filtered = prev.filter((i) => i !== item);
        return [item, ...filtered].slice(0, max);
      });
    },
    [setItems, max]
  );

  const removeItem = useCallback(
    (item: string) => {
      setItems((prev) => prev.filter((i) => i !== item));
    },
    [setItems]
  );

  return [items, addItem, removeItem];
}

/**
 * Listen for storage changes from other tabs.
 */
export function useStorageSync<T>(
  key: string,
  setter: (value: T) => void
): void {
  const prefixedKey = `${STORAGE_PREFIX}${key}`;

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === prefixedKey && e.newValue !== null) {
        try {
          setter(JSON.parse(e.newValue) as T);
        } catch {
          // ignore parse errors
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [prefixedKey, setter]);
}
