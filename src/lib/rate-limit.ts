import { createHash } from 'crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { headers } from 'next/headers';

import { getAdminDb } from '@/server/firebase-admin';

type RateLimitScope = 'user' | 'ip';

export class RateLimitExceededError extends Error {
  retryAfterSeconds: number;
  scope: RateLimitScope;

  constructor(message: string, retryAfterSeconds: number, scope: RateLimitScope) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
    this.scope = scope;
  }
}

type RateLimitEntry = {
  action: string;
  scope: RateLimitScope;
  subject: string;
  limit: number;
  windowSeconds: number;
};

function getWindowStartMs(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildRateLimitDocId(
  action: string,
  scope: RateLimitScope,
  subject: string,
  windowStartMs: number,
): string {
  return hashValue(`${action}:${scope}:${subject}:${windowStartMs}`);
}

function buildRateLimitEntry(options: RateLimitEntry, nowMs: number) {
  const windowStartMs = getWindowStartMs(nowMs, options.windowSeconds);
  const windowEndMs = windowStartMs + options.windowSeconds * 1000;
  const docId = buildRateLimitDocId(options.action, options.scope, options.subject, windowStartMs);

  return {
    ...options,
    windowStartMs,
    windowEndMs,
    docRef: getAdminDb().collection('rateLimits').doc(docId),
  };
}

function normalizeIpAddress(rawIp: string): string {
  if (rawIp.startsWith('::ffff:')) {
    return rawIp.slice(7);
  }

  return rawIp;
}

export async function getRequestIpAddress(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for');
  const candidate = forwardedFor?.split(',')[0]?.trim()
    || requestHeaders.get('x-real-ip')?.trim()
    || requestHeaders.get('cf-connecting-ip')?.trim()
    || null;

  if (!candidate) {
    return null;
  }

  return normalizeIpAddress(candidate);
}

type ActionRateLimitOptions = {
  action: string;
  userId: string;
  ipAddress?: string | null;
  windowSeconds: number;
  userLimit: number;
  ipLimit?: number;
};

export async function assertActionRateLimit(options: ActionRateLimitOptions): Promise<void> {
  const db = getAdminDb();
  const nowMs = Date.now();
  const entries = [buildRateLimitEntry({
    action: options.action,
    scope: 'user',
    subject: options.userId,
    limit: options.userLimit,
    windowSeconds: options.windowSeconds,
  }, nowMs)];

  if (options.ipAddress && options.ipLimit) {
    entries.push(buildRateLimitEntry({
      action: options.action,
      scope: 'ip',
      subject: options.ipAddress,
      limit: options.ipLimit,
      windowSeconds: options.windowSeconds,
    }, nowMs));
  }

  await db.runTransaction(async (transaction) => {
    const snapshots = new Map<string, number>();

    for (const entry of entries) {
      const snapshot = await transaction.get(entry.docRef);
      const currentCount = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0;
      snapshots.set(entry.docRef.path, currentCount);

      if (currentCount >= entry.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowEndMs - nowMs) / 1000));
        throw new RateLimitExceededError(
          `Rate limit reached for ${entry.action}. Retry in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
          entry.scope,
        );
      }
    }

    for (const entry of entries) {
      const currentCount = snapshots.get(entry.docRef.path) ?? 0;

      transaction.set(entry.docRef, {
        action: entry.action,
        scope: entry.scope,
        subjectHash: hashValue(entry.subject),
        count: currentCount + 1,
        limit: entry.limit,
        windowSeconds: entry.windowSeconds,
        windowStart: Timestamp.fromMillis(entry.windowStartMs),
        windowEndsAt: Timestamp.fromMillis(entry.windowEndMs),
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  });
}
