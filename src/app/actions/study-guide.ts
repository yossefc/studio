'use server';

import { fetchSefariaText, buildSefariaRef, SOURCE_CONFIGS, SOURCE_PROCESSING_ORDER } from '@/lib/sefaria-api';
import type { SourceKey, SefariaResponse } from '@/lib/sefaria-api';
import { chunkText, type TextChunk } from '@/lib/chunker';
import { explainTalmudSegment } from '@/ai/flows/talmud-ai-chatbot-explanation';
import { summarizeTalmudStudyGuide } from '@/ai/flows/talmud-ai-summary';
import { createStudyGuideDoc } from '@/lib/google-docs';
import { getEffectiveModel } from '@/ai/genkit';
import { logGenerationMetrics } from '@/lib/metrics';
import { getAdminDb } from '@/server/firebase-admin';
import { MAX_CHUNKS_PER_SOURCE, CANCELLATION_CHECK_INTERVAL } from '@/lib/constants';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'crypto';

export interface ProcessedChunk {
  id: string;
  rawText: string;
  explanation: string;
  rawHash: string;
  cacheHit: boolean;
  orderIndex: number;
  modelUsed?: string;
  validated?: boolean;
}

export interface SourceResult {
  sourceKey: SourceKey;
  hebrewLabel: string;
  tref: string;
  chunks: ProcessedChunk[];
}

export interface MultiSourceRequest {
  section: string;
  siman: string;
  seif?: string;
  sources: SourceKey[];
}

export interface GenerationResult {
  success: boolean;
  guideData?: {
    tref: string;
    summary: string;
    sourceResults: SourceResult[];
    sources: SourceKey[];
    summaryModel?: string;
    validated?: boolean;
  };
  error?: string;
  cancelled?: boolean;
}

const CANONICAL_COLLECTION = 'canonicalStudyGuides';
const CANONICAL_CACHE_VERSION = 'v1';
const CANONICAL_LOCK_STALE_MS = 10 * 60 * 1000;
const CANONICAL_READY_WAIT_ATTEMPTS = 20;
const CANONICAL_READY_WAIT_MS = 1500;

type CanonicalLockState = 'acquired' | 'ready' | 'wait';

function sortSources(sources: SourceKey[]): SourceKey[] {
  return [...sources].sort((a, b) => a.localeCompare(b));
}

function normalizePart(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function buildCanonicalCacheKey(request: MultiSourceRequest): string {
  const sourcePart = sortSources(request.sources).join(',');
  const raw = [
    CANONICAL_CACHE_VERSION,
    normalizePart(request.section),
    normalizePart(request.siman),
    normalizePart(request.seif),
    sourcePart,
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isKnownSourceKey(value: unknown): value is SourceKey {
  return typeof value === 'string' && value in SOURCE_CONFIGS;
}

async function tryAcquireCanonicalLock(
  cacheKey: string,
  request: MultiSourceRequest,
): Promise<CanonicalLockState> {
  const db = getAdminDb();
  const canonicalRef = db.collection(CANONICAL_COLLECTION).doc(cacheKey);
  const sortedSources = sortSources(request.sources);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(canonicalRef);
    const now = Date.now();

    if (snap.exists) {
      const data = snap.data() || {};

      if (data.status === 'ready' && typeof data.summaryText === 'string') {
        return 'ready' as const;
      }

      const updatedAtMs = toMillis(data.updatedAt);
      const isStale = !updatedAtMs || (now - updatedAtMs) > CANONICAL_LOCK_STALE_MS;
      if (data.status === 'processing' && !isStale) {
        return 'wait' as const;
      }

      tx.set(canonicalRef, {
        status: 'processing',
        section: request.section,
        siman: request.siman,
        seif: request.seif || null,
        sources: sortedSources,
        version: CANONICAL_CACHE_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return 'acquired' as const;
    }

    tx.set(canonicalRef, {
      status: 'processing',
      section: request.section,
      siman: request.siman,
      seif: request.seif || null,
      sources: sortedSources,
      version: CANONICAL_CACHE_VERSION,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return 'acquired' as const;
  });
}

async function loadCanonicalGuide(cacheKey: string): Promise<GenerationResult['guideData'] | null> {
  const db = getAdminDb();
  const canonicalRef = db.collection(CANONICAL_COLLECTION).doc(cacheKey);
  const guideSnap = await canonicalRef.get();

  if (!guideSnap.exists) {
    return null;
  }

  const guideData = guideSnap.data();
  if (!guideData || guideData.status !== 'ready') {
    return null;
  }

  if (typeof guideData.summaryText !== 'string' || typeof guideData.tref !== 'string') {
    return null;
  }

  const chunkSnap = await canonicalRef.collection('chunks').get();
  if (chunkSnap.empty) {
    return null;
  }

  type GroupedSource = {
    sourceKey: SourceKey;
    hebrewLabel: string;
    tref: string;
    chunks: ProcessedChunk[];
  };

  const grouped = new Map<SourceKey, GroupedSource>();

  for (const chunkDoc of chunkSnap.docs) {
    const chunk = chunkDoc.data();
    if (!isKnownSourceKey(chunk.sourceKey)) {
      continue;
    }

    const sourceKey = chunk.sourceKey;
    const rawText = typeof chunk.rawText === 'string' ? chunk.rawText : '';
    const explanationText = typeof chunk.explanationText === 'string' ? chunk.explanationText : '';
    if (!rawText || !explanationText) {
      continue;
    }

    const source = grouped.get(sourceKey) ?? {
      sourceKey,
      hebrewLabel: typeof chunk.hebrewLabel === 'string' ? chunk.hebrewLabel : SOURCE_CONFIGS[sourceKey].hebrewLabel,
      tref: typeof chunk.tref === 'string' ? chunk.tref : guideData.tref,
      chunks: [],
    };

    source.chunks.push({
      id: typeof chunk.id === 'string' ? chunk.id : chunkDoc.id,
      rawText,
      explanation: explanationText,
      rawHash: typeof chunk.rawHash === 'string' ? chunk.rawHash : '',
      cacheHit: true,
      orderIndex: typeof chunk.orderIndex === 'number' ? chunk.orderIndex : source.chunks.length,
      modelUsed: typeof chunk.modelUsed === 'string' ? chunk.modelUsed : undefined,
      validated: typeof chunk.validated === 'boolean' ? chunk.validated : undefined,
    });

    grouped.set(sourceKey, source);
  }

  const sourceResults: SourceResult[] = SOURCE_PROCESSING_ORDER
    .filter(sourceKey => grouped.has(sourceKey))
    .map((sourceKey) => {
      const source = grouped.get(sourceKey)!;
      source.chunks.sort((a, b) => a.orderIndex - b.orderIndex);
      return source;
    });

  if (sourceResults.length === 0) {
    return null;
  }

  const sources = Array.isArray(guideData.sources)
    ? guideData.sources.filter(isKnownSourceKey)
    : sourceResults.map(source => source.sourceKey);

  return {
    tref: guideData.tref,
    summary: guideData.summaryText,
    sourceResults,
    sources,
    summaryModel: typeof guideData.summaryModel === 'string' ? guideData.summaryModel : undefined,
    validated: typeof guideData.validated === 'boolean' ? guideData.validated : undefined,
  };
}

async function waitForCanonicalGuide(cacheKey: string): Promise<GenerationResult['guideData'] | null> {
  for (let attempt = 0; attempt < CANONICAL_READY_WAIT_ATTEMPTS; attempt++) {
    const cachedGuide = await loadCanonicalGuide(cacheKey);
    if (cachedGuide) {
      return cachedGuide;
    }

    await sleep(CANONICAL_READY_WAIT_MS);
  }

  return null;
}

async function saveCanonicalGuide(
  cacheKey: string,
  request: MultiSourceRequest,
  guideData: NonNullable<GenerationResult['guideData']>,
): Promise<void> {
  const db = getAdminDb();
  const canonicalRef = db.collection(CANONICAL_COLLECTION).doc(cacheKey);
  const existingChunks = await canonicalRef.collection('chunks').get();
  const batch = db.batch();

  for (const docSnap of existingChunks.docs) {
    batch.delete(docSnap.ref);
  }

  const totalChunks = guideData.sourceResults.reduce((sum, source) => sum + source.chunks.length, 0);

  batch.set(canonicalRef, {
    status: 'ready',
    section: request.section,
    siman: request.siman,
    seif: request.seif || null,
    sources: sortSources(request.sources),
    version: CANONICAL_CACHE_VERSION,
    tref: guideData.tref,
    summaryText: guideData.summary,
    summaryModel: guideData.summaryModel || null,
    validated: guideData.validated ?? false,
    chunkCount: totalChunks,
    updatedAt: FieldValue.serverTimestamp(),
    lastGeneratedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  for (const sourceResult of guideData.sourceResults) {
    const sourceOrder = SOURCE_PROCESSING_ORDER.indexOf(sourceResult.sourceKey);
    for (const chunk of sourceResult.chunks) {
      batch.set(canonicalRef.collection('chunks').doc(chunk.id), {
        id: chunk.id,
        sourceKey: sourceResult.sourceKey,
        sourceOrder,
        hebrewLabel: sourceResult.hebrewLabel,
        tref: sourceResult.tref,
        orderIndex: chunk.orderIndex,
        rawText: chunk.rawText,
        explanationText: chunk.explanation,
        rawHash: chunk.rawHash,
        modelUsed: chunk.modelUsed || null,
        validated: chunk.validated ?? false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await batch.commit();
}

async function markCanonicalFailed(cacheKey: string, reason: string): Promise<void> {
  const db = getAdminDb();
  await db.collection(CANONICAL_COLLECTION).doc(cacheKey).set({
    status: 'failed',
    error: reason,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function isCancelled(userId: string, guideId: string): Promise<boolean> {
  if (!userId || !guideId) return false;

  try {
    const db = getAdminDb();
    const guideSnap = await db.collection('users').doc(userId).collection('studyGuides').doc(guideId).get();
    return guideSnap.exists && guideSnap.get('status') === 'Cancelled';
  } catch {
    return false;
  }
}

async function processSourceChunks(
  rawChunks: TextChunk[],
  tref: string,
  sourceKey: SourceKey,
  modelName: string,
  userId: string,
  guideId: string,
  companionText: string | undefined,
): Promise<{ chunks: ProcessedChunk[]; cacheHits: number; cancelled: boolean }> {
  const processed: ProcessedChunk[] = [];
  let cacheHits = 0;
  let previousSegment: string | null = null;
  let previousExplanation: string | null = null;

  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];

    if (i % CANCELLATION_CHECK_INTERVAL === 0 && await isCancelled(userId, guideId)) {
      return { chunks: processed, cacheHits, cancelled: true };
    }

    const result = await explainTalmudSegment({
      currentSegment: chunk.text,
      previousSegments: previousSegment ? [previousSegment] : [],
      previousExplanations: previousExplanation ? [previousExplanation] : [],
      modelName,
      normalizedTref: tref,
      chunkOrder: i,
      rawHash: chunk.rawHash,
      sourceKey,
      companionText: sourceKey === 'shulchan_arukh' ? companionText : undefined,
    });

    if (result.cacheHit) cacheHits += 1;

    processed.push({
      id: chunk.id,
      rawText: chunk.text,
      explanation: result.explanation,
      rawHash: chunk.rawHash,
      cacheHit: result.cacheHit,
      orderIndex: i,
      modelUsed: result.modelUsed,
      validated: result.validated,
    });

    previousSegment = chunk.text;
    previousExplanation = result.explanation;
  }

  return { chunks: processed, cacheHits, cancelled: false };
}

export async function generateMultiSourceStudyGuide(
  request: MultiSourceRequest,
  userId: string,
  guideId: string,
): Promise<GenerationResult> {
  if (!userId || !guideId) {
    return { success: false, error: 'חסר מזהה משתמש או מזהה מדריך.' };
  }

  if (!request.sources.length) {
    return { success: false, error: 'יש לבחור לפחות מקור אחד.' };
  }

  const startTime = Date.now();
  let totalCacheHits = 0;
  let totalChunkCount = 0;
  const canonicalCacheKey = buildCanonicalCacheKey(request);
  let hasCanonicalLock = false;

  try {
    let canonicalState = await tryAcquireCanonicalLock(canonicalCacheKey, request);

    if (canonicalState === 'ready') {
      const cachedGuide = await loadCanonicalGuide(canonicalCacheKey);
      if (cachedGuide) {
        return { success: true, guideData: cachedGuide };
      }
      canonicalState = await tryAcquireCanonicalLock(canonicalCacheKey, request);
    }

    if (canonicalState === 'wait') {
      const waitedGuide = await waitForCanonicalGuide(canonicalCacheKey);
      if (waitedGuide) {
        return { success: true, guideData: waitedGuide };
      }

      canonicalState = await tryAcquireCanonicalLock(canonicalCacheKey, request);
      if (canonicalState === 'ready') {
        const cachedGuide = await loadCanonicalGuide(canonicalCacheKey);
        if (cachedGuide) {
          return { success: true, guideData: cachedGuide };
        }
      }
    }

    hasCanonicalLock = canonicalState === 'acquired';

    // 1. Build refs for each selected source
    const refsToFetch = request.sources
      .filter(s => s !== 'mishnah_berurah') // MB is fetched but not processed as a standalone section
      .map(sourceKey => ({
        sourceKey,
        tref: buildSefariaRef(sourceKey, request.section, request.siman, request.seif),
      }));

    // Also fetch Mishnah Berurah if selected (as companion for SA)
    let mbRef: string | undefined;
    if (request.sources.includes('mishnah_berurah')) {
      mbRef = buildSefariaRef('mishnah_berurah', request.section, request.siman, request.seif);
    }

    // 2. Parallel fetch all sources
    const fetchPromises = refsToFetch.map(async ({ sourceKey, tref }) => {
      const data = await fetchSefariaText(tref, 'he');
      return { sourceKey, tref: data.ref, data };
    });

    const mbPromise = mbRef
      ? fetchSefariaText(mbRef, 'he').catch((err) => {
        console.warn('[Action] Mishnah Berurah fetch failed, proceeding without:', err);
        return null;
      })
      : Promise.resolve(null);

    const [fetchResults, mbData] = await Promise.all([
      Promise.allSettled(fetchPromises),
      mbPromise,
    ]);

    // Prepare MB companion text
    const companionText = mbData
      ? (Array.isArray(mbData.he) ? mbData.he : []).join(' ').trim() || undefined
      : undefined;

    // 3. Count total chunks to pick model
    const sourceFetches: { sourceKey: SourceKey; tref: string; data: SefariaResponse }[] = [];
    for (const result of fetchResults) {
      if (result.status === 'fulfilled') {
        sourceFetches.push(result.value);
      } else {
        console.warn('[Action] Source fetch failed:', result.reason);
      }
    }

    if (sourceFetches.length === 0) {
      throw new Error('לא הצלחנו לקבל טקסט מאף מקור שנבחר.');
    }

    // Pre-chunk to count total
    const sourceChunkMap = new Map<SourceKey, { tref: string; chunks: TextChunk[] }>();
    for (const { sourceKey, tref, data } of sourceFetches) {
      const heTexts = Array.isArray(data.he) ? data.he : [];
      const content = heTexts.join(' ');
      if (!content.trim()) continue;

      const allChunks = chunkText(content, tref, sourceKey);
      const limited = allChunks.slice(0, MAX_CHUNKS_PER_SOURCE);
      if (allChunks.length > MAX_CHUNKS_PER_SOURCE) {
        console.warn(`[Action] ${sourceKey}: ${allChunks.length} chunks, limiting to ${MAX_CHUNKS_PER_SOURCE}.`);
      }
      sourceChunkMap.set(sourceKey, { tref, chunks: limited });
      totalChunkCount += limited.length;
    }

    const modelToUse = getEffectiveModel(totalChunkCount);

    // 4. Process all sources in PARALLEL (each source still processes chunks sequentially for context)
    const sourceResults: SourceResult[] = [];

    const sourceProcessingPromises = SOURCE_PROCESSING_ORDER
      .filter(sourceKey => sourceChunkMap.has(sourceKey))
      .map(async (sourceKey) => {
        const entry = sourceChunkMap.get(sourceKey)!;
        const { chunks: rawChunks, tref } = entry;
        const config = SOURCE_CONFIGS[sourceKey];

        const result = await processSourceChunks(
          rawChunks,
          tref,
          sourceKey,
          modelToUse,
          userId,
          guideId,
          companionText,
        );

        return { sourceKey, result, tref, config };
      });

    const parallelResults = await Promise.all(sourceProcessingPromises);

    let cancelled = false;
    for (const { sourceKey, result, tref, config } of parallelResults) {
      totalCacheHits += result.cacheHits;

      if (result.cancelled) {
        console.info(`[Action-Cancel] Stopped at source ${sourceKey} for user ${userId}`);
        cancelled = true;
        break;
      }

      if (result.chunks.length > 0) {
        const label = sourceKey === 'shulchan_arukh' && companionText
          ? `${config.hebrewLabel} (עם משנה ברורה)`
          : config.hebrewLabel;

        sourceResults.push({
          sourceKey,
          hebrewLabel: label,
          tref,
          chunks: result.chunks,
        });
      }
    }

    if (cancelled) {
      if (hasCanonicalLock) {
        await markCanonicalFailed(canonicalCacheKey, 'cancelled');
      }
      return { success: false, cancelled: true };
    }

    if (sourceResults.length === 0) {
      throw new Error('לא נמצא תוכן בכל המקורות שנבחרו.');
    }

    // 5. Build combined text for summary
    const allExplanations = sourceResults
      .map(sr => `--- ${sr.hebrewLabel} ---\n` + sr.chunks.map(c => c.explanation).join('\n\n'))
      .join('\n\n');

    const summaryResult = await summarizeTalmudStudyGuide({
      studyGuideText: allExplanations,
      modelName: modelToUse,
      sources: request.sources,
    });

    // 6. Log metrics
    const duration = Date.now() - startTime;
    logGenerationMetrics({
      modelName: modelToUse,
      chunkCount: totalChunkCount,
      durationMs: duration,
      cacheHits: totalCacheHits,
    });

    // Primary tref = SA if present, otherwise first source
    const primaryTref = sourceResults.find(sr => sr.sourceKey === 'shulchan_arukh')?.tref
      || sourceResults[0].tref;

    const finalGuideData: NonNullable<GenerationResult['guideData']> = {
      tref: primaryTref,
      summary: summaryResult.summary,
      sourceResults,
      sources: request.sources,
      summaryModel: summaryResult.modelUsed,
      validated: summaryResult.validated && sourceResults.every(sr =>
        sr.chunks.every(c => c.validated)
      ),
    };

    if (hasCanonicalLock) {
      try {
        await saveCanonicalGuide(canonicalCacheKey, request, finalGuideData);
      } catch (cacheSaveError) {
        console.warn('[Action-Cache] Failed to save canonical guide:', cacheSaveError);
        await markCanonicalFailed(canonicalCacheKey, 'cache_write_failed');
      }
    }

    return {
      success: true,
      guideData: finalGuideData,
    };
  } catch (error: unknown) {
    console.error('[Action-Error]', error);
    if (hasCanonicalLock) {
      try {
        await markCanonicalFailed(
          canonicalCacheKey,
          error instanceof Error ? error.message : 'unknown_error'
        );
      } catch (markError) {
        console.warn('[Action-Cache] Failed to mark canonical guide as failed:', markError);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'אירעה שגיאה בלתי צפויה בתהליך היצירה.',
    };
  }
}

export async function exportToGoogleDocs(
  tref: string,
  summary: string,
  sourceResults: SourceResult[],
): Promise<{ success: boolean; googleDocId?: string; googleDocUrl?: string; error?: string }> {
  try {
    const docData = await createStudyGuideDoc(tref, summary, sourceResults);
    return {
      success: true,
      googleDocId: docData.id,
      googleDocUrl: docData.url,
    };
  } catch (error) {
    console.error('[GoogleDocs] Failed to create document:', error);
    return {
      success: false,
      error: 'יצירת מסמך Google Docs נכשלה. בדוק הרשאות גישה לשירות.',
    };
  }
}
