/**
 * @fileOverview Client for interacting with the Sefaria API.
 * Supports multiple Jewish text sources: Tur, Beit Yosef, Shulchan Arukh, Mishnah Berurah.
 */

import { hebrewToNumber } from '@/lib/hebrew-utils';
import { chunkStructuredText } from '@/lib/chunker';

export type SourceKey = 'tur' | 'beit_yosef' | 'shulchan_arukh' | 'mishnah_berurah';
export type FetchMode = 'exact-seif' | 'linked-passages' | 'full-siman';

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
};

/** Canonical processing order for multi-source guides. */
export const SOURCE_PROCESSING_ORDER: SourceKey[] = ['tur', 'beit_yosef', 'shulchan_arukh'];

export function resolveFetchMode(sourceKey: SourceKey): FetchMode {
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
    .sort();

  const beitYosefRefs = [...allRefs]
    .filter(ref => refStartsWithAnyPrefix(ref, beitYosefPrefixes))
    .sort();

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

/**
 * Extrait le sous-ensemble du Tur correspondant à un Seif donné,
 * en se basant sur les liens du Beit Yosef comme repères de début et de fin.
 * 
 * Règle métier :
 * - Début : Index du premier Beit Yosef lié au Seif N.
 * - Fin : Index (exclu) du premier Beit Yosef lié au Seif N+1.
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

  // 1. Chercher la limite de début (Beit Yosef lié au Seif N)
  let startIndex: number | null = providedStartIndex ?? null;
  let seekStartSeif = seif;

  if (!startIndex) {
    while (seekStartSeif >= 1) {
      try {
        const links = await getLinkedSourcesForShulchanArukhSeif(sectionName, siman, seekStartSeif);
        startIndex = getFirstBeitYosefBoundaryIndex(links, siman);
        if (startIndex) break;
      } catch {
        // Ignorer les erreurs et continuer la recherche en arrière
      }
      seekStartSeif--;
    }
  }

  // Si aucun Beit Yosef avant, on prend depuis le début du Siman
  if (!startIndex) {
    startIndex = 1;
  }

  // 2. Chercher la limite de fin (Beit Yosef lié au Seif N+1)
  let endIndexExclusive: number | null = providedEndIndexExclusive ?? null;
  let seekEndSeif = seif + 1;
  const maxEndSeek = seif + 5; // Limiter la recherche pour éviter les boucles infinies

  if (!endIndexExclusive) {
    while (seekEndSeif <= maxEndSeek) {
      try {
        const nextLinks = await getLinkedSourcesForShulchanArukhSeif(sectionName, siman, seekEndSeif);
        endIndexExclusive = getFirstBeitYosefBoundaryIndex(nextLinks, siman);
        if (endIndexExclusive) break;
      } catch {
        // Cas typique où l'on a atteint la fin du Siman
        break;
      }
      seekEndSeif++;
    }
  }

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

  // 4. Découper (par frontières d'index ou textuelles)
  let selected: StructuredChunk[] = [];

  // OPTION 2 : HEURISTIQUE TEXTUELLE
  // Si le Tur est mal découpé (un seul gros bloc pour tout le siman, ex: OC 24)
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

    // Helper to generate a robust regex from a text snippet
    // Takes the first ~4 words, escapes them, and joins with flexible whitespace/punctuation matchers
    const buildRegexMarker = (text: string, numWords = 4) => {
      const words = cleanSegmentText(text)
        .replace(/[^\u05D0-\u05EA]/g, ' ') // Keep only Hebrew letters
        .split(/\s+/)
        .filter(w => w.length > 0)
        .slice(0, numWords);

      if (words.length === 0) return null;
      // Allow any non-hebrew characters (spaces, punctuation) between the anchor words
      const pattern = words.join('[^\\u05D0-\\u05EA]+');
      return new RegExp(pattern);
    };

    if (byData && byData.segments.length > 0) {
      if (startIndex) {
        const byStartSeg = byData.segments.find(s => getSegmentTopLevelIndex(s, siman) === startIndex);
        if (byStartSeg) {
          const regexStart = buildRegexMarker(byStartSeg.text);
          if (regexStart) {
            const match = giantText.match(regexStart);
            if (match && match.index !== undefined) {
              cutStartIndex = match.index;
            }
          }
        }
      }

      if (endIndexExclusive) {
        const byEndSeg = byData.segments.find(s => getSegmentTopLevelIndex(s, siman) === endIndexExclusive);
        if (byEndSeg) {
          const regexEnd = buildRegexMarker(byEndSeg.text);
          if (regexEnd) {
            const subGiant = giantText.substring(cutStartIndex);
            const match = subGiant.match(regexEnd);
            if (match && match.index !== undefined && match.index > 0) {
              cutEndIndex = cutStartIndex + match.index;
            }
          }
        }
      }
    }

    const extractedText = giantText.substring(cutStartIndex, cutEndIndex).trim();
    if (extractedText) {
      selected.push({
        ref: `${turSimanRef} [Extrait Seif ${seif}]`,
        text: extractedText
      });
    }

  } else {
    // Cas classique par frontières d'index (le Tur est bien découpé)
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
    return []; // Retourne un tableau vide au lieu de planter si rien n'est trouvé
  }

  // 5. Chunking technique (si > 180 mots) en préservant le 'ref'
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
