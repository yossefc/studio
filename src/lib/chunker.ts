/**
 * @fileOverview Utilities for segmenting Jewish texts into logical chunks for AI processing.
 * Implements deterministic ID generation and robust text hashing.
 * Optimized for 120-180 words per chunk to balance context and cost.
 */

export type TextChunk = {
  id: string;
  text: string;
  rawHash: string;
  ref?: string;
  path?: number[];
};

export type StructuredChunk = {
  ref: string;
  path?: number[];
  text: string;
};

/**
 * Generates a deterministic hash without Node-only dependencies.
 */
function generateHash(text: string): string {
  // cyrb53-style hash: deterministic and stronger than a simple 32-bit hash.
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const MIN_WORDS_PER_CHUNK = 120;
const MAX_WORDS_PER_CHUNK = 180;

function splitByWordBudget(text: string, minWords = MIN_WORDS_PER_CHUNK, maxWords = MAX_WORDS_PER_CHUNK): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return [text.trim()];
  }

  const parts: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    currentWords.push(word);

    const wordCount = currentWords.length;
    const isSentenceBoundary = /[\u05C3.:?!]/.test(word);
    if (wordCount >= minWords && (isSentenceBoundary || wordCount >= maxWords)) {
      parts.push(currentWords.join(' ').trim());
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    parts.push(currentWords.join(' ').trim());
  }

  return parts.filter(Boolean);
}

function normalizeRefKey(ref: string): string {
  const normalized = ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return 'ref';
  }

  return normalized.length <= 64 ? normalized : normalized.slice(-64);
}

function buildChunkId(source: string, ref: string, path: number[] | undefined, index: number): string {
  const refPart = normalizeRefKey(ref);
  const pathPart = path && path.length ? path.join('_') : 'root';
  return `${source}_${refPart}_${pathPart}_chunk_${index + 1}`;
}

/**
 * Chunks structured Sefaria segments. Each logical segment is preserved as-is unless it exceeds 180 words.
 * In that case, it is split into 120-180 word sub-chunks while preserving the parent reference metadata.
 */
export function chunkStructuredText(segments: StructuredChunk[], source: string): TextChunk[] {
  const chunks: TextChunk[] = [];

  for (const segment of segments) {
    const cleanText = segment.text.trim();
    if (!cleanText) {
      continue;
    }

    const parts = splitByWordBudget(cleanText);
    for (const part of parts) {
      chunks.push({
        id: buildChunkId(source, segment.ref, segment.path, chunks.length),
        text: part,
        rawHash: generateHash(part),
        ref: segment.ref,
        path: segment.path,
      });
    }
  }

  return chunks;
}

/**
 * Backward-compatible entry point for plain text.
 */
export function chunkText(fullText: string, tref: string, source: string): TextChunk[] {
  const segment: StructuredChunk = {
    ref: tref,
    text: fullText,
  };
  return chunkStructuredText([segment], source);
}
