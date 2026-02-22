'use server';

import { numberToHebrew } from '@/lib/hebrew-utils';

const SEFARIA_SECTION_MAP: Record<string, string> = {
    'Orach Chayim': 'Shulchan Arukh, Orach Chayim',
    'Yoreh Deah': 'Shulchan Arukh, Yoreh Deah',
    'Even HaEzer': 'Shulchan Arukh, Even HaEzer',
    'Choshen Mishpat': 'Shulchan Arukh, Choshen Mishpat',
};

export interface SimanOption {
    value: number;
    label: string; // Hebrew letter representation
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
 * Returns an array of siman options {value, label} for the dropdown.
 */
export async function getSimanOptions(section: string): Promise<SimanOption[]> {
    const count = await getSimanCount(section);
    const options: SimanOption[] = [];
    for (let i = 1; i <= count; i++) {
        options.push({ value: i, label: numberToHebrew(i) });
    }
    return options;
}

/**
 * Returns an array of seif options {value, label} for the dropdown.
 */
export async function getSeifOptions(section: string, siman: number): Promise<SeifOption[]> {
    const count = await getSeifCount(section, siman);
    const options: SeifOption[] = [];
    for (let i = 1; i <= count; i++) {
        options.push({ value: i, label: numberToHebrew(i) });
    }
    return options;
}
