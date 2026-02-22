/**
 * @fileOverview Client for interacting with the Sefaria API.
 * Supports multiple Jewish text sources: Tur, Beit Yosef, Shulchan Arukh, Mishnah Berurah.
 */

import { hebrewToNumber } from '@/lib/hebrew-utils';

export type SourceKey = 'tur' | 'beit_yosef' | 'shulchan_arukh' | 'mishnah_berurah';

export interface SourceConfig {
  key: SourceKey;
  hebrewLabel: string;
  sefariaPrefix: string;
  includesSection: boolean;
  supportsSeif: boolean;
  onlyOrachChayim: boolean;
}

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

export type SefariaResponse = {
  ref: string;
  he: string[];
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
function cleanSefariaText(texts: unknown): string[] {
  const flatten = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [String(arr ?? '')];
    return arr.reduce<string[]>((acc, val) => acc.concat(Array.isArray(val) ? flatten(val) : String(val ?? '')), []);
  };

  const flatTexts = flatten(texts);

  return flatTexts
    .map(t => {
      if (typeof t !== 'string') return '';
      return t
        .replace(/<[^>]*>?/gm, '')
        .replace(/\([^)]{1,5}\)/g, '')
        .trim();
    })
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

  return {
    ref: data.ref || normalized,
    he: cleanSefariaText(heTexts),
    en: cleanSefariaText(data.en || []),
    direction: 'rtl',
  };
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
