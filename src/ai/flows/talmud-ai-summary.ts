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

  const bulletRegex = /^\s*(?:[-*]|\u2022|\d+\.)\s+/m;
  if (!bulletRegex.test(text)) {
    errors.push('הסיכום חייב להיות בפורמט נקודות.');
  }
  if (!/\(מקור ההלכה:\s*[^)]+\)/u.test(text) && !/\([^)]+\)/u.test(text)) {
    // We check for some sort of source format at the end of the text.
    // The new prompt uses (לדוגמה: "... (רמב"ם)") so we check for parentheses.
    errors.push('חסר פורמט "(שם הפוסק/המקור)" בסוף ההלכה כנדרש בסיכום.');
  }

  if (/הכרעה למעשה/u.test(text)) {
    errors.push('אין לכלול את הביטוי "הכרעה למעשה" בסיכום.');
  }

  return { valid: errors.length === 0, errors };
}

function buildSummaryPrompt(studyGuideText: string, sources: string[]) {
  return `אתה מומחה הלכה שמכין סיכום ממוקד עבור תלמיד למבחן רבנות.
ענה בעברית בלבד.

כללים מחייבים לסיכום:
1. **חלוקה לנושאים:** ייתכן שהטקסט עוסק במספר נושאים. ציין כל נושא בנפרד והסבר בקצרה במה מדובר.
2. **ריבוי דעות (מחלוקת):** אם יש מחלוקת בנושא, פרט בקצרה את הדעות השונות (מי אומר מה), ובסוף ציין בבירור מהי ההלכה למעשה.
3. **דעה יחידה (ללא מחלוקת):** אם בנושא מסוים יש רק דעה אחת, פוסק אחד, או שאין מחלוקת כלל – פשוט כתוב את הדין/ההלכה באופן ישיר, וציין את שם הפוסק או המקור בסוגריים בלבד בסוף המשפט (לדוגמה: "... (רמב"ם)").
4. **מבנה והדגשות:** ערוך את הסיכום ברשימת נקודות (bullets). הדגש ב-**bold** את שמות הפוסקים ומילות מפתח/מקור חשובות.
5. **חוק עליון - ללא תוספות:** אסור לכתוב פתיח, סיום או הערות מטא (כגון "הנה הסיכום", "להלן הנושאים"). התחל את התשובה ישירות עם הנושא הראשון.

טקסט מלא לעיבוד:
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

function normalizeSummaryFormat(text: string): string {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^\s*##\s*הכרעה למעשה\b/u.test(line))
    .filter(line => !/^\s*הכרעה למעשה\s*:?\s*$/u.test(line));

  const output: string[] = [];

  for (const line of lines) {
    // If it's a heading for a topic, just push it
    if (/^#/.test(line)) {
      output.push('');
      output.push(line);
      continue;
    }

    // Try to ensure some sort of source attribution if it looks like a bullet
    const bulletRegex = /^(?:[-*]|\u2022|\d+\.)\s+(.+)$/u;
    const bulletMatch = line.match(bulletRegex);

    if (bulletMatch) {
      let body = line.trim();
      if (!/\([^)]+\)/u.test(body)) {
        body = `${body} (מקור לא צוין)`;
      }
      output.push(body);
    } else {
      output.push(line);
    }
  }

  return output.join('\n').trim();
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

    let summary = normalizeSummaryFormat(stripMetaPrefix(generated.text));
    let modelUsed = generated.modelUsed;
    let validation = validateSummary(summary);

    if (!validation.valid) {
      const repairPrompt = `הסיכום הבא לא תקין: ${validation.errors.join(', ')}.
תקן בעברית בלבד ובפורמט נקודות, תוך שמירה על הכללים הבאים:
1. **חלוקה לנושאים:** ייתכן שהטקסט עוסק במספר נושאים. ציין כל נושא בנפרד והסבר בקצרה במה מדובר.
2. **ריבוי דעות (מחלוקת):** אם יש מחלוקת בנושא, פרט בקצרה את הדעות השונות (מי אומר מה), ובסוף ציין בבירור מהי ההלכה למעשה.
3. **דעה יחידה (ללא מחלוקת):** אם בנושא מסוים יש רק דעה אחת, פוסק אחד, או שאין מחלוקת כלל – פשוט כתוב את הדין/ההלכה באופן ישיר, וציין את שם הפוסק או המקור בסוגריים בלבד בסוף המשפט (לדוגמה: "... (רמב"ם)").
4. **מבנה והדגשות:** ערוך את הסיכום ברשימת נקודות (bullets). הדגש ב-**bold** את שמות הפוסקים ומילות מפתח/מקור חשובות.
5. **חוק עליון - ללא תוספות:** אסור לכתוב פתיח, סיום או הערות מטא. התחל את התשובה ישירות עם הנושא הראשון.

סיכום לא תקין:
${summary}

תוכן מתוקן:`;

      const repaired = await generateTextWithFallback({
        prompt: repairPrompt,
        preferredModel: modelUsed,
        maxRetries: 2,
        timeoutMs: 45_000,
      });

      summary = normalizeSummaryFormat(stripMetaPrefix(repaired.text));
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

