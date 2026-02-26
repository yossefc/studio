/**
 * @fileOverview Integration with Google Docs API to publish multi-source study guides.
 */

import { google, docs_v1 } from 'googleapis';
import type { SourceResult } from '@/app/actions/study-guide';

type StyledRange = {
  start: number;
  end: number;
  style: 'bold' | 'title' | 'sectionHeader' | 'sourceLabel' | 'sourceText' | 'summaryHeader' | 'separator';
  sourceKey?: SourceResult['sourceKey'];
};

const DOC_FONT_SIZE_PT = 11;
const DOC_TITLE_FONT_SIZE_PT = 18;
const DOC_SECTION_FONT_SIZE_PT = 14;
const DOC_LINE_SPACING = 115;
const DOC_PARAGRAPH_SPACE_PT = 3;

// Colors matching the app's theme (from globals.css)
const COLOR_PRIMARY = { red: 52 / 255, green: 107 / 255, blue: 191 / 255 };       // #346DBF
const COLOR_DARK = { red: 24 / 255, green: 38 / 255, blue: 71 / 255 };            // #182647
const COLOR_SOURCE_BG = { red: 242 / 255, green: 247 / 255, blue: 250 / 255 };    // #F2F7FA
const COLOR_SUMMARY_BG = { red: 235 / 255, green: 242 / 255, blue: 252 / 255 };   // #EBF2FC

const SOURCE_PALETTE: Record<SourceResult['sourceKey'], { accent: typeof COLOR_PRIMARY; softBg: typeof COLOR_SOURCE_BG }> = {
  tur: {
    accent: { red: 166 / 255, green: 109 / 255, blue: 31 / 255 },      // #A66D1F
    softBg: { red: 252 / 255, green: 245 / 255, blue: 230 / 255 },      // #FCF5E6
  },
  beit_yosef: {
    accent: { red: 23 / 255, green: 115 / 255, blue: 107 / 255 },       // #17736B
    softBg: { red: 231 / 255, green: 248 / 255, blue: 245 / 255 },       // #E7F8F5
  },
  shulchan_arukh: {
    accent: COLOR_PRIMARY,
    softBg: COLOR_SOURCE_BG,
  },
  mishnah_berurah: {
    accent: { red: 11 / 255, green: 124 / 255, blue: 88 / 255 },         // #0B7C58
    softBg: { red: 229 / 255, green: 247 / 255, blue: 240 / 255 },       // #E5F7F0
  },
};

function getSourcePalette(sourceKey?: SourceResult['sourceKey']) {
  if (!sourceKey) {
    return { accent: COLOR_PRIMARY, softBg: COLOR_SOURCE_BG };
  }
  return SOURCE_PALETTE[sourceKey] || { accent: COLOR_PRIMARY, softBg: COLOR_SOURCE_BG };
}

function extractBoldRanges(
  text: string,
  startIndex: number,
  sourceKey?: SourceResult['sourceKey'],
): { cleanText: string; ranges: StyledRange[] } {
  let i = 0;
  let cleanText = '';
  const ranges: StyledRange[] = [];

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
        style: 'bold',
        sourceKey,
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

function structureSummaryForDoc(summary: string): string {
  const lines = normalizeForDoc(summary)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  const structured: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      if (structured.length > 0 && structured[structured.length - 1] !== '') {
        structured.push('');
      }
      structured.push(headerMatch[1]!.trim());
      structured.push('');
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*]|\d+\.|\u2022)\s+(.+)$/);
    if (bulletMatch) {
      structured.push(`• ${bulletMatch[1]!.trim()}`);
      continue;
    }

    structured.push(line);
  }

  return structured.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Creates a formatted Google Doc for a multi-source study guide.
 * Organizes content by source with section headers and colors matching the app UI.
 */
export async function createStudyGuideDoc(
  tref: string,
  summary: string,
  sourceResults: SourceResult[],
): Promise<{ id: string; url: string }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[GoogleDocs] Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REFRESH_TOKEN in env.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  console.info('[GoogleDocs] Authenticating with OAuth2 user token');

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const createResponse = await drive.files.create({
    requestBody: {
      name: `ביאור ${tref}`,
      mimeType: 'application/vnd.google-apps.document',
    },
    fields: 'id',
  });

  const documentId = createResponse.data.id;
  if (!documentId) {
    throw new Error('Google Drive API did not return a file ID.');
  }

  const styledRanges: StyledRange[] = [];
  let fullContent = '';
  let cursor = 1;

  // Track paragraph ranges for background shading
  const sourceParagraphs: { start: number; end: number; sourceKey: SourceResult['sourceKey'] }[] = [];
  const summaryParagraphs: { start: number; end: number }[] = [];

  const appendPlain = (text: string) => {
    fullContent += text;
    cursor += text.length;
  };

  const appendStyled = (text: string, style: StyledRange['style'], sourceKey?: SourceResult['sourceKey']) => {
    const start = cursor;
    fullContent += text;
    cursor += text.length;
    styledRanges.push({ start, end: cursor, style, sourceKey });
  };

  const appendBoldAware = (text: string, sourceKey?: SourceResult['sourceKey']) => {
    const { cleanText, ranges } = extractBoldRanges(text, cursor, sourceKey);
    fullContent += cleanText;
    cursor += cleanText.length;
    styledRanges.push(...ranges);
  };

  // --- Title ---
  const titleText = `ביאור הלכתי: ${tref}\n`;
  appendStyled(titleText, 'title');
  appendPlain('\n');

  // --- Source sections ---
  const sections = sourceResults.filter((sr) => sr.chunks.length > 0);

  sections.forEach((sr, sourceIndex) => {
    // Section header
    appendStyled(`${sr.hebrewLabel}\n`, 'sectionHeader', sr.sourceKey);

    // Separator line
    appendStyled('--------------------\n', 'separator', sr.sourceKey);

    sr.chunks.forEach((chunk, chunkIndex) => {
      const compactRaw = normalizeForDoc(chunk.rawText, true);
      const compactExplanation = normalizeForDoc(chunk.explanation);

      // Source text with label
      const sourceStart = cursor;
      appendStyled('מקור: ', 'sourceLabel', sr.sourceKey);
      appendPlain(`${compactRaw}\n`);
      sourceParagraphs.push({ start: sourceStart, end: cursor, sourceKey: sr.sourceKey });

      // Explanation
      appendBoldAware(`${compactExplanation}\n`, sr.sourceKey);

      if (chunkIndex < sr.chunks.length - 1) {
        appendPlain('\n');
      }
    });

    if (sourceIndex < sections.length - 1) {
      appendPlain('\n\n');
    }
  });

  // --- Summary ---
  appendPlain('\n');
  appendStyled('סיכום הלכה למעשה\n', 'summaryHeader');
  appendStyled('--------------------\n', 'separator');

  const compactSummary = structureSummaryForDoc(summary);
  if (compactSummary) {
    const summaryStart = cursor;
    appendBoldAware(`${compactSummary}\n`);
    summaryParagraphs.push({ start: summaryStart, end: cursor });
  } else {
    appendPlain('לא הופק סיכום.\n');
  }

  // --- Build requests ---
  const requests: docs_v1.Schema$Request[] = [
    {
      insertText: {
        location: { index: 1 },
        text: fullContent,
      },
    },
  ];

  if (cursor <= 1) {
    await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
    return { id: documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
  }

  // Global: RTL direction and base font
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: 1, endIndex: cursor },
      paragraphStyle: {
        lineSpacing: DOC_LINE_SPACING,
        spaceAbove: { magnitude: DOC_PARAGRAPH_SPACE_PT, unit: 'PT' },
        spaceBelow: { magnitude: DOC_PARAGRAPH_SPACE_PT, unit: 'PT' },
        direction: 'RIGHT_TO_LEFT',
      },
      fields: 'lineSpacing,spaceAbove,spaceBelow,direction',
    },
  });

  // Global: base font size and dark text color
  requests.push({
    updateTextStyle: {
      range: { startIndex: 1, endIndex: cursor },
      textStyle: {
        fontSize: { magnitude: DOC_FONT_SIZE_PT, unit: 'PT' },
        foregroundColor: { color: { rgbColor: COLOR_DARK } },
      },
      fields: 'fontSize,foregroundColor',
    },
  });

  // Apply styled ranges
  for (const range of styledRanges) {
    switch (range.style) {
      case 'title':
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              bold: true,
              fontSize: { magnitude: DOC_TITLE_FONT_SIZE_PT, unit: 'PT' },
              foregroundColor: { color: { rgbColor: COLOR_PRIMARY } },
            },
            fields: 'bold,fontSize,foregroundColor',
          },
        });
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            paragraphStyle: {
              alignment: 'CENTER',
              spaceBelow: { magnitude: 8, unit: 'PT' },
            },
            fields: 'alignment,spaceBelow',
          },
        });
        break;

      case 'sectionHeader': {
        const sectionPalette = getSourcePalette(range.sourceKey);
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              bold: true,
              fontSize: { magnitude: DOC_SECTION_FONT_SIZE_PT, unit: 'PT' },
              foregroundColor: { color: { rgbColor: sectionPalette.accent } },
            },
            fields: 'bold,fontSize,foregroundColor',
          },
        });
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            paragraphStyle: {
              spaceAbove: { magnitude: 12, unit: 'PT' },
              borderBottom: {
                color: { color: { rgbColor: sectionPalette.accent } },
                width: { magnitude: 1, unit: 'PT' },
                padding: { magnitude: 4, unit: 'PT' },
                dashStyle: 'SOLID',
              },
            },
            fields: 'spaceAbove,borderBottom',
          },
        });
        break;
      }

      case 'summaryHeader':
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              bold: true,
              fontSize: { magnitude: DOC_SECTION_FONT_SIZE_PT, unit: 'PT' },
              foregroundColor: { color: { rgbColor: COLOR_PRIMARY } },
            },
            fields: 'bold,fontSize,foregroundColor',
          },
        });
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            paragraphStyle: {
              spaceAbove: { magnitude: 16, unit: 'PT' },
              borderBottom: {
                color: { color: { rgbColor: COLOR_PRIMARY } },
                width: { magnitude: 2, unit: 'PT' },
                padding: { magnitude: 4, unit: 'PT' },
                dashStyle: 'SOLID',
              },
            },
            fields: 'spaceAbove,borderBottom',
          },
        });
        break;

      case 'separator': {
        const separatorPalette = getSourcePalette(range.sourceKey);
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              foregroundColor: { color: { rgbColor: separatorPalette.accent } },
              fontSize: { magnitude: 6, unit: 'PT' },
            },
            fields: 'foregroundColor,fontSize',
          },
        });
        break;
      }

      case 'sourceLabel': {
        const sourceLabelPalette = getSourcePalette(range.sourceKey);
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              bold: true,
              foregroundColor: { color: { rgbColor: sourceLabelPalette.accent } },
            },
            fields: 'bold,foregroundColor',
          },
        });
        break;
      }

      case 'bold': {
        const boldPalette = getSourcePalette(range.sourceKey);
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.start, endIndex: range.end },
            textStyle: {
              bold: true,
              foregroundColor: { color: { rgbColor: boldPalette.accent } },
            },
            fields: 'bold,foregroundColor',
          },
        });
        break;
      }
    }
  }

  // Background shading for source text paragraphs
  for (const para of sourceParagraphs) {
    const sourcePalette = getSourcePalette(para.sourceKey);
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: para.start, endIndex: para.end },
        paragraphStyle: {
          shading: { backgroundColor: { color: { rgbColor: sourcePalette.softBg } } },
          indentStart: { magnitude: 10, unit: 'PT' },
          indentEnd: { magnitude: 10, unit: 'PT' },
        },
        fields: 'shading,indentStart,indentEnd',
      },
    });
    // Source text in darker muted color
    requests.push({
      updateTextStyle: {
        range: { startIndex: para.start, endIndex: para.end },
        textStyle: {
          foregroundColor: { color: { rgbColor: sourcePalette.accent } },
        },
        fields: 'foregroundColor',
      },
    });
  }

  // Light background for summary section
  for (const para of summaryParagraphs) {
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: para.start, endIndex: para.end },
        paragraphStyle: {
          shading: { backgroundColor: { color: { rgbColor: COLOR_SUMMARY_BG } } },
          indentStart: { magnitude: 10, unit: 'PT' },
          indentEnd: { magnitude: 10, unit: 'PT' },
        },
        fields: 'shading,indentStart,indentEnd',
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
