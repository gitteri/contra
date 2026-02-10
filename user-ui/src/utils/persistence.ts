import type { User, AdminState } from '../types/user.ts';

const STORAGE_KEY = 'contra-sim-state';
const LEGACY_COUNT_KEY = 'contra-user-count';

export type PayoutMode = 'auto' | 'manual';

export interface PersistedState {
  users: User[];
  adminState: AdminState;
  selectedId: string;
  userCount: number;
  payoutMode?: PayoutMode;
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded or private browsing -- ignore */
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Basic validation
    if (
      !Array.isArray(parsed.users) ||
      parsed.users.length < 2 ||
      !parsed.adminState ||
      typeof parsed.userCount !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_COUNT_KEY);
  } catch {
    /* ignore */
  }
}
