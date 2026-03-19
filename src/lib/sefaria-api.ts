/**
 * @fileOverview Client for interacting with the Sefaria API.
 * Supports multiple Jewish text sources: Tur, Beit Yosef, Shulchan Arukh, Mishnah Berurah.
 */

import { hebrewToNumber } from '@/lib/hebrew-utils';
import { chunkStructuredText } from '@/lib/chunker';

export type SourceKey = 'tur' | 'beit_yosef' | 'shulchan_arukh' | 'mishnah_berurah' | 'torah_ohr' | 'rav_ovadia';
export type FetchMode = 'exact-seif' | 'linked-passages' | 'full-siman' | 'ai-generated';

export interface SourceConfig {
  key: SourceKey;
  hebrewLabel: string;
  sefariaPrefix: string;
  includesSection: boolean;
  supportsSeif: boolean;
  onlyOrachChayim: boolean;
}

export type StructuredChunk = {
  ref: string;
  path?: number[];
  text: string;
};

export const SOURCE_CONFIGS: Record<SourceKey, SourceConfig> = {
  tur: {
    key: 'tur',
    hebrewLabel: 'טור',
    sefariaPrefix: 'Tur',
    includesSection: true,
    supportsSeif: false,
    onlyOrachChayim: false,
  },
  beit_yosef: {
    key: 'beit_yosef',
    hebrewLabel: 'בית יוסף',
    sefariaPrefix: 'Beit Yosef',
    includesSection: true,
    supportsSeif: false,
    onlyOrachChayim: false,
  },
  shulchan_arukh: {
    key: 'shulchan_arukh',
    hebrewLabel: 'שולחן ערוך',
    sefariaPrefix: 'Shulchan Arukh',
    includesSection: true,
    supportsSeif: true,
    onlyOrachChayim: false,
  },
  mishnah_berurah: {
    key: 'mishnah_berurah',
    hebrewLabel: 'משנה ברורה',
    sefariaPrefix: 'Mishnah Berurah',
    includesSection: false,
    supportsSeif: true,
    onlyOrachChayim: true,
  },
  torah_ohr: {
    key: 'torah_ohr',
    hebrewLabel: 'תורה אור',
    sefariaPrefix: 'Torah Ohr',
    includesSection: false,
    supportsSeif: true,
    onlyOrachChayim: false,
  },
  rav_ovadia: {
    key: 'rav_ovadia',
    hebrewLabel: 'רב עובדיה יוסף',
    sefariaPrefix: '',          // AI-generated — no Sefaria fetch
    includesSection: false,
    supportsSeif: false,
    onlyOrachChayim: false,
  },
};

/** Canonical processing order for multi-source guides. */
export const SOURCE_PROCESSING_ORDER: SourceKey[] = ['tur', 'beit_yosef', 'shulchan_arukh', 'mishnah_berurah', 'torah_ohr', 'rav_ovadia'];

export function resolveFetchMode(sourceKey: SourceKey): FetchMode {
  if (sourceKey === 'rav_ovadia') return 'ai-generated';
  if (sourceKey === 'tur' || sourceKey === 'beit_yosef') {
    return 'linked-passages';
  }
  if (SOURCE_CONFIGS[sourceKey].supportsSeif) {
    return 'exact-seif';
  }
  return 'full-siman';
}

export type SefariaResponse = {
  ref: string;
  he: string[];
  segments: StructuredChunk[];
  en: string[];
  versionTitle?: string;
  direction: 'rtl' | 'ltr';
};

/**
 * Builds a Sefaria API reference string for a given source.
 */
export function buildSefariaRef(
  sourceKey: SourceKey,
  section: string,
  siman: string,
  seif?: string,
): string {
  if (sourceKey === 'torah_ohr') {
    const parasha = siman.trim();
    let base = `Torah Ohr, ${parasha}`;
    if (seif && seif.trim()) {
      base += ` ${seif.trim()}`;
    }
    return base;
  }

  const config = SOURCE_CONFIGS[sourceKey];
  const simanNum = hebrewToNumber(siman);

  if (config.includesSection) {
    // "Tur, Orach Chayim 1" or "Shulchan Arukh, Orach Chayim 1.1"
    const base = `${config.sefariaPrefix}, ${section} ${simanNum}`;
    if (config.supportsSeif && seif) {
      return `${base}.${hebrewToNumber(seif)}`;
    }
    return base;
  }

  // Mishnah Berurah: "Mishnah Berurah 1.1" (no section name)
  const base = `${config.sefariaPrefix} ${simanNum}`;
  if (config.supportsSeif && seif) {
    return `${base}.${hebrewToNumber(seif)}`;
  }
  return base;
}

/**
 * Cleans Sefaria text from HTML tags and extra formatting.
 */
function cleanSegmentText(text: string): string {
  return text
    .replace(/<[^>]*>?/gm, '')
    .replace(/\([^)]{1,5}\)/g, '')
    .trim();
}

function flattenAsStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [String(value ?? '')];
  }
  return value.reduce<string[]>(
    (acc, item) => acc.concat(Array.isArray(item) ? flattenAsStrings(item) : String(item ?? '')),
    [],
  );
}

function buildSegmentRef(baseRef: string, path: number[]): string {
  if (!path.length) return baseRef;
  const oneBasedPath = path.map(index => index + 1).join(':');
  return `${baseRef}:${oneBasedPath}`;
}

function extractStructuredSegments(value: unknown, ref: string, path: number[] = []): StructuredChunk[] {
  if (Array.isArray(value)) {
    const segments: StructuredChunk[] = [];
    value.forEach((item, index) => {
      segments.push(...extractStructuredSegments(item, ref, [...path, index]));
    });
    return segments;
  }

  const text = cleanSegmentText(String(value ?? ''));
  if (!text) {
    return [];
  }

  return [
    {
      ref: buildSegmentRef(ref, path),
      path: path.length ? path : undefined,
      text,
    },
  ];
}

function cleanSefariaText(texts: unknown): string[] {
  const flatTexts = flattenAsStrings(texts);

  return flatTexts
    .map(t => cleanSegmentText(typeof t === 'string' ? t : String(t ?? '')))
    .filter(t => t.length > 0);
}

/**
 * Fetches text from the Sefaria API.
 */
export async function fetchSefariaText(tref: string, lang: 'he' | 'en' = 'he'): Promise<SefariaResponse> {
  const normalized = normalizeTref(tref);
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(normalized)}?lang=${lang}&context=0`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`טקסט לא נמצא עבור המראה מקום: ${tref} (נוסה כ: ${normalized})`);
  }

  const data = await response.json();

  let heTexts = data.he || [];
  if (!heTexts.length && data.versions) {
    const heVersion = data.versions.find((v: { language: string }) => v.language === 'he');
    if (heVersion) heTexts = heVersion.text || [];
  }

  const resolvedRef = data.ref || normalized;
  const segments = extractStructuredSegments(heTexts, resolvedRef);

  return {
    ref: resolvedRef,
    he: segments.map(segment => segment.text),
    segments,
    en: cleanSefariaText(data.en || []),
    direction: 'rtl',
  };
}

function collectRefsFromLinkRecord(record: unknown): string[] {
  if (!record || typeof record !== 'object') {
    return [];
  }

  const candidateValues: unknown[] = [];
  const typed = record as Record<string, unknown>;

  if (Array.isArray(typed.refs)) candidateValues.push(...typed.refs);
  if (Array.isArray(typed.expandedRefs0)) candidateValues.push(...typed.expandedRefs0);
  if (Array.isArray(typed.expandedRefs1)) candidateValues.push(...typed.expandedRefs1);
  if (Array.isArray(typed.expandedRefs)) candidateValues.push(...typed.expandedRefs);
  if (typeof typed.ref === 'string') candidateValues.push(typed.ref);
  if (typeof typed.anchorRef === 'string') candidateValues.push(typed.anchorRef);
  if (typeof typed.sourceRef === 'string') candidateValues.push(typed.sourceRef);

  return candidateValues
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
}

type LinkedSourcesResult = {
  shulchanArukhTref: string;
  turLinks: string[];
  byLinks: string[];
  turRefs: string[];
  beitYosefRefs: string[];
};

function normalizeForPrefixMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/chayim/g, 'chaim');
}

function sectionVariants(section: string): string[] {
  const normalized = normalizeTref(section).trim();
  const variants = new Set<string>([normalized]);

  // Handle common transliteration variants used by Sefaria references.
  variants.add(normalized.replace(/\bChayim\b/g, 'Chaim'));
  variants.add(normalized.replace(/\bChaim\b/g, 'Chayim'));

  return [...variants];
}

function refStartsWithAnyPrefix(ref: string, prefixes: string[]): boolean {
  const normalizedRef = normalizeForPrefixMatch(ref);
  return prefixes.some(prefix => normalizedRef.startsWith(normalizeForPrefixMatch(prefix)));
}

function firstNumericToken(ref: string): number | null {
  const match = ref.match(/(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function refBelongsToSiman(ref: string, siman: number): boolean {
  const firstNumber = firstNumericToken(ref);
  return firstNumber === siman;
}

function numericRefSort(a: string, b: string): number {
  const aNums = (a.match(/\d+/g) || []).map(n => Number.parseInt(n, 10));
  const bNums = (b.match(/\d+/g) || []).map(n => Number.parseInt(n, 10));
  const len = Math.max(aNums.length, bNums.length);
  for (let i = 0; i < len; i++) {
    const av = aNums[i] ?? -1;
    const bv = bNums[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return a.localeCompare(b);
}

export async function getLinkedSourcesForShulchanArukhSeif(
  section: string,
  siman: number,
  seif: number,
): Promise<LinkedSourcesResult> {
  const normalizedSection = normalizeTref(section);
  const sectionCandidates = sectionVariants(normalizedSection);
  const shulchanArukhTref = `Shulchan Arukh, ${normalizedSection} ${siman}:${seif}`;
  const url = `https://www.sefaria.org/api/links/${encodeURIComponent(shulchanArukhTref)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`קישורים לא נמצאו עבור: ${shulchanArukhTref}`);
  }

  const data = await response.json();
  const rawLinks = Array.isArray(data) ? data : (Array.isArray(data?.links) ? data.links : []);
  const allRefs = new Set<string>();

  for (const link of rawLinks) {
    for (const ref of collectRefsFromLinkRecord(link)) {
      allRefs.add(ref);
    }
  }

  const turPrefixes = sectionCandidates.map(candidate => `Tur, ${candidate}`);
  const beitYosefPrefixes = sectionCandidates.map(candidate => `Beit Yosef, ${candidate}`);

  const turRefs = [...allRefs]
    .filter(ref => refStartsWithAnyPrefix(ref, turPrefixes))
    .filter(ref => refBelongsToSiman(ref, siman))
    .sort(numericRefSort);

  const beitYosefRefs = [...allRefs]
    .filter(ref => refStartsWithAnyPrefix(ref, beitYosefPrefixes))
    .filter(ref => refBelongsToSiman(ref, siman))
    .sort(numericRefSort);

  return {
    shulchanArukhTref,
    turLinks: turRefs,
    byLinks: beitYosefRefs,
    turRefs,
    beitYosefRefs,
  };
}

function extractTopLevelIndexFromRef(ref: string, siman: number): number | null {
  if (!ref) return null;

  // Matches refs like "... 287:3", "... 287:3:1", "... 287 3"
  const match = ref.match(/(\d+)[:\s](\d+)/);
  if (!match) return null;

  const refSiman = Number.parseInt(match[1], 10);
  const refIndex = Number.parseInt(match[2], 10);
  if (!Number.isFinite(refSiman) || !Number.isFinite(refIndex)) return null;
  if (refSiman !== siman || refIndex <= 0) return null;

  return refIndex;
}

function getFirstBeitYosefBoundaryIndex(
  linked: LinkedSourcesResult,
  siman: number,
): number | null {
  const indices = linked.beitYosefRefs
    .map(ref => extractTopLevelIndexFromRef(ref, siman))
    .filter((index): index is number => typeof index === 'number')
    .sort((a, b) => a - b);

  return indices[0] ?? null;
}

function getSegmentTopLevelIndex(segment: StructuredChunk, siman: number): number | null {
  if (Array.isArray(segment.path) && segment.path.length > 0 && Number.isInteger(segment.path[0])) {
    return segment.path[0] + 1;
  }
  return extractTopLevelIndexFromRef(segment.ref, siman);
}

function markerTokens(text: string): string[] {
  return cleanSegmentText(text)
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\u05D0-\u05EA\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function buildMarkerRegexes(text: string, maxWords = 8, minWords = 2): RegExp[] {
  const tokens = markerTokens(text);
  if (tokens.length < minWords) return [];

  const starts = [0, 2, 4, 6, 8].filter(start => start < tokens.length);
  const seen = new Set<string>();
  const regexes: RegExp[] = [];

  for (const start of starts) {
    const upper = Math.min(maxWords, tokens.length - start);
    for (let len = upper; len >= minWords; len--) {
      const anchor = tokens.slice(start, start + len);
      if (anchor.length < minWords) continue;
      const pattern = anchor.join('[^\\u05D0-\\u05EA]+');
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      regexes.push(new RegExp(pattern));
    }
  }

  return regexes;
}

function findMarkerIndexInText(
  haystack: string,
  markerText: string,
  fromIndex = 0,
  minWords = 2,
): number | null {
  const scoped = haystack.substring(Math.max(fromIndex, 0));
  const regexes = buildMarkerRegexes(markerText, 8, minWords);
  let bestIndex: number | null = null;

  for (const regex of regexes) {
    const match = scoped.match(regex);
    if (match && match.index !== undefined) {
      const absoluteIndex = Math.max(fromIndex, 0) + match.index;
      if (bestIndex === null || absoluteIndex < bestIndex) {
        bestIndex = absoluteIndex;
      }
    }
  }

  return bestIndex;
}

async function getShulchanArukhMaxSeif(section: string, siman: number): Promise<number> {
  const saSimanRef = `Shulchan Arukh, ${section} ${siman}`;
  const saData = await fetchSefariaText(saSimanRef, 'he');
  const indices = saData.segments
    .map(segment => getSegmentTopLevelIndex(segment, siman))
    .filter((index): index is number => typeof index === 'number' && index > 0);

  if (indices.length === 0) {
    return 0;
  }

  return Math.max(...indices);
}

async function getBeitYosefTopLevelIndices(section: string, siman: number): Promise<number[]> {
  const bySimanRef = `Beit Yosef, ${section} ${siman}`;
  const byData = await fetchSefariaText(bySimanRef, 'he');

  const indices = byData.segments
    .map(segment => getSegmentTopLevelIndex(segment, siman))
    .filter((index): index is number => typeof index === 'number' && index > 0)
    .sort((a, b) => a - b);

  return [...new Set(indices)];
}

/**
 * Extrait le sous-ensemble du Tur correspondant à un Seif donné,
 * en se basant sur les liens du Beit Yosef comme repères de début et de fin.
 * 
 * Règle métier :
 * - Début : Index du premier Beit Yosef lié au Seif N.
 * - Fin : Index (exclu) du premier Beit Yosef lié au premier Seif > N
 *         qui possède un lien BY (N+1, puis N+2, etc.).
 */
export async function getTurSegmentsForSeif(
  section: string,
  siman: number,
  seif: number,
  providedStartIndex?: number | null,
  providedEndIndexExclusive?: number | null,
): Promise<StructuredChunk[]> {
  if (!Number.isFinite(siman) || siman <= 0 || !Number.isFinite(seif) || seif <= 0) {
    throw new Error(`[Tur-Boundary] Valeurs siman/seif invalides: siman=${siman}, seif=${seif}`);
  }

  const sectionName = normalizeTref(section);
  let byTopLevelIndicesCache: number[] | null = null;

  const getByTopLevelIndicesSafe = async (): Promise<number[]> => {
    if (byTopLevelIndicesCache) return byTopLevelIndicesCache;
    try {
      byTopLevelIndicesCache = await getBeitYosefTopLevelIndices(sectionName, siman);
    } catch {
      byTopLevelIndicesCache = [];
    }
    return byTopLevelIndicesCache;
  };

  // 1) Start boundary = first Beit Yosef segment linked to SA seif N.
  let startIndex: number | null = providedStartIndex ?? null;
  if (!startIndex) {
    try {
      const currentLinks = await getLinkedSourcesForShulchanArukhSeif(sectionName, siman, seif);
      startIndex = getFirstBeitYosefBoundaryIndex(currentLinks, siman);
    } catch {
      startIndex = null;
    }
  }

  if (!startIndex) {
    // Fallback A: search backward seif-by-seif for nearest prior BY link boundary.
    for (let prevSeif = seif - 1; prevSeif >= 1; prevSeif--) {
      try {
        const prevLinks = await getLinkedSourcesForShulchanArukhSeif(sectionName, siman, prevSeif);
        const candidateBoundary = getFirstBeitYosefBoundaryIndex(prevLinks, siman);
        if (candidateBoundary) {
          startIndex = candidateBoundary;
          break;
        }
      } catch {
        // keep searching
      }
    }
  }

  if (!startIndex) {
    // Fallback B: use Beit Yosef siman structure (exact seif if exists, else nearest previous).
    const byIndices = await getByTopLevelIndicesSafe();
    if (byIndices.includes(seif)) {
      startIndex = seif;
    } else {
      const prevCandidates = byIndices.filter(index => index < seif);
      startIndex = prevCandidates.length > 0 ? prevCandidates[prevCandidates.length - 1] : null;
    }
  }

  if (!startIndex) {
    // Final fallback: start from beginning of siman.
    startIndex = 1;
  }

  // 2) End boundary = first Beit Yosef segment linked to SA seif > N.
  // If N+1 has no BY link, continue with N+2, N+3, ... until end of siman.
  let endIndexExclusive: number | null = providedEndIndexExclusive ?? null;
  if (!endIndexExclusive) {
    let maxSeif = 0;
    try {
      maxSeif = await getShulchanArukhMaxSeif(sectionName, siman);
    } catch {
      maxSeif = 0;
    }

    const upperBound = Math.max(maxSeif, seif + 1);
    for (let nextSeif = seif + 1; nextSeif <= upperBound; nextSeif++) {
      try {
        const nextLinks = await getLinkedSourcesForShulchanArukhSeif(sectionName, siman, nextSeif);
        const candidateBoundary = getFirstBeitYosefBoundaryIndex(nextLinks, siman);
        if (candidateBoundary && candidateBoundary > startIndex) {
          endIndexExclusive = candidateBoundary;
          break;
        }
      } catch {
        // Keep searching forward.
      }
    }
  }

  if (!endIndexExclusive) {
    // Fallback C: use BY siman structure for the next boundary after chosen start.
    const byIndices = await getByTopLevelIndicesSafe();
    endIndexExclusive = byIndices.find(index => index > startIndex) ?? null;
  }

  console.info(
    `[Tur-Boundary] ${sectionName} ${siman}:${seif} boundaries => startIndex=${startIndex}, endIndexExclusive=${endIndexExclusive ?? 'end-of-siman'}`,
  );

  // 3. Récupérer le JaggedArray du Tur
  const turSimanRef = `Tur, ${sectionName} ${siman}`;
  let turData: SefariaResponse;

  try {
    turData = await fetchSefariaText(turSimanRef, 'he');
  } catch (err) {
    throw new Error(`[Tur-Boundary] Erreur de récupération du Tur pour ${turSimanRef} : ${err}`);
  }

  if (!Array.isArray(turData.segments) || turData.segments.length === 0) {
    throw new Error(`[Tur-Boundary] Le siman du Tur est vide: ${turSimanRef}`);
  }

  // 4) Slice Tur by index boundaries.
  // If Sefaria returns one giant Tur segment, use textual markers based on BY boundaries.
  let selected: StructuredChunk[] = [];

  if (turData.segments.length === 1) {
    const giantText = turData.segments[0].text;
    const bySimanRef = `Beit Yosef, ${sectionName} ${siman}`;
    let byData: SefariaResponse | null = null;
    try {
      byData = await fetchSefariaText(bySimanRef, 'he');
    } catch {
      // Ignore
    }

    let cutStartIndex = 0;
    let cutEndIndex = giantText.length;

    if (byData && byData.segments.length > 0) {
      const bySegmentsByIndex = new Map<number, StructuredChunk[]>();
      for (const seg of byData.segments) {
        const idx = getSegmentTopLevelIndex(seg, siman);
        if (!idx) continue;
        const bucket = bySegmentsByIndex.get(idx) ?? [];
        bucket.push(seg);
        bySegmentsByIndex.set(idx, bucket);
      }

      if (startIndex && startIndex > 1) {
        const startCandidates = bySegmentsByIndex.get(startIndex) ?? [];
        let bestStart: number | null = null;

        const startMinWordLevels = [6, 5, 4, 3, 2];
        for (const minWords of startMinWordLevels) {
          let levelBest: number | null = null;

          for (const candidate of startCandidates) {
            const markerPos = findMarkerIndexInText(giantText, candidate.text, 0, minWords);
            if (markerPos === null) continue;
            if (levelBest === null || markerPos < levelBest) {
              levelBest = markerPos;
            }
          }

          if (levelBest !== null) {
            bestStart = levelBest;
            break;
          }
        }

        if (bestStart !== null) {
          cutStartIndex = bestStart;
        }
      }
      // startIndex === 1: first seif always starts from the beginning of the Tur text (cutStartIndex remains 0)

      if (endIndexExclusive) {
        const endCandidates = bySegmentsByIndex.get(endIndexExclusive) ?? [];
        let bestEnd: number | null = null;

        const minSpanWordsStrict = 18;
        const minSpanWordsRelaxed = 10;

        const tryFindEnd = (levels: number[], minSpanWords: number): number | null => {
          for (const minWords of levels) {
            let levelBest: number | null = null;

            for (const candidate of endCandidates) {
              const markerPos = findMarkerIndexInText(giantText, candidate.text, cutStartIndex + 1, minWords);
              if (markerPos === null || markerPos <= cutStartIndex) continue;

              const spanWords = markerTokens(giantText.substring(cutStartIndex, markerPos)).length;
              if (spanWords < minSpanWords) continue;

              if (levelBest === null || markerPos < levelBest) {
                levelBest = markerPos;
              }
            }

            if (levelBest !== null) {
              return levelBest;
            }
          }

          return null;
        };

        bestEnd = tryFindEnd([6, 5, 4, 3, 2], minSpanWordsStrict);
        if (bestEnd === null) {
          bestEnd = tryFindEnd([8, 7, 6, 5], minSpanWordsRelaxed);
        }

        if (bestEnd !== null) {
          cutEndIndex = bestEnd;
        }
      }
    }

    if (startIndex > 1 && cutStartIndex === 0) {
      console.warn(
        `[Tur-Boundary] giant marker start not found for ${sectionName} ${siman}:${seif} (startIndex=${startIndex})`,
      );
    }
    if (endIndexExclusive && cutEndIndex === giantText.length) {
      console.warn(
        `[Tur-Boundary] giant marker end not found for ${sectionName} ${siman}:${seif} (endIndexExclusive=${endIndexExclusive})`,
      );
    }

    const extractedText = giantText.substring(cutStartIndex, cutEndIndex).trim();
    if (extractedText) {
      const extractedWordCount = extractedText.split(/\s+/).filter(Boolean).length;
      if (endIndexExclusive && extractedWordCount < 18) {
        console.warn(
          `[Tur-Boundary] unusually short giant-cut for ${sectionName} ${siman}:${seif} (${extractedWordCount} words)`,
        );
      }
      const startPreview = extractedText.split(/\s+/).slice(0, 10).join(' ');
      const endPreview = extractedText.split(/\s+/).slice(-10).join(' ');
      console.info(
        `[Tur-Boundary] ${sectionName} ${siman}:${seif} giant-cut => startChar=${cutStartIndex}, endChar=${cutEndIndex}, words=${extractedWordCount}, start="${startPreview}", end="${endPreview}"`,
      );
      selected.push({
        ref: `${turSimanRef} [Extrait Seif ${seif}]`,
        text: extractedText
      });
    }

  } else {
    const boundedByIndex = turData.segments.filter((segment) => {
      const idx = getSegmentTopLevelIndex(segment, siman);
      if (!idx) return false;
      if (idx < (startIndex as number)) return false;
      if (endIndexExclusive && idx >= endIndexExclusive) return false;
      return true;
    });

    selected = boundedByIndex.length > 0
      ? boundedByIndex
      : turData.segments.slice(
        Math.max((startIndex as number) - 1, 0),
        endIndexExclusive ? Math.max(endIndexExclusive - 1, startIndex as number) : turData.segments.length,
      );
  }

  if (selected.length === 0) {
    return [];
  }

  // 5) Technical chunking (>180 words) while preserving parent `ref`.
  const chunked = chunkStructuredText(
    selected.map(segment => ({ ref: segment.ref, path: segment.path, text: segment.text })),
    'tur',
  );

  return chunked.map(chunk => ({
    ref: chunk.ref || turSimanRef,
    path: chunk.path,
    text: chunk.text,
  }));
}

/**
 * Normalizes a Sefaria reference string.
 * Converts Hebrew book and section names to English equivalents expected by Sefaria API.
 */
export function normalizeTref(tref: string): string {
  if (!tref) return '';

  let normalized = tref.trim().replace(/\s+/g, ' ');

  const mappings: Record<string, string> = {
    'שולחן ערוך': 'Shulchan Arukh',
    'אורח חיים': 'Orach Chayim',
    'יורה דעה': 'Yoreh Deah',
    'אבן העזר': 'Even HaEzer',
    'חושן משפט': 'Choshen Mishpat',
    'משנה ברורה': 'Mishnah Berurah',
    'בית יוסף': 'Beit Yosef',
    'ברכות': 'Berakhot',
    'שבת': 'Shabbat',
    'עירובין': 'Eruvin',
    'פסחים': 'Pesachim',
    'יומה': 'Yoma',
    'סוכה': 'Sukkah',
    'ביצה': 'Beitzah',
    'ראש השנה': 'Rosh Hashanah',
    'תענית': 'Taanit',
    'מגילה': 'Megillah',
    'מועד קטן': 'Moed Katan',
    'חגיגה': 'Chagigah',
    'טור': 'Tur',
    'תורה אור': 'Torah Ohr',
  };

  const sortedKeys = Object.keys(mappings).sort((a, b) => b.length - a.length);

  for (const heb of sortedKeys) {
    if (normalized.includes(heb)) {
      normalized = normalized.replace(new RegExp(heb, 'g'), mappings[heb]);
    }
  }

  // Sefaria format cleanup: convert ":" to "." for Siman.Seif references
  if (normalized.includes('Shulchan Arukh') || normalized.includes('Mishnah Berurah')) {
    normalized = normalized.replace(/(\d+):(\d+)/g, '$1.$2');
    normalized = normalized.replace(/,\s*,/g, ',');
  }

  return normalized;
}

export async function fetchSefariaTopicsForRef(tref: string): Promise<string[]> {
  try {
    const normalized = normalizeTref(tref);
    const url = `https://www.sefaria.org/api/related/${encodeURIComponent(normalized)}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return [];
    const topics = (data as Record<string, unknown>).topics;
    if (!Array.isArray(topics)) return [];
    return topics
      .map((t: unknown) => {
        if (!t || typeof t !== 'object') return null;
        const topicObj = t as Record<string, unknown>;
        const heTitle = typeof topicObj.he === 'string' ? topicObj.he.trim() : null;
        return heTitle && heTitle.length > 0 ? heTitle : null;
      })
      .filter((name): name is string => name !== null)
      .slice(0, 3);
  } catch {
    return [];
  }
}
