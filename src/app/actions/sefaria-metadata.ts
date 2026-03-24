'use server';

import { numberToHebrew } from '@/lib/hebrew-utils';

const SEFARIA_SECTION_MAP: Record<string, string> = {
    'Orach Chayim': 'Shulchan Arukh, Orach Chayim',
    'Yoreh Deah': 'Shulchan Arukh, Yoreh Deah',
    'Even HaEzer': 'Shulchan Arukh, Even HaEzer',
    'Choshen Mishpat': 'Shulchan Arukh, Choshen Mishpat',
    'Torah Ohr': 'Torah Ohr',
};

export interface SimanOption {
    value: number | string;
    label: string; // Hebrew letter representation or Parasha name
    subject?: string; // Topic/subject of the siman (e.g. "הלכות השכמת הבוקר")
}

export interface SeifOption {
    value: number;
    label: string;
}

/**
 * Fetches the total number of simanim for a given section from the Sefaria index API.
 */
export async function getSimanCount(section: string): Promise<number> {
    const bookTitle = SEFARIA_SECTION_MAP[section];
    if (!bookTitle) return 0;

    const url = `https://www.sefaria.org/api/v2/index/${encodeURIComponent(bookTitle)}`;
    const response = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!response.ok) return 0;

    const data = await response.json();
    const lengths = data?.schema?.lengths;
    if (Array.isArray(lengths) && lengths.length > 0) {
        return lengths[0]; // first dimension = siman count
    }
    return 0;
}

/**
 * Fetches the number of seifim for a given siman from the Sefaria text API.
 */
export async function getSeifCount(section: string, siman: number): Promise<number> {
    const bookTitle = SEFARIA_SECTION_MAP[section];
    if (!bookTitle || siman < 1) return 0;

    const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(bookTitle + ' ' + siman)}?lang=he&context=0`;
    const response = await fetch(url, { next: { revalidate: 86400 } });
    if (!response.ok) return 0;

    const data = await response.json();
    // The text array for the siman, each element = one seif
    const versions = data?.versions;
    if (Array.isArray(versions)) {
        const heVersion = versions.find((v: { language: string }) => v.language === 'he');
        if (heVersion?.text && Array.isArray(heVersion.text)) {
            return heVersion.text.length;
        }
    }
    return 0;
}

/**
 * Returns an array of siman options {value, label, subject} for the dropdown.
 */
export async function getSimanOptions(section: string): Promise<SimanOption[]> {
    if (section === 'Torah Ohr') {
        return getTorahOhrParashot();
    }
    // Fetch count and subjects in parallel
    const [count, subjects] = await Promise.all([
        getSimanCount(section),
        getSimanSubjects(section),
    ]);
    const options: SimanOption[] = [];
    for (let i = 1; i <= count; i++) {
        options.push({
            value: i,
            label: numberToHebrew(i),
            subject: subjects[i],
        });
    }
    return options;
}

/**
 * Returns an array of seif options {value, label} for the dropdown.
 */
export async function getSeifOptions(section: string, siman: number | string): Promise<SeifOption[]> {
    if (section === 'Torah Ohr') {
        const count = await getTorahOhrMaamarCount(siman as string);
        const options: SeifOption[] = [];
        for (let i = 1; i <= count; i++) {
            options.push({ value: i, label: i.toString() }); // Maamarim are usually numbered
        }
        return options;
    }
    const count = await getSeifCount(section, siman as number);
    const options: SeifOption[] = [];
    for (let i = 1; i <= count; i++) {
        options.push({ value: i, label: numberToHebrew(i) });
    }
    return options;
}

/**
 * Fetches siman subjects (topic titles) for a given section from the Sefaria index API.
 * Returns a map of siman number -> Hebrew subject title.
 */
export async function getSimanSubjects(section: string): Promise<Record<number, string>> {
    const bookTitle = SEFARIA_SECTION_MAP[section];
    if (!bookTitle) return {};

    const url = `https://www.sefaria.org/api/v2/index/${encodeURIComponent(bookTitle)}`;

    try {
        const response = await fetch(url, { next: { revalidate: 86400 } });
        if (!response.ok) return {};

        const data = await response.json();
        const subjects: Record<number, string> = {};

        // Try alt_structs for topic-based structure (e.g. "Hilkhot", "Topics")
        const altStructs = data?.alt_structs;
        if (altStructs && typeof altStructs === 'object') {
            const structKey = Object.keys(altStructs)[0];
            const struct = structKey ? altStructs[structKey] : null;
            const nodes: unknown[] = Array.isArray(struct?.nodes) ? struct.nodes : [];

            for (const node of nodes) {
                if (!node || typeof node !== 'object') continue;
                const n = node as Record<string, unknown>;

                const heTitle = typeof n.heTitle === 'string'
                    ? n.heTitle
                    : (Array.isArray(n.titles)
                        ? (n.titles as Array<{ lang: string; text: string }>)
                            .find(t => t.lang === 'he')?.text
                        : undefined);

                if (!heTitle) continue;

                // Try wholeRef first (e.g. "Shulchan Arukh, Orach Chayim 1-8")
                const rangeRef = typeof n.wholeRef === 'string' ? n.wholeRef : null;
                if (rangeRef) {
                    const match = rangeRef.match(/(\d+)(?:-(\d+))?$/);
                    if (match) {
                        const from = parseInt(match[1]!, 10);
                        const to = match[2] ? parseInt(match[2], 10) : from;
                        for (let i = from; i <= to; i++) {
                            if (!subjects[i]) subjects[i] = heTitle;
                        }
                        continue;
                    }
                }

                // Fall back to refs array
                const refs = Array.isArray(n.refs) ? (n.refs as unknown[]) : [];
                for (const ref of refs) {
                    const refStr = typeof ref === 'string' ? ref : null;
                    if (!refStr) continue;
                    const match = refStr.match(/(\d+)(?:-(\d+))?$/);
                    if (match) {
                        const from = parseInt(match[1]!, 10);
                        const to = match[2] ? parseInt(match[2], 10) : from;
                        for (let i = from; i <= to; i++) {
                            if (!subjects[i]) subjects[i] = heTitle;
                        }
                    }
                }
            }
        }

        return subjects;
    } catch {
        return {};
    }
}

/**
 * Fetches the Parashot nodes for Torah Ohr.
 */
async function getTorahOhrParashot(): Promise<SimanOption[]> {
    const url = `https://www.sefaria.org/api/v2/index/Torah_Ohr`;
    const response = await fetch(url, { next: { revalidate: 86400 } });
    if (!response.ok) return [];

    const data = await response.json();
    const nodes = data?.schema?.nodes || [];

    // Some books start directly, some have an intro or supplements. Filter to just Parashot.
    const options: SimanOption[] = [];
    const seenTitles = new Set<string>();

    // Torah Ohr has two main divisions: "Bereshit" and "Shemot".
    // Wait, let's explore all depth-1 nodes usually corresponding to Parashot.
    const flattenNodes = (n: any) => {
        if (n.nodeType === 'JaggedArrayNode' || !n.nodes) {
            const heTitle = n.heTitle || n.titles?.find((t: any) => t.lang === 'he' && t.primary)?.text || n.titles?.find((t: any) => t.lang === 'he')?.text;
            const enTitle = n.title || n.titles?.find((t: any) => t.lang === 'en' && t.primary)?.text || n.titles?.find((t: any) => t.lang === 'en')?.text;
            if (heTitle && enTitle && !enTitle.toLowerCase().includes('introduction')) {
                if (!seenTitles.has(enTitle)) {
                    seenTitles.add(enTitle);
                    options.push({ value: enTitle, label: heTitle });
                }
            }
        } else if (n.nodes) {
            n.nodes.forEach(flattenNodes);
        }
    };

    nodes.forEach(flattenNodes);
    return options;
}

/**
 * Fetches the number of Maamarim in a specific Parasha in Torah Ohr.
 */
async function getTorahOhrMaamarCount(parashaEn: string | number): Promise<number> {
    const parashaSafe = String(parashaEn).replace(/ /g, '_');
    const url = `https://www.sefaria.org/api/v3/texts/Torah_Ohr,_${encodeURIComponent(parashaSafe)}?lang=he&context=0`;
    const response = await fetch(url, { next: { revalidate: 86400 } });
    if (!response.ok) return 0;

    const data = await response.json();
    const versions = data?.versions;
    if (Array.isArray(versions)) {
        const heVersion = versions.find((v: any) => v.language === 'he');
        if (heVersion?.text && Array.isArray(heVersion.text)) {
            // Depending on the structure, it might be an array of Maamarim or deeper
            // If the Parasha is a 2D array, length is number of Maamarim.
            return heVersion.text.length;
        }
    }
    return 1; // Default to at least 1 if we can't parse
}
