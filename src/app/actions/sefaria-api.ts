import { getAdminDb } from '@/server/firebase-admin';

export interface StructuredChunk {
    /** The Sefaria string reference, e.g., "Tur, Orach Chayim 1:2" */
    ref: string;
    /** The original text of the reference without merging */
    text: string;
    /** (Optional) the jagged array index path */
    path?: number[];
}

export interface LinkResult {
    ref: string;
    type: string;
    sourceRef: string;
}

const SEFARIA_BASE = 'https://www.sefaria.org/api';

/**
 * Normalizes text, removing niqqud and HTML markup.
 */
export function normalizeSefariaText(text: string): string {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/[\u0591-\u05C7]/g, '') // Remove Niqqud/Taamim
        .trim();
}

/**
 * Fetches the raw JSON for a specific Sefaria Text Ref.
 */
export async function fetchSefariaTextRaw(tref: string): Promise<any> {
    const url = `${SEFARIA_BASE}/texts/${encodeURIComponent(tref)}?context=0&commentary=0`;
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'force-cache'
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch Sefaria Ref: ${tref} (${res.status})`);
    }

    return res.json();
}

/**
 * Recursively flattens a Sefaria JaggedArray into distinct StructuredChunks.
 * Each chunk retains its exact string reference (e.g. "Orach Chayim 1:2:3").
 * @param node The current element in the array or the array itself
 * @param baseRef The parent ref, e.g. "Orach Chayim 1"
 * @param currentPath Indices traversed so far, e.g. [0, 1]
 */
export function flattenJaggedArrayToChunks(
    node: any,
    baseRef: string,
    currentPath: number[] = []
): StructuredChunk[] {
    const chunks: StructuredChunk[] = [];

    if (Array.isArray(node)) {
        // Array of strings or further arrays
        node.forEach((child, index) => {
            chunks.push(...flattenJaggedArrayToChunks(child, baseRef, [...currentPath, index + 1]));
        });
    } else if (typeof node === 'string') {
        // Leaf node: actual text segment
        const cleanText = normalizeSefariaText(node);
        if (cleanText.length > 0) {
            // Build Sefaria ref by appending the indices joined by colons
            const leafRef = currentPath.length > 0
                ? `${baseRef}:${currentPath.join(':')}`
                : baseRef;

            chunks.push({
                ref: leafRef,
                path: [...currentPath],
                text: cleanText
            });
        }
    }

    return chunks;
}

/**
 * Fetches a full siman and extracts it into StructuredChunks preserving discrete refs.
 */
export async function getStructuredSiman(tref: string): Promise<StructuredChunk[]> {
    const data = await fetchSefariaTextRaw(tref);
    const textArray = data.he || [];
    return flattenJaggedArrayToChunks(textArray, data.ref);
}

/**
 * Queries Sefaria /api/links/{tref} to find related commentaries.
 * Returns only the refs for Tur and Beit Yosef explicitly linked to the section.
 */

