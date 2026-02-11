import type { Address } from '@solana/addresses';
import { address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';
import type { TransactionSigner } from '@solana/signers';
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
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  type TransactionMessage,
} from '@solana/kit';
import { getWithdrawFundsInstructionAsync } from '@contra-withdraw';

const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;

/**
 * Build a payout transaction (admin sends tokens to user on Contra)
 * This is a standard SPL token transfer on the Contra network
 */
export async function buildPayoutTransaction(
  from: TransactionSigner,
  to: Address,
  amount: bigint,
  mintAddress: Address,
  rpc: Rpc<any>
) {
  console.log('[buildPayoutTransaction] Building transaction from:', from.address, 'to:', to, 'amount:', amount);

  // 1. Find source ATA (admin's token account)
  const [sourceAta] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: from.address,
    tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
  });

  // 2. Find destination ATA (user's token account)
  const [destinationAta] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: to,
    tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
  });

  // 3. Get recent blockhash (skip the getAccountInfo check - use idempotent instruction instead)
  const { value: latestBlockhash } = await (rpc as any)
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();

  // 4. Build transaction message - ALWAYS include idempotent ATA creation for speed
  console.log('[buildPayoutTransaction] Building with idempotent ATA creation');

  const createAtaInstruction = getCreateAssociatedTokenIdempotentInstruction({
    payer: from,
    ata: destinationAta,
    owner: to,
    mint: mintAddress,
  });

  const transferInstruction = getTransferInstruction({
    source: sourceAta,
    destination: destinationAta,
    authority: from,
    amount,
  });

  const transactionMessage = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(createAtaInstruction, m),
    (m) => appendTransactionMessageInstruction(transferInstruction, m)
  );

  console.log('[buildPayoutTransaction] Final transaction:', transactionMessage);

  return transactionMessage;
}

/**
 * Send transaction to Contra and confirm
 */
export async function sendAndConfirmTransaction(
  transactionMessage: any, // Accept any type to preserve signer information
  rpc: Rpc<any>
): Promise<string> {
  console.log('[sendAndConfirmTransaction] Transaction message:', transactionMessage);

  // Sign the transaction with the embedded signers
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  console.log('[sendAndConfirmTransaction] Transaction signed');

  // Get the base64-encoded wire transaction
  const base64Transaction = getBase64EncodedWireTransaction(signedTransaction);
  console.log('[sendAndConfirmTransaction] Wire transaction encoded');

  // Send the transaction to the network
  const signature = await (rpc as any).sendTransaction(base64Transaction, {
    encoding: 'base64',
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  }).send();

  console.log('[sendAndConfirmTransaction] Transaction sent with signature:', signature);

  return signature;
}

/**
 * Wait for transaction confirmation
 * Optional - use if you need to wait for confirmation before proceeding
 */
export async function waitForConfirmation(
  signature: string,
  rpc: Rpc<any>,
  maxAttempts: number = 30
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await (rpc as any)
        .getSignatureStatuses([signature])
        .send();

      if (status.value && status.value[0]) {
        const confirmationStatus = status.value[0].confirmationStatus;
        if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
          return;
        }

        if (status.value[0].err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value[0].err)}`);
        }
      }
    } catch (error: any) {
      // If method not supported, skip confirmation wait
      if (error?.message?.includes('Method not found')) {
        console.warn('getSignatureStatuses not supported - skipping confirmation wait');
        return;
      }
      console.warn(`Confirmation attempt ${i + 1} failed:`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Transaction confirmation timeout');
}

/**
 * Transaction error class
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly signature?: string,
    public readonly logs?: string[]
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

/**
 * Send transaction with retry logic
 */
export async function sendWithRetry(
  buildTx: () => Promise<TransactionMessage>,
  rpc: Rpc<any>,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const tx = await buildTx();
      return await sendAndConfirmTransaction(tx, rpc);
    } catch (error) {
      console.warn(`Transaction attempt ${i + 1} failed:`, error);
      lastError = error as Error;

      // Don't retry on certain errors
      if (error instanceof Error) {
        if (
          error.message.includes('insufficient funds') ||
          error.message.includes('invalid signature') ||
          error.message.includes('Blockhash not found')
        ) {
          throw error;
        }
      }

      // Wait before retry (exponential backoff)
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
  }

  throw new TransactionError(
    `Transaction failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Build a withdrawal transaction (user/admin withdraws from Contra to mainnet Solana)
 * Uses the Contra withdraw program to bridge funds to mainnet
 */
export async function buildWithdrawalTransaction(
  user: TransactionSigner,
  mintAddress: Address,
  amount: bigint,
  destination: Address | null,
  rpc: Rpc<any>
) {
  console.log('[buildWithdrawalTransaction] Building withdrawal from:', user.address, 'amount:', amount, 'destination:', destination || 'self');

  // 1. Get withdrawal instruction from @contra-withdraw package
  const instruction = await getWithdrawFundsInstructionAsync({
    user: user,
    mint: mintAddress,
    amount: amount,
    destination: destination, // null = withdraw to user's own address
  });

  // 2. Get recent blockhash from Contra read endpoint
  const { value: latestBlockhash } = await (rpc as any)
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();

  // 3. Build transaction message - MUST use 'legacy' version for withdrawals
  console.log('[buildWithdrawalTransaction] Building with legacy transaction version');

  const transactionMessage = pipe(
    createTransactionMessage({ version: 'legacy' }),  // CRITICAL: 'legacy' not 0
    (m) => setTransactionMessageFeePayerSigner(user, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );

  console.log('[buildWithdrawalTransaction] Final transaction:', transactionMessage);

  return transactionMessage;
}

/**
 * Validate a Solana address format
 */
export function validateSolanaAddress(addr: string): boolean {
  if (!addr || addr.trim() === '') {
    return false;
  }

  try {
    address(addr);
    return true;
  } catch {
    return false;
  }
}
