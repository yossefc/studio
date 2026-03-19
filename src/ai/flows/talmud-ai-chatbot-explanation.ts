'use server';
/**
 * @fileOverview Genkit flow for generating contextual explanations of Jewish text segments.
 * Implements cache-first retrieval, Hebrew validation, and model fallback.
 */

import { createHash } from 'crypto';

import { z } from 'genkit';
import { FieldValue } from 'firebase-admin/firestore';

import { ai, generateTextWithFallback, getModelCandidates, getModelConfig } from '@/ai/genkit';
import { HEBREW_RATIO_THRESHOLD } from '@/lib/constants';
import { getAdminDb } from '@/server/firebase-admin';

const PROMPT_VERSION = 'v4.3-metivta-per-source';

const SOURCE_LABELS: Record<string, string> = {
  tur: 'טור',
  beit_yosef: 'בית יוסף',
  shulchan_arukh: 'שולחן ערוך',
  mishnah_berurah: 'משנה ברורה',
  rav_ovadia: 'רב עובדיה יוסף',
  torah_ohr: 'תורה אור',
};

const TalmudAIChatbotExplanationInputSchema = z.object({
  currentSegment: z.string().describe('The current segment of text to be explained.'),
  previousSegments: z.array(z.string()).default([]).describe('Previous text segment for context.'),
  previousExplanations: z.array(z.string()).default([]).describe('Previous explanation for context.'),
  modelName: z.string().optional().describe('Preferred model name to use.'),
  normalizedTref: z.string().describe('The normalized Sefaria reference.'),
  chunkOrder: z.number().describe('The sequential order of this chunk.'),
  rawHash: z.string().describe('A hash of the current segment text.'),
  sourceKey: z.string().default('shulchan_arukh').describe('The source type: tur, beit_yosef, shulchan_arukh, torah_ohr.'),
  companionText: z.string().optional().describe('Mishnah Berurah text to integrate alongside SA explanation.'),
});

export type TalmudAIChatbotExplanationInput = z.infer<typeof TalmudAIChatbotExplanationInputSchema>;

const UsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});

const TalmudAIChatbotExplanationOutputSchema = z.object({
  explanation: z.string().describe('AI-generated explanation.'),
  modelUsed: z.string().describe('The model name used.'),
  cacheHit: z.boolean().describe('True if retrieved from cache.'),
  promptVersion: z.string(),
  validated: z.boolean().default(true),
  durationMs: z.number().optional(),
  usage: UsageSchema,
});

export type TalmudAIChatbotExplanationOutput = z.infer<typeof TalmudAIChatbotExplanationOutputSchema>;

function mergeUsage(
  left: TalmudAIChatbotExplanationOutput['usage'],
  right: TalmudAIChatbotExplanationOutput['usage'],
): TalmudAIChatbotExplanationOutput['usage'] {
  return {
    inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
    totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0),
  };
}

function getMetivtaStyleInstructions(): string {
  return `כללי סגנון מחייבים לכל המקורות:
- אין לכתוב פתיחה כללית, סיום כללי, או הערות מטא.
- בכל קטע יש להעתיק את מילות המקור ברצף ובלי דילוגים (מודגשות ב-**bold**).
- הסבר כל ביטוי קשה או סברא מיד לאחר התיבות הקשורות אליו, כהמשך ישיר.
- דאג שהקריאה תהיה שוטפת, בדומה למבנה מהדורת "שטיינזלץ" או רש"י.`;
}

function getSourceSpecificInstructions(sourceKey: string): string {
  switch (sourceKey) {
    case 'tur':
      return `הוראות מיוחדות לטור:
- שלב את מילות הטור בתוך ההסבר.
- באר בדיוק את שיטת הטור ואת שיטות הראשונים המובאות בו.
- אם מובאת דעה חולקת ("ויש אומרים"), באר אותה ואת טעמה מיד לאחר מילותיה.
- הסבר כל הכרעה או סיכום שהטור מביא בסוף הקטע.`;
    case 'beit_yosef':
      return `הוראות מיוחדות לבית יוסף:
- שלב את דברי הבית יוסף בביאור משולב (מילות בית יוסף מודגשות).
- חובה! קבץ יחד שיטות שאינן חולקות (שאומרות את אותו היסוד), והבא אותן במהלך אחד.
- הצג והסבר כל שיטה שחולקת על חברתה בנפרד, עם סיכום קצר המחדד את ההבדל ביניהן.
- כאשר מובאות שיטות מרובות בבית יוסף, דאג להסביר בבירור כל שיטה היכן שהיא מוזכרת בטקסט.
- ציין בעדינות אם נראה שהבית יוסף מסכים לשיטה מסוימת מתוך לשונו.`;
    case 'shulchan_arukh':
      return `הוראות מיוחדות לשולחן ערוך:
- שלב את פסק השולחן ערוך (המחבר) במלואו.
- כתוב את ביאור הפסק בצורה חדה ומעשית.
- אם הפסק בנוי על שיטה מסוימת שנידונה קודם בבית יוסף, ציין זאת בקצרה בביאור.`;
    case 'mishnah_berurah':
      return `הוראות מיוחדות למשנה ברורה:
- שלב את דברי המשנה ברורה במלואם.
- הדגש בביאור אם המשנה ברורה בא לצמצם, להרחיב או לדחות את דברי השולחן ערוך.
- הוסף ציונים לסעיפים קטנים (ס"ק) אם הם ידועים מהטקסט המקורי.`;
    default:
      return 'הקפד על עיקרון הביאור המשולב (מילות מקור ב-**bold**).';
  }
}

function validateHebrewOutput(text: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
  return hebrewChars.length / Math.max(text.length, 1) >= HEBREW_RATIO_THRESHOLD;
}

function normalizeForRewriteCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySourceRewrite(source: string, output: string): boolean {
  const src = normalizeForRewriteCheck(source);
  const out = normalizeForRewriteCheck(output);

  if (!src || !out || out.length < 120) {
    return false;
  }

  const srcTokens = src.split(' ').filter((token) => token.length > 1);
  const outTokens = out.split(' ').filter((token) => token.length > 1);
  if (outTokens.length < 24) {
    return false;
  }

  const srcSet = new Set(srcTokens);
  let overlapCount = 0;
  for (const token of outTokens) {
    if (srcSet.has(token)) {
      overlapCount += 1;
    }
  }

  const overlapRatio = overlapCount / outTokens.length;
  const startsWithSourcePrefix = src.startsWith(out.slice(0, 80));
  const sourceContainsOpening = src.includes(out.slice(0, 100));

  return overlapRatio > 0.82 || startsWithSourcePrefix || sourceContainsOpening;
}

function parseTrefForPath(normalizedTref: string): { sectionKey: string; siman: string; seif: string } {
  const lowerTref = normalizedTref.toLowerCase();
  let sectionKey = 'unknown';

  if (lowerTref.includes('orach chayim') || lowerTref.includes('mishnah berurah')) {
    sectionKey = 'orach_chayim';
  } else if (lowerTref.includes('yoreh deah')) {
    sectionKey = 'yoreh_deah';
  } else if (lowerTref.includes('even haezer')) {
    sectionKey = 'even_haezer';
  } else if (lowerTref.includes('choshen mishpat')) {
    sectionKey = 'choshen_mishpat';
  } else if (lowerTref.includes('torah ohr')) {
    sectionKey = 'torah_ohr';
  } else {
    const matchFallback = lowerTref.match(/^(.+?)\s+\d+/);
    if (matchFallback) {
      sectionKey = matchFallback[1].replace(/[^a-z0-9]+/g, '_');
    }
  }

  let siman = '0';
  let seif = '0';

  if (sectionKey === 'torah_ohr') {
    const withoutPrefix = lowerTref.replace('torah ohr,', '').trim();
    const parts = withoutPrefix.split(/\s+/);
    siman = parts[0] ? parts[0].replace(/[^\u0590-\u05FFa-z0-9]+/g, '_') : 'unknown';
    seif = parts[1] ? parts[1].replace(/[^\u0590-\u05FFa-z0-9]+/g, '_') : '0';
  } else {
    const match = normalizedTref.match(/(\d+)(?::(\d+))?[\s\w]*$/);
    if (match) {
      siman = match[1] || '0';
      seif = match[2] || '0';
    }
  }

  return { sectionKey, siman, seif };
}

function rabanutDocPath(input: { normalizedTref: string; sourceKey: string; chunkOrder: number }): string {
  const { sectionKey, siman, seif } = parseTrefForPath(input.normalizedTref);
  return `rabanout/${sectionKey}/${siman}/${seif}/${input.sourceKey}/${input.chunkOrder}`;
}

function generateLegacyCacheKey(input: TalmudAIChatbotExplanationInput, modelName: string): string {
  const data = `${input.sourceKey}|${input.normalizedTref}|${input.chunkOrder}|${input.rawHash}|${PROMPT_VERSION}|${modelName}`;
  return createHash('sha256').update(data).digest('hex');
}

export async function explainTalmudSegment(
  input: TalmudAIChatbotExplanationInput,
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
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        }
      }
    } catch (error) {
      console.warn('[Flow-Cache] Rabanout read error:', error);
    }

    for (const candidateModel of candidates) {
      const cacheKey = generateLegacyCacheKey(input, candidateModel);
      const cacheRef = firestore.collection('explanationCacheEntries').doc(cacheKey);
      try {
        const cacheSnap = await cacheRef.get();
        if (!cacheSnap.exists) {
          continue;
        }

        const data = cacheSnap.data();
        if (!data?.explanationText || !data?.modelName) {
          continue;
        }

        console.info(`[Flow-Cache] Legacy hit chunk=${input.chunkOrder} tref=${input.normalizedTref} model=${data.modelName}`);

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
        } catch (e) {
          console.warn('[Flow-Cache] Migration write error:', e);
        }

        return {
          explanation: data.explanationText,
          modelUsed: data.modelName,
          cacheHit: true,
          promptVersion: data.promptVersion || PROMPT_VERSION,
          validated: data.validated ?? true,
          durationMs: Date.now() - startTime,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      } catch (error) {
        console.warn('[Flow-Cache] Legacy read error:', error);
      }
    }

    const contextPrompt = input.previousSegments.length > 0
      ? `הקשר קודם:
מקור קודם: ${input.previousSegments[0]}
ביאור קודם: ${input.previousExplanations[0] || ''}
---`
      : '';

    const sourceLabel = SOURCE_LABELS[input.sourceKey] || 'שולחן ערוך';

    const companionSection = input.companionText
      ? `תוספת מן המשנה ברורה:
${input.companionText}

לאחר ביאור ${sourceLabel}, הוסף כותרת נפרדת בדיוק כך: "משנה ברורה".
תחת כותרת זו סדר בקצרה:
- חידושים עיקריים,
- הסתייגויות והגבלות,
- נקודות מעשיות ונפקא מינות,
- ואם ידוע מן הטקסט, גם ציון ס"ק.`
      : '';

    const beitYosefAddition = input.sourceKey === 'beit_yosef'
      ? `הוראה נוספת לבית יוסף:
- בסוף כל שיטה כתוב שורת סיכום קצרה.
- אם כמה דעות אומרות אותו יסוד, קבץ אותן תחת מהלך אחד.`
      : '';

    const manualInputAddition = /saisie manuelle|manual/i.test(input.normalizedTref)
      ? `הטקסט הוזן ידנית. לכן חובה לכתוב ביאור עצמאי, ולא לחזור על הנוסח הנתון.`
      : '';

    const structuredCompanionSection = companionSection ? `\n${companionSection}` : '';
    const structuredBeitYosefAddition = beitYosefAddition ? `\n${beitYosefAddition}` : '';
    const structuredManualAddition = manualInputAddition ? `\n${manualInputAddition}` : '';

    let basePrompt = '';

    if (input.sourceKey === 'torah_ohr') {
      basePrompt = `אתה מבאר חסידות בסגנון ישיבתי בהיר.
ענה בעברית בלבד.

מטרה:
לבאר את הקטע באופן רציף, עמוק, ומסודר, כך שהלומד יבין את המושגים, את המהלך, ואת הקשר בין חלקי הדברים.

כללים:
- אל תחזור על המקור בלשון דומה, אלא באר אותו.
- פתח ראשי תיבות ומונחים קבליים.
- הסבר כל נקודה בלשון בהירה וקצרה.
- אל תכתוב פתיחה וסיום כלליים.
- שמור על רצף לימודי טבעי.

${contextPrompt}

הקטע לביאור (${sourceLabel}):
${input.currentSegment}

כתוב עכשיו ביאור עברי רציף, ברור, ומעמיק בסגנון מתיבתא:`;
    } else if (input.sourceKey === 'mishnah_berurah') {
      basePrompt = `אתה מסביר תורני מומחה, הכותב ביאור של המשנה ברורה בסגנון מתיבתא.
ענה בעברית בלבד.

**חוק עליון:** אל תכתוב פתיח, סיום, או הערות מטא. התחל ישירות בביאור.

כללים מחייבים:
1. **סגנון משולב (מתיבתא):** העתק את כל מילות המקור לפי הסדר (ללא דילוגים), הדגש כל מילת מקור ב-**bold**. הוסף הסבר כהמשך טבעי וזורם של המשפט (לא בסוגריים). אם המילה ברורה – המשך בלי להוסיף כלום.
2. **תרגום וראשי תיבות:** תרגם קטעים בארמית לעברית פשוטה מיד אחריהם. פתח ראשי תיבות במלואם.
3. **יחס לשולחן ערוך:** כאשר המשנה ברורה מצמצם, מרחיב, או חולק על פסק השולחן ערוך – ציין זאת במפורש.
4. **ס"ק:** אם ידוע מספר הסעיף הקטן מן הטקסט – ציין אותו.
5. כאשר מובאות כמה דעות – הסבר כל שיטה בנפרד עם שם בעליה וטעמה.

${contextPrompt}
${structuredCompanionSection}

מקור להסבר (${sourceLabel}):
${input.currentSegment}

ביאור משולב:`;
        } else {
      const sourceInstructionsSection = (input.sourceKey === 'tur' || input.sourceKey === 'shulchan_arukh')
        ? `\n\n${getMetivtaStyleInstructions()}\n\n${getSourceSpecificInstructions(input.sourceKey)}`
        : '';
      basePrompt = `אתה מסביר תורני מומחה, הכותב ביאור הלכתי בסגנון המשלב את מילות המקור בתוך ההסבר (כדוגמת מהדורות "שטיינזלץ" או "מתיבתא"). הקהל הוא תלמיד המתכונן למבחן רבנות הדורש הבנה עמוקה של השתלשלות ההלכה.
ענה בעברית בלבד.

מטרתך: לבאר את הטקסט בצורה זורמת, לעשות סדר מוחלט במחלוקות, ולהראות את הקשר בין מקורות הדין לפסיקה הסופית.

כללים מחייבים לעיצוב ולתוכן:
1. **סגנון משולב (שטיינזלץ):** העתק את כל מילות המקור לפי הסדר (ללא דילוגים), והדגש כל מילת מקור בפורמט **bold**. הוסף את ההסבר שלך כהמשך טבעי וזורם של המשפט (לא בסוגריים). אם המילה ברורה, אל תוסיף כלום, המשך למילה הבאה.
2. **תרגום וראשי תיבות:** תרגם מיד קטעים בארמית לעברית פשוטה. פתח ראשי תיבות במלואם (לדוגמה: **מ"ב** משנה ברורה).
3. **פירוק וסיכום שיטות (לטור ולבית יוסף):** כאשר ישנה מחלוקת או שמובאות כמה דעות, עשה סדר! הסבר כל שיטה בנפרד (מי הפוסק, מה הדין שלו, ומה טעמו). אם יש צורך, הוסף משפט סיכום קצר המחדד את ההבדל בין השיטות.
4. **זיהוי פסיקת ההלכה (לשולחן ערוך ולמשנה ברורה):** כאשר הטקסט מציג פסיקה, עליך להסביר *כאיזו דעה* פוסק המחבר או המשנה ברורה (לדוגמה: "כאן פוסק המחבר כדעת הרמב"ה שהובאה בבית יוסף, בניגוד לדעת הרא"ש...").
5. **חוק עליון - נקיות מוחלטת:** אסור להוסיף פתיח, סיום, או הקדמות (כמו "להלן הביאור"). התחל ישירות בעיבוד הטקסט. אל תוסיף דעות או מקורות שלא מוזכרים בטקסט הנוכחי או בהקשר הישיר שלו.
${sourceInstructionsSection}
${structuredBeitYosefAddition}
${structuredManualAddition}
${contextPrompt}
${structuredCompanionSection}

מקור להסביר (${sourceLabel}):
${input.currentSegment}

ביאור משולב:`;
    }

    const generated = await generateTextWithFallback({
      prompt: basePrompt,
      preferredModel,
      maxRetries: 3,
      timeoutMs: 120_000,
    });

    let explanation = generated.text;
    let modelUsed = generated.modelUsed;
    let usage = generated.usage;

    let validated = validateHebrewOutput(explanation);

    if (!validated) {
      const repairPrompt = `The following text is not valid Hebrew output.
Rewrite it in Hebrew only while preserving the same meaning and substance.
Do not switch languages.

Text to repair:
${explanation}

Rewritten Hebrew text: `;

      const repaired = await generateTextWithFallback({
        prompt: repairPrompt,
        preferredModel: modelUsed,
        maxRetries: 2,
        timeoutMs: 90_000,
      });

      explanation = repaired.text;
      modelUsed = repaired.modelUsed;
      validated = validateHebrewOutput(explanation);
      usage = mergeUsage(usage, repaired.usage);
    }

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
      usage,
    };
  },
);
