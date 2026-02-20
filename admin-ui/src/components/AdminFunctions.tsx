import { useState } from 'react';
import { useSolana } from '../hooks/useSolana';
import { useWallet } from '../hooks/useWallet';
import { useWalletStandardAccount } from '../hooks/useWalletStandardAccount';
import { useCluster } from '../hooks/useCluster';
import { useLocalStorage, useRecentItems } from '../hooks/useLocalStorage';
import { address } from '@solana/addresses';
import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import { getBase58Decoder } from '@solana/codecs-strings';
import { generateKeyPairSigner } from '@solana/signers';
import {
  getAllowMintInstructionAsync,
  getBlockMintInstructionAsync,
  getAddOperatorInstructionAsync,
  getRemoveOperatorInstructionAsync,
} from '@contra-escrow';
import {
  getInitializeMintInstruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getCreateAccountInstruction } from '@solana-program/system';
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

interface AdminFunctionsProps {
  instancePubkey: string;
}

export function AdminFunctions({ instancePubkey }: AdminFunctionsProps) {
  const { connected } = useWallet();
  const account = useWalletStandardAccount();
  const { network } = useCluster();

  if (!connected || !account) {
    return (
      <div className="card">
        <h2>Admin Functions</h2>
        <p className="card-description">These functions require admin privileges</p>
        <div className="error-message">Please connect your wallet to use admin functions</div>
      </div>
    );
  }

  return <AdminFunctionsContent instancePubkey={instancePubkey} account={account} network={network} />;
}

interface AdminFunctionsContentProps {
  instancePubkey: string;
  account: Parameters<typeof useWalletAccountTransactionSendingSigner>[0];
  network: string;
}

function AdminFunctionsContent({ instancePubkey, account, network }: AdminFunctionsContentProps) {
  const { rpc } = useSolana();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [savedMint] = useLocalStorage<string>('lastMintAddress', '');
  const [mintAddress, setMintAddress] = useState(savedMint);
  const [operatorAddress, setOperatorAddress] = useState('');
  const [newAdminAddress, setNewAdminAddress] = useState('');
  const [newMintDecimals, setNewMintDecimals] = useState(9);
  const [createdMintAddress, setCreatedMintAddress] = useState<string | null>(null);
  const [recentMints, addRecentMint] = useRecentItems('recentMints', 5);

  const chainId = (network === 'localnet' ? 'solana:devnet' : `solana:${network}`) as `solana:${string}`;
  const transactionSigner = useWalletAccountTransactionSendingSigner(account, chainId);

  const truncateAddress = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  const handleAllowMint = async () => {
    if (!mintAddress) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess(null);

      // Get the allow mint instruction
      const instruction = await getAllowMintInstructionAsync({
        payer: transactionSigner,
        admin: transactionSigner,
        instance: address(instancePubkey),
        mint: address(mintAddress),
      });

      console.log('Created allow mint instruction:', instruction);

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(instruction, m)
      );

      console.log('Transaction message:', transactionMessage);

      // Assert single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction
      const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature bytes to base58 string
      const signature = getBase58Decoder().decode(signatureBytes);

      console.log('Transaction sent with signature:', signature);

      addRecentMint(mintAddress);
      setSuccess(`Mint allowed successfully! Signature: ${signature}`);
      setMintAddress('');

    } catch (err) {
      console.error('Error allowing mint:', err);
      setError(err instanceof Error ? err.message : 'Failed to allow mint');
    } finally {
      setLoading(false);
    }
  };

  const handleBlockMint = async () => {
    if (!mintAddress) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess(null);

      // Get the block mint instruction
      const instruction = await getBlockMintInstructionAsync({
        payer: transactionSigner,
        admin: transactionSigner,
        instance: address(instancePubkey),
        mint: address(mintAddress),
      });

      console.log('Created block mint instruction:', instruction);

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(instruction, m)
      );

      console.log('Transaction message:', transactionMessage);

      // Assert single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction
      const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature bytes to base58 string
      const signature = getBase58Decoder().decode(signatureBytes);

      console.log('Transaction sent with signature:', signature);

      setSuccess(`Mint blocked successfully! Signature: ${signature}`);
      setMintAddress('');

    } catch (err) {
      console.error('Error blocking mint:', err);
      setError(err instanceof Error ? err.message : 'Failed to block mint');
    } finally {
      setLoading(false);
    }
  };

  const handleAddOperator = async () => {
    if (!operatorAddress) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess(null);

      // Get the add operator instruction
      const instruction = await getAddOperatorInstructionAsync({
        payer: transactionSigner,
        admin: transactionSigner,
        instance: address(instancePubkey),
        operator: address(operatorAddress),
      });

      console.log('Created add operator instruction:', instruction);

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(instruction, m)
      );

      console.log('Transaction message:', transactionMessage);

      // Assert single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction
      const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature bytes to base58 string
      const signature = getBase58Decoder().decode(signatureBytes);

      console.log('Transaction sent with signature:', signature);

      setSuccess(`Operator added successfully! Signature: ${signature}`);
      setOperatorAddress('');

    } catch (err) {
      console.error('Error adding operator:', err);
      setError(err instanceof Error ? err.message : 'Failed to add operator');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveOperator = async () => {
    if (!operatorAddress) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess(null);

      // Get the remove operator instruction
      const instruction = await getRemoveOperatorInstructionAsync({
        payer: transactionSigner,
        admin: transactionSigner,
        instance: address(instancePubkey),
        operator: address(operatorAddress),
      });

      console.log('Created remove operator instruction:', instruction);

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(instruction, m)
      );

      console.log('Transaction message:', transactionMessage);

      // Assert single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction
      const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature bytes to base58 string
      const signature = getBase58Decoder().decode(signatureBytes);

      console.log('Transaction sent with signature:', signature);

      setSuccess(`Operator removed successfully! Signature: ${signature}`);
      setOperatorAddress('');

    } catch (err) {
      console.error('Error removing operator:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove operator');
    } finally {
      setLoading(false);
    }
  };

  const handleTransferAdmin = () => {
    setError('Admin transfer requires the new admin to sign the transaction. Please use the CLI for this operation.');
  };

  const handleCreateMint = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess(null);
      setCreatedMintAddress(null);

      // Generate a new keypair for the mint
      const mint = await generateKeyPairSigner();

      console.log('Generated mint keypair:', mint.address);

      // Get the space needed for a mint account
      const mintSpace = BigInt(getMintSize());
      const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send();

      console.log('Mint rent:', mintRent, 'lamports');

      // Create instructions for creating and initializing the mint
      const instructions = [
        getCreateAccountInstruction({
          payer: transactionSigner,
          newAccount: mint,
          lamports: mintRent,
          space: mintSpace,
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMintInstruction({
          mint: mint.address,
          decimals: newMintDecimals,
          mintAuthority: transactionSigner.address,
          freezeAuthority: transactionSigner.address,
        }),
      ];

      console.log('Created instructions for mint creation');

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(transactionSigner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m)
      );

      console.log('Transaction message:', transactionMessage);

      // Sign and send the transaction
      const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature bytes to base58 string
      const signature = getBase58Decoder().decode(signatureBytes);

      console.log('Mint created with signature:', signature);

      setCreatedMintAddress(mint.address);
      addRecentMint(mint.address);
      setSuccess(`Mint created successfully! Signature: ${signature}`);

    } catch (err) {
      console.error('Error creating mint:', err);
      setError(err instanceof Error ? err.message : 'Failed to create mint');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Admin Functions</h2>
      <p className="card-description">These functions require admin privileges</p>

      {error && <div className="error-message">{error}</div>}

      {success && (
        <div className="alert alert-success">
          <span className="alert-title">{success.split('!')[0]}!</span>
          <span className="alert-body">Signature: {success.split('Signature: ')[1]}</span>
        </div>
      )}

      <div className="function-section">
        <h3>Mint Management</h3>
        <div className="form-group">
          <label>Mint Address</label>
          <input autoComplete="off" data-1p-ignore
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
        <div className="button-group">
          <button
            onClick={handleAllowMint}
            disabled={loading || !mintAddress}
            className="button button-success"
          >
            {loading ? 'Processing...' : 'Allow Mint'}
          </button>
          <button
            onClick={handleBlockMint}
            disabled={loading || !mintAddress}
            className="button button-danger"
          >
            {loading ? 'Processing...' : 'Block Mint'}
          </button>
        </div>
      </div>

      <div className="function-section">
        <h3>Operator Management</h3>
        <div className="form-group">
          <label>Operator Address</label>
          <input autoComplete="off" data-1p-ignore
            type="text"
            value={operatorAddress}
            onChange={(e) => setOperatorAddress(e.target.value)}
            placeholder="Enter operator public key"
            className="input"
          />
        </div>
        <div className="button-group">
          <button
            onClick={handleAddOperator}
            disabled={loading || !operatorAddress}
            className="button button-success"
          >
            {loading ? 'Processing...' : 'Add Operator'}
          </button>
          <button
            onClick={handleRemoveOperator}
            disabled={loading || !operatorAddress}
            className="button button-danger"
          >
            {loading ? 'Processing...' : 'Remove Operator'}
          </button>
        </div>
      </div>

      <div className="function-section">
        <h3>Admin Transfer</h3>
        <div className="form-group">
          <label>New Admin Address</label>
          <input autoComplete="off" data-1p-ignore
            type="text"
            value={newAdminAddress}
            onChange={(e) => setNewAdminAddress(e.target.value)}
            placeholder="Enter new admin public key"
            className="input"
          />
        </div>
        <button
          onClick={handleTransferAdmin}
          disabled={loading || !newAdminAddress}
          className="button button-warning"
        >
          {loading ? 'Processing...' : 'Transfer Admin Rights'}
        </button>
      </div>

      <div className="function-section">
        <h3>Create New Mint</h3>
        <p className="info-text">Create a new SPL token mint for testing purposes. You will be set as the mint authority and freeze authority.</p>
        <div className="form-group">
          <label>Decimals</label>
          <input autoComplete="off" data-1p-ignore
            type="number"
            value={newMintDecimals}
            onChange={(e) => setNewMintDecimals(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))}
            min="0"
            max="9"
            placeholder="Enter decimals (e.g., 9)"
            className="input"
          />
          <p className="info-text">
            Standard tokens use 9 decimals. NFTs typically use 0.
          </p>
        </div>
        <button
          onClick={handleCreateMint}
          disabled={loading}
          className="button button-primary"
        >
          {loading ? 'Creating...' : 'Create Mint'}
        </button>
        {createdMintAddress && (
          <div className="alert alert-info">
            <span className="alert-title">Mint Created</span>
            <span className="alert-body">{createdMintAddress}</span>
            <span className="info-text">Copy this address for the Allow Mint section or the Mint tab.</span>
          </div>
        )}
      </div>
    </div>
  );
}
