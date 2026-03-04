import {
  buildSefariaRef,
  fetchSefariaText,
  getLinkedSourcesForShulchanArukhSeif,
} from '@/lib/sefaria-api';
import type { SefariaResponse, StructuredChunk } from '@/lib/sefaria-api';
import {
  CURRENT_CACHE_VERSION,
  generateSourceHash,
  loadSimanAlignment,
  markAlignmentFailed,
  markAlignmentReady,
  touchAlignmentSourceChecked,
  tryAcquireSimanLock,
  waitForAlignmentReady,
} from './alignment-cache';
import type { SeifRefMapping, SimanAlignment } from './alignment-cache';
import { alignSourceWithLLM } from './heuristic-alignment';

const MAX_WAIT_FOR_READY_MS = 180_000;
const SOURCE_HASH_RECHECK_MS = 12 * 60 * 60 * 1000;

type SimanSourcePayload = {
  shulchanArukh: SefariaResponse;
  tur: SefariaResponse;
  beitYosef: SefariaResponse;
};

type PreparedSimilarityChunk = {
  ref: string;
  index: number;
  tokens: Set<string>;
  bigrams: Set<string>;
};

type SimilaritySelection = {
  refs: string[];
  bestScore: number;
};

const inFlightBuilds = new Map<string, Promise<SimanAlignment | null>>();

export async function getOrBuildSimanAlignment(section: string, siman: number): Promise<SimanAlignment | null> {
  const dedupeKey = `${section.toLowerCase()}_${siman}`;
  const inFlight = inFlightBuilds.get(dedupeKey);
  if (inFlight) return inFlight;

  const promise = _getOrBuildSimanAlignment(section, siman);
  inFlightBuilds.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    inFlightBuilds.delete(dedupeKey);
  }
}

async function _getOrBuildSimanAlignment(section: string, siman: number): Promise<SimanAlignment | null> {
  const existing = await loadSimanAlignment(section, siman);

  let forceRebuild = false;
  let preloadedSourcePayload: SimanSourcePayload | undefined;

  if (existing?.status === 'ready' && existing.version === CURRENT_CACHE_VERSION) {
    const revalidation = await revalidateSourceHashIfNeeded(existing, section, siman);
    if (!revalidation.stale) {
      return existing;
    }
    forceRebuild = true;
    preloadedSourcePayload = revalidation.payload;
  }

  if (existing?.status === 'building' && hasActiveLock(existing)) {
    const ready = await waitForAlignmentReady(section, siman, MAX_WAIT_FOR_READY_MS);
    if (ready) return ready;
  }

  const lockAcquired = await tryAcquireSimanLock(section, siman, { forceRebuild });
  if (!lockAcquired) {
    const ready = await waitForAlignmentReady(section, siman, MAX_WAIT_FOR_READY_MS);
    if (ready) return ready;

    const latest = await loadSimanAlignment(section, siman);
    if (latest?.status === 'ready') return latest;

    throw new Error(`[AlignmentEngine] timeout waiting for alignment ${section} ${siman}`);
  }

  try {
    return await buildSimanAlignmentJob(section, siman, preloadedSourcePayload);
  } catch (error) {
    await markAlignmentFailed(section, siman, error instanceof Error ? error.message : 'alignment_build_failed');
    throw error;
  }
}

function hasActiveLock(alignment: SimanAlignment): boolean {
  if (alignment.status !== 'building' || !alignment.lockExpiresAt) return false;
  return alignment.lockExpiresAt.toMillis() > Date.now();
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return 0;
}

async function revalidateSourceHashIfNeeded(
  alignment: SimanAlignment,
  section: string,
  siman: number,
): Promise<{ stale: boolean; payload?: SimanSourcePayload }> {
  const lastCheckedAtMs = toMillis(alignment.sourceCheckedAt ?? alignment.updatedAt);
  const shouldRecheck = !lastCheckedAtMs || (Date.now() - lastCheckedAtMs >= SOURCE_HASH_RECHECK_MS);
  if (!shouldRecheck) {
    return { stale: false };
  }

  try {
    const payload = await fetchSimanSourcePayload(section, siman);
    const currentHash = buildSourceHash(payload);

    const unchanged = alignment.sourceHash
      && alignment.sourceHash.shulchanArukh === currentHash.shulchanArukh
      && alignment.sourceHash.tur === currentHash.tur
      && alignment.sourceHash.beitYosef === currentHash.beitYosef;

    if (unchanged) {
      await touchAlignmentSourceChecked(section, siman);
      return { stale: false };
    }

    return { stale: true, payload };
  } catch (error) {
    console.warn(`[AlignmentEngine] source hash revalidation failed for ${section} ${siman}:`, error);
    return { stale: false };
  }
}

async function buildSimanAlignmentJob(
  section: string,
  siman: number,
  preloadedPayload?: SimanSourcePayload,
): Promise<SimanAlignment> {
  const payload = preloadedPayload ?? await fetchSimanSourcePayload(section, siman);
  const sourceHash = buildSourceHash(payload);

  const seifEntries = buildShulchanArukhSeifEntries(payload.shulchanArukh.segments);
  if (seifEntries.length === 0) {
    throw new Error(`No Shulchan Arukh seif segments found for ${section} ${siman}`);
  }

  const turIndex = buildSimilarityIndex(payload.tur.segments);

  const seifMap: Record<string, SeifRefMapping> = {};

  // Phase 1: Per-seif Sefaria link lookups
  for (const entry of seifEntries) {
    let turRefs: string[] = [];
    let byRefs: string[] = [];
    let turMode: SeifRefMapping['turMode'] = 'none';
    let byMode: SeifRefMapping['byMode'] = 'none';
    let turScore = 0;
    let byScore = 0;

    try {
      const linked = await getLinkedSourcesForShulchanArukhSeif(section, siman, entry.seif);
      turRefs = dedupeRefs(linked.turRefs);
      byRefs = dedupeRefs(linked.beitYosefRefs);
    } catch (error) {
      console.warn(`[AlignmentEngine] links lookup failed for ${section} ${siman}:${entry.seif}:`, error);
    }

    if (turRefs.length > 0) {
      turMode = 'linked-passages';
      turScore = 1;
    } else {
      const fallback = selectBestRefsBySimilarity(entry.text, turIndex);
      turRefs = fallback.refs;
      turScore = fallback.bestScore;
      turMode = turRefs.length > 0 ? 'fallback-similarity' : 'none';
    }

    if (byRefs.length > 0) {
      byMode = 'linked-passages';
      byScore = 1;
    } else {
      byRefs = [];
      byScore = 0;
      byMode = 'none';
    }

    seifMap[String(entry.seif)] = {
      turRefs,
      byRefs,
      turMode,
      byMode,
      confidence: Number(((turScore + byScore) / 2).toFixed(3)),
    };
  }

  // Phase 2: LLM-based global alignment for sources with missing refs
  const byMissing = seifEntries.filter(e => seifMap[String(e.seif)]?.byRefs.length === 0);

  // BY: use LLM alignment with ordering+contiguity enforcement when ANY seif is missing
  if (byMissing.length > 0 && payload.beitYosef.segments.length > 0) {
    console.info(`[AlignmentEngine] BY: ${byMissing.length}/${seifEntries.length} seifim missing refs, running LLM alignment...`);
    try {
      const saTextMap = new Map<number, string>();
      for (const entry of seifEntries) {
        saTextMap.set(entry.seif, entry.text);
      }

      const byChunks = payload.beitYosef.segments;
      const llmResult = await alignSourceWithLLM(saTextMap, byChunks, 'Beit Yosef', { mode: 'exhaustive-contiguous' });

      // Apply LLM results only to seifim that had no Sefaria links
      for (const entry of seifEntries) {
        const key = String(entry.seif);
        const existing = seifMap[key];
        if (existing && existing.byRefs.length === 0) {
          const assignedIndices = llmResult.get(entry.seif) ?? [];
          if (assignedIndices.length > 0) {
            const refs = dedupeRefs(assignedIndices.map(idx => byChunks[idx]?.ref).filter(Boolean));
            seifMap[key] = {
              ...existing,
              byRefs: refs,
              byMode: 'fallback-similarity',
              confidence: Number(((existing.confidence * 2 - 0 + 0.7) / 2).toFixed(3)),
            };
          }
        }
      }

      console.info(`[AlignmentEngine] BY LLM alignment applied for ${section} ${siman}`);
    } catch (error) {
      console.warn(`[AlignmentEngine] BY LLM alignment failed for ${section} ${siman}:`, error);
    }
  }

  // Phase 3: Tur alignment.
  // For giant Tur simanim, use BY opening anchors first, then LLM fallback for unresolved seifim.
  const turIsGiant = payload.tur.segments.length === 1 && seifEntries.length > 1;
  const turMissing = seifEntries.filter(e => seifMap[String(e.seif)]?.turRefs.length === 0);

  if (turIsGiant && payload.tur.segments.length > 0) {
    const giantText = payload.tur.segments[0].text;
    const turRef = payload.tur.ref;

    try {
      const anchorSlices = sliceGiantTurByByOpenings({
        giantText,
        bySegments: payload.beitYosef.segments,
        seifEntries,
        seifMap,
        siman,
      });

      let appliedAnchorSlices = 0;
      for (const entry of seifEntries) {
        const key = String(entry.seif);
        const existing = seifMap[key];
        const slice = anchorSlices.get(entry.seif);
        if (!existing || !slice) continue;

        seifMap[key] = {
          ...existing,
          turRefs: [turRef],
          turMode: 'fallback-similarity',
          turTextSlice: slice.text,
          confidence: Number(((0.9 + (existing.byRefs.length > 0 ? 1 : 0)) / 2).toFixed(3)),
        };
        appliedAnchorSlices += 1;
      }

      console.info(
        `[AlignmentEngine] Tur BY-anchor slicing applied for ${section} ${siman}: ${appliedAnchorSlices}/${seifEntries.length} seifim`,
      );
    } catch (error) {
      console.warn(`[AlignmentEngine] Tur BY-anchor slicing failed for ${section} ${siman}:`, error);
    }

    const unresolved = seifEntries.filter((entry) => {
      const mapping = seifMap[String(entry.seif)];
      if (!mapping || mapping.turTextSlice) return false;
      // Only LLM-fill seifim that have direct Sefaria evidence.
      // Seifim without direct links stay empty (e.g. SA additions).
      return mapping.byMode === 'linked-passages' || mapping.turMode === 'linked-passages';
    });
    if (unresolved.length > 0) {
      console.info(
        `[AlignmentEngine] Tur giant fallback: ${unresolved.length}/${seifEntries.length} seifim unresolved, running LLM alignment...`,
      );
      try {
        const saTextMap = new Map<number, string>();
        for (const entry of unresolved) {
          saTextMap.set(entry.seif, entry.text);
        }

        const sentenceChunks = splitTextIntoSentenceChunks(giantText, turRef, seifEntries.length);
        console.info(`[AlignmentEngine] Tur split into ${sentenceChunks.length} sentence chunks`);

        const llmResult = await alignSourceWithLLM(saTextMap, sentenceChunks, 'Tur', { mode: 'partial-ordered' });

        for (const entry of unresolved) {
          const key = String(entry.seif);
          const existing = seifMap[key];
          if (!existing || existing.turTextSlice) continue;

          const assignedIndices = llmResult.get(entry.seif) ?? [];
          if (assignedIndices.length > 0) {
            const sliceText = assignedIndices
              .sort((a, b) => a - b)
              .map(idx => sentenceChunks[idx]?.text ?? '')
              .filter(Boolean)
              .join(' ')
              .trim();

            if (!sliceText) continue;

            seifMap[key] = {
              ...existing,
              turRefs: [turRef],
              turMode: 'fallback-similarity',
              turTextSlice: sliceText,
              confidence: Number(((0.8 + (existing.byRefs.length > 0 ? 1 : 0)) / 2).toFixed(3)),
            };
          }
        }

        console.info(`[AlignmentEngine] Tur LLM alignment (giant fallback) applied for ${section} ${siman}`);
      } catch (error) {
        console.warn(`[AlignmentEngine] Tur LLM alignment (giant fallback) failed for ${section} ${siman}:`, error);
      }
    }

    // In giant-Tur mode, refs without a concrete slice would return the whole Tur block.
    // Keep those seifim empty and let downstream fallback handle boundary extraction if needed.
    for (const entry of seifEntries) {
      const key = String(entry.seif);
      const existing = seifMap[key];
      if (!existing || existing.turTextSlice) continue;

      seifMap[key] = {
        ...existing,
        turRefs: [],
        turMode: 'none',
      };
    }
  } else if (turMissing.length > 0 && payload.tur.segments.length > 1) {
    // Multi-segment Tur: use LLM alignment only for seifim missing refs
    console.info(`[AlignmentEngine] Tur: ${turMissing.length}/${seifEntries.length} seifim missing refs, running LLM alignment...`);
    try {
      const saTextMap = new Map<number, string>();
      for (const entry of seifEntries) {
        saTextMap.set(entry.seif, entry.text);
      }

      const turChunks = payload.tur.segments;
      const llmResult = await alignSourceWithLLM(saTextMap, turChunks, 'Tur', { mode: 'partial-ordered' });

      for (const entry of seifEntries) {
        const key = String(entry.seif);
        const existing = seifMap[key];
        if (existing && existing.turRefs.length === 0) {
          const assignedIndices = llmResult.get(entry.seif) ?? [];
          if (assignedIndices.length > 0) {
            const refs = dedupeRefs(assignedIndices.map(idx => turChunks[idx]?.ref).filter(Boolean));
            seifMap[key] = {
              ...existing,
              turRefs: refs,
              turMode: 'fallback-similarity',
              confidence: Number(((0.7 + (existing.byRefs.length > 0 ? 1 : 0)) / 2).toFixed(3)),
            };
          }
        }
      }

      console.info(`[AlignmentEngine] Tur LLM alignment applied for ${section} ${siman}`);
    } catch (error) {
      console.warn(`[AlignmentEngine] Tur LLM alignment failed for ${section} ${siman}:`, error);
    }
  }

  await markAlignmentReady(section, siman, sourceHash, seifMap);

  return {
    section,
    siman,
    status: 'ready',
    version: CURRENT_CACHE_VERSION,
    sourceHash,
    seifMap,
  };
}

/**
 * Splits a giant Hebrew text into topical chunks using colon-based sentence
 * boundaries (the standard separator in rabbinic literature). Overly large
 * chunks are sub-split by word count so the LLM has enough granularity.
 */
function splitTextIntoSentenceChunks(text: string, baseRef: string, minChunks: number): StructuredChunk[] {
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords === 0) return [];

  // Step 1: Split on colon boundaries (": " or ":\n") which are the primary
  //         topic separators in Hebrew rabbinic texts like the Tur.
  const rawSegments = text.split(/:\s+/).map(s => s.trim()).filter(Boolean);

  // If colon splitting didn't produce meaningful segments, fall back to word count.
  if (rawSegments.length <= 1) {
    const desiredChunks = Math.max(minChunks * 1.5, 8);
    const targetWords = Math.max(10, Math.floor(totalWords / desiredChunks));
    return splitByWordCount(text, baseRef, targetWords);
  }

  // Step 2: Sub-split any segment that is too large (> maxWordsPerChunk).
  //         Target: each chunk should be digestible for the LLM while preserving
  //         topical coherence. Allow up to ~80 words per chunk before sub-splitting.
  const maxWordsPerChunk = 80;
  const chunks: StructuredChunk[] = [];

  for (const segment of rawSegments) {
    const segWords = segment.split(/\s+/).filter(Boolean);
    if (segWords.length <= maxWordsPerChunk) {
      chunks.push({
        ref: `${baseRef} [chunk ${chunks.length}]`,
        text: segment,
      });
    } else {
      // Sub-split large segments by word count
      const subTarget = Math.max(30, Math.floor(segWords.length / Math.ceil(segWords.length / maxWordsPerChunk)));
      for (let i = 0; i < segWords.length; i += subTarget) {
        const slice = segWords.slice(i, i + subTarget).join(' ').trim();
        if (slice) {
          chunks.push({
            ref: `${baseRef} [chunk ${chunks.length}]`,
            text: slice,
          });
        }
      }
    }
  }

  return chunks;
}

function splitByWordCount(text: string, baseRef: string, targetWords: number): StructuredChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: StructuredChunk[] = [];
  for (let i = 0; i < words.length; i += targetWords) {
    const slice = words.slice(i, i + targetWords).join(' ');
    if (slice.trim()) {
      chunks.push({
        ref: `${baseRef} [chunk ${chunks.length}]`,
        text: slice.trim(),
      });
    }
  }

  return chunks;
}

type TurAnchorSlice = {
  text: string;
  startChar: number;
  endChar: number;
  startBoundary: number;
  endBoundary?: number;
};

function sliceGiantTurByByOpenings(params: {
  giantText: string;
  bySegments: StructuredChunk[];
  seifEntries: Array<{ seif: number; text: string }>;
  seifMap: Record<string, SeifRefMapping>;
  siman: number;
}): Map<number, TurAnchorSlice> {
  const { giantText, bySegments, seifEntries, seifMap, siman } = params;
  const slices = new Map<number, TurAnchorSlice>();

  if (!giantText.trim() || bySegments.length === 0 || seifEntries.length === 0) {
    return slices;
  }

  const byOpeningByIndex = new Map<number, string>();
  for (const segment of bySegments) {
    const index = getSegmentTopLevelIndexForSiman(segment, siman);
    if (!index || byOpeningByIndex.has(index)) continue;
    const opening = segment.text.trim();
    if (!opening) continue;
    byOpeningByIndex.set(index, opening);
  }

  const linkedOnlyBoundaries = buildSeifToByBoundaryIndexMap(seifEntries, seifMap, siman, true);
  const linkedBoundaryCount = new Set([...linkedOnlyBoundaries.values()]).size;
  if (linkedBoundaryCount < 2) {
    // Deterministic BY-anchor slicing is reliable only with enough direct BY boundaries.
    return slices;
  }
  const boundaryBySeif = linkedOnlyBoundaries;

  const orderedBoundaries: number[] = [];
  const seenBoundaries = new Set<number>();
  for (const entry of seifEntries) {
    const boundary = boundaryBySeif.get(entry.seif);
    if (!boundary || seenBoundaries.has(boundary)) continue;
    seenBoundaries.add(boundary);
    orderedBoundaries.push(boundary);
  }

  const boundaryStartChar = new Map<number, number>();
  let searchFrom = 0;
  for (const boundary of orderedBoundaries) {
    if (boundary === 1) {
      boundaryStartChar.set(1, 0);
      continue;
    }

    const opening = byOpeningByIndex.get(boundary);
    if (!opening) continue;

    const position = findByOpeningAnchorPosition(giantText, opening, searchFrom);
    if (position === null) continue;

    boundaryStartChar.set(boundary, position);
    searchFrom = Math.max(searchFrom, position + 1);
  }

  const consumedStartBoundaries = new Set<number>();
  for (let i = 0; i < seifEntries.length; i++) {
    const entry = seifEntries[i];
    const startBoundary = boundaryBySeif.get(entry.seif);
    if (!startBoundary) continue;
    if (consumedStartBoundaries.has(startBoundary)) continue;

    const startChar = boundaryStartChar.get(startBoundary);
    if (typeof startChar !== 'number') continue;

    let endChar = giantText.length;
    let endBoundary: number | undefined;

    for (let j = i + 1; j < seifEntries.length; j++) {
      const nextBoundary = boundaryBySeif.get(seifEntries[j].seif);
      if (!nextBoundary || nextBoundary === startBoundary) continue;

      const nextStart = boundaryStartChar.get(nextBoundary);
      if (typeof nextStart === 'number' && nextStart > startChar) {
        endChar = nextStart;
        endBoundary = nextBoundary;
        break;
      }
    }

    if (endChar <= startChar) continue;

    const text = giantText.substring(startChar, endChar).trim();
    if (!text) continue;

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 3) continue;

    slices.set(entry.seif, {
      text,
      startChar,
      endChar,
      startBoundary,
      endBoundary,
    });
    consumedStartBoundaries.add(startBoundary);
  }

  return slices;
}

function buildSeifToByBoundaryIndexMap(
  seifEntries: Array<{ seif: number }>,
  seifMap: Record<string, SeifRefMapping>,
  siman: number,
  linkedOnly: boolean,
): Map<number, number> {
  const result = new Map<number, number>();

  for (const entry of seifEntries) {
    const mapping = seifMap[String(entry.seif)];
    if (!mapping) continue;
    if (linkedOnly && mapping.byMode !== 'linked-passages') continue;

    const boundary = extractFirstByBoundaryIndex(mapping.byRefs, siman);
    if (boundary) {
      result.set(entry.seif, boundary);
    }
  }

  return result;
}

function extractFirstByBoundaryIndex(refs: string[], siman: number): number | null {
  const boundaries = refs
    .map(ref => extractTopLevelIndexFromRefForSiman(ref, siman))
    .filter((index): index is number => typeof index === 'number' && index > 0)
    .sort((a, b) => a - b);

  return boundaries[0] ?? null;
}

function extractTopLevelIndexFromRefForSiman(ref: string, siman: number): number | null {
  if (!ref) return null;

  const colonMatch = ref.match(/(\d+):(\d+)(?::\d+)?$/);
  if (colonMatch) {
    const refSiman = Number.parseInt(colonMatch[1], 10);
    const refIndex = Number.parseInt(colonMatch[2], 10);
    if (Number.isFinite(refSiman) && Number.isFinite(refIndex) && refSiman === siman && refIndex > 0) {
      return refIndex;
    }
  }

  const spacedMatch = ref.match(new RegExp(`\\b${siman}\\s+(\\d+)\\b`));
  if (spacedMatch) {
    const refIndex = Number.parseInt(spacedMatch[1], 10);
    return Number.isFinite(refIndex) && refIndex > 0 ? refIndex : null;
  }

  return null;
}

function getSegmentTopLevelIndexForSiman(segment: StructuredChunk, siman: number): number | null {
  if (Array.isArray(segment.path) && segment.path.length > 0 && Number.isInteger(segment.path[0])) {
    return segment.path[0] + 1;
  }

  return extractTopLevelIndexFromRefForSiman(segment.ref, siman);
}

function tokenizeHebrewOpening(text: string): string[] {
  const normalized = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\u05D0-\u05EA\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function findByOpeningAnchorPosition(giantText: string, byOpeningText: string, fromIndex: number): number | null {
  const openingTokens = tokenizeHebrewOpening(byOpeningText).slice(0, 36);
  if (openingTokens.length < 2) return null;

  const startOffsets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12].filter(offset => offset < openingTokens.length);
  const scopedFrom = Math.max(fromIndex, 0);
  const scopedText = giantText.substring(scopedFrom);

  for (let phraseLength = Math.min(9, openingTokens.length); phraseLength >= 2; phraseLength--) {
    let bestIndex: number | null = null;
    const seenPatterns = new Set<string>();

    for (const startOffset of startOffsets) {
      const anchor = openingTokens.slice(startOffset, startOffset + phraseLength);
      if (anchor.length < phraseLength) continue;

      const pattern = anchor.join('[^\\u05D0-\\u05EA]+');
      if (seenPatterns.has(pattern)) continue;
      seenPatterns.add(pattern);

      const match = scopedText.match(new RegExp(pattern));
      if (match && match.index !== undefined) {
        const absoluteIndex = scopedFrom + match.index;
        if (bestIndex === null || absoluteIndex < bestIndex) {
          bestIndex = absoluteIndex;
        }
      }
    }

    if (bestIndex !== null) {
      return bestIndex;
    }
  }

  return null;
}

async function fetchSimanSourcePayload(section: string, siman: number): Promise<SimanSourcePayload> {
  const simanStr = String(siman);
  const shulchanArukhRef = buildSefariaRef('shulchan_arukh', section, simanStr);
  const turRef = buildSefariaRef('tur', section, simanStr);
  const beitYosefRef = buildSefariaRef('beit_yosef', section, simanStr);

  const [shulchanArukh, tur, beitYosef] = await Promise.all([
    fetchSefariaText(shulchanArukhRef, 'he'),
    fetchSefariaText(turRef, 'he'),
    fetchSefariaText(beitYosefRef, 'he'),
  ]);

  return { shulchanArukh, tur, beitYosef };
}

function buildSourceHash(payload: SimanSourcePayload): SimanAlignment['sourceHash'] {
  const hashSegments = (segments: StructuredChunk[]): string => {
    const compact = segments.map(segment => ({
      ref: segment.ref,
      path: segment.path ?? [],
      text: segment.text,
    }));
    return generateSourceHash(JSON.stringify(compact));
  };

  return {
    shulchanArukh: hashSegments(payload.shulchanArukh.segments),
    tur: hashSegments(payload.tur.segments),
    beitYosef: hashSegments(payload.beitYosef.segments),
  };
}

function buildShulchanArukhSeifEntries(segments: StructuredChunk[]): Array<{ seif: number; text: string }> {
  const grouped = new Map<number, string[]>();

  for (const segment of segments) {
    const seif = extractSeifNumber(segment);
    if (!seif) continue;
    const bucket = grouped.get(seif) ?? [];
    bucket.push(segment.text.trim());
    grouped.set(seif, bucket);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seif, parts]) => ({ seif, text: parts.join(' ').trim() }));
}

function extractSeifNumber(segment: StructuredChunk): number | null {
  if (segment.path && segment.path.length > 0 && Number.isInteger(segment.path[0])) {
    return segment.path[0] + 1;
  }

  // Matches "... 308:5" or "... 308:5:2" and extracts the seif (5).
  const match = segment.ref.match(/\s(\d+):(\d+)(?::\d+)?$/);
  if (!match) return null;

  const parsed = Number.parseInt(match[2], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dedupeRefs(refs: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const ref of refs) {
    const clean = ref.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    deduped.push(clean);
  }

  return deduped;
}

function normalizeHebrewForSimilarity(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[׳״"'`´]/g, ' ')
    .replace(/[^\u05D0-\u05EAa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(text: string): string[] {
  const normalized = normalizeHebrewForSimilarity(text);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function buildBigramSet(tokens: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

function buildSimilarityIndex(segments: StructuredChunk[]): PreparedSimilarityChunk[] {
  return segments
    .map((segment, index) => {
      const tokensArr = tokenizeForSimilarity(segment.text);
      return {
        ref: segment.ref,
        index,
        tokens: new Set(tokensArr),
        bigrams: buildBigramSet(tokensArr),
      } satisfies PreparedSimilarityChunk;
    })
    .filter(item => item.tokens.size > 0);
}

function overlapRatio(querySet: Set<string>, candidateSet: Set<string>): number {
  if (querySet.size === 0 || candidateSet.size === 0) return 0;
  let overlap = 0;
  for (const token of querySet) {
    if (candidateSet.has(token)) overlap += 1;
  }
  return overlap / querySet.size;
}

function selectBestRefsBySimilarity(queryText: string, candidates: PreparedSimilarityChunk[]): SimilaritySelection {
  if (!queryText.trim() || candidates.length === 0) {
    return { refs: [], bestScore: 0 };
  }

  const queryTokensArray = tokenizeForSimilarity(queryText);
  const queryTokenSet = new Set(queryTokensArray);
  const queryBigramSet = buildBigramSet(queryTokensArray);
  if (queryTokenSet.size === 0) {
    return { refs: [], bestScore: 0 };
  }

  const scored = candidates.map(candidate => {
    const tokenScore = overlapRatio(queryTokenSet, candidate.tokens);
    const bigramScore = overlapRatio(queryBigramSet, candidate.bigrams);
    const score = (tokenScore * 0.7) + (bigramScore * 0.3);

    return {
      ref: candidate.ref,
      index: candidate.index,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const bestScore = scored[0]?.score ?? 0;
  if (bestScore < 0.05) {
    return { refs: [], bestScore };
  }

  const minimumScore = Math.max(0.08, bestScore * 0.6);
  const selected = scored
    .filter(item => item.score >= minimumScore)
    .slice(0, 12)
    .sort((a, b) => a.index - b.index);

  return {
    refs: dedupeRefs(selected.map(item => item.ref)),
    bestScore,
  };
}
