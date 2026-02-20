import { useState, useEffect } from 'react';

interface AdminWithdrawalDrawerProps {
  open: boolean;
  onClose: () => void;
  treasuryBalance: number;
  onWithdraw: (amount: number, destination: string) => Promise<void>;
}

export function AdminWithdrawalDrawer({
  open,
  onClose,
  treasuryBalance,
  onWithdraw,
}: AdminWithdrawalDrawerProps) {
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);

  // Reset form when drawer opens/closes
  useEffect(() => {
    if (open) {
      setAmount('');
      setDestination('');
      setError(null);
      setAmountError(null);
      setDestinationError(null);
      setIsProcessing(false);
    }
  }, [open]);

  const validateAmount = (value: string): string | null => {
    const numAmount = parseFloat(value);

    if (!value || value.trim() === '') {
      return 'Amount is required';
    }

    if (isNaN(numAmount)) {
      return 'Invalid amount';
    }

    if (numAmount <= 0) {
      return 'Amount must be greater than 0';
    }

    if (numAmount > treasuryBalance) {
      return `Amount exceeds treasury balance (${treasuryBalance.toFixed(2)} USDA)`;
    }

    return null;
  };

  const validateDestination = (addr: string): string | null => {
    // Destination is required for admin
    if (!addr || addr.trim() === '') {
      return 'Destination wallet is required';
    }

    // Basic format check (base58, typical length)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!base58Regex.test(addr)) {
      return 'Invalid Solana wallet address format';
    }

    // Check for system program address
    if (addr === '11111111111111111111111111111111') {
      return 'Cannot withdraw to system program address';
    }

    return null;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAmount(value);
    setAmountError(validateAmount(value));
    setError(null);
  };

  const handleDestinationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDestination(value);
    setError(null);
  };

  const handleDestinationBlur = () => {
    setDestinationError(validateDestination(destination));
  };

  const handleMaxClick = () => {
    const maxAmount = treasuryBalance.toFixed(2);
    setAmount(maxAmount);
    setAmountError(validateAmount(maxAmount));
  };

  const handleConfirm = async () => {
    if (isProcessing) return;

    // Validate before submitting
    const amountErr = validateAmount(amount);
    const destErr = validateDestination(destination);

    if (amountErr || destErr) {
      setAmountError(amountErr);
      setDestinationError(destErr);
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      await onWithdraw(parseFloat(amount), destination);
      // Success: parent closes drawer and shows toast
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isProcessing) {
      onClose();
    }

    if (e.key === 'Enter' && canConfirm && !isProcessing) {
      handleConfirm();
    }
  };

  const canConfirm =
    amount &&
    parseFloat(amount) > 0 &&
    parseFloat(amount) <= treasuryBalance &&
    destination &&
    destination.trim() !== '' &&
    !amountError &&
    !destinationError &&
    !isProcessing;

  return (
    <>
      <div
        className={`withdrawal-overlay ${open ? 'withdrawal-overlay--open' : ''}`}
        onClick={() => !isProcessing && onClose()}
      />
      <div
        className={`withdrawal-drawer ${open ? 'withdrawal-drawer--open' : ''}`}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-labelledby="admin-withdrawal-title"
        aria-describedby="admin-withdrawal-description"
      >
        <div className="withdrawal-drawer-header">
          <h2 id="admin-withdrawal-title">Withdraw Treasury Funds</h2>
          <button
            className="withdrawal-close"
            onClick={onClose}
            disabled={isProcessing}
            type="button"
            aria-label="Close withdrawal dialog"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="withdrawal-body" id="admin-withdrawal-description">
          {/* Balance section */}
          <div className="withdrawal-balance-section">
            <div className="withdrawal-balance-label">Treasury Balance</div>
            <div className="withdrawal-balance-amount">
              {treasuryBalance.toFixed(2)} USDA
            </div>
          </div>

          {/* Amount input */}
          <div className="withdrawal-field">
            <label htmlFor="admin-amount-input" className="withdrawal-label">
              Amount to Withdraw
              <span className="withdrawal-label-required" aria-label="required">
                *
              </span>
            </label>
            <div className="withdrawal-input-group">
              <input
                id="admin-amount-input"
                className={`withdrawal-input${amountError ? ' withdrawal-input--error' : ''}`}
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={handleAmountChange}
                disabled={isProcessing}
                aria-required="true"
                aria-invalid={!!amountError}
                aria-describedby={amountError ? 'admin-amount-error' : undefined}
              />
              <button
                className="withdrawal-max-button"
                onClick={handleMaxClick}
                disabled={isProcessing}
                type="button"
              >
                Max
              </button>
            </div>
            {amountError && (
              <div id="admin-amount-error" role="alert" className="withdrawal-field-error">
                {amountError}
              </div>
            )}
          </div>

          {/* Destination input */}
          <div className="withdrawal-field">
            <label htmlFor="admin-destination-input" className="withdrawal-label">
              Destination Wallet (Mainnet Solana)
              <span className="withdrawal-label-required" aria-label="required">
                *
              </span>
            </label>
            <input
              id="admin-destination-input"
              className={`withdrawal-input${destinationError ? ' withdrawal-input--error' : ''}`}
              type="text"
              placeholder="Solana wallet address"
              value={destination}
              onChange={handleDestinationChange}
              onBlur={handleDestinationBlur}
              disabled={isProcessing}
              aria-required="true"
              aria-invalid={!!destinationError}
              aria-describedby={destinationError ? 'admin-destination-error' : undefined}
            />
            {destinationError && (
              <div id="admin-destination-error" role="alert" className="withdrawal-field-error">
                {destinationError}
              </div>
            )}
          </div>

          {/* General error display */}
          {error && (
            <div className="withdrawal-error">
              <span className="withdrawal-error-icon">⚠️</span>
              <span className="withdrawal-error-message">{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="withdrawal-actions">
            <button
              className="withdrawal-cancel-button"
              onClick={onClose}
              disabled={isProcessing}
              type="button"
            >
              Cancel
            </button>
            <button
              className="withdrawal-confirm-button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              type="button"
              aria-busy={isProcessing}
              aria-live="polite"
            >
              {isProcessing ? 'Processing...' : 'Confirm Withdrawal'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
