'use server';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { getAdminAuth, getAdminDb } from '@/server/firebase-admin';
import { isAdminUser } from '@/lib/admin-role';
import { saveUserUsagePolicy } from '@/lib/usage-policy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalUsers: number;
  activeSubscriptions: number;
  totalRevenueIls: number;
}

export interface DashboardUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  role: string | null;          // 'admin' | null
  planId: string | null;        // 'standard' | 'free' | null
  isSubscriptionActive: boolean;
  totalSpent: number;           // cumulative ILS paid (from users/{uid}.totalSpent)
}

// ---------------------------------------------------------------------------
// Internal guard — throws if caller is not an admin
// ---------------------------------------------------------------------------

async function requireAdmin() {
  const authUser = await getAuthenticatedUser();
  const admin = await isAdminUser(authUser);
  if (!admin) throw new Error('Unauthorized: admin access required.');
  return authUser;
}

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<DashboardStats> {
  await requireAdmin();

  const db = getAdminDb();
  const adminAuth = getAdminAuth();

  // 1. Total user count (Firebase Auth)
  let totalUsers = 0;
  let pageToken: string | undefined;
  do {
    const batch = await adminAuth.listUsers(1000, pageToken);
    totalUsers += batch.users.length;
    pageToken = batch.pageToken;
  } while (pageToken);

  // 2. Active subscriptions — fetch all subscriptionStatus docs, filter in memory
  //    (collectionGroup + .where requires a composite index; skip that)
  const subSnap = await db.collectionGroup('subscriptionStatus').get();
  const activeSubscriptions = subSnap.docs.filter(
    (d) => d.id === 'current' && d.data().isActive === true,
  ).length;

  // 3. Revenue: sum totalSpent field on users/{uid} docs
  const usersSnap = await db.collection('users').get();
  let totalRevenueIls = 0;
  for (const doc of usersSnap.docs) {
    const spent = doc.data().totalSpent;
    if (typeof spent === 'number') totalRevenueIls += spent;
  }

  return { totalUsers, activeSubscriptions, totalRevenueIls };
}

// ---------------------------------------------------------------------------
// listDashboardUsers
// ---------------------------------------------------------------------------

export async function listDashboardUsers(limit = 200): Promise<DashboardUser[]> {
  await requireAdmin();

  const adminAuth = getAdminAuth();
  const db = getAdminDb();

  // Fetch all Auth users (up to `limit`)
  const authUsers: { uid: string; email?: string; displayName?: string; disabled: boolean }[] = [];
  let pageToken: string | undefined;
  do {
    const batch = await adminAuth.listUsers(Math.min(limit - authUsers.length, 1000), pageToken);
    authUsers.push(
      ...batch.users.map((u) => ({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        disabled: u.disabled,
      })),
    );
    pageToken = batch.pageToken;
    if (authUsers.length >= limit) break;
  } while (pageToken);

  if (authUsers.length === 0) return [];

  // Batch-fetch Firestore user docs (role, totalSpent) and subscriptionStatus
  const userRefs = authUsers.map((u) => db.collection('users').doc(u.uid));
  const subRefs = authUsers.map((u) =>
    db.collection('users').doc(u.uid).collection('subscriptionStatus').doc('current'),
  );

  // Firestore getAll supports up to 500 per call — chunk if needed
  function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  const userDocs = (
    await Promise.all(chunk(userRefs, 400).map((refs) => db.getAll(...refs)))
  ).flat();

  const subDocs = (
    await Promise.all(chunk(subRefs, 400).map((refs) => db.getAll(...refs)))
  ).flat();

  const userDocMap = new Map(userDocs.map((d) => [d.id, d.data()]));
  const subDocMap = new Map(
    subDocs.map((d) => [d.ref.parent.parent!.id, d.exists ? d.data() : null]),
  );

  return authUsers.map((au) => {
    const userData = userDocMap.get(au.uid);
    const subData = subDocMap.get(au.uid);
    return {
      uid: au.uid,
      email: au.email ?? null,
      displayName: au.displayName ?? null,
      disabled: au.disabled,
      role: typeof userData?.role === 'string' ? userData.role : null,
      planId: typeof subData?.planId === 'string' ? subData.planId : null,
      isSubscriptionActive: Boolean(subData?.isActive),
      totalSpent: typeof userData?.totalSpent === 'number' ? userData.totalSpent : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// promoteToAdmin / revokeAdmin
// ---------------------------------------------------------------------------

export async function promoteToAdmin(uid: string): Promise<void> {
  const caller = await requireAdmin();
  if (uid === caller.uid) throw new Error('Cannot modify your own admin role.');

  const db = getAdminDb();
  await db.collection('users').doc(uid).set({ role: 'admin' }, { merge: true });
}

export async function revokeAdmin(uid: string): Promise<void> {
  const caller = await requireAdmin();
  if (uid === caller.uid) throw new Error('Cannot revoke your own admin role.');

  const db = getAdminDb();
  await db.collection('users').doc(uid).update({ role: FieldValue.delete() });
}

// ---------------------------------------------------------------------------
// setSubscriptionActive — manually activate or deactivate a user's subscription
// ---------------------------------------------------------------------------

export async function setSubscriptionActive(uid: string, active: boolean): Promise<void> {
  await requireAdmin();

  const db = getAdminDb();
  const planId = active ? 'standard' : 'free';

  await db
    .collection('users')
    .doc(uid)
    .collection('subscriptionStatus')
    .doc('current')
    .set(
      {
        isActive: active,
        planId,
        updatedAt: Timestamp.now(),
        ...(active ? { currentPeriodEnd: Math.floor(Date.now() / 1000) + 31 * 24 * 60 * 60 } : {}),
      },
      { merge: true },
    );

  // Sync the usage policy so quota reflects the change immediately
  await saveUserUsagePolicy(uid, null, { planId }, 'admin-dashboard');
}
