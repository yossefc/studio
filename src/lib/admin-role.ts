import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminDb } from '@/server/firebase-admin';
import { ADMIN_EMAIL } from '@/app/actions/admin-auth';

/**
 * Returns true if the authenticated user has admin privileges.
 * Checks (in order):
 *   1. Director email (backward compatibility with existing /admin page)
 *   2. Firebase Custom Claims — `role: 'admin'`
 *   3. Firestore `users/{uid}.role === 'admin'`
 */
export async function isAdminUser(authUser: DecodedIdToken): Promise<boolean> {
  // 1. Director email
  if ((authUser.email ?? '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) return true;

  // 2. Firebase Custom Claims
  if ((authUser as Record<string, unknown>)['role'] === 'admin') return true;

  // 3. Firestore role field
  try {
    const snap = await getAdminDb().collection('users').doc(authUser.uid).get();
    return snap.exists && snap.data()?.role === 'admin';
  } catch {
    return false;
  }
}
