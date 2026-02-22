/**
 * @fileOverview Utilities for segmenting Jewish texts into logical chunks for AI processing.
 * Implements deterministic ID generation and robust text hashing.
 * Optimized for 120-180 words per chunk to balance context and cost.
 */

export type TextChunk = {
  id: string;
  text: string;
  rawHash: string;
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

/**
 * Splits text into chunks of 120-180 words, attempting to break at sentence boundaries.
 */
export function chunkText(fullText: string, tref: string, source: string): TextChunk[] {
  const words = fullText.split(/\s+/).filter(Boolean);
  const chunks: TextChunk[] = [];
  let currentWords: string[] = [];

  const minWords = 120;
  const maxWords = 180;

  // Derive a short section prefix from the tref (e.g. "Shulchan Arukh, Orach Chayim 1.1" → "OC").
  const sectionPrefixes: Record<string, string> = {
    'orach chayim': 'OC',
    'yoreh deah': 'YD',
    'even haezer': 'EH',
    'choshen mishpat': 'CM',
  };
  const trefLower = tref.toLowerCase();
  const sectionPrefix = Object.entries(sectionPrefixes).find(([key]) => trefLower.includes(key))?.[1] ?? 'GEN';

  // Extract trailing numeric reference part (e.g. "1:1" => "1_1").
  const refParts = tref.split(' ');
  const numericRef = (refParts[refParts.length - 1] || '0_0').replace(/[:.]/g, '_');

  const createChunk = (text: string, index: number): TextChunk => {
    const cleanText = text.trim();
    return {
      id: `${sectionPrefix}_${numericRef}_${source}_chunk_${index + 1}`,
      text: cleanText,
      rawHash: generateHash(cleanText),
    };
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentWords.push(word);

    const wordCount = currentWords.length;
    const isPunctuation = /[\u05C3.:?!]/.test(word);

    if (wordCount >= minWords && (isPunctuation || wordCount >= maxWords)) {
      chunks.push(createChunk(currentWords.join(' '), chunks.length));
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    chunks.push(createChunk(currentWords.join(' '), chunks.length));
  }

  return chunks;
}
