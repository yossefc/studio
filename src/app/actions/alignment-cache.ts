import { createHash } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/server/firebase-admin';

export interface SeifRefMapping {
  turRefs: string[];
  byRefs: string[];
  turMode: 'linked-passages' | 'fallback-similarity' | 'none';
  byMode: 'linked-passages' | 'fallback-similarity' | 'none';
  confidence: number;
}

export interface SimanAlignment {
  section: string;
  siman: number;
  status: 'building' | 'ready' | 'failed';
  version: number;
  lockExpiresAt?: Timestamp;
  sourceHash: {
    shulchanArukh: string;
    tur: string;
    beitYosef: string;
  };
  seifMap: Record<string, SeifRefMapping>;
  sourceCheckedAt?: Timestamp;
  error?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const ALIGNMENTS_COLLECTION = 'alignments';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
export const CURRENT_CACHE_VERSION = 2;

export function generateSourceHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function getAlignmentPath(section: string, siman: number): string {
  const normalizedSection = section
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${ALIGNMENTS_COLLECTION}/${normalizedSection}_${siman}`;
}

export async function loadSimanAlignment(section: string, siman: number): Promise<SimanAlignment | null> {
  const db = getAdminDb();
  const snap = await db.doc(getAlignmentPath(section, siman)).get();
  if (!snap.exists) return null;
  return snap.data() as SimanAlignment;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export async function tryAcquireSimanLock(
  section: string,
  siman: number,
  options?: { forceRebuild?: boolean },
): Promise<boolean> {
  const db = getAdminDb();
  const docRef = db.doc(getAlignmentPath(section, siman));
  const forceRebuild = options?.forceRebuild === true;

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const nowMs = Date.now();
      const expiresAt = Timestamp.fromMillis(nowMs + LOCK_TIMEOUT_MS);

      if (snap.exists) {
        const data = snap.data() as Partial<SimanAlignment>;
        const lockExpiresAtMs = toMillis(data.lockExpiresAt);
        const lockActive = data.status === 'building' && lockExpiresAtMs > nowMs;
        if (lockActive) return false;

        const cacheReady = data.status === 'ready' && data.version === CURRENT_CACHE_VERSION;
        if (cacheReady && !forceRebuild) return false;
      }

      tx.set(docRef, {
        section,
        siman,
        status: 'building',
        version: CURRENT_CACHE_VERSION,
        lockExpiresAt: expiresAt,
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: snap.exists ? (snap.data()?.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      } as Record<string, unknown>, { merge: true });

      return true;
    });
  } catch (error) {
    console.error('[AlignmentCache] Failed to acquire siman lock:', error);
    return false;
  }
}

export async function waitForAlignmentReady(
  section: string,
  siman: number,
  maxWaitMs = 60_000,
): Promise<SimanAlignment | null> {
  const db = getAdminDb();
  const docRef = db.doc(getAlignmentPath(section, siman));
  const startedAt = Date.now();
  const pollIntervalMs = 2_000;

  while (Date.now() - startedAt < maxWaitMs) {
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data() as SimanAlignment;
      if (data.status === 'ready') {
        return data;
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  return null;
}

export async function markAlignmentReady(
  section: string,
  siman: number,
  sourceHash: SimanAlignment['sourceHash'],
  seifMap: Record<string, SeifRefMapping>,
): Promise<void> {
  const db = getAdminDb();
  const docRef = db.doc(getAlignmentPath(section, siman));

  await docRef.set({
    section,
    siman,
    status: 'ready',
    version: CURRENT_CACHE_VERSION,
    lockExpiresAt: FieldValue.delete(),
    sourceHash,
    seifMap,
    sourceCheckedAt: FieldValue.serverTimestamp(),
    error: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  } as Record<string, unknown>, { merge: true });
}

export async function markAlignmentFailed(section: string, siman: number, errorMessage: string): Promise<void> {
  const db = getAdminDb();
  const docRef = db.doc(getAlignmentPath(section, siman));

  await docRef.set({
    status: 'failed',
    lockExpiresAt: FieldValue.delete(),
    error: errorMessage,
    updatedAt: FieldValue.serverTimestamp(),
  } as Record<string, unknown>, { merge: true });
}

export async function touchAlignmentSourceChecked(section: string, siman: number): Promise<void> {
  const db = getAdminDb();
  await db.doc(getAlignmentPath(section, siman)).set({
    sourceCheckedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as Record<string, unknown>, { merge: true });
}
