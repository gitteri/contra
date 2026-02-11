import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { User, Transaction, AdminState } from '../types/user.ts';
import type { NetworkTransaction } from '../components/NetworkView.tsx';
import { generateUsers, fakePublicKey } from '../utils/nameGenerator.ts';
import { saveState, loadState, clearState } from '../utils/persistence.ts';
import type { PayoutMode } from '../utils/persistence.ts';

const DEFAULT_USER_COUNT = 10;
const ADMIN_STARTING_BALANCE = 1_000_000;
const SAVE_DEBOUNCE_MS = 300;

/* ------------------------------------------------------------------ */
/*  Builders (only used on first visit / after user-count change)      */
/* ------------------------------------------------------------------ */

function buildUsers(count: number): User[] {
  return generateUsers(count).map((g) => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    avatarColor: g.avatarColor,
    wallet: { publicKey: g.publicKey },
    balance: 0,
    transactions: [],
  }));
}

function buildAdminState(userIds: string[]): AdminState {
  const pendingPayouts: Record<string, number> = {};
  let totalPending = 0;
  for (const uid of userIds) {
    const amount = Math.round((Math.random() * 90 + 10) * 100) / 100;
    pendingPayouts[uid] = amount;
    totalPending += amount;
  }
  return {
    wallet: { publicKey: fakePublicKey(999_999) },
    balance: ADMIN_STARTING_BALANCE + totalPending,
    pendingPayouts,
  };
}

/* ------------------------------------------------------------------ */
/*  Initial state — hydrate from localStorage or build fresh           */
/* ------------------------------------------------------------------ */

function getInitialState() {
  const saved = loadState();
  if (saved) {
    return {
      userCount: saved.userCount,
      users: saved.users,
      adminState: saved.adminState,
      selectedId: saved.selectedId,
      payoutMode: (saved.payoutMode ?? 'manual') as PayoutMode,
    };
  }
  const count = DEFAULT_USER_COUNT;
  const users = buildUsers(count);
  const adminState = buildAdminState(users.map((u) => u.id));
  return {
    userCount: count,
    users,
    adminState,
    selectedId: 'network' as string,
    payoutMode: 'manual' as PayoutMode,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useUsers() {
  const initial = useRef(getInitialState()).current;

  const [userCount, setUserCountState] = useState(initial.userCount);
  const [users, setUsers] = useState<User[]>(initial.users);
  const [adminState, setAdminState] = useState<AdminState>(initial.adminState);
  const [selectedId, setSelectedId] = useState<string>(initial.selectedId);
  const [payoutMode, setPayoutModeState] = useState<PayoutMode>(initial.payoutMode);
  const [liveTransactionsActive, setLiveTransactionsActive] = useState(false);
  const [networkTransactions, setNetworkTransactions] = useState<NetworkTransaction[]>([]);

  /* ---- Refs for reading latest state without re-triggering effects ---- */
  const usersRef = useRef(users);
  usersRef.current = users;

  const payoutModeRef = useRef(payoutMode);
  useEffect(() => {
    payoutModeRef.current = payoutMode;
  }, [payoutMode]);

  /* ---- Debounced persistence ---- */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState({ users, adminState, selectedId, userCount, payoutMode });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [users, adminState, selectedId, userCount, payoutMode]);

  /* ---- User count change ---- */
  const setUserCount = useCallback((count: number) => {
    const clamped = Math.max(2, Math.min(50, count));
    clearState();
    const newUsers = buildUsers(clamped);
    const newAdmin = buildAdminState(newUsers.map((u) => u.id));
    setUserCountState(clamped);
    setUsers(newUsers);
    setAdminState(newAdmin);
    setSelectedId('network');
    setNetworkTransactions([]);
  }, []);

  /* ---- Payout mode ---- */
  const payOutAllRef = useRef<() => void>(() => {});

  const setPayoutMode = useCallback((mode: PayoutMode) => {
    setPayoutModeState((prev) => {
      if (prev === mode) return prev;
      if (prev === 'manual' && mode === 'auto') {
        setTimeout(() => payOutAllRef.current(), 0);
      }
      return mode;
    });
  }, []);

  /* ---- Derived ---- */
  const isNetworkView = selectedId === 'network';
  const isAdminView = selectedId === 'admin';

  const selectedUser = useMemo(
    () => (isNetworkView || isAdminView ? null : (users.find((u) => u.id === selectedId) ?? users[0])),
    [users, selectedId, isNetworkView, isAdminView],
  );

  /* ---- Transactions ---- */
  const addTransaction = useCallback((userId: string, tx: Transaction) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const balanceDelta = tx.type === 'earning' ? tx.amount : -tx.amount;
        return {
          ...u,
          balance: u.balance + balanceDelta,
          transactions: [tx, ...u.transactions].slice(0, 50),
        };
      }),
    );
  }, []);

  const addNetworkTransaction = useCallback((tx: NetworkTransaction) => {
    setNetworkTransactions((prev) => [...prev, tx]);
    setTimeout(() => {
      setNetworkTransactions((prev) => prev.filter((t) => t.id !== tx.id));
    }, 1500);
  }, []);

  const toggleLiveTransactions = useCallback(() => {
    setLiveTransactionsActive((prev) => !prev);
  }, []);

  /* ---- Pending earnings ---- */
  const addPendingEarning = useCallback((userId: string, amount: number) => {
    setAdminState((prev) => ({
      ...prev,
      pendingPayouts: {
        ...prev.pendingPayouts,
        [userId]: (prev.pendingPayouts[userId] ?? 0) + amount,
      },
    }));
  }, []);

  /* ---- Fire a network animation from admin to a user ---- */
  const firePayoutAnimation = useCallback((userId: string, amount: number) => {
    const netTx: NetworkTransaction = {
      id: `payout-anim-${userId}-${Date.now()}-${Math.random()}`,
      from: 'admin',
      to: userId,
      amount,
      timestamp: performance.now(),
    };
    setNetworkTransactions((prev) => [...prev, netTx]);
    setTimeout(() => {
      setNetworkTransactions((prev) => prev.filter((t) => t.id !== netTx.id));
    }, 1500);
  }, []);

  /* ---- Pay out single user ---- */
  const payOutUser = useCallback((userId: string) => {
    let payoutAmount = 0;

    setAdminState((prev) => {
      payoutAmount = prev.pendingPayouts[userId] ?? 0;
      if (payoutAmount <= 0) return prev;
      return {
        ...prev,
        balance: prev.balance - payoutAmount,
        pendingPayouts: { ...prev.pendingPayouts, [userId]: 0 },
      };
    });

    setTimeout(() => {
      if (payoutAmount <= 0) return;

      firePayoutAnimation(userId, payoutAmount);

      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u;
          const tx: Transaction = {
            id: `payout-${userId}-${Date.now()}`,
            type: 'earning',
            amount: payoutAmount,
            timestamp: Date.now(),
            from: 'admin',
          };
          return {
            ...u,
            balance: u.balance + payoutAmount,
            transactions: [tx, ...u.transactions].slice(0, 50),
          };
        }),
      );
    }, 0);
  }, [firePayoutAnimation]);

  /* ---- Pay out all ---- */
  const payOutAll = useCallback(() => {
    setAdminState((prev) => {
      let totalPaid = 0;
      const payouts: Record<string, number> = {};

      for (const [uid, amount] of Object.entries(prev.pendingPayouts)) {
        if (amount > 0) {
          totalPaid += amount;
          payouts[uid] = amount;
        }
      }

      if (totalPaid <= 0) return prev;

      setTimeout(() => {
        for (const [uid, amount] of Object.entries(payouts)) {
          firePayoutAnimation(uid, amount);
        }

        setUsers((prevUsers) =>
          prevUsers.map((u) => {
            const amount = payouts[u.id];
            if (!amount || amount <= 0) return u;
            const tx: Transaction = {
              id: `payout-${u.id}-${Date.now()}`,
              type: 'earning',
              amount,
              timestamp: Date.now(),
              from: 'admin',
            };
            return {
              ...u,
              balance: u.balance + amount,
              transactions: [tx, ...u.transactions].slice(0, 50),
            };
          }),
        );
      }, 0);

      const clearedPayouts: Record<string, number> = {};
      for (const uid of Object.keys(prev.pendingPayouts)) {
        clearedPayouts[uid] = 0;
      }

      return {
        ...prev,
        balance: prev.balance - totalPaid,
        pendingPayouts: clearedPayouts,
      };
    });
  }, [firePayoutAnimation]);

  /* Keep payOutAllRef current so setPayoutMode can call it */
  payOutAllRef.current = payOutAll;

  /* ---- Live transactions generator ---- */
  useEffect(() => {
    if (!liveTransactionsActive) return;

    let timeout: ReturnType<typeof setTimeout>;

    function tick() {
      // Read current users from ref -- NO nesting state setters inside setUsers
      const currentUsers = usersRef.current;
      if (currentUsers.length === 0) {
        timeout = setTimeout(tick, 1000);
        return;
      }

      const randomUser = currentUsers[Math.floor(Math.random() * currentUsers.length)];
      const amount = Math.round((Math.random() * 40 + 5) * 100) / 100;
      const isAuto = payoutModeRef.current === 'auto';

      // Fire network animation (always, regardless of mode)
      firePayoutAnimation(randomUser.id, amount);

      if (isAuto) {
        // Auto: debit treasury immediately
        setAdminState((prev) => ({
          ...prev,
          balance: prev.balance - amount,
        }));

        // Credit user balance + add activity entry
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id !== randomUser.id) return u;
            const tx: Transaction = {
              id: `auto-${Date.now()}-${Math.random()}`,
              type: 'earning',
              amount,
              timestamp: Date.now(),
              from: 'marketplace',
            };
            return {
              ...u,
              balance: u.balance + amount,
              transactions: [tx, ...u.transactions].slice(0, 50),
            };
          }),
        );
      } else {
        // Manual: accumulate pending
        setAdminState((prev) => ({
          ...prev,
          pendingPayouts: {
            ...prev.pendingPayouts,
            [randomUser.id]: (prev.pendingPayouts[randomUser.id] ?? 0) + amount,
          },
        }));
      }

      const nextDelay = 800 + Math.random() * 1200;
      timeout = setTimeout(tick, nextDelay);
    }

    const firstDelay = 400 + Math.random() * 600;
    timeout = setTimeout(tick, firstDelay);

    return () => clearTimeout(timeout);
  }, [liveTransactionsActive, firePayoutAnimation]);

  return {
    users,
    userCount,
    setUserCount,
    selectedId,
    setSelectedId,
    isNetworkView,
    isAdminView,
    selectedUser,
    adminState,
    payoutMode,
    setPayoutMode,
    liveTransactionsActive,
    toggleLiveTransactions,
    addTransaction,
    networkTransactions,
    addNetworkTransaction,
    addPendingEarning,
    payOutUser,
    payOutAll,
  };
}
