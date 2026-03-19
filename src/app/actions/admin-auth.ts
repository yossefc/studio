import { getAdminAuth } from '@/server/firebase-admin';

export const ADMIN_EMAIL = 'yossefcohzar@gmail.com';

export async function verifyAdmin(idToken: string): Promise<void> {
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  if (decoded.email !== ADMIN_EMAIL) {
    throw new Error('Unauthorized: admin access required.');
  }
}
