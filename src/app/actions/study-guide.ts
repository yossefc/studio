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

  try {
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

    return {
      success: true,
      guideData: {
        tref: primaryTref,
        summary: summaryResult.summary,
        sourceResults,
        sources: request.sources,
        summaryModel: summaryResult.modelUsed,
        validated: summaryResult.validated && sourceResults.every(sr =>
          sr.chunks.every(c => c.validated)
        ),
      },
    };
  } catch (error: unknown) {
    console.error('[Action-Error]', error);
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
