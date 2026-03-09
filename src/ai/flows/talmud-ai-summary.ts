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

function validateSummary(text: string, isTorahOhr: boolean = false): { valid: boolean; errors: string[] } {
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
  if (!isTorahOhr && !/\(מקור ההלכה:\s*[^)]+\)/u.test(text) && !/\([^)]+\)/u.test(text)) {
    // We check for some sort of source format at the end of the text.
    // The new prompt uses (לדוגמה: "... (רמב"ם)") so we check for parentheses.
    errors.push('חסר פורמט "(שם הפוסק/המקור)" בסוף ההלכה כנדרש בסיכום.');
  }

  if (!isTorahOhr && /הכרעה למעשה/u.test(text)) {
    errors.push('אין לכלול את הביטוי "הכרעה למעשה" בסיכום.');
  }

  if (/מקור לא צוין/u.test(text)) {
    errors.push('אין לכתוב "(מקור לא צוין)" בסיכום.');
  }

  return { valid: errors.length === 0, errors };
}

function buildHalakhicSummaryStructure(sources: string[]): string {
  const sections: string[] = [];

  if (sources.includes('tur')) {
    sections.push(`## דברי הטור
- סכם בקצרה את יסוד הדין, ההגדרה, והכיוון המעשי של הטור (טור).`);
  }

  if (sources.includes('beit_yosef')) {
    sections.push(`## שיטות הבית יוסף
- סדר את הדעות המרכזיות בקצרה, עם קיבוץ דעות דומות לאותו מהלך (בית יוסף).
- אם אין מחלוקת ממשית, כתוב זאת במפורש בשורה קצרה (בית יוסף).`);
  }

  if (sources.includes('shulchan_arukh')) {
    sections.push(`## פסק השולחן ערוך
- כתוב את ההכרעה של השולחן ערוך בצורה ברורה, קצרה ומעשית (שולחן ערוך).`);
  }

  if (sources.includes('mishnah_berurah')) {
    sections.push(`## חידושי המשנה ברורה
- ציין בקצרה את ההוספות המעשיות, החילוקים וההסתייגויות של המשנה ברורה (משנה ברורה).`);
  }

  sections.push(`## סיכום והכרעה
- כתוב את השורה התחתונה למעשה, וציין בקצרה מי מחמיר, מי מקל, ומה נפסק (סיכום).`);

  return sections.join('\n\n');
}

function getStyleRules(isTorahOhr: boolean): string {
  if (isTorahOhr) {
    return `You are writing a concise summary of spiritual concepts from Torah Ohr (Hassidut).
Output language: Hebrew only.

Mandatory format (repeat per topic):
## <כותרת נושא רוחני קצרה>
- מושג: הסבר קצר של המושג (עד ~18 מילים).
- משמעות: מה המשמעות הרוחנית או העבודה הפנימית הנדרשת בקצרה.
- תמצית: שורת סיכום קצרה.

Strict constraints:
1) Keep it short, focused on spiritual growth and Kabbalistic/Hassidic concepts.
2) No repetition between lines or topics.
3) No intro or outro text.
4) Prefer exactly 3 lines per topic (מושג, משמעות, תמצית).
5) Maximum 6 topics total.`;
  }

  return `You are writing a concise Rabanut exam summary.
Output language: Hebrew only.

Mandatory format (repeat per topic):
## <כותרת נושא קצרה>
- נושא: משפט אחד קצר וברור (עד ~18 מילים).
- דעות: רק עיקרי הדעות בקיצור. אם כמה פוסקים באותה דעה, לקבץ באותה שורה עם כל השמות יחד.
- הלכה: שורה אחת ברורה וקצרה, ובסופה מקור בסוגריים.

Strict constraints:
1) Keep it short and practical. No long explanations.
2) No repetition between lines or topics.
3) Do not write "(מקור לא צוין)".
4) Do not write "הכרעה למעשה".
5) No intro or outro text.
6) Prefer 3 lines per topic exactly (נושא, דעות, הלכה).
7) If there is no real מחלוקת, write in "דעות" that there is no practical dispute in one short line.
8) Maximum 6 topics total.`;
}

function getStructuredStyleRules(sources: string[], isTorahOhr: boolean): string {
  if (isTorahOhr) {
    return getStyleRules(true);
  }

  return `You are writing a concise metivta-style Rabanut exam summary.
Output language: Hebrew only.

Mandatory structure:
${buildHalakhicSummaryStructure(sources)}

Strict constraints:
1) Keep it short, structured, and practical. No long explanations.
2) Group similar views together instead of repeating them.
3) If there is no real מחלוקת, say so explicitly in one short bullet.
4) Do not write "(מקור לא צוין)".
5) Do not write "הכרעה למעשה".
6) No intro or outro text.
7) Keep the order of the sections exactly as requested.
8) End with a short bottom line in the section "סיכום והכרעה".`;
}

function buildSummaryPrompt(studyGuideText: string, sources: string[]) {
  const isTorahOhr = sources.includes('torah_ohr');
  return `${getStructuredStyleRules(sources, isTorahOhr)}

Included sources: ${sources.join(', ')}

Study guide text:
${studyGuideText}

Now produce the summary in the required format.`;
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

    // Keep bullet lines concise; do not auto-insert "(מקור לא צוין)".
    const bulletRegex = /^(?:[-*]|\u2022|\d+\.)\s+(.+)$/u;
    const bulletMatch = line.match(bulletRegex);

    if (bulletMatch) {
      output.push(line.trim());
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

    const isTorahOhr = input.sources.includes('torah_ohr');

    const generated = await generateTextWithFallback({
      prompt: buildSummaryPrompt(input.studyGuideText, input.sources),
      preferredModel,
      maxRetries: 3,
      timeoutMs: 120_000,
    });

    let summary = normalizeSummaryFormat(stripMetaPrefix(generated.text));
    let modelUsed = generated.modelUsed;
    let validation = validateSummary(summary, isTorahOhr);

    if (!validation.valid) {
      const repairPrompt = `The summary is invalid: ${validation.errors.join(', ')}.
Rewrite it using the exact same information but following these strict rules:
${getStructuredStyleRules(input.sources, isTorahOhr)}

Invalid summary:
${summary}

Rewritten summary (Hebrew only):`;

      const repaired = await generateTextWithFallback({
        prompt: repairPrompt,
        preferredModel: modelUsed,
        maxRetries: 2,
        timeoutMs: 45_000,
      });

      summary = normalizeSummaryFormat(stripMetaPrefix(repaired.text));
      modelUsed = repaired.modelUsed;
      validation = validateSummary(summary, isTorahOhr);
    }

    return {
      summary,
      modelUsed,
      validated: validation.valid,
      validationErrors: validation.errors,
    };
  }
);
