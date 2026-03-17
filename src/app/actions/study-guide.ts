'use server';

import {
  fetchSefariaText,
  buildSefariaRef,
  SOURCE_CONFIGS,
  SOURCE_PROCESSING_ORDER,
  resolveFetchMode,
  getLinkedSourcesForShulchanArukhSeif,
  getTurSegmentsForSeif,
} from '@/lib/sefaria-api';
import type { SourceKey, SefariaResponse, FetchMode, StructuredChunk } from '@/lib/sefaria-api';
import { chunkStructuredText, type TextChunk } from '@/lib/chunker';
import { explainTalmudSegment } from '@/ai/flows/talmud-ai-chatbot-explanation';
import { summarizeTalmudStudyGuide } from '@/ai/flows/talmud-ai-summary';
import { generateRavOvadiaOpinion } from '@/ai/flows/rav-ovadia-opinion';
import { createStudyGuideDoc, createAllGuidesDoc, createSummariesOnlyDoc } from '@/lib/google-docs';
import { getOrBuildSimanAlignment } from './siman-alignment';
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
  sourceRef?: string;
  sourcePath?: number[];
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
  torahOhrPassagesOnly?: boolean;
  manualTurText?: string;
  manualByText?: string;
  manualMbText?: string;
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
const CANONICAL_CACHE_VERSION = 'v8';
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
  const rawParts = [
    CANONICAL_CACHE_VERSION,
    normalizePart(request.section),
    normalizePart(request.siman),
    normalizePart(request.seif),
    sourcePart,
    request.torahOhrPassagesOnly ? 'torah_ohr_passages_only' : '',
  ];

  const manualTur = normalizePart(request.manualTurText);
  const manualBy = normalizePart(request.manualByText);

  if (manualTur || manualBy) {
    rawParts.push(manualTur, manualBy);
  }

  return createHash('sha256').update(rawParts.join('|')).digest('hex');
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

function getChunkLimitForSource(sourceKey: SourceKey): number {
  // Torah Ohr can contain long maamarim; truncating to the generic cap drops large parts.
  if (sourceKey === 'torah_ohr') {
    return Number.POSITIVE_INFINITY;
  }
  return MAX_CHUNKS_PER_SOURCE;
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
      sourceRef: typeof chunk.sourceRef === 'string' ? chunk.sourceRef : undefined,
      sourcePath: Array.isArray(chunk.sourcePath)
        ? chunk.sourcePath.filter((part: unknown): part is number => typeof part === 'number')
        : undefined,
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
        sourceRef: chunk.sourceRef || null,
        sourcePath: chunk.sourcePath || null,
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

async function persistGuideResultForUser(
  userId: string,
  guideId: string,
  guideData: NonNullable<GenerationResult['guideData']>,
): Promise<void> {
  const db = getAdminDb();
  const guideRef = db.collection('users').doc(userId).collection('studyGuides').doc(guideId);
  const existingGuide = await guideRef.get();
  const nowIso = new Date().toISOString();

  const existingTref = existingGuide.exists && typeof existingGuide.get('tref') === 'string'
    ? existingGuide.get('tref') as string
    : guideData.tref;
  const existingCreatedAt = existingGuide.exists && typeof existingGuide.get('createdAt') === 'string'
    ? existingGuide.get('createdAt') as string
    : nowIso;

  const totalChunks = guideData.sourceResults.reduce((sum, source) => sum + source.chunks.length, 0);

  await guideRef.set({
    id: guideId,
    userId,
    tref: existingTref,
    sefariaRef: guideData.tref,
    language: 'he',
    status: 'Preview',
    summaryText: guideData.summary,
    googleDocUrl: existingGuide.exists && typeof existingGuide.get('googleDocUrl') === 'string'
      ? existingGuide.get('googleDocUrl')
      : '',
    googleDocId: existingGuide.exists && typeof existingGuide.get('googleDocId') === 'string'
      ? existingGuide.get('googleDocId')
      : '',
    validated: guideData.validated ?? false,
    sources: guideData.sources,
    createdAt: existingCreatedAt,
    updatedAt: nowIso,
    progressDone: totalChunks,
    progressTotal: totalChunks,
    progressPhase: 'summary',
  }, { merge: true });

  const chunkWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const sr of guideData.sourceResults) {
    for (const chunk of sr.chunks) {
      chunkWrites.push({
        id: chunk.id,
        data: {
          id: chunk.id,
          studyGuideId: guideId,
          userId,
          sourceKey: sr.sourceKey,
          hebrewLabel: sr.hebrewLabel,
          tref: sr.tref,
          orderIndex: chunk.orderIndex,
          rawText: chunk.rawText,
          rawHash: chunk.rawHash,
          explanationText: chunk.explanation,
          validated: chunk.validated ?? false,
          sourceRef: chunk.sourceRef || null,
          sourcePath: chunk.sourcePath || null,
          modelUsed: chunk.modelUsed || null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      });
    }
  }

  const BATCH_LIMIT = 400;
  for (let i = 0; i < chunkWrites.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const slice = chunkWrites.slice(i, i + BATCH_LIMIT);
    for (const write of slice) {
      batch.set(guideRef.collection('textChunks').doc(write.id), write.data, { merge: true });
    }
    await batch.commit();
  }
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

type SourceFetchPayload = {
  sourceKey: SourceKey;
  tref: string;
  data: SefariaResponse;
  fetchMode: FetchMode;
};

function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function dedupeStructuredSegments(segments: StructuredChunk[]): StructuredChunk[] {
  const seen = new Set<string>();
  const deduped: StructuredChunk[] = [];

  for (const segment of segments) {
    const pathKey = Array.isArray(segment.path) ? segment.path.join('.') : '';
    const key = `${segment.ref}|${pathKey}|${segment.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }

  return deduped;
}

function responseWithSegments(data: SefariaResponse, segments: StructuredChunk[]): SefariaResponse {
  return {
    ...data,
    he: segments.map(segment => segment.text),
    segments,
  };
}

function segmentMatchesRef(segmentRef: string, targetRef: string): boolean {
  return segmentRef === targetRef || segmentRef.startsWith(`${targetRef}:`);
}

async function fetchSegmentsFromRefs(
  request: MultiSourceRequest,
  sourceKey: SourceKey,
  refs: string[],
): Promise<StructuredChunk[]> {
  const uniqueRefs = [...new Set(refs.map(ref => ref.trim()).filter(Boolean))];
  if (uniqueRefs.length === 0) return [];

  const settled = await Promise.allSettled(uniqueRefs.map(ref => fetchSefariaText(ref, 'he')));
  const fetched: StructuredChunk[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      fetched.push(...result.value.segments);
    }
  }

  if (fetched.length > 0) {
    return dedupeStructuredSegments(fetched);
  }

  // Fallback: fetch full siman once and select segments by ref/prefix match.
  const fullSimanRef = buildSefariaRef(sourceKey, request.section, request.siman);
  const fullSimanData = await fetchSefariaText(fullSimanRef, 'he');
  const matched = fullSimanData.segments.filter(segment =>
    uniqueRefs.some(ref => segmentMatchesRef(segment.ref, ref)),
  );

  return dedupeStructuredSegments(matched);
}

async function fetchSourceWithStrategy(
  request: MultiSourceRequest,
  sourceKey: SourceKey,
): Promise<SourceFetchPayload> {
  const fetchMode = resolveFetchMode(sourceKey);
  const simanNum = parsePositiveInt(request.siman);
  const seifNum = parsePositiveInt(request.seif);

  // Manual Text Override Support
  const isTur = sourceKey === 'tur';
  const isBy = sourceKey === 'beit_yosef';

  if (isTur && request.manualTurText?.trim()) {
    const syntheticRef = `Tur (Saisie Manuelle) - ${request.section} ${request.siman}:${request.seif || ''}`.trim();
    const syntheticSegment: StructuredChunk = {
      ref: syntheticRef,
      text: request.manualTurText.trim()
    };
    const syntheticData = responseWithSegments({
      ref: syntheticRef,
      he: [],
      segments: [],
      en: [],
      direction: 'rtl'
    }, [syntheticSegment]);

    console.info(`[Action] tur: using manual text input (${request.manualTurText.trim().split(/\\s+/).length} words)`);
    return {
      sourceKey,
      tref: syntheticData.ref,
      data: syntheticData,
      fetchMode: 'linked-passages'
    };
  }

  if (isBy && request.manualByText?.trim()) {
    const syntheticRef = `Beit Yosef (Saisie Manuelle) - ${request.section} ${request.siman}:${request.seif || ''}`.trim();
    const syntheticSegment: StructuredChunk = {
      ref: syntheticRef,
      text: request.manualByText.trim()
    };
    const syntheticData = responseWithSegments({
      ref: syntheticRef,
      he: [],
      segments: [],
      en: [],
      direction: 'rtl'
    }, [syntheticSegment]);

    console.info(`[Action] beit_yosef: using manual text input (${request.manualByText.trim().split(/\\s+/).length} words)`);
    return {
      sourceKey,
      tref: syntheticData.ref,
      data: syntheticData,
      fetchMode: 'linked-passages'
    };
  }

  // Tur & Beit Yosef -> use the Siman Alignment Engine
  if (fetchMode === 'linked-passages' && simanNum && seifNum) {
    if (sourceKey === 'beit_yosef') {
      const fallbackRef = buildSefariaRef('beit_yosef', request.section, request.siman);
      try {
        const linked = await getLinkedSourcesForShulchanArukhSeif(request.section, simanNum, seifNum);
        const refs = linked.beitYosefRefs;

        if (refs.length > 0) {
          const segments = await fetchSegmentsFromRefs(request, sourceKey, refs);
          return {
            sourceKey,
            tref: refs[0] || fallbackRef,
            data: responseWithSegments({
              ref: refs[0] || fallbackRef,
              he: [],
              segments: [],
              en: [],
              direction: 'rtl',
            }, segments),
            fetchMode: 'linked-passages',
          };
        }

        // No direct Sefaria links — fall through to alignment cache (which uses LLM alignment)
        console.info(`[Action] beit_yosef: no direct Sefaria links for ${request.section} ${simanNum}:${seifNum}, trying alignment cache...`);
      } catch (error) {
        console.warn(
          `[Action] beit_yosef: links lookup failed for ${request.section} ${simanNum}:${seifNum}, trying alignment cache:`,
          error,
        );
      }
    }

    // For both Tur and BY: try alignment cache first (has LLM-computed slices)
    try {
      const alignment = await getOrBuildSimanAlignment(request.section, simanNum);
      if (alignment) {
        const mapping = alignment.seifMap[seifNum.toString()];

        if (mapping) {
          // Tur with pre-sliced text: use turTextSlice directly (giant Tur case)
          if (sourceKey === 'tur' && mapping.turTextSlice) {
            const turSimanRef = buildSefariaRef('tur', request.section, request.siman);
            const sliceSegment: StructuredChunk = {
              ref: `${turSimanRef} [Seif ${seifNum}]`,
              text: mapping.turTextSlice,
            };
            const syntheticData = responseWithSegments({
              ref: sliceSegment.ref,
              he: [],
              segments: [],
              en: [],
              direction: 'rtl',
            }, [sliceSegment]);

            console.info(`[Action] tur: using turTextSlice from alignment cache for ${request.section} ${simanNum}:${seifNum} (${mapping.turTextSlice.split(/\s+/).length} words)`);
            return {
              sourceKey,
              tref: syntheticData.ref,
              data: syntheticData,
              fetchMode: 'linked-passages',
            };
          }

          const refs = sourceKey === 'tur' ? mapping.turRefs : mapping.byRefs;
          if (refs.length > 0) {
            const segments = await fetchSegmentsFromRefs(request, sourceKey, refs);
            if (segments.length > 0) {
              const syntheticData = responseWithSegments({
                ref: refs[0] || buildSefariaRef(sourceKey, request.section, request.siman),
                he: [],
                segments: [],
                en: [],
                direction: 'rtl',
              }, segments);

              console.info(`[Action] ${sourceKey}: using alignment cache refs for ${request.section} ${simanNum}:${seifNum}`);
              return {
                sourceKey,
                tref: syntheticData.ref,
                data: syntheticData,
                fetchMode: 'linked-passages',
              };
            }
          }
        } else {
          console.warn(`[Action] ${sourceKey}: no mapping found for seif ${seifNum} in seifMap (keys: ${Object.keys(alignment.seifMap).join(',')}).`);
        }
      }
    } catch (error) {
      console.warn(`[Action] Alignment cache lookup failed for ${sourceKey}:`, error);
    }

    // Tur fallback: boundary slicing (for cases where alignment cache has no data)
    if (sourceKey === 'tur') {
      try {
        const turSegments = await getTurSegmentsForSeif(request.section, simanNum, seifNum);
        if (turSegments.length > 0) {
          const syntheticData = responseWithSegments({
            ref: turSegments[0].ref,
            he: [],
            segments: [],
            en: [],
            direction: 'rtl',
          }, turSegments);

          return {
            sourceKey,
            tref: syntheticData.ref,
            data: syntheticData,
            fetchMode: 'linked-passages',
          };
        }
      } catch (error) {
        console.warn(`[Action] Tur boundary slicing fallback failed for ${request.section} ${simanNum}:${seifNum}:`, error);
      }
    }

    // Final fallback: direct Sefaria links
    try {
      const linked = await getLinkedSourcesForShulchanArukhSeif(request.section, simanNum, seifNum);
      const refs = sourceKey === 'tur' ? linked.turRefs : linked.beitYosefRefs;
      if (refs.length > 0) {
        const segments = await fetchSegmentsFromRefs(request, sourceKey, refs);
        const syntheticData = responseWithSegments({
          ref: refs[0],
          he: [],
          segments: [],
          en: [],
          direction: 'rtl',
        }, segments);

        return {
          sourceKey,
          tref: syntheticData.ref,
          data: syntheticData,
          fetchMode: 'linked-passages',
        };
      }
    } catch (linksError) {
      console.warn(`[Action] Direct links fallback failed for ${sourceKey}:`, linksError);
    }
  }

  // Exact seif fetch (Shulchan Arukh, Mishnah Berurah)
  if (fetchMode === 'exact-seif' && request.seif) {
    const exactSeifTref = buildSefariaRef(sourceKey, request.section, request.siman, request.seif);
    const exactSeifData = await fetchSefariaText(exactSeifTref, 'he');
    return {
      sourceKey,
      tref: exactSeifData.ref,
      data: exactSeifData,
      fetchMode: 'exact-seif',
    };
  }

  // Fallback for everything else
  const fullSimanTref = buildSefariaRef(sourceKey, request.section, request.siman);
  const fullSimanData = await fetchSefariaText(fullSimanTref, 'he');

  return {
    sourceKey,
    tref: fullSimanData.ref,
    data: fullSimanData,
    fetchMode: 'full-siman',
  };
}

async function processSourceChunks(
  rawChunks: TextChunk[],
  tref: string,
  sourceKey: SourceKey,
  modelName: string,
  userId: string,
  guideId: string,
  companionText: string | undefined,
  passagesOnlyMode: boolean,
  onChunkDone?: () => void,
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

    const rawHash = createHash('sha256').update(chunk.text).digest('hex');
    const shouldBypassLlm = passagesOnlyMode && sourceKey === 'torah_ohr';
    let result: {
      explanation: string;
      modelUsed: string;
      cacheHit: boolean;
      validated: boolean;
    };

    if (shouldBypassLlm) {
      result = {
        explanation: chunk.text,
        modelUsed: 'passages-only',
        cacheHit: true,
        validated: true,
      };
    } else {
      const llmResult = await explainTalmudSegment({
        currentSegment: chunk.text,
        previousSegments: previousSegment ? [previousSegment] : [],
        previousExplanations: previousExplanation ? [previousExplanation] : [],
        modelName,
        normalizedTref: chunk.ref || tref,
        chunkOrder: i,
        rawHash,
        sourceKey,
        companionText: sourceKey === 'shulchan_arukh' ? companionText : undefined,
      });
      if (llmResult.cacheHit) cacheHits += 1;
      result = {
        explanation: llmResult.explanation,
        modelUsed: llmResult.modelUsed,
        cacheHit: llmResult.cacheHit,
        validated: llmResult.validated,
      };
    }

    processed.push({
      id: `${sourceKey}-${i}`,
      rawText: chunk.text,
      explanation: result.explanation,
      rawHash,
      sourceRef: chunk.ref,
      sourcePath: chunk.path,
      cacheHit: result.cacheHit,
      orderIndex: i,
      modelUsed: result.modelUsed,
      validated: result.validated,
    });

    previousSegment = chunk.text;
    previousExplanation = result.explanation;

    if (onChunkDone) onChunkDone();
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

    // 2. Fetch selected sources (Tur/Beit Yosef use linked-passages strategy).
    const sourceFetchPromises = request.sources
      .filter(s => s !== 'mishnah_berurah' && s !== 'rav_ovadia') // MB and Rav Ovadia are handled separately
      .map(sourceKey => fetchSourceWithStrategy(request, sourceKey));

    // Also fetch Mishnah Berurah if selected (as companion for SA).
    // If manualMbText is provided, use it directly without a Sefaria fetch.
    const hasMb = request.sources.includes('mishnah_berurah');
    const mbSyntheticRef = `Mishnah Berurah (Saisie Manuelle) - ${request.section} ${request.siman}:${request.seif || ''}`.trim();

    let mbRef: string | undefined;
    if (hasMb && !request.manualMbText?.trim()) {
      mbRef = buildSefariaRef('mishnah_berurah', request.section, request.siman, request.seif);
    }

    const mbPromise = hasMb && request.manualMbText?.trim()
      ? Promise.resolve({
          ref: mbSyntheticRef,
          he: [request.manualMbText.trim()],
          segments: [{ ref: mbSyntheticRef, text: request.manualMbText.trim() }] as StructuredChunk[],
          en: [],
          direction: 'rtl' as const,
        })
      : mbRef
        ? fetchSefariaText(mbRef, 'he').catch((error) => {
            console.warn('[Action] Mishnah Berurah fetch failed, proceeding without:', error);
            return null;
          })
        : Promise.resolve(null);

    const [fetchResults, mbData] = await Promise.all([
      Promise.allSettled(sourceFetchPromises),
      mbPromise,
    ]);

    // Prepare MB companion text.
    const companionText = mbData
      ? (Array.isArray(mbData.he) ? mbData.he : []).join(' ').trim() || undefined
      : undefined;

    // 3. Collect successful source fetches and count total chunks to pick model.
    const sourceFetches: SourceFetchPayload[] = [];
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

    // Pre-chunk to count total while preserving source structure.
    const sourceChunkMap = new Map<SourceKey, { tref: string; chunks: TextChunk[] }>();
    for (const { sourceKey, tref, data, fetchMode } of sourceFetches) {
      const segments: StructuredChunk[] = Array.isArray(data.segments) && data.segments.length > 0
        ? data.segments
        : (Array.isArray(data.he) ? data.he : []).map((text, index) => ({
          ref: tref,
          path: [index],
          text,
        }));

      if (!segments.length) {
        continue;
      }

      const allChunks = chunkStructuredText(segments, sourceKey);
      const sourceChunkLimit = getChunkLimitForSource(sourceKey);
      const limited = Number.isFinite(sourceChunkLimit)
        ? allChunks.slice(0, sourceChunkLimit)
        : allChunks;
      if (allChunks.length > limited.length) {
        console.warn(`[Action] ${sourceKey}: ${allChunks.length} chunks, limiting to ${limited.length}.`);
      }
      if (fetchMode === 'linked-passages') {
        console.info(`[Action] ${sourceKey}: using linked passages (${segments.length} structured segments).`);
      } else if (fetchMode === 'full-siman') {
        console.info(`[Action] ${sourceKey}: using full siman strategy (${segments.length} structured segments).`);
      }
      sourceChunkMap.set(sourceKey, { tref, chunks: limited });
      totalChunkCount += limited.length;
    }

    const modelToUse = getEffectiveModel(totalChunkCount);

    // Write total chunk count to Firestore so the client can show a progress bar
    const db = getAdminDb();
    const guideRef = db.collection('users').doc(userId).collection('studyGuides').doc(guideId);
    await guideRef.update({
      progressDone: 0,
      progressTotal: totalChunkCount,
      progressPhase: 'chunks',
    });

    // Shared progress counter (atomic via closure since sources run in parallel)
    let progressDone = 0;
    const reportProgress = async () => {
      progressDone += 1;
      try {
        await guideRef.update({ progressDone });
      } catch { /* ignore progress write errors */ }
    };

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
          !!request.torahOhrPassagesOnly,
          reportProgress,
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

    // Process Mishnah Berurah through AI explanation (style מתיבתא)
    if (mbData && request.sources.includes('mishnah_berurah')) {
      const mbSegments: StructuredChunk[] = Array.isArray(mbData.segments) && mbData.segments.length > 0
        ? mbData.segments
        : (Array.isArray(mbData.he) ? mbData.he : []).map((text, index) => ({
            ref: mbData.ref,
            path: [index],
            text,
          }));

      if (mbSegments.length > 0) {
        const mbRawChunks = chunkStructuredText(mbSegments, 'mishnah_berurah').slice(0, MAX_CHUNKS_PER_SOURCE);

        const mbResult = await processSourceChunks(
          mbRawChunks,
          mbData.ref,
          'mishnah_berurah',
          modelToUse,
          userId,
          guideId,
          undefined,
          false,
          reportProgress,
        );

        if (!mbResult.cancelled && mbResult.chunks.length > 0) {
          totalCacheHits += mbResult.cacheHits;
          sourceResults.push({
            sourceKey: 'mishnah_berurah',
            hebrewLabel: SOURCE_CONFIGS.mishnah_berurah.hebrewLabel,
            tref: mbData.ref,
            chunks: mbResult.chunks,
          });
        }
      }
    }

        // Generate Rav Ovadia Yosef's opinion if requested (AI-generated, no Sefaria fetch)
    if (request.sources.includes('rav_ovadia')) {
      try {
        const saResult = sourceResults.find(sr => sr.sourceKey === 'shulchan_arukh');
        const saText = saResult?.chunks.map(c => c.rawText).join('\n') ?? '';
        const mbText = companionText ?? '';

        if (saText) {
          const ravOvadiaResult = await generateRavOvadiaOpinion({
            saText,
            mbText: mbText || undefined,
            section: request.section,
            siman: request.siman,
            seif: request.seif,
            modelName: modelToUse,
          });

          const opinionText = ravOvadiaResult.opinion;
          const ravOvadiaChunk: ProcessedChunk = {
            id: 'rav_ovadia-0',
            rawText: opinionText,
            explanation: opinionText,
            rawHash: createHash('sha256').update(opinionText).digest('hex'),
            cacheHit: false,
            orderIndex: 0,
            modelUsed: ravOvadiaResult.modelUsed,
            validated: true,
          };

          sourceResults.push({
            sourceKey: 'rav_ovadia',
            hebrewLabel: SOURCE_CONFIGS.rav_ovadia.hebrewLabel,
            tref: `${request.section} ${request.siman}${request.seif ? `:${request.seif}` : ''}`,
            chunks: [ravOvadiaChunk],
          });
        }
      } catch (ravOvadiaError) {
        console.warn('[Action] Failed to generate Rav Ovadia opinion:', ravOvadiaError);
      }
    }

    if (sourceResults.length === 0) {
      throw new Error('לא נמצא תוכן בכל המקורות שנבחרו.');
    }

    // 5. Build combined text for summary
    const allExplanations = sourceResults
      .map(sr => `--- ${sr.hebrewLabel} ---\n` + sr.chunks.map(c => c.explanation).join('\n\n'))
      .join('\n\n');

    // Update progress phase to 'summary'
    try {
      await guideRef.update({ progressPhase: 'summary' });
    } catch { /* ignore */ }

    const summaryResult = (request.torahOhrPassagesOnly && request.sources.length === 1 && request.sources[0] === 'torah_ohr')
      ? {
        summary: `תצוגת כל קטעי הפרשה ${request.siman} מתוך תורה אור (ללא ביאור AI).`,
        modelUsed: 'passages-only',
        validated: true,
      }
      : await summarizeTalmudStudyGuide({
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

    try {
      await persistGuideResultForUser(userId, guideId, finalGuideData);
    } catch (userPersistError) {
      console.warn('[Action] Failed to persist user guide result on server:', userPersistError);
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

export async function exportSimanSummariesToGoogleDocs(
  userId: string,
  guideIds: string[],
  simanLabel: string,
): Promise<{ success: boolean; googleDocUrl?: string; error?: string }> {
  try {
    const db = getAdminDb();
    const guidesRef = db.collection('users').doc(userId).collection('studyGuides');

    const guideSummaries: Array<{ tref: string; summary: string; seifNum: number }> = [];

    for (const guideId of guideIds) {
      const guideSnap = await guidesRef.doc(guideId).get();
      if (!guideSnap.exists) continue;
      const data = guideSnap.data() as { tref: string; summaryText: string };
      if (!data.summaryText?.trim()) continue;

      const tref = data.tref || '';
      const seifMatch = tref.match(/:(\d+)$/);
      const seifNum = seifMatch ? parseInt(seifMatch[1]!, 10) : 0;

      guideSummaries.push({ tref, summary: data.summaryText, seifNum });
    }

    if (guideSummaries.length === 0) {
      return { success: false, error: 'לא נמצאו סיכומים לייצוא.' };
    }

    guideSummaries.sort((a, b) => a.seifNum - b.seifNum);

    const date = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
    const docTitle = `סיכומי סימן ${simanLabel} – ${date}`;
    const docData = await createSummariesOnlyDoc(
      guideSummaries.map(({ tref, summary }) => ({ tref, summary })),
      docTitle,
    );

    return { success: true, googleDocUrl: docData.url };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[GoogleDocs] exportSimanSummariesToGoogleDocs failed:', error);
    return { success: false, error: `יצירת מסמך Google Docs נכשלה: ${detail}` };
  }
}

export async function exportAllGuidesToGoogleDocs(
  userId: string,
  guideIds: string[],
): Promise<{ success: boolean; googleDocUrl?: string; error?: string }> {
  try {
    const db = getAdminDb();
    const guidesRef = db.collection('users').doc(userId).collection('studyGuides');

    const guideDatas: Array<{ tref: string; summary: string; sourceResults: SourceResult[] }> = [];

    for (const guideId of guideIds) {
      const guideSnap = await guidesRef.doc(guideId).get();
      if (!guideSnap.exists) continue;
      const guideData = guideSnap.data() as { tref: string; summaryText: string; sources?: SourceKey[] };

      const chunksSnap = await guidesRef
        .doc(guideId)
        .collection('textChunks')
        .orderBy('orderIndex', 'asc')
        .get();

      const chunksBySource = new Map<string, ProcessedChunk[]>();
      for (const chunkDoc of chunksSnap.docs) {
        const c = chunkDoc.data() as {
          sourceKey: string;
          orderIndex: number;
          rawText: string;
          explanationText: string;
        };
        if (!chunksBySource.has(c.sourceKey)) chunksBySource.set(c.sourceKey, []);
        chunksBySource.get(c.sourceKey)!.push({
          id: chunkDoc.id,
          rawText: c.rawText ?? '',
          explanation: c.explanationText ?? '',
          rawHash: '',
          cacheHit: false,
          orderIndex: c.orderIndex,
        });
      }

      const sourceResults: SourceResult[] = SOURCE_PROCESSING_ORDER
        .filter((key) => chunksBySource.has(key))
        .map((key) => {
          const config = SOURCE_CONFIGS[key];
          return {
            sourceKey: key,
            hebrewLabel: config?.hebrewLabel ?? key,
            tref: guideData.tref,
            chunks: chunksBySource.get(key)!,
          };
        });

      guideDatas.push({
        tref: guideData.tref,
        summary: guideData.summaryText ?? '',
        sourceResults,
      });
    }

    if (guideDatas.length === 0) {
      return { success: false, error: 'לא נמצאו ביאורים לייצוא.' };
    }

    const date = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
    const docTitle = `כל הביאורים – ${date}`;
    const docData = await createAllGuidesDoc(guideDatas, docTitle);

    return { success: true, googleDocUrl: docData.url };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[GoogleDocs] exportAllGuidesToGoogleDocs failed:', error);
    return { success: false, error: `יצירת מסמך Google Docs נכשלה: ${detail}` };
  }
}
