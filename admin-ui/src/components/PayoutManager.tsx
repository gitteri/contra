import { useState, useRef, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useWalletStandardAccount } from '../hooks/useWalletStandardAccount';
import { useCluster } from '../hooks/useCluster';
import { useLocalStorage, useRecentItems } from '../hooks/useLocalStorage';
import { address } from '@solana/addresses';
import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import type { UiWalletAccount } from '@wallet-standard/react';
import { getBase58Decoder } from '@solana/codecs-strings';
import { createSolanaRpc } from '@solana/rpc';
import { CONTRA_READ_URL, CONTRA_WRITE_URL } from '../utils/contraRpc';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferInstruction,
} from '@solana-program/token';
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signAndSendTransactionMessageWithSigners,
  assertIsTransactionMessageWithSingleSendingSigner,
} from '@solana/kit';
import { parseCsv } from '../utils/csvParser';
import type { PayoutRow } from '../types/activity';

const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;

export function PayoutManager() {
  const { connected } = useWallet();
  const account = useWalletStandardAccount();
  const { network } = useCluster();

  if (!connected || !account) {
    return (
      <div className="card">
        <h2>Mass Payout</h2>
        <p className="card-description">
          Import a CSV to send batch SPL token transfers on Contra
        </p>
        <div className="error-message">Connect your wallet to use payouts</div>
      </div>
    );
  }

  return <PayoutContent account={account} network={network} />;
}

interface PayoutContentProps {
  account: UiWalletAccount;
  network: string;
}

function PayoutContent({ account, network }: PayoutContentProps) {
  const [savedMint] = useLocalStorage<string>('lastMintAddress', '');
  const [mintAddress, setMintAddress] = useState(savedMint);
  const [recentMints] = useRecentItems('recentMints', 5);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [batchSize, setBatchSize] = useState(1);
  const [error, setError] = useState('');
  const [csvText, setCsvText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  const chainId = (network === 'localnet' ? 'solana:devnet' : `solana:${network}`) as `solana:${string}`;
  const transactionSigner = useWalletAccountTransactionSendingSigner(account, chainId);
  const walletAddress = account.address;

  const truncateAddress = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  // -- CSV parsing --
  const handleCsvInput = useCallback((text: string) => {
    setCsvText(text);
    const { rows: parsed, errors } = parseCsv(text);
    setRows(parsed);
    setParseErrors(errors);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      handleCsvInput(text);
    };
    reader.readAsText(file);
  }, [handleCsvInput]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      handleCsvInput(text);
    };
    reader.readAsText(file);
  }, [handleCsvInput]);

  // -- Execution --
  const executePayout = async (row: PayoutRow): Promise<{ signature: string } | { error: string }> => {
    const mint = row.mint || mintAddress;
    if (!mint) return { error: 'No mint address' };

    try {
      const contraRead = createSolanaRpc(CONTRA_READ_URL);

      const recipient = address(row.address);
      const rawAmount = BigInt(row.amount);

      // Find ATAs
      const [sourceAta] = await findAssociatedTokenPda({
        mint: address(mint),
        owner: address(walletAddress),
        tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
      });

      const [destinationAta] = await findAssociatedTokenPda({
        mint: address(mint),
        owner: recipient,
        tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
      });

      // Check if destination ATA exists
      const destInfo = await contraRead
        .getAccountInfo(destinationAta, { encoding: 'base64' })
        .send();

      // Build instructions
      const transferIx = getTransferInstruction({
        source: sourceAta,
        destination: destinationAta,
        authority: transactionSigner,
        amount: rawAmount,
      });

      // Get blockhash
      const { value: latestBlockhash } = await contraRead
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send();

      let txMessage;

      if (!destInfo.value) {
        // Need to create ATA first
        const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
          payer: transactionSigner,
          ata: destinationAta,
          owner: recipient,
          mint: address(mint),
        });

        txMessage = pipe(
          createTransactionMessage({ version: 'legacy' }),
          (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstructions([createAtaIx, transferIx], m),
        );
      } else {
        txMessage = pipe(
          createTransactionMessage({ version: 'legacy' }),
          (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstruction(transferIx, m),
        );
      }

      assertIsTransactionMessageWithSingleSendingSigner(txMessage);
      const sigBytes = await signAndSendTransactionMessageWithSigners(txMessage);
      const signature = getBase58Decoder().decode(sigBytes);

      return { signature };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Transfer failed' };
    }
  };

  const handleExecute = async () => {
    if (!mintAddress || rows.length === 0) return;

    setIsExecuting(true);
    abortRef.current = false;
    setError('');

    // Process in sequential batches
    for (let i = 0; i < rows.length; i += batchSize) {
      if (abortRef.current) break;

      const batch = rows.slice(i, i + batchSize);

      // Mark batch as sending
      setRows((prev) =>
        prev.map((r) =>
          batch.some((b) => b.id === r.id) && r.status === 'pending'
            ? { ...r, status: 'sending' }
            : r
        )
      );

      // Execute batch concurrently
      const results = await Promise.all(
        batch
          .filter((r) => r.status === 'pending' || r.status === 'sending')
          .map(async (row) => {
            const result = await executePayout(row);
            return { id: row.id, result };
          })
      );

      // Update rows with results
      setRows((prev) =>
        prev.map((r) => {
          const res = results.find((x) => x.id === r.id);
          if (!res) return r;
          if ('signature' in res.result) {
            return { ...r, status: 'confirmed', signature: res.result.signature };
          } else {
            return { ...r, status: 'failed', error: res.result.error };
          }
        })
      );
    }

    setIsExecuting(false);
  };

  const handleAbort = () => {
    abortRef.current = true;
  };

  const handleReset = () => {
    setRows([]);
    setParseErrors([]);
    setCsvText('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const confirmedCount = rows.filter((r) => r.status === 'confirmed').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const sendingCount = rows.filter((r) => r.status === 'sending').length;
  const totalAmount = rows.reduce((sum, r) => sum + BigInt(r.amount || '0'), 0n);

  return (
    <div className="card">
      <h2>Mass Payout</h2>
      <p className="card-description">
        Import a CSV to send batch SPL token transfers on Contra
      </p>

      {error && <div className="error-message">{error}</div>}

      {/* Mint selection */}
      <div className="function-section">
        <h3>Token Mint</h3>
        <div className="form-group">
          <label>Mint Address (used for all rows without a mint column)</label>
          <input
            type="text"
            value={mintAddress}
            onChange={(e) => setMintAddress(e.target.value)}
            placeholder="Enter token mint address"
            className="input"
          />
          {recentMints.length > 0 && (
            <div className="recent-items recent-items-inline">
              <span className="recent-label">Recent mints</span>
              <div className="recent-list">
                {recentMints.map((addr) => (
                  <button
                    key={addr}
                    className="recent-item"
                    onClick={() => setMintAddress(addr)}
                    title={addr}
                  >
                    <span className="recent-item-text">{truncateAddress(addr)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSV Import */}
      <div className="function-section">
        <h3>Import CSV</h3>
        <p className="info-text">
          CSV format: <code>address, amount</code> (header optional). Amounts in raw token units.
        </p>

        <div
          className="csv-dropzone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="csv-dropzone-text">
            Drop a CSV file here, or click to browse
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>

        <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
          <label>Or paste CSV content</label>
          <textarea
            value={csvText}
            onChange={(e) => handleCsvInput(e.target.value)}
            placeholder={"address, amount\nAbc123...xyz, 1000000\nDef456...uvw, 2000000"}
            className="input textarea"
            rows={5}
          />
        </div>

        {parseErrors.length > 0 && (
          <div className="alert alert-warning">
            <span className="alert-title">Parse Warnings</span>
            <span className="alert-body">{parseErrors.join('\n')}</span>
          </div>
        )}
      </div>

      {/* Review */}
      {rows.length > 0 && (
        <div className="function-section">
          <h3>Review ({rows.length} recipients)</h3>

          <div className="payout-summary">
            <div className="payout-summary-item">
              <span className="payout-summary-label">Recipients</span>
              <span className="payout-summary-value">{rows.length}</span>
            </div>
            <div className="payout-summary-item">
              <span className="payout-summary-label">Total Amount</span>
              <span className="payout-summary-value">{totalAmount.toString()}</span>
            </div>
            <div className="payout-summary-item">
              <span className="payout-summary-label">Confirmed</span>
              <span className="payout-summary-value payout-confirmed">{confirmedCount}</span>
            </div>
            <div className="payout-summary-item">
              <span className="payout-summary-label">Failed</span>
              <span className="payout-summary-value payout-failed">{failedCount}</span>
            </div>
          </div>

          {/* Batch size control */}
          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label>Concurrent batch size</label>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
              min="1"
              max="10"
              className="input"
              style={{ maxWidth: '120px' }}
              disabled={isExecuting}
            />
          </div>

          {/* Progress bar */}
          {(confirmedCount + failedCount) > 0 && (
            <div className="payout-progress">
              <div
                className="payout-progress-fill"
                style={{ width: `${((confirmedCount + failedCount) / rows.length) * 100}%` }}
              />
            </div>
          )}

          {/* Actions */}
          <div className="button-group" style={{ marginTop: 'var(--space-4)' }}>
            {!isExecuting ? (
              <button
                className="button button-primary"
                onClick={handleExecute}
                disabled={!mintAddress || pendingCount === 0}
              >
                Execute {pendingCount} Payouts
              </button>
            ) : (
              <button className="button button-danger" onClick={handleAbort}>
                Abort ({sendingCount} sending...)
              </button>
            )}
            <button className="button" onClick={handleReset} disabled={isExecuting}>
              Reset
            </button>
          </div>

          {/* Row table */}
          <div className="payout-table-wrap">
            <table className="payout-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={`payout-row-${row.status}`}>
                    <td>{row.id + 1}</td>
                    <td className="mono" title={row.address}>
                      {truncateAddress(row.address)}
                    </td>
                    <td>{row.amount}</td>
                    <td>
                      <span className={`payout-status payout-status-${row.status}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="mono">
                      {row.signature ? (
                        <span title={row.signature}>{row.signature.slice(0, 12)}...</span>
                      ) : row.error ? (
                        <span className="payout-error" title={row.error}>
                          {row.error.slice(0, 30)}
                        </span>
                      ) : (
                        '---'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
