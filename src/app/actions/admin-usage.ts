'use server';

import { Timestamp } from 'firebase-admin/firestore';

import { verifyAdmin } from './admin-auth';
import { getAdminAuth, getAdminDb } from '@/server/firebase-admin';

export interface AdminUsageEntry {
  id: string;
  userId: string;
  userEmail: string | null;
  guideId: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface AdminUsageUserSummary {
  userId: string;
  userEmail: string | null;
  generationCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  lastActivityAt: string | null;
}

export interface AdminUsageModelSummary {
  modelUsed: string;
  generationCount: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface AdminUsageReport {
  monthKey: string;
  monthLabel: string;
  startIso: string;
  endIso: string;
  totalGenerations: number;
  totalUsers: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  users: AdminUsageUserSummary[];
  models: AdminUsageModelSummary[];
  recentEntries: AdminUsageEntry[];
}

function getMonthBounds(monthKey?: string): { start: Timestamp; end: Timestamp; normalizedMonthKey: string } {
  const now = new Date();
  const normalizedMonthKey = monthKey && /^\d{4}-\d{2}$/.test(monthKey)
    ? monthKey
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [year, month] = normalizedMonthKey.split('-').map((part) => Number(part));
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  return {
    start: Timestamp.fromDate(startDate),
    end: Timestamp.fromDate(endDate),
    normalizedMonthKey,
  };
}

function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export async function fetchAdminUsageReport(
  idToken: string,
  monthKey?: string,
): Promise<AdminUsageReport> {
  await verifyAdmin(idToken);

  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const { start, end, normalizedMonthKey } = getMonthBounds(monthKey);

  const usageSnapshot = await db.collectionGroup('usageLedger')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .orderBy('createdAt', 'desc')
    .get();

  const userIds = Array.from(new Set(
    usageSnapshot.docs
      .map((doc) => doc.ref.parent.parent?.id)
      .filter((value): value is string => Boolean(value)),
  ));

  const userEmailEntries = await Promise.all(userIds.map(async (uid) => {
    try {
      const userRecord = await adminAuth.getUser(uid);
      return [uid, userRecord.email ?? null] as const;
    } catch {
      return [uid, null] as const;
    }
  }));
  const userEmails = new Map<string, string | null>(userEmailEntries);

  const userSummaries = new Map<string, AdminUsageUserSummary>();
  const modelSummaries = new Map<string, AdminUsageModelSummary>();
  const recentEntries: AdminUsageEntry[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const usageDoc of usageSnapshot.docs) {
    const data = usageDoc.data() as {
      guideId?: string;
      modelUsed?: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      estimatedCostUsd?: number;
      createdAt?: Timestamp;
    };

    const userId = usageDoc.ref.parent.parent?.id;
    if (!userId) {
      continue;
    }

    const inputTokens = Number(data.inputTokens ?? 0);
    const outputTokens = Number(data.outputTokens ?? 0);
    const usageTotalTokens = Number(data.totalTokens ?? (inputTokens + outputTokens));
    const estimatedCostUsd = Number(data.estimatedCostUsd ?? 0);
    const createdAtIso = data.createdAt?.toDate().toISOString() ?? '';
    const userEmail = userEmails.get(userId) ?? null;
    const modelUsed = data.modelUsed || 'unknown';

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalTokens += usageTotalTokens;
    totalCostUsd += estimatedCostUsd;

    const userSummary = userSummaries.get(userId) ?? {
      userId,
      userEmail,
      generationCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      lastActivityAt: null,
    };
    userSummary.generationCount += 1;
    userSummary.totalInputTokens += inputTokens;
    userSummary.totalOutputTokens += outputTokens;
    userSummary.totalTokens += usageTotalTokens;
    userSummary.totalCostUsd += estimatedCostUsd;
    if (!userSummary.lastActivityAt || createdAtIso > userSummary.lastActivityAt) {
      userSummary.lastActivityAt = createdAtIso;
    }
    userSummaries.set(userId, userSummary);

    const modelSummary = modelSummaries.get(modelUsed) ?? {
      modelUsed,
      generationCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    };
    modelSummary.generationCount += 1;
    modelSummary.totalTokens += usageTotalTokens;
    modelSummary.totalCostUsd += estimatedCostUsd;
    modelSummaries.set(modelUsed, modelSummary);

    if (recentEntries.length < 50) {
      recentEntries.push({
        id: usageDoc.id,
        userId,
        userEmail,
        guideId: data.guideId || usageDoc.id,
        modelUsed,
        inputTokens,
        outputTokens,
        totalTokens: usageTotalTokens,
        estimatedCostUsd,
        createdAt: createdAtIso,
      });
    }
  }

  const monthDate = start.toDate();

  return {
    monthKey: normalizedMonthKey,
    monthLabel: formatMonthLabel(monthDate),
    startIso: start.toDate().toISOString(),
    endIso: end.toDate().toISOString(),
    totalGenerations: usageSnapshot.size,
    totalUsers: userSummaries.size,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
    users: Array.from(userSummaries.values())
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd),
    models: Array.from(modelSummaries.values())
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd),
    recentEntries,
  };
}
