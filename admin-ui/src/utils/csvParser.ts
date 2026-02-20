import type { PayoutRow } from '../types/activity';

/**
 * Parse CSV text into PayoutRow[].
 *
 * Expected columns (header optional, auto-detected):
 *   address, amount [, mint]
 *
 * Supports both comma and tab delimiters.
 */
export function parseCsv(text: string): { rows: PayoutRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: ['CSV is empty'] };
  }

  // Detect delimiter
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // Detect header row
  const firstCols = lines[0].split(delimiter).map((c) => c.trim().toLowerCase());
  const hasHeader =
    firstCols.includes('address') || firstCols.includes('wallet') || firstCols.includes('recipient');

  let addressIdx = 0;
  let amountIdx = 1;
  let mintIdx = -1;

  if (hasHeader) {
    addressIdx = firstCols.findIndex((c) => ['address', 'wallet', 'recipient'].includes(c));
    amountIdx = firstCols.findIndex((c) => ['amount', 'quantity', 'value'].includes(c));
    mintIdx = firstCols.findIndex((c) => ['mint', 'token'].includes(c));

    if (addressIdx === -1) {
      errors.push('Header missing an "address" column');
      return { rows: [], errors };
    }
    if (amountIdx === -1) {
      errors.push('Header missing an "amount" column');
      return { rows: [], errors };
    }
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: PayoutRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cols = dataLines[i].split(delimiter).map((c) => c.trim());
    const lineNum = hasHeader ? i + 2 : i + 1;

    const addr = cols[addressIdx] ?? '';
    const amt = cols[amountIdx] ?? '';
    const mint = mintIdx >= 0 ? cols[mintIdx] : undefined;

    // Validate address (base58, 32-44 chars)
    if (!addr || addr.length < 32 || addr.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
      errors.push(`Line ${lineNum}: invalid address "${addr}"`);
      continue;
    }

    // Validate amount (positive number)
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      errors.push(`Line ${lineNum}: invalid amount "${amt}"`);
      continue;
    }

    rows.push({
      id: rows.length,
      address: addr,
      amount: amt,
      mint: mint && mint.length > 0 ? mint : undefined,
      status: 'pending',
    });
  }

  return { rows, errors };
}
