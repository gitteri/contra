const FIRST_NAMES = [
  'Aria', 'Blake', 'Cora', 'Dante', 'Elena', 'Felix', 'Grace', 'Hugo',
  'Iris', 'Jude', 'Kira', 'Leo', 'Maya', 'Noah', 'Olive', 'Pierce',
  'Quinn', 'Ruby', 'Silas', 'Tessa', 'Umar', 'Vera', 'Wren', 'Xena',
  'Yuki', 'Zara', 'Aiden', 'Brynn', 'Caleb', 'Dana', 'Ezra', 'Faye',
  'Gael', 'Hazel', 'Ivan', 'Jade', 'Kai', 'Luna', 'Miles', 'Nia',
  'Oscar', 'Piper', 'Reed', 'Sage', 'Theo', 'Uma', 'Viola', 'Wyatt',
  'Ximena', 'Zane', 'Asher', 'Bianca', 'Cole', 'Dara', 'Ellis', 'Flora',
  'Grant', 'Hana', 'Idris', 'June', 'Knox', 'Lyra', 'Milo', 'Nora',
  'Orion', 'Priya', 'Remy', 'Stella', 'Taro', 'Uriel', 'Vale', 'Wells',
];

const LAST_NAMES = [
  'Nakamura', 'Chen', 'Okafor', 'Rivera', 'Singh', 'Kim', 'Petrov',
  'Santos', 'Ahmed', 'Larsson', 'Torres', 'Nguyen', 'Patel', 'Reyes',
  'Weber', 'Costa', 'Sharma', 'Park', 'Andersen', 'Morin', 'Tanaka',
  'Alvarez', 'Dubois', 'Kapoor', 'Volkov', 'Cruz', 'Fischer', 'Sato',
  'Jensen', 'Ibrahim', 'Rossi', 'Huang', 'Lopez', 'Müller', 'Diaz',
  'Yamamoto', 'Ferreira', 'Johansson', 'Ali', 'Vargas', 'Berg', 'Ito',
  'Moreno', 'Schmidt', 'Kowalski', 'Navarro', 'Gupta', 'Fernandez',
  'Okamoto', 'Chandra', 'Martinez', 'Becker', 'Ortiz', 'Rahim', 'Nunes',
  'Kimura', 'Ramos', 'Lindqvist', 'Hassan', 'Mendez', 'Takahashi',
];

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a78bfa',
];

/** Simple deterministic hash for consistent avatar colors. */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

import { generateUserWallet, loadUserWallet } from './walletStorage';
import type { KeyPairSigner } from '@solana/signers';

export interface GeneratedUser {
  id: string;
  firstName: string;
  lastName: string;
  avatarColor: string;
  publicKey: string;
  signer?: KeyPairSigner; // Optional - only available when generated
}

/** Generate a deterministic list of N unique users with real Solana wallets. */
export async function generateUsers(count: number): Promise<GeneratedUser[]> {
  const users: GeneratedUser[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    // Pick names deterministically based on index
    const fi = i % FIRST_NAMES.length;
    const li = Math.floor(i / FIRST_NAMES.length + i) % LAST_NAMES.length;
    let firstName = FIRST_NAMES[fi];
    let lastName = LAST_NAMES[li];

    // Handle duplicates by cycling
    let attempt = 0;
    while (usedNames.has(`${firstName} ${lastName}`)) {
      attempt++;
      const altFi = (fi + attempt * 7) % FIRST_NAMES.length;
      const altLi = (li + attempt * 11) % LAST_NAMES.length;
      firstName = FIRST_NAMES[altFi];
      lastName = LAST_NAMES[altLi];
    }
    usedNames.add(`${firstName} ${lastName}`);

    const fullName = `${firstName}${lastName}`;
    const hash = simpleHash(fullName);
    const userId = `user-${i}`;

    // Try to load existing wallet first, generate new one if not found
    let signer = await loadUserWallet(userId);
    if (!signer) {
      const wallet = await generateUserWallet(userId);
      signer = wallet.signer;
    }

    users.push({
      id: userId,
      firstName,
      lastName,
      avatarColor: AVATAR_COLORS[hash % AVATAR_COLORS.length],
      publicKey: signer.address,
      signer,
    });
  }

  return users;
}
