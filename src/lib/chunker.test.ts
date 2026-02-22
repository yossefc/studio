/**
 * @fileOverview Unit tests for the text chunking logic.
 * Run using your preferred test runner (e.g., vitest).
 */

import { chunkText } from './chunker';

describe('chunkText', () => {
  const mockTref = 'Shabbat 2a';
  const mockSource = 'HE';

  it('should split text into segments within the 120-180 word range', () => {
    // Generate a string with 400 words
    const longText = Array(400).fill('מילה').join(' ');
    const chunks = chunkText(longText, mockTref, mockSource);
    
    // 400 words / ~150 words target should yield ~3 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    
    chunks.forEach((chunk, index) => {
      const wordCount = chunk.text.split(/\s+/).length;
      if (index < chunks.length - 1) {
        expect(wordCount).toBeGreaterThanOrEqual(120);
        expect(wordCount).toBeLessThanOrEqual(180);
      }
    });
  });

  it('should attempt to break at sentence boundaries', () => {
    const text = Array(130).fill('מילה').join(' ') + '. ' + Array(50).fill('עוד').join(' ');
    const chunks = chunkText(text, mockTref, mockSource);
    
    // The first chunk should end with the period
    expect(chunks[0].text.endsWith('.')).toBe(true);
  });

  it('should generate deterministic IDs and hashes', () => {
    const text = 'זהו טקסט קצר לבדיקה.';
    const chunks1 = chunkText(text, mockTref, mockSource);
    const chunks2 = chunkText(text, mockTref, mockSource);
    
    expect(chunks1[0].id).toBe(chunks2[0].id);
    expect(chunks1[0].rawHash).toBe(chunks2[0].rawHash);
  });
});
