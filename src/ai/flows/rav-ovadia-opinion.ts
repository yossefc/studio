'use server';
/**
 * @fileOverview Genkit flow for generating Rav Ovadia Yosef's halachic ruling
 * on a given Shulchan Arukh seif, based on SA and Mishnah Berurah texts.
 */

import { ai, generateTextWithFallback, getModelConfig } from '@/ai/genkit';
import { z } from 'genkit';

const RavOvadiaOpinionInputSchema = z.object({
  saText: z.string().describe('The Shulchan Arukh seif text in Hebrew.'),
  mbText: z.string().optional().describe('The Mishnah Berurah text for this seif.'),
  section: z.string().describe('The halachic section (e.g. Orach Chayim).'),
  siman: z.string().describe('The siman number.'),
  seif: z.string().optional().describe('The seif number.'),
  modelName: z.string().optional(),
});

export type RavOvadiaOpinionInput = z.infer<typeof RavOvadiaOpinionInputSchema>;

const UsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});

const RavOvadiaOpinionOutputSchema = z.object({
  opinion: z.string().describe('Rav Ovadia Yosef\'s ruling in Hebrew.'),
  modelUsed: z.string(),
  usage: UsageSchema,
});

export type RavOvadiaOpinionOutput = z.infer<typeof RavOvadiaOpinionOutputSchema>;

function buildPrompt(input: RavOvadiaOpinionInput): string {
  const seifLabel = input.seif ? `:${input.seif}` : '';
  const tref = `${input.section} ${input.siman}${seifLabel}`;

  const mbSection = input.mbText?.trim()
    ? `\nמשנה ברורה:\n${input.mbText.trim()}`
    : '';

  return `אתה פוסק הלכה המתמחה בשיטת הרב עובדיה יוסף זצ"ל.

הנושא: ${tref}

שולחן ערוך:
${input.saText.trim()}${mbSection}

המשימה:
כתוב בעברית בלבד את עמדת הרב עובדיה יוסף בנושא זה.
• פתח ב"- הלכה:" עם פסיקתו הסופית בשורה אחת ברורה.
• הוסף "- מקור:" עם ציון ספרו הרלוונטי (יחוה דעת, יביע אומר, חזון עובדיה, ילקוט יוסף) — רק אם אתה בטוח שקיימת הכרעה ידועה.
• אם הנושא כולל מחלוקת שהרב עובדיה הכריע בה, ציין בקצרה את עמדתו לעומת הדעה האחרת.
• אם אין לך ידיעה בטוחה על עמדתו בנושא ספציפי זה, כתוב: "- לא נמצאה הכרעה ידועה של הרב עובדיה יוסף בנושא ספציפי זה."
• היה קצר ומדויק. אל תמציא מקורות.`;
}

export async function generateRavOvadiaOpinion(
  input: RavOvadiaOpinionInput,
): Promise<RavOvadiaOpinionOutput> {
  return ravOvadiaOpinionFlow(input);
}

export const ravOvadiaOpinionFlow = ai.defineFlow(
  {
    name: 'ravOvadiaOpinionFlow',
    inputSchema: RavOvadiaOpinionInputSchema,
    outputSchema: RavOvadiaOpinionOutputSchema,
  },
  async (input): Promise<RavOvadiaOpinionOutput> => {
    const config = getModelConfig();
    const preferredModel = input.modelName || config.primary;

    const generated = await generateTextWithFallback({
      prompt: buildPrompt(input),
      preferredModel,
      maxRetries: 2,
      timeoutMs: 60_000,
    });

    return {
      opinion: generated.text.trim(),
      modelUsed: generated.modelUsed,
      usage: generated.usage,
    };
  },
);
