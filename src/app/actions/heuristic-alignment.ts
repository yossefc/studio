import { StructuredChunk } from './sefaria-api';
import { generateTextWithFallback } from '@/ai/genkit';

/**
 * Uses Gemini to find the best matching chunks for all Shulchan Arukh seifim in a Siman.
 * Returns a map of seif number → array of candidate **indices** (into candidateChunks).
 * Using indices instead of refs avoids ambiguity when multiple sub-chunks share the same ref.
 */
export async function alignSourceWithLLM(
    saSeifTextMap: Map<number, string>,
    candidateChunks: StructuredChunk[],
    sourceName: string // 'Tur' or 'Beit Yosef'
): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    for (const seifNum of saSeifTextMap.keys()) {
        result.set(seifNum, []);
    }

    if (candidateChunks.length === 0 || saSeifTextMap.size === 0) {
        return result;
    }

    let saStr = '';
    saSeifTextMap.forEach((text, seifNum) => {
        saStr += `\n[Seif ${seifNum}]\n${text}\n---\n`;
    });

    let candidatesStr = '';
    candidateChunks.forEach((c, index) => {
        // With aggressive chunking (~50 words), chunks are small enough to show in full.
        // Only truncate truly extreme outliers.
        const preview = c.text.length > 1500 ? c.text.substring(0, 1500) + '...' : c.text;
        candidatesStr += `\n[ID: ${index}]\nRef: ${c.ref}\nText: ${preview}\n---\n`;
    });

    const prompt = `You are a rabbinic scholar expert in the mapping between the Shulchan Arukh, Tur, and Beit Yosef block structures.
You are given all the Seifim of a Shulchan Arukh Siman, and a list of all candidate segments from the ${sourceName} for that same Siman.

Your task is to exhaustively assign EVERY candidate segment ID to the Shulchan Arukh Seif number it most closely relates to.
Because the Shulchan Arukh summarizes the ${sourceName}, the match might be paraphrased or significantly shorter, but the underlying Halachic concept will be identical.
DO NOT LEAVE ANY CANDIDATE ID BEHIND. If a candidate spans multiple Seifim, pick the most relevant one, or the first one it relates to.
IMPORTANT: The candidates follow the order of the original text. Try to distribute them across ALL seifim proportionally — do not pile everything into Seif 1.

SHULCHAN ARUKH SEIFIM:
"""
${saStr}
"""

CANDIDATES (${sourceName}):
${candidatesStr}

INSTRUCTIONS:
1. For each Shulchan Arukh Seif number (e.g., "1", "2"), list the candidate IDs (e.g., [0, 1, 2]) that correspond to it.
2. EVERY candidate ID from 0 to ${candidateChunks.length - 1} MUST appear exactly once in your output.
3. Return ONLY a raw JSON object where the keys are the Seif numbers (strings) and the values are arrays of integers (the assigned candidate IDs).
4. Do NOT return markdown formatting like \`\`\`json. Do not explain your answer.

Example Expected JSON format:
{
  "1": [0, 1],
  "2": [2, 3, 4],
  "3": [5]
}

JSON Output:`;

    try {
        const { text } = await generateTextWithFallback({
            prompt,
            timeoutMs: 60000,
            maxRetries: 2
        });

        // Strip backticks if the LLM ignores instructions
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const mapping: Record<string, number[]> = JSON.parse(cleanJson);

        let totalAssigned = 0;
        for (const [seifNumStr, ids] of Object.entries(mapping)) {
            const seifNum = parseInt(seifNumStr, 10);
            if (result.has(seifNum) && Array.isArray(ids)) {
                const validIds = ids.filter(id => id >= 0 && id < candidateChunks.length);
                result.set(seifNum, validIds);
                totalAssigned += validIds.length;
            }
        }

        // Log coverage: how many candidates were actually assigned vs total
        const seifSummary = [...result.entries()].map(([s, ids]) => `${s}:${ids.length}`).join(', ');
        console.log(`[LLM Alignment] ${sourceName}: assigned ${totalAssigned}/${candidateChunks.length} candidates. Per-seif: {${seifSummary}}`);

        if (totalAssigned < candidateChunks.length) {
            console.warn(`[LLM Alignment] ${sourceName}: ${candidateChunks.length - totalAssigned} candidates were NOT assigned by the LLM!`);
        }
    } catch (err) {
        console.warn(`[LLM Alignment] Global LLM matching failed for ${sourceName}:`, err);
    }

    return result;
}
