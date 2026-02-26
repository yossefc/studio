import type { StructuredChunk } from './sefaria-api';

const MAX_WORDS_PER_CHUNK = 180;
const MIN_WORDS_PER_CHUNK = 120; // try not to leave tiny trailing chunks

// Aggressive limits for alignment: small chunks give the LLM granularity
// to distribute text across all seifim, even when Sefaria returns 1 huge block.
const ALIGNMENT_MAX_WORDS = 50;
const ALIGNMENT_MIN_WORDS = 25;

/**
 * Counts words in a Hebrew string. 
 * Splits by whitespace and ignores pure punctuation tokens.
 */
function countWords(text: string): number {
    if (!text) return 0;
    const tokens = text.trim().split(/\s+/);
    return tokens.filter(t => /[א-תa-zA-Z0-9]/.test(t)).length;
}

/**
 * Splits a long text string into multiple segments.
 * Uses a basic regex to split by sentences/clauses where possible,
 * then groups them up to the maximum word threshold.
 */
function splitTextIntoSubChunks(
    text: string,
    maxWords: number = MAX_WORDS_PER_CHUNK,
    minWords: number = MIN_WORDS_PER_CHUNK
): string[] {
    // Split on dots, colons, or line breaks, keeping the delimiter attached.
    // In Rabbinic text, often delimited by ":" or "."
    const clauses = text.match(/[^.:\n]+[.:\n]+/g) || [text];

    // If the text has no punctuation, fallback to raw word splitting
    if (clauses.length <= 1) {
        const words = text.split(' ');
        const subChunks: string[] = [];
        let currentAcc = [];
        for (const w of words) {
            currentAcc.push(w);
            if (currentAcc.length >= maxWords) {
                subChunks.push(currentAcc.join(' '));
                currentAcc = [];
            }
        }
        if (currentAcc.length > 0) subChunks.push(currentAcc.join(' '));
        return subChunks;
    }

    const result: string[] = [];
    let currentGroup = '';

    for (const clause of clauses) {
        const nextWords = countWords(clause);
        const currWords = countWords(currentGroup);

        if (currWords + nextWords > maxWords && currWords >= minWords) {
            // Flush current group
            result.push(currentGroup.trim());
            currentGroup = clause;
        } else if (currWords + nextWords > maxWords + 50) {
            // A single clause is massive. Just flush what we have,
            // and we might need to strictly word-split the clause
            // but for now we'll accept a slightly larger chunk.
            if (currentGroup) result.push(currentGroup.trim());
            result.push(clause.trim());
            currentGroup = '';
        } else {
            currentGroup += ' ' + clause;
        }
    }

    if (currentGroup.trim()) {
        result.push(currentGroup.trim());
    }

    return result;
}

/**
 * Processes a list of StructuredChunks.
 * If any chunk exceeds MAX_WORDS_PER_CHUNK, it is split into smaller chunks.
 *
 * CRITICAL RULE: Every sub-chunk inherits the distinct `ref` property of its parent.
 */
export function chunkStructuredText(chunks: StructuredChunk[]): StructuredChunk[] {
    return chunkWithLimits(chunks, MAX_WORDS_PER_CHUNK, MIN_WORDS_PER_CHUNK);
}

/**
 * Adaptive chunking for the alignment step.
 *
 * The goal is to produce ~30-60 chunks so the LLM can distribute them across
 * seifim without being overwhelmed. The strategy adapts to Sefaria's own
 * segmentation:
 *
 *   - Few raw segments (1-5):   Sefaria gave us huge blocks → aggressive 50-word split
 *   - Medium segments (6-20):   Moderate granularity → 100-word split
 *   - Many segments (21+):      Sefaria already segmented well → just cap at 150 words
 *
 * TARGET_MAX_CHUNKS caps the final output. If we still exceed it after splitting,
 * we keep only the first TARGET_MAX_CHUNKS chunks (the text is sequential, so
 * losing tail chunks is better than garbling the LLM prompt).
 */
const TARGET_MAX_CHUNKS = 60;

export function chunkForAlignment(chunks: StructuredChunk[]): StructuredChunk[] {
    const rawCount = chunks.length;

    let maxW: number;
    let minW: number;

    if (rawCount <= 5) {
        // Very few segments from Sefaria → aggressive split
        maxW = ALIGNMENT_MAX_WORDS;   // 50
        minW = ALIGNMENT_MIN_WORDS;   // 25
    } else if (rawCount <= 20) {
        // Moderate segmentation → medium split
        maxW = 100;
        minW = 50;
    } else {
        // Already well-segmented → light split only for outliers
        maxW = 150;
        minW = 80;
    }

    const result = chunkWithLimits(chunks, maxW, minW);

    if (result.length > TARGET_MAX_CHUNKS) {
        console.warn(`[Chunker] Alignment chunks capped: ${result.length} → ${TARGET_MAX_CHUNKS} (raw segments: ${rawCount}, maxW: ${maxW})`);
        return result.slice(0, TARGET_MAX_CHUNKS);
    }

    return result;
}

function chunkWithLimits(
    chunks: StructuredChunk[],
    maxWords: number,
    minWords: number
): StructuredChunk[] {
    const result: StructuredChunk[] = [];

    for (const chunk of chunks) {
        const wordCount = countWords(chunk.text);

        if (wordCount <= maxWords) {
            result.push(chunk);
        } else {
            // Need to split
            const subTexts = splitTextIntoSubChunks(chunk.text, maxWords, minWords);
            for (const st of subTexts) {
                if (!st.trim()) continue;

                result.push({
                    ref: chunk.ref, // Inherit parent Sefaria Ref explicitly
                    path: chunk.path ? [...chunk.path] : undefined,
                    text: st
                });
            }
        }
    }

    return result;
}
