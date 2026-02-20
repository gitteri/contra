export interface User {
  id: string;
  firstName: string;
  lastName: string;
  avatarColor: string;
  wallet: {
    publicKey: string;
  };
  balance: number;
  transactions: Transaction[];
}

export interface Transaction {
  id: string;
  type: 'earning' | 'transfer';
  amount: number;
  timestamp: number;
  from?: string;
  to?: string;
}

export interface AdminState {
  wallet: { publicKey: string };
  balance: number;
  pendingPayouts: Record<string, number>;
}
