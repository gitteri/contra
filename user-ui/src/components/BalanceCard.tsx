import { formatBalance } from '../utils/formatters.ts';

interface BalanceCardProps {
  balance: number;
}

export function BalanceCard({ balance }: BalanceCardProps) {
  return (
    <div className="balance-card">
      <div className="balance-label">USDA Balance</div>
      <div>
        <span className="balance-amount">{formatBalance(balance)}</span>
        <span className="balance-currency">USDA</span>
      </div>
    </div>
  );
}
