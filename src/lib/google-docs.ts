/**
 * @fileOverview Integration with Google Docs API to publish multi-source study guides.
 */

import { google, docs_v1 } from 'googleapis';
import type { SourceResult } from '@/app/actions/study-guide';

type BoldRange = { start: number; end: number };

const DOC_FONT_SIZE_PT = 11;
const DOC_LINE_SPACING = 110;
const DOC_PARAGRAPH_SPACE_PT = 2;

function extractBoldRanges(text: string, startIndex: number): { cleanText: string; ranges: BoldRange[] } {
  let i = 0;
  let cleanText = '';
  const ranges: BoldRange[] = [];

  while (i < text.length) {
    const isBoldMarker = text[i] === '*' && text[i + 1] === '*';

    if (!isBoldMarker) {
      cleanText += text[i];
      i += 1;
      continue;
    }

    i += 2;
    const boldStart = cleanText.length;

    while (i < text.length && !(text[i] === '*' && text[i + 1] === '*')) {
      cleanText += text[i];
      i += 1;
    }

    const boldEnd = cleanText.length;
    if (boldEnd > boldStart) {
      ranges.push({
        start: startIndex + boldStart,
        end: startIndex + boldEnd,
      });
    }

    if (i < text.length && text[i] === '*' && text[i + 1] === '*') {
      i += 2;
    }
  }

  return { cleanText, ranges };
}

function normalizeForDoc(text: string, collapseLineBreaks = false): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!collapseLineBreaks) {
    return normalized;
  }

  return normalized.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Creates a formatted Google Doc for a multi-source study guide.
 * Organizes content by source with section headers.
 */
export async function createStudyGuideDoc(
  tref: string,
  summary: string,
  sourceResults: SourceResult[],
): Promise<{ id: string; url: string }> {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const createResponse = await docs.documents.create({
    requestBody: {
      title: `ביאור ${tref}`,
    },
  });

  const documentId = createResponse.data.documentId;
  if (!documentId) {
    throw new Error('Google Docs API did not return a documentId.');
  }

  // Share the document with the user
  await drive.permissions.create({
    fileId: documentId,
    requestBody: {
      type: 'user',
      role: 'writer',
      emailAddress: 'yossefcohzar@gmail.com',
    },
    sendNotificationEmail: false,
  });

  const boldRanges: BoldRange[] = [];
  let fullContent = '';
  let cursor = 1;

  const appendPlain = (text: string) => {
    fullContent += text;
    cursor += text.length;
  };

  const appendBoldAware = (text: string) => {
    const { cleanText, ranges } = extractBoldRanges(text, cursor);
    fullContent += cleanText;
    cursor += cleanText.length;
    boldRanges.push(...ranges);
  };

  appendPlain(`ביאור הלכתי: ${tref}\n\n`);

  const sections = sourceResults.filter((sr) => sr.chunks.length > 0);

  sections.forEach((sr, sourceIndex) => {
    appendPlain(`${sr.hebrewLabel}\n`);
    appendPlain('--------------------\n');

    sr.chunks.forEach((chunk, chunkIndex) => {
      const compactRaw = normalizeForDoc(chunk.rawText, true);
      const compactExplanation = normalizeForDoc(chunk.explanation);

      appendPlain(`מקור: ${compactRaw}\n`);
      appendBoldAware(`ביאור: ${compactExplanation}\n`);

      if (chunkIndex < sr.chunks.length - 1) {
        appendPlain('\n');
      }
    });

    if (sourceIndex < sections.length - 1) {
      appendPlain('\n\n');
    }
  });

  appendPlain('\nסיכום הלכה למעשה\n');
  appendPlain('-----------------\n');

  const compactSummary = normalizeForDoc(summary);
  if (compactSummary) {
    appendBoldAware(`${compactSummary}\n`);
  } else {
    appendPlain('לא הופק סיכום.\n');
  }

  const requests: docs_v1.Schema$Request[] = [
    {
      insertText: {
        location: { index: 1 },
        text: fullContent,
      },
    },
  ];

  if (cursor > 1) {
    requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: 1,
          endIndex: cursor,
        },
        paragraphStyle: {
          lineSpacing: DOC_LINE_SPACING,
          spaceAbove: {
            magnitude: DOC_PARAGRAPH_SPACE_PT,
            unit: 'PT',
          },
          spaceBelow: {
            magnitude: DOC_PARAGRAPH_SPACE_PT,
            unit: 'PT',
          },
          direction: 'RIGHT_TO_LEFT',
        },
        fields: 'lineSpacing,spaceAbove,spaceBelow,direction',
      },
    });

    requests.push({
      updateTextStyle: {
        range: {
          startIndex: 1,
          endIndex: cursor,
        },
        textStyle: {
          fontSize: {
            magnitude: DOC_FONT_SIZE_PT,
            unit: 'PT',
          },
        },
        fields: 'fontSize',
      },
    });
  }

  for (const range of boldRanges) {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: range.start,
          endIndex: range.end,
        },
        textStyle: {
          bold: true,
        },
        fields: 'bold',
      },
    });
  }

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });

  return {
    id: documentId,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}
