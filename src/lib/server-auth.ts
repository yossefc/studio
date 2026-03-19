import { cookies } from 'next/headers';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { getAdminAuth } from '@/server/firebase-admin';

export const FIREBASE_ID_TOKEN_COOKIE = 'firebase_id_token';

export async function getAuthenticatedUser(): Promise<DecodedIdToken> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(FIREBASE_ID_TOKEN_COOKIE)?.value;

  if (!idToken) {
    throw new Error('Authentication required.');
  }

  try {
    return await getAdminAuth().verifyIdToken(idToken);
  } catch (error) {
    console.error('[ServerAuth] Failed to verify Firebase ID token:', error);
    throw new Error('Invalid or expired session.');
  }
}
