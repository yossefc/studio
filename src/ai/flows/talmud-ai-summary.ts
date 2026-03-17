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
  summary: z.string().describe('Concise, structured summary in Hebrew.'),
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
    errors.push('הסיכום חייב לכלול נקודות מסודרות.');
  }

  if (!isTorahOhr && /הכרעה למעשה/u.test(text)) {
    errors.push('אין לכתוב את הביטוי "הכרעה למעשה" בסיכום.');
  }

  if (/מקור לא צוין/u.test(text)) {
    errors.push('אין לכתוב "מקור לא צוין" בסיכום.');
  }

  return { valid: errors.length === 0, errors };
}


function getStyleRules(isTorahOhr: boolean, hasMb: boolean = false): string {
  if (isTorahOhr) {
    return `אתה כותב סיכום קצר של מושגים רוחניים מתוך תורה אור.
ענה בעברית בלבד.

מבנה מחייב:
## <כותרת קצרה>
- מושג: הסבר קצר של המושג.
- משמעות: מה הנקודה הפנימית או העבודה העולה ממנו.
- תמצית: שורת סיכום קצרה.

כללים:
1. היה קצר, מדויק, וללא חזרות.
2. אין פתיחה ואין סיום.
3. עדיף שלוש שורות לכל נושא.
4. עד שישה נושאים לכל היותר.`;
  }

  const mbOpinionsLine = hasMb
    ? `- דעות המשנה ברורה: פרט כל פוסק המוזכר במשנה ברורה לנושא זה – שמו ודינו בקצרה (כולל ביאור הלכה, שיטת הרא"ש ואחרונים שמוזכרים).
`
    : '';

  return `אתה כותב סיכום לבחינת רבנות, מסודר לפי נושאים.
ענה בעברית בלבד.

מבנה מחייב — לכל נושא שעולה מהסעיף:
## <שם הנושא>
- נושא: משפט אחד קצר המגדיר את הנושא.
- דעות: עיקרי הדעות (ראשונים ואחרונים), מקובצות לפי שיטה. אם אין מחלוקת, כתוב זאת.
${mbOpinionsLine}- הלכה: פסיקת השולחן ערוך בשורה אחת ברורה ומעשית.
- רב עובדיה יוסף: פסיקתו של הרב עובדיה יוסף זצ"ל בנושא זה. אם לא ידועה הכרעה ספציפית, כתוב "אין הכרעה ידועה בנושא זה".

כללים:
1. צור כותרת נפרדת לכל דין עצמאי שעולה מהסעיף.
2. היה קצר, ממוקד, וללא חזרות.
3. אין פתיחה ואין סיום.
4. אל תכתוב "הכרעה למעשה".
5. עד שישה נושאים לכל היותר.`;
}

function getStructuredStyleRules(sources: string[], isTorahOhr: boolean): string {
  if (isTorahOhr) {
    return getStyleRules(true, false);
  }

  const hasMb = sources.includes('mishnah_berurah');
  // For all halachic sources: topic-based summary with Rav Ovadia's opinion
  return getStyleRules(false, hasMb);
}

function buildSummaryPrompt(studyGuideText: string, sources: string[]) {
  const isTorahOhr = sources.includes('torah_ohr');
  return `${getStructuredStyleRules(sources, isTorahOhr)}

מקורות שנכללו:
${sources.join(', ')}

דף הלימוד:
${studyGuideText}

כתוב עכשיו את הסיכום במבנה הנדרש בלבד.`;
}

function stripMetaPrefix(text: string): string {
  const META_PATTERNS = [
    /^(בטח|הנה|להלן|כפי שביקשת)/,
    /סיכום מתוקן/,
    /נוסח מחדש/,
    /בעברית תקינה/,
    /בפורמט של נקודות/,
    /הנה הסיכום/,
    /בהצלחה/,
    /^תוכן מתוקן:?\s*$/,
  ];

  const lines = text.split('\n');
  let startIdx = 0;

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      startIdx = i + 1;
      continue;
    }
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
    if (/^#/.test(line)) {
      output.push('');
      output.push(line);
      continue;
    }

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
      const repairPrompt = `הסיכום הבא אינו תקין: ${validation.errors.join(', ')}.
כתוב אותו מחדש לפי הכללים הבאים:
${getStructuredStyleRules(input.sources, isTorahOhr)}

סיכום לתיקון:
${summary}

כתוב רק את הסיכום המתוקן בעברית:`;

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
