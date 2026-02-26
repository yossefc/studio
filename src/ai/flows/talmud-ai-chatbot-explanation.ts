'use server';
/**
 * @fileOverview Genkit flow for generating contextual explanations of Jewish text segments.
 * Implements cache-first retrieval, Hebrew validation, and model fallback.
 */

import { ai, generateTextWithFallback, getModelCandidates, getModelConfig } from '@/ai/genkit';
import { z } from 'genkit';
import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/server/firebase-admin';
import { HEBREW_RATIO_THRESHOLD } from '@/lib/constants';

const PROMPT_VERSION = 'v3.4-rabbanut';

const SOURCE_LABELS: Record<string, string> = {
  tur: 'טור',
  beit_yosef: 'בית יוסף',
  shulchan_arukh: 'שולחן ערוך',
};

const TalmudAIChatbotExplanationInputSchema = z.object({
  currentSegment: z.string().describe('The current segment of text to be explained.'),
  previousSegments: z.array(z.string()).default([]).describe('Previous text segment for context.'),
  previousExplanations: z.array(z.string()).default([]).describe('Previous explanation for context.'),
  modelName: z.string().optional().describe('Preferred model name to use.'),
  normalizedTref: z.string().describe('The normalized Sefaria reference.'),
  chunkOrder: z.number().describe('The sequential order of this chunk.'),
  rawHash: z.string().describe('A hash of the current segment text.'),
  sourceKey: z.string().default('shulchan_arukh').describe('The source type: tur, beit_yosef, shulchan_arukh.'),
  companionText: z.string().optional().describe('Mishnah Berurah text to integrate alongside SA explanation.'),
});

export type TalmudAIChatbotExplanationInput = z.infer<typeof TalmudAIChatbotExplanationInputSchema>;

const TalmudAIChatbotExplanationOutputSchema = z.object({
  explanation: z.string().describe('AI-generated explanation.'),
  modelUsed: z.string().describe('The model name used.'),
  cacheHit: z.boolean().describe('True if retrieved from cache.'),
  promptVersion: z.string(),
  validated: z.boolean().default(true),
  durationMs: z.number().optional(),
});

export type TalmudAIChatbotExplanationOutput = z.infer<typeof TalmudAIChatbotExplanationOutputSchema>;

function validateHebrewOutput(text: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
  return hebrewChars.length / Math.max(text.length, 1) >= HEBREW_RATIO_THRESHOLD;
}

/* ---- Tref → Firestore path ---- */

function parseTrefForPath(normalizedTref: string): { sectionKey: string; siman: string; seif: string } {
  const lowerTref = normalizedTref.toLowerCase();
  let sectionKey = 'unknown';

  if (lowerTref.includes('orach chayim') || lowerTref.includes('mishnah berurah')) {
    sectionKey = 'orach_chayim'; // MB is only OC
  } else if (lowerTref.includes('yoreh deah')) {
    sectionKey = 'yoreh_deah';
  } else if (lowerTref.includes('even haezer')) {
    sectionKey = 'even_haezer';
  } else if (lowerTref.includes('choshen mishpat')) {
    sectionKey = 'choshen_mishpat';
  } else {
    // Fallback if structured differently
    const matchFallback = lowerTref.match(/^(.+?)\s+\d+/);
    if (matchFallback) {
      sectionKey = matchFallback[1].replace(/[^a-z0-9]+/g, '_');
    }
  }

  let siman = '0';
  let seif = '0';
  const match = normalizedTref.match(/(\d+)(?::(\d+))?[\s\w]*$/);

  if (match) {
    siman = match[1] || '0';
    seif = match[2] || '0';
  }

  return { sectionKey, siman, seif };
}

/** Build Firestore path for the new rabanout structure. */
function rabanutDocPath(input: { normalizedTref: string; sourceKey: string; chunkOrder: number }): string {
  const { sectionKey, siman, seif } = parseTrefForPath(input.normalizedTref);
  return `rabanout/${sectionKey}/${siman}/${seif}/${input.sourceKey}/${input.chunkOrder}`;
}

/** Legacy hash-based cache key (for reading old entries). */
function generateLegacyCacheKey(input: TalmudAIChatbotExplanationInput, modelName: string): string {
  const data = `${input.sourceKey}|${input.normalizedTref}|${input.chunkOrder}|${input.rawHash}|${PROMPT_VERSION}|${modelName}`;
  return createHash('sha256').update(data).digest('hex');
}

export async function explainTalmudSegment(
  input: TalmudAIChatbotExplanationInput
): Promise<TalmudAIChatbotExplanationOutput> {
  return talmudAIChatbotExplanationFlow(input);
}

export const talmudAIChatbotExplanationFlow = ai.defineFlow(
  {
    name: 'talmudAIChatbotExplanationFlow',
    inputSchema: TalmudAIChatbotExplanationInputSchema,
    outputSchema: TalmudAIChatbotExplanationOutputSchema,
  },
  async (input): Promise<TalmudAIChatbotExplanationOutput> => {
    const startTime = Date.now();
    const firestore = getAdminDb();
    const config = getModelConfig();
    const preferredModel = input.modelName || config.primary;
    const candidates = getModelCandidates(preferredModel);

    // --- 1) Check NEW rabanout structure first ---
    const rabanutPath = rabanutDocPath(input);
    try {
      const rabanutSnap = await firestore.doc(rabanutPath).get();
      if (rabanutSnap.exists) {
        const data = rabanutSnap.data();
        if (data?.explanationText && data?.rawHash === input.rawHash && data?.promptVersion === PROMPT_VERSION) {
          console.info(`[Flow-Cache] Rabanout hit chunk=${input.chunkOrder} tref=${input.normalizedTref}`);
          return {
            explanation: data.explanationText,
            modelUsed: data.modelName || 'cached',
            cacheHit: true,
            promptVersion: data.promptVersion,
            validated: data.validated ?? true,
            durationMs: Date.now() - startTime,
          };
        }
      }
    } catch (error) {
      console.warn('[Flow-Cache] Rabanout read error:', error);
    }

    // --- 2) Fallback: check legacy explanationCacheEntries ---
    for (const candidateModel of candidates) {
      const cacheKey = generateLegacyCacheKey(input, candidateModel);
      const cacheRef = firestore.collection('explanationCacheEntries').doc(cacheKey);
      try {
        const cacheSnap = await cacheRef.get();
        if (!cacheSnap.exists) continue;
        const data = cacheSnap.data();
        if (!data?.explanationText || !data?.modelName) continue;

        console.info(`[Flow-Cache] Legacy hit chunk=${input.chunkOrder} tref=${input.normalizedTref} model=${data.modelName}`);

        // Migrate to new structure
        try {
          await firestore.doc(rabanutPath).set({
            rawText: input.currentSegment,
            explanationText: data.explanationText,
            rawHash: input.rawHash,
            sourceKey: input.sourceKey,
            chunkOrder: input.chunkOrder,
            modelName: data.modelName,
            promptVersion: data.promptVersion || PROMPT_VERSION,
            validated: data.validated ?? true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } catch (e) { console.warn('[Flow-Cache] Migration write error:', e); }

        return {
          explanation: data.explanationText,
          modelUsed: data.modelName,
          cacheHit: true,
          promptVersion: data.promptVersion || PROMPT_VERSION,
          validated: data.validated ?? true,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        console.warn('[Flow-Cache] Legacy read error:', error);
      }
    }

    const contextPrompt = input.previousSegments.length > 0
      ? `הקשר קודם (N-1 בלבד):\nמקור: ${input.previousSegments[0]}\nביאור: ${input.previousExplanations[0] || ''}\n---\n`
      : '';

    const sourceLabel = SOURCE_LABELS[input.sourceKey] || 'שולחן ערוך';

    const companionSection = input.companionText
      ? `\nמשנה ברורה על הסעיף:\n${input.companionText}\n\nלאחר ביאור ה${sourceLabel}, הוסף סעיף נפרד בכותרת "משנה ברורה:" וציין בנקודות קצרות את חידושי המשנה ברורה, הערותיו, ופסיקותיו המעשיות. ציין מספר ס"ק כשידוע.\n`
      : '';

    const beitYosefAddition = input.sourceKey === 'beit_yosef'
      ? `\nהוספה לבית יוסף: בסוף כל דעה כתוב שורת סיכום קצרה של אותה דעה. אם כמה דעות אומרות אותו עיקרון, קבץ אותן יחד תחת סיכום משותף.\n`
      : '';

    const basePrompt = `אתה מסביר תורני מקצועי. הקהל הוא תלמיד המתכונן למבחן רבנות.
ענה בעברית בלבד.

מטרתך היא מינימליזם מוחלט: להסביר *אך ורק* מה שבאמת דורש הסבר. אל תאריך במילים ואל תפרש טקסט שמובן מאליו!

כללים מחייבים:
1. העתק את כל מילות המקור לפי הסדר, בלי לדלג על אף מילה. הדגש כל מילת מקור בפורמט **bold**.
2. **התערבות מינימלית (חובה):** הוסף הסבר קצר (כהמשך ישיר של המשפט, ללא סוגריים) **אך ורק** בשלושת המקרים הבאים:
   - **ארמית:** תרגם והסבר קטעים בארמית בעברית פשוטה.
   - **מושגים מורכבים:** באר ביטויים קשים, נדירים או לא ברורים.
   - **השלמת הקשר:** הוסף רקע קצרצר רק במקום שבו הטקסט חסר או לא מובן ללא ההקשר.
   *אם המשפט המקורי מובן וברור בעברית - אל תוסיף לו אפילו מילה אחת של הסבר! פשוט העתק אותו מודגש והמשך הלאה.*
3. פתח ראשי תיבות לידם, בלי סוגריים (לדוגמה: **מ"ב** משנה ברורה).
4. כשמוזכר פוסק/דעה: ציין מפורש מי אומר, ומהיכן הוא (לדוגמה: **הרמב"ם** פוסק ש... כמובא ב**טור**).
5. חוק עליון - ללא תוספות: אל תכתוב פתיח, סיום, הערות, או הקדמה (אסור לכתוב "בטח", "הנה"). תתחיל ישר עם הטקסט.
6. אל תוסיף דעות או מקורות שלא מוזכרים בטקסט המקור.

${beitYosefAddition}${contextPrompt}${companionSection}
מקור להסבר (${sourceLabel}):
${input.currentSegment}

ביאור מינימליסטי וממוקד:`;

    const generated = await generateTextWithFallback({
      prompt: basePrompt,
      preferredModel,
      maxRetries: 3,
      timeoutMs: 120_000,
    });

    let explanation = generated.text;
    let modelUsed = generated.modelUsed;
    let validated = validateHebrewOutput(explanation);

    if (!validated) {
      const repairPrompt = `הטקסט הבא לא עומד בדרישת עברית.
שכתב אותו בעברית בלבד, עם אותו סדר תוכן והדגשות **bold** למילות מקור.

טקסט לתיקון:
${explanation}

טקסט מתוקן:`;

      const repaired = await generateTextWithFallback({
        prompt: repairPrompt,
        preferredModel: modelUsed,
        maxRetries: 2,
        timeoutMs: 90_000,
      });

      explanation = repaired.text;
      modelUsed = repaired.modelUsed;
      validated = validateHebrewOutput(explanation);
    }

    // --- Write to NEW rabanout structure ---
    try {
      await firestore.doc(rabanutPath).set({
        rawText: input.currentSegment,
        explanationText: explanation,
        rawHash: input.rawHash,
        sourceKey: input.sourceKey,
        chunkOrder: input.chunkOrder,
        modelName: modelUsed,
        promptVersion: PROMPT_VERSION,
        validated,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('[Flow-Cache] Rabanout write error:', error);
    }

    const durationMs = Date.now() - startTime;
    console.info('[Flow-Exec] Completed', {
      tref: input.normalizedTref,
      chunkOrder: input.chunkOrder,
      modelUsed,
      durationMs,
      cacheHit: false,
    });

    return {
      explanation,
      modelUsed,
      cacheHit: false,
      promptVersion: PROMPT_VERSION,
      validated,
      durationMs,
    };
  }
);
