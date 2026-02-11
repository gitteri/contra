import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { User, Transaction, AdminState } from '../types/user.ts';
import type { NetworkTransaction } from '../components/NetworkView.tsx';
import { generateUsers } from '../utils/nameGenerator.ts';
import { saveState, loadState, clearState } from '../utils/persistence.ts';
import type { PayoutMode } from '../utils/persistence.ts';
import { getAdminAddress, loadOrGenerateAdminWallet } from '../utils/adminWallet.ts';
import { loadUserWallet } from '../utils/walletStorage';
import { useBalances } from './useBalances';
import { useContraWebSocket, type ContraTransaction } from './useContraWebSocket';
import { getPendingPayouts } from '../utils/contractState';
import { formatBalance, getTokenBalance, toLamports } from '../utils/queries';
import { useSolana } from '../context/SolanaContext';
import { address } from '@solana/addresses';
import { useAdminSigner } from './useAdminSigner';
import { buildPayoutTransaction, buildWithdrawalTransaction, sendWithRetry, validateSolanaAddress } from '../utils/transactions';
import { useToasts } from './useToasts';
import { getExplorerUrl } from '../utils/explorer';

const DEFAULT_USER_COUNT = 10;
const ADMIN_STARTING_BALANCE = 1_000_000;
const SAVE_DEBOUNCE_MS = 300;

/* ------------------------------------------------------------------ */
/*  Builders (only used on first visit / after user-count change)      */
/* ------------------------------------------------------------------ */

async function buildUsers(count: number): Promise<User[]> {
  const generatedUsers = await generateUsers(count);
  return generatedUsers.map((g) => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    avatarColor: g.avatarColor,
    wallet: { publicKey: g.publicKey },
    balance: 0,
    transactions: [],
  }));
}

function buildAdminState(adminAddress: string | null): AdminState {
  // Pending payouts will be fetched from contract
  return {
    wallet: { publicKey: adminAddress || 'Not configured' },
    balance: ADMIN_STARTING_BALANCE, // Will be fetched from RPC
    pendingPayouts: {},
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
  // Return a placeholder - we'll generate users asynchronously
  return {
    userCount: DEFAULT_USER_COUNT,
    users: [] as User[],
    adminState: buildAdminState(null),
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
  const [pendingPayouts, setPendingPayouts] = useState<Map<string, number>>(new Map());
  const [escrowBalance, setEscrowBalance] = useState<number>(0);
  const [adminBalance, setAdminBalance] = useState<number>(ADMIN_STARTING_BALANCE);
  const [payoutsInProgress, setPayoutsInProgress] = useState<Set<string>>(new Set());
  const [payoutErrors, setPayoutErrors] = useState<Map<string, Error>>(new Map());
  const [recentAutoPayouts, setRecentAutoPayouts] = useState<Map<string, { amount: number; timestamp: number }>>(new Map());
  const [withdrawalsInProgress, setWithdrawalsInProgress] = useState<Set<string>>(new Set());
  const [withdrawalErrors, setWithdrawalErrors] = useState<Map<string, Error>>(new Map());

  const { rpc, rpcWrite} = useSolana();
  const adminSigner = useAdminSigner();
  const { toasts, dismissToast, showSuccess, showError } = useToasts();

  // Track previous balances to detect increases
  const previousBalancesRef = useRef<Map<string, number>>(new Map());

  // Get all wallet addresses for balance fetching
  const walletAddresses = useMemo(() => {
    if (users.length === 0) return [];
    return users.map(u => address(u.wallet.publicKey));
  }, [users]);

  // Fetch real balances from blockchain
  const { balances, isLoading: isLoadingBalances, error: balancesError, refetch: refetchBalances } = useBalances(walletAddresses);

  // Handle incoming transactions from WebSocket
  const handleWebSocketTransaction = useCallback((tx: ContraTransaction) => {
    console.log('[useUsers] Received transaction:', tx);

    // Check if transaction involves any of our users
    const userAddresses = users.map(u => u.wallet.publicKey);

    if (userAddresses.includes(tx.from) || userAddresses.includes(tx.to)) {
      // Refetch balances for affected users
      refetchBalances();

      // Add to network animation
      const amount = tx.amount ? parseFloat(tx.amount) : 0;
      addNetworkTransaction({
        id: tx.signature,
        from: tx.from,
        to: tx.to,
        amount,
        timestamp: Date.now(),
      });
    }
  }, [users, refetchBalances]);

  // Connect to WebSocket
  useContraWebSocket(handleWebSocketTransaction, liveTransactionsActive);

  /* ---- Initialize users and admin wallet on mount ---- */
  useEffect(() => {
    async function initialize() {
      // If we have saved state with users, we're already initialized
      if (initial.users.length > 0) {
        // Still need to initialize admin wallet for signing
        try {
          await loadOrGenerateAdminWallet();
        } catch (error) {
          console.error('Failed to initialize admin wallet:', error);
        }
        return;
      }

      try {
        // Load or generate admin wallet (needed for transactions)
        const adminSigner = await loadOrGenerateAdminWallet();
        const adminAddress = adminSigner.address;

        // Generate initial users
        console.log('Generating users...');
        const newUsers = await buildUsers(initial.userCount);
        console.log('Generated users:', newUsers.length);
        const newAdmin = buildAdminState(adminAddress);

        setUsers(newUsers);
        setAdminState(newAdmin);
      } catch (error) {
        console.error('Failed to initialize users:', error);
      }
    }

    initialize();
  }, []); // Only run once on mount

  /* ---- Fetch pending payouts from escrow contract (ONLY ON INITIAL LOAD) ---- */
  useEffect(() => {
    async function fetchPendingPayouts() {
      if (users.length === 0) return;

      try {
        const instanceAddr = address(import.meta.env.VITE_INSTANCE_ADDRESS as string);
        const addresses = users.map(u => address(u.wallet.publicKey));

        const payouts = await getPendingPayouts(addresses, instanceAddr, rpc);

        // Convert to display format with userId keys
        const displayPayouts = new Map<string, number>();
        users.forEach(u => {
          const addr = address(u.wallet.publicKey);
          const amount = payouts.get(addr) || 0n;
          displayPayouts.set(u.id, formatBalance(amount));
        });

        setPendingPayouts(displayPayouts);
        console.log('[useUsers] Fetched initial pending payouts from contract');
      } catch (error) {
        console.error('Failed to fetch pending payouts:', error);
      }
    }

    // Only fetch once when users are first loaded
    if (users.length > 0 && pendingPayouts.size === 0) {
      fetchPendingPayouts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users.length]); // Only depend on users.length, not the full users array

  /* ---- Fetch escrow balance ---- */
  useEffect(() => {
    async function fetchEscrowBalance() {
      try {
        const instanceAddr = address(import.meta.env.VITE_INSTANCE_ADDRESS as string);
        const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);

        const balance = await getTokenBalance(instanceAddr, mintAddr, rpc);
        setEscrowBalance(formatBalance(balance));
      } catch (error) {
        console.error('Failed to fetch escrow balance:', error);
      }
    }

    fetchEscrowBalance();

    // Poll every 10 seconds
    const interval = setInterval(fetchEscrowBalance, 10000);
    return () => clearInterval(interval);
  }, [rpc]);

  /* ---- Fetch admin balance ---- */
  useEffect(() => {
    async function fetchAdminBalance() {
      const adminAddress = getAdminAddress();
      if (!adminAddress) return;

      try {
        const adminAddr = address(adminAddress);
        const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);

        const balance = await getTokenBalance(adminAddr, mintAddr, rpc);
        setAdminBalance(formatBalance(balance));
      } catch (error) {
        console.error('Failed to fetch admin balance:', error);
      }
    }

    fetchAdminBalance();

    // Poll every 10 seconds
    const interval = setInterval(fetchAdminBalance, 10000);
    return () => clearInterval(interval);
  }, [rpc]);

  /* ---- Refs for reading latest state without re-triggering effects ---- */
  const usersRef = useRef(users);
  usersRef.current = users;

  const payoutModeRef = useRef(payoutMode);
  useEffect(() => {
    payoutModeRef.current = payoutMode;
  }, [payoutMode]);

  /* ---- Detect balance increases in auto mode and show flash ---- */
  useEffect(() => {
    if (payoutMode !== 'auto') return;

    // Compare current balances to previous balances
    users.forEach(user => {
      const addr = address(user.wallet.publicKey);
      const currentBalance = balances.get(addr) ?? 0;
      const previousBalance = previousBalancesRef.current.get(addr) ?? 0;

      if (currentBalance > previousBalance) {
        const increase = currentBalance - previousBalance;
        console.log(`[Balance Increase] ${user.firstName}: +${increase.toFixed(2)} USDA`);

        // Show flash indicator
        setRecentAutoPayouts((prev) => {
          const next = new Map(prev);
          next.set(user.id, { amount: increase, timestamp: Date.now() });
          return next;
        });

        // Clear after 3 seconds
        setTimeout(() => {
          setRecentAutoPayouts((prev) => {
            const next = new Map(prev);
            const existing = next.get(user.id);
            // Only clear if it's the same timestamp (to avoid clearing newer flashes)
            if (existing && Date.now() - existing.timestamp >= 3000) {
              next.delete(user.id);
            }
            return next;
          });
        }, 3000);
      }

      // Update previous balance
      previousBalancesRef.current.set(addr, currentBalance);
    });
  }, [balances, users, payoutMode]);

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

    // Generate users asynchronously
    buildUsers(clamped).then((newUsers) => {
      const adminAddress = getAdminAddress();
      const newAdmin = buildAdminState(adminAddress);
      setUserCountState(clamped);
      setUsers(newUsers);
      setAdminState(newAdmin);
      setSelectedId('network');
      setNetworkTransactions([]);
    });
  }, []);

  /* ---- Payout mode ---- */
  const payOutAllRef = useRef<() => void>(() => {});
  const modeTransitionRef = useRef<{ from: PayoutMode; to: PayoutMode } | null>(null);

  const setPayoutMode = useCallback((mode: PayoutMode) => {
    setPayoutModeState((prev) => {
      if (prev === mode) return prev;

      // Track mode transition to prevent duplicate calls
      if (prev === 'manual' && mode === 'auto') {
        // Only trigger payOutAll once per transition
        if (!modeTransitionRef.current || modeTransitionRef.current.from !== prev || modeTransitionRef.current.to !== mode) {
          modeTransitionRef.current = { from: prev, to: mode };
          setTimeout(() => {
            payOutAllRef.current();
            // Clear transition tracking after execution
            setTimeout(() => { modeTransitionRef.current = null; }, 100);
          }, 0);
        }
      }

      return mode;
    });
  }, []);

  /* ---- Computed users with real balances ---- */
  const usersWithRealData = useMemo(() => {
    return users.map(u => {
      const addr = address(u.wallet.publicKey);
      const realBalance = balances.get(addr) ?? 0;
      const pendingEarnings = pendingPayouts.get(u.id) ?? 0;

      return {
        ...u,
        balance: realBalance,
        pendingEarnings,
      };
    });
  }, [users, balances, pendingPayouts]);

  /* ---- Computed admin state with real pending payouts and balance ---- */
  const adminStateWithRealData = useMemo(() => {
    const pendingPayoutsRecord: Record<string, number> = {};
    pendingPayouts.forEach((amount, userId) => {
      pendingPayoutsRecord[userId] = amount;
    });

    return {
      ...adminState,
      balance: adminBalance,
      pendingPayouts: pendingPayoutsRecord,
    };
  }, [adminState, pendingPayouts, adminBalance]);

  /* ---- Derived ---- */
  const isNetworkView = selectedId === 'network';
  const isAdminView = selectedId === 'admin';

  const selectedUser = useMemo(
    () => (isNetworkView || isAdminView ? null : (usersWithRealData.find((u) => u.id === selectedId) ?? usersWithRealData[0])),
    [usersWithRealData, selectedId, isNetworkView, isAdminView],
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
  const payOutUser = useCallback(async (userId: string, silent = false) => {
    console.log('payOutUser called for userId:', userId);

    const user = users.find(u => u.id === userId);
    if (!user) {
      console.error('User not found:', userId);
      return { success: false, error: 'User not found' };
    }

    const pendingAmount = pendingPayouts.get(userId) ?? 0;
    console.log('Pending amount:', pendingAmount);
    if (pendingAmount <= 0) {
      console.warn('No pending amount for user:', userId);
      return { success: false, error: 'No pending amount' };
    }

    console.log('Admin signer status:', adminSigner ? 'available' : 'null');
    if (!adminSigner) {
      console.error('Admin signer not available - cannot execute payout');
      if (!silent) {
        showError('Admin wallet not initialized', {
          message: 'Please refresh the page to reinitialize the admin wallet',
          duration: 10000,
        });
      }
      return { success: false, error: 'Admin wallet not initialized' };
    }

    try {
      // Set loading state
      setPayoutsInProgress(prev => new Set(prev).add(userId));
      setPayoutErrors(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });

      // Convert to lamports
      const amountLamports = toLamports(pendingAmount);

      // Build and send transaction with retry logic
      const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);
      const userAddr = address(user.wallet.publicKey);

      const signature = await sendWithRetry(
        () => buildPayoutTransaction(adminSigner, userAddr, amountLamports, mintAddr, rpc),
        rpcWrite  // Use write endpoint for sending
      );

      console.log('Payout successful:', signature);

      // Show success toast (unless silent)
      if (!silent) {
        showSuccess(
          `Paid ${pendingAmount.toFixed(2)} USDA to ${user.firstName} ${user.lastName}`,
          {
            message: 'Transaction confirmed',
            link: {
              href: getExplorerUrl(signature),
              label: 'View on Explorer'
            },
            duration: 7000,
          }
        );
      }

      // Update UI state - clear pending payout
      setPendingPayouts((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });

      // Add transaction to user's history
      const tx: Transaction = {
        id: signature,
        type: 'earning',
        amount: pendingAmount,
        timestamp: Date.now(),
        from: 'admin',
      };

      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u;
          return {
            ...u,
            transactions: [tx, ...u.transactions].slice(0, 50),
          };
        })
      );

      // Fire animation
      firePayoutAnimation(userId, pendingAmount);

      // Refetch balances after transaction
      setTimeout(() => refetchBalances(), 1000);

      return { success: true, signature, user, amount: pendingAmount };
    } catch (error) {
      console.error('Payout failed:', error);
      setPayoutErrors(prev => new Map(prev).set(userId, error as Error));

      // Show error toast (unless silent)
      if (!silent) {
        showError(
          `Failed to pay ${user.firstName} ${user.lastName}`,
          {
            message: error instanceof Error ? error.message : 'Unknown error occurred',
            duration: 10000,
          }
        );
      }

      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', user };
    } finally {
      setPayoutsInProgress(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }, [users, pendingPayouts, adminSigner, rpc, rpcWrite, refetchBalances, firePayoutAnimation, showSuccess, showError]);

  /* ---- Pay out all ---- */
  const payOutAll = useCallback(async () => {
    const usersToPay = users.filter(u => {
      const pending = pendingPayouts.get(u.id) ?? 0;
      return pending > 0;
    });

    if (usersToPay.length === 0) return;

    if (!adminSigner) {
      console.error('Admin signer not available - cannot execute payouts');
      showError('Admin wallet not initialized', {
        message: 'Please refresh the page to reinitialize the admin wallet',
        duration: 10000,
      });
      return;
    }

    console.log(`Paying out ${usersToPay.length} users in parallel...`);

    // Execute all payouts in parallel for maximum speed (silently - no individual toasts)
    const results = await Promise.all(usersToPay.map(user => payOutUser(user.id, true)));

    // Count successes and failures
    const successes = results.filter(r => r?.success);
    const failures = results.filter(r => r && !r.success);

    console.log('All payouts complete:', { successes: successes.length, failures: failures.length });

    // Show single summary toast
    if (failures.length === 0) {
      // All succeeded
      const totalAmount = successes.reduce((sum, r) => sum + (r?.amount || 0), 0);
      showSuccess(
        `Successfully paid ${successes.length} user${successes.length !== 1 ? 's' : ''}`,
        {
          message: `Total: ${totalAmount.toFixed(2)} USDA`,
          duration: 7000,
        }
      );
    } else if (successes.length === 0) {
      // All failed
      showError(
        `Failed to pay ${failures.length} user${failures.length !== 1 ? 's' : ''}`,
        {
          message: 'Please try again or check individual payouts',
          duration: 10000,
        }
      );
    } else {
      // Mixed results
      showSuccess(
        `Paid ${successes.length} of ${usersToPay.length} users`,
        {
          message: `${failures.length} failed - check status for details`,
          duration: 10000,
        }
      );
    }
  }, [users, pendingPayouts, adminSigner, payOutUser, showSuccess, showError]);

  /* Keep payOutAllRef current so setPayoutMode can call it */
  payOutAllRef.current = payOutAll;

  /* ---- Withdraw user funds (Contra → Mainnet Solana) ---- */
  const withdrawUser = useCallback(async (
    userId: string,
    amount: number,
    destinationAddress: string
  ): Promise<void> => {
    const user = users.find(u => u.id === userId);
    if (!user) {
      console.error('User not found:', userId);
      showError('User not found');
      throw new Error('User not found');
    }

    // Validate amount
    if (amount <= 0) {
      showError('Invalid amount', { message: 'Amount must be greater than 0' });
      throw new Error('Amount must be greater than 0');
    }

    const userBalance = balances.get(address(user.wallet.publicKey)) ?? 0;
    if (amount > userBalance) {
      showError('Insufficient balance', {
        message: `Available: ${userBalance.toFixed(2)} USDA`,
      });
      throw new Error('Insufficient balance');
    }

    // Load user signer
    const userSigner = await loadUserWallet(userId);
    if (!userSigner) {
      showError('User wallet not available', {
        message: 'Failed to load wallet for withdrawal',
      });
      throw new Error('User wallet not available');
    }

    try {
      // Set loading state
      setWithdrawalsInProgress(prev => new Set(prev).add(userId));
      setWithdrawalErrors(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });

      // Validate and parse destination address (required for mainnet bridging)
      if (!validateSolanaAddress(destinationAddress)) {
        throw new Error('Invalid destination address format');
      }
      const destination = address(destinationAddress);

      // Convert to lamports
      const amountLamports = toLamports(amount);
      const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);

      // Build and send transaction with retry logic
      const signature = await sendWithRetry(
        () => buildWithdrawalTransaction(userSigner, mintAddr, amountLamports, destination, rpc),
        rpcWrite
      );

      console.log('Withdrawal successful:', signature);

      // Show success toast
      showSuccess(
        `Withdrew ${amount.toFixed(2)} USDA for ${user.firstName} ${user.lastName}`,
        {
          message: 'Transaction confirmed on mainnet',
          link: {
            href: getExplorerUrl(signature, 'solana'),
            label: 'View on Solana Explorer'
          },
          duration: 7000,
        }
      );

      // Add transaction to user's history
      const tx: Transaction = {
        id: signature,
        type: 'transfer',
        amount: -amount,
        timestamp: Date.now(),
        to: destinationAddress || 'mainnet',
      };

      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u;
          return {
            ...u,
            transactions: [tx, ...u.transactions].slice(0, 50),
          };
        })
      );

      // Refetch balances after transaction
      setTimeout(() => refetchBalances(), 1000);
    } catch (error) {
      console.error('Withdrawal failed:', error);
      setWithdrawalErrors(prev => new Map(prev).set(userId, error as Error));

      showError(
        `Failed to withdraw for ${user.firstName} ${user.lastName}`,
        {
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          duration: 10000,
        }
      );

      throw error;
    } finally {
      setWithdrawalsInProgress(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }, [users, balances, rpc, rpcWrite, refetchBalances, showSuccess, showError]);

  /* ---- Withdraw admin funds (Contra → Mainnet Solana) ---- */
  const withdrawAdmin = useCallback(async (
    amount: number,
    destinationAddress: string
  ): Promise<void> => {
    // Validate amount
    if (amount <= 0) {
      showError('Invalid amount', { message: 'Amount must be greater than 0' });
      throw new Error('Amount must be greater than 0');
    }

    if (amount > adminBalance) {
      showError('Insufficient balance', {
        message: `Available: ${adminBalance.toFixed(2)} USDA`,
      });
      throw new Error('Insufficient balance');
    }

    if (!adminSigner) {
      showError('Admin wallet not available', {
        message: 'Please refresh to reinitialize admin wallet',
      });
      throw new Error('Admin wallet not available');
    }

    try {
      // Set loading state
      setWithdrawalsInProgress(prev => new Set(prev).add('admin'));
      setWithdrawalErrors(prev => {
        const next = new Map(prev);
        next.delete('admin');
        return next;
      });

      // Validate and parse destination address (required for mainnet bridging)
      if (!validateSolanaAddress(destinationAddress)) {
        throw new Error('Invalid destination address format');
      }
      const destination = address(destinationAddress);

      // Convert to lamports
      const amountLamports = toLamports(amount);
      const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);

      // Build and send transaction with retry logic
      const signature = await sendWithRetry(
        () => buildWithdrawalTransaction(adminSigner, mintAddr, amountLamports, destination, rpc),
        rpcWrite
      );

      console.log('Admin withdrawal successful:', signature);

      // Show success toast
      showSuccess(
        `Admin withdrew ${amount.toFixed(2)} USDA`,
        {
          message: 'Transaction confirmed on mainnet',
          link: {
            href: getExplorerUrl(signature, 'solana'),
            label: 'View on Solana Explorer'
          },
          duration: 7000,
        }
      );

      // Refetch balances after transaction
      setTimeout(() => refetchBalances(), 1000);
    } catch (error) {
      console.error('Admin withdrawal failed:', error);
      setWithdrawalErrors(prev => new Map(prev).set('admin', error as Error));

      showError(
        'Failed to withdraw admin funds',
        {
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          duration: 10000,
        }
      );

      throw error;
    } finally {
      setWithdrawalsInProgress(prev => {
        const next = new Set(prev);
        next.delete('admin');
        return next;
      });
    }
  }, [adminBalance, adminSigner, rpc, rpcWrite, refetchBalances, showSuccess, showError]);

  /* ---- Live transactions generator ---- */
  useEffect(() => {
    if (!liveTransactionsActive) {
      console.log('[Live Transactions] Not active');
      return;
    }

    console.log('[Live Transactions] Starting...');
    let timeout: ReturnType<typeof setTimeout>;

    async function tick() {
      // Read current users from ref -- NO nesting state setters inside setUsers
      const currentUsers = usersRef.current;
      if (currentUsers.length === 0) {
        timeout = setTimeout(tick, 1000);
        return;
      }

      const randomUser = currentUsers[Math.floor(Math.random() * currentUsers.length)];
      const amount = Math.round((Math.random() * 40 + 5) * 100) / 100;
      const isAuto = payoutModeRef.current === 'auto';

      console.log(`[Live Transactions] Generated transaction: ${amount} USDA to ${randomUser.firstName} (mode: ${isAuto ? 'auto' : 'manual'})`);

      // Fire network animation (always, regardless of mode)
      firePayoutAnimation(randomUser.id, amount);

      if (isAuto && adminSigner) {
        // Auto mode: Execute REAL transaction
        try {
          const amountLamports = toLamports(amount);
          const mintAddr = address(import.meta.env.VITE_MINT_ADDRESS as string);
          const userAddr = address(randomUser.wallet.publicKey);

          // Send transaction with retry logic in background (non-blocking)
          sendWithRetry(
            () => buildPayoutTransaction(adminSigner, userAddr, amountLamports, mintAddr, rpc),
            rpcWrite  // Use write endpoint for sending
          )
            .then((signature) => {
              console.log('Auto payout transaction confirmed:', signature);

              // Add to user's transaction history
              setUsers((prev) =>
                prev.map((u) => {
                  if (u.id !== randomUser.id) return u;
                  const tx: Transaction = {
                    id: signature,
                    type: 'earning',
                    amount,
                    timestamp: Date.now(),
                    from: 'marketplace',
                  };
                  return {
                    ...u,
                    transactions: [tx, ...u.transactions].slice(0, 50),
                  };
                })
              );

              // Balances will update via polling, which will trigger the flash animation
              setTimeout(() => refetchBalances(), 1000);
            })
            .catch((error) => {
              console.error('Auto payout failed:', error);
            });
        } catch (error) {
          console.error('Failed to build auto payout transaction:', error);
        }
      } else {
        // Manual mode: Accumulate pending
        setPendingPayouts((prev) => {
          const next = new Map(prev);
          const current = next.get(randomUser.id) ?? 0;
          next.set(randomUser.id, current + amount);
          return next;
        });
      }

      const nextDelay = 800 + Math.random() * 1200;
      timeout = setTimeout(tick, nextDelay);
    }

    const firstDelay = 400 + Math.random() * 600;
    timeout = setTimeout(tick, firstDelay);

    return () => clearTimeout(timeout);
  }, [liveTransactionsActive, firePayoutAnimation, adminSigner, rpc, rpcWrite, refetchBalances]);

  return {
    users: usersWithRealData,
    userCount,
    setUserCount,
    selectedId,
    setSelectedId,
    isNetworkView,
    isAdminView,
    selectedUser,
    adminState: adminStateWithRealData,
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
    isLoadingBalances,
    escrowBalance,
    balancesError,
    refetchBalances,
    payoutsInProgress,
    payoutErrors,
    toasts,
    dismissToast,
    recentAutoPayouts,
    withdrawUser,
    withdrawAdmin,
    withdrawalsInProgress,
    withdrawalErrors,
  };
}
