/**
 * Get explorer URL for a transaction signature
 * Uses Solana Explorer with custom RPC URL for Contra transactions
 */
export function getExplorerUrl(signature: string, chain: 'solana' | 'contra' = 'contra'): string {
  if (chain === 'solana') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }

  // For Contra, use Solana Explorer with custom URL pointing to Contra read endpoint
  const contraReadUrl = 'https://read-node-production.up.railway.app';
  return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(contraReadUrl)}`;
}
