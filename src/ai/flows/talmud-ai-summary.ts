'use server';
/**
 * @fileOverview Flow for summarizing study guides into Halacha Lema'aseh.
 * Includes Hebrew quality validation and repair logic.
 */

import { ai, generateTextWithFallback, getModelConfig } from '@/ai/genkit';
import { z } from 'genkit';
import { HEBREW_RATIO_THRESHOLD } from '@/lib/constants';

const TalmudAISummaryInputSchema = z.object({
  studyGuideText: z.string().describe('The complete text of the study guide.'),
  modelName: z.string().optional(),
  sources: z.array(z.string()).default(['shulchan_arukh']).describe('Source keys included in the guide.'),
});

export type TalmudAISummaryInput = z.infer<typeof TalmudAISummaryInputSchema>;

const TalmudAISummaryOutputSchema = z.object({
  summary: z.string().describe('Concise, bullet-point summary in Hebrew.'),
  modelUsed: z.string(),
  validated: z.boolean().default(true),
  validationErrors: z.array(z.string()).optional(),
});

export type TalmudAISummaryOutput = z.infer<typeof TalmudAISummaryOutputSchema>;

function validateSummary(text: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!text || text.trim().length === 0) {
    errors.push('הסיכום ריק.');
    return { valid: false, errors };
  }

  const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
  const ratio = hebrewChars.length / Math.max(text.length, 1);
  if (ratio < HEBREW_RATIO_THRESHOLD) {
    errors.push('אחוז העברית בסיכום נמוך מדי.');
  }

  const bulletRegex = /^\s*(?:[-*•]|\d+\.)\s+/m;
  if (!bulletRegex.test(text)) {
    errors.push('הסיכום חייב להיות בפורמט נקודות.');
  }

  return { valid: errors.length === 0, errors };
}

function buildSummaryPrompt(studyGuideText: string, sources: string[]) {
  const hasTur = sources.includes('tur');
  const hasBeitYosef = sources.includes('beit_yosef');
  const hasSA = sources.includes('shulchan_arukh');
  const hasMB = sources.includes('mishnah_berurah');

  let structureInstruction = '';

  if (hasSA && (hasTur || hasBeitYosef)) {
    structureInstruction += `\n## דעות ומקורות\nציין את הדעות השונות שהובאו (רמב"ם, רא"ש, רי"ף וכו'), עם ציון המקור (טור / בית יוסף).\n`;
    structureInstruction += `\n## פסיקת השולחן ערוך\nציין בקצרה באיזו שיטה פסק השולחן ערוך ומהי ההלכה שנפסקה.\n`;
  }

  if (hasMB) {
    structureInstruction += `\n## חידושי המשנה ברורה\nציין בנקודות את חידושיו, הערותיו המעשיות וכל הלכה נוספת שמביא.\n`;
  }

  return `אתה מומחה הלכה שמכין סיכום עבור תלמיד למבחן רבנות.
ענה בעברית בלבד.

כללים מחייבים:
- !!! חוק עליון !!! אסור בהחלט לכתוב שום משפט פתיחה, הקדמה, סיום, או הערת מטא. 
- רשימת ביטויים אסורים (גם לא בווריאציה): "בטח", "הנה", "סיכום מתוקן", "מנוסח מחדש", "בעברית תקינה", "בפורמט", "בהצלחה", "הנה הסיכום", "להלן", "כפי שביקשת".
- המילה הראשונה בתשובתך חייבת להיות חלק מהתוכן ההלכתי עצמו (דין, מקור, או כותרת).
- כתוב סיכום ברור, ממוקד, ותמציתי.
- כל נקודה צריכה להכיל: **הדין**, **המקור** (מי אמר), ו**ההכרעה למעשה**.
- אם יש מחלוקת: ציין את השיטות בקצרה, ואת מי פוסקים הלכה.
- הדגש מושגים חשובים ב-**bold**.
- אל תחזור על דברים שכבר כתובים.

## הלכות עיקריות
ציין כל הלכה כנקודה נפרדת עם הדין המעשי.
${structureInstruction}
## סיכום למעשה
שורה אחת עד שתיים: מה ההלכה למעשה בפועל.

טקסט מלא:
${studyGuideText}

סיכום:`;
}

/**
 * Strip any AI meta-commentary preamble from the beginning of the summary.
 * We remove lines that start with known meta-phrases until we hit real content.
 */
function stripMetaPrefix(text: string): string {
  const META_PATTERNS = [
    /^(בטח|הנה|להלן|כפי שביקשת)/,
    /סיכום מתוקן/,
    /מנוסח מחדש/,
    /בעברית תקינה/,
    /בפורמט של נקודות/,
    /הנה הסיכום/,
    /בהצלחה/,
    /^תוכן מתוקן:?\s*$/,
  ];

  const lines = text.split('\n');
  let startIdx = 0;

  // Skip leading meta-commentary lines
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { startIdx = i + 1; continue; }
    const isMeta = META_PATTERNS.some(p => p.test(trimmed));
    if (isMeta) {
      startIdx = i + 1;
    } else {
      break;
    }
  }

  return lines.slice(startIdx).join('\n').trim();
}

export async function summarizeTalmudStudyGuide(input: TalmudAISummaryInput): Promise<TalmudAISummaryOutput> {
  return talmudAISummaryFlow(input);
}

export const talmudAISummaryFlow = ai.defineFlow(
  {
    name: 'talmudAISummaryFlow',
    inputSchema: TalmudAISummaryInputSchema,
    outputSchema: TalmudAISummaryOutputSchema,
  },
  async (input): Promise<TalmudAISummaryOutput> => {
    const config = getModelConfig();
    const preferredModel = input.modelName || config.primary;

    const generated = await generateTextWithFallback({
      prompt: buildSummaryPrompt(input.studyGuideText, input.sources),
      preferredModel,
      maxRetries: 3,
      timeoutMs: 120_000,
    });

    let summary = stripMetaPrefix(generated.text);
    let modelUsed = generated.modelUsed;
    let validation = validateSummary(summary);

    if (!validation.valid) {
      const repairPrompt = `הסיכום הבא לא תקין: ${validation.errors.join(', ')}.
תקן בעברית בלבד ובפורמט נקודות. תתחיל ישר עם התוכן ההלכתי – בלי פתיח.

סיכום לא תקין:
${summary}

תוכן מתוקן:`;

      const repaired = await generateTextWithFallback({
        prompt: repairPrompt,
        preferredModel: modelUsed,
        maxRetries: 2,
        timeoutMs: 45_000,
      });

      summary = stripMetaPrefix(repaired.text);
      modelUsed = repaired.modelUsed;
      validation = validateSummary(summary);
    }

    return {
      summary,
      modelUsed,
      validated: validation.valid,
      validationErrors: validation.errors,
    };
  }
);
