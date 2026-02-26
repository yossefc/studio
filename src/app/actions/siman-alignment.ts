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
  const byIndex = buildSimilarityIndex(payload.beitYosef.segments);

  const seifMap: Record<string, SeifRefMapping> = {};

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
      const fallback = selectBestRefsBySimilarity(entry.text, byIndex);
      byRefs = fallback.refs;
      byScore = fallback.bestScore;
      byMode = byRefs.length > 0 ? 'fallback-similarity' : 'none';
    }

    seifMap[String(entry.seif)] = {
      turRefs,
      byRefs,
      turMode,
      byMode,
      confidence: Number(((turScore + byScore) / 2).toFixed(3)),
    };
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
