'use server';

import { Timestamp } from 'firebase-admin/firestore';

import { verifyAdmin, ADMIN_EMAIL } from './admin-auth';
import { getAdminAuth, getAdminDb } from '@/server/firebase-admin';
import {
  getDirectorUsagePolicy,
  getUserUsagePolicy,
  saveUserUsagePolicy,
  type UserUsagePolicy,
  type UserUsagePolicyInput,
} from '@/lib/usage-policy';
import type { UsagePlanId } from '@/lib/usage-plans';

export interface AdminManagedUser {
  userId: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  isDirector: boolean;
  policy: {
    planId: UsagePlanId;
    unlimited: boolean;
    monthlyGenerationLimit: number;
    generationRateLimitUserMax: number;
    exportRateLimitUserMax: number;
    updatedAt: string | null;
    updatedByEmail: string | null;
  };
  monthUsage: {
    generationCount: number;
    totalTokens: number;
    totalCostUsd: number;
    lastActivityAt: string | null;
  };
}

function getMonthBounds(monthKey?: string): { start: Timestamp; end: Timestamp } {
  const now = new Date();
  const normalizedMonthKey = monthKey && /^\d{4}-\d{2}$/.test(monthKey)
    ? monthKey
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [year, month] = normalizedMonthKey.split('-').map((part) => Number(part));

  return {
    start: Timestamp.fromDate(new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))),
    end: Timestamp.fromDate(new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))),
  };
}

function serializePolicy(policy: UserUsagePolicy): AdminManagedUser['policy'] {
  return {
    planId: policy.planId,
    unlimited: policy.unlimited,
    monthlyGenerationLimit: policy.monthlyGenerationLimit,
    generationRateLimitUserMax: policy.generationRateLimitUserMax,
    exportRateLimitUserMax: policy.exportRateLimitUserMax,
    updatedAt: policy.updatedAt?.toDate().toISOString() ?? null,
    updatedByEmail: policy.updatedByEmail ?? null,
  };
}

async function listAllUsers() {
  const adminAuth = getAdminAuth();
  const users = [];
  let pageToken: string | undefined;

  do {
    const batch = await adminAuth.listUsers(1000, pageToken);
    users.push(...batch.users);
    pageToken = batch.pageToken;
  } while (pageToken);

  return users;
}

export async function fetchAdminManagedUsers(
  idToken: string,
  monthKey?: string,
): Promise<AdminManagedUser[]> {
  await verifyAdmin(idToken);

  const db = getAdminDb();
  const { start, end } = getMonthBounds(monthKey);
  const [authUsers, usageSnapshot] = await Promise.all([
    listAllUsers(),
    db.collectionGroup('usageLedger')
      .where('createdAt', '>=', start)
      .where('createdAt', '<', end)
      .get(),
  ]);

  const usageByUser = new Map<string, AdminManagedUser['monthUsage']>();

  for (const usageDoc of usageSnapshot.docs) {
    const userId = usageDoc.ref.parent.parent?.id;
    if (!userId) {
      continue;
    }

    const data = usageDoc.data() as {
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
      createdAt?: Timestamp;
    };

    const current = usageByUser.get(userId) ?? {
      generationCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      lastActivityAt: null,
    };

    current.generationCount += 1;
    current.totalTokens += Number(data.totalTokens ?? ((data.inputTokens ?? 0) + (data.outputTokens ?? 0)));
    current.totalCostUsd += Number(data.estimatedCostUsd ?? 0);

    const createdAtIso = data.createdAt?.toDate().toISOString() ?? null;
    if (createdAtIso && (!current.lastActivityAt || createdAtIso > current.lastActivityAt)) {
      current.lastActivityAt = createdAtIso;
    }

    usageByUser.set(userId, current);
  }

  const managedUsers = await Promise.all(authUsers.map(async (authUser) => {
    const isDirector = (authUser.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const policy = isDirector
      ? getDirectorUsagePolicy()
      : await getUserUsagePolicy({ uid: authUser.uid, email: authUser.email });

    return {
      userId: authUser.uid,
      email: authUser.email ?? null,
      displayName: authUser.displayName ?? null,
      disabled: authUser.disabled,
      isDirector,
      policy: serializePolicy(policy),
      monthUsage: usageByUser.get(authUser.uid) ?? {
        generationCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        lastActivityAt: null,
      },
    };
  }));

  return managedUsers.sort((left, right) => {
    if (left.isDirector && !right.isDirector) return -1;
    if (!left.isDirector && right.isDirector) return 1;
    return right.monthUsage.totalCostUsd - left.monthUsage.totalCostUsd
      || (left.email || '').localeCompare(right.email || '');
  });
}

export async function updateAdminUserUsagePolicy(
  idToken: string,
  userId: string,
  input: UserUsagePolicyInput,
): Promise<AdminManagedUser['policy']> {
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  if (decoded.email !== ADMIN_EMAIL) {
    throw new Error('Unauthorized: admin access required.');
  }

  const adminAuth = getAdminAuth();
  const targetUser = await adminAuth.getUser(userId);
  const updatedPolicy = await saveUserUsagePolicy(
    userId,
    targetUser.email,
    input,
    decoded.email || ADMIN_EMAIL,
  );

  return serializePolicy(updatedPolicy);
}
