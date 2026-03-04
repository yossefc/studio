import type { StructuredChunk } from '@/lib/sefaria-api';
import { generateTextWithFallback } from '@/ai/genkit';

export type AlignmentMode =
    /** Every candidate must be assigned exactly once. Seifim form contiguous blocks. Used for BY. */
    | 'exhaustive-contiguous'
    /** Candidates are assigned only when relevant. Some seifim may be empty. Ordering is preserved. Used for Tur. */
    | 'partial-ordered';

/**
 * Uses Gemini to find the best matching chunks for all Shulchan Arukh seifim in a Siman.
 * Returns a map of seif number → array of candidate **indices** (into candidateChunks).
 */
export async function alignSourceWithLLM(
    saSeifTextMap: Map<number, string>,
    candidateChunks: StructuredChunk[],
    sourceName: string,
    options?: { mode?: AlignmentMode },
): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    for (const seifNum of saSeifTextMap.keys()) {
        result.set(seifNum, []);
    }

    if (candidateChunks.length === 0 || saSeifTextMap.size === 0) {
        return result;
    }

    const mode = options?.mode ?? 'exhaustive-contiguous';

    let saStr = '';
    saSeifTextMap.forEach((text, seifNum) => {
        saStr += `\n[Seif ${seifNum}]\n${text}\n---\n`;
    });

    let candidatesStr = '';
    candidateChunks.forEach((c, index) => {
        const preview = c.text.length > 1500 ? c.text.substring(0, 1500) + '...' : c.text;
        candidatesStr += `\n[ID: ${index}]\nRef: ${c.ref}\nText: ${preview}\n---\n`;
    });

    const prompt = mode === 'exhaustive-contiguous'
        ? buildExhaustivePrompt(sourceName, saStr, candidatesStr, candidateChunks.length)
        : buildPartialPrompt(sourceName, saStr, candidatesStr, candidateChunks.length);

    try {
        const { text } = await generateTextWithFallback({
            prompt,
            timeoutMs: 60000,
            maxRetries: 2
        });

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

        const seifSummary = [...result.entries()].map(([s, ids]) => `${s}:${ids.length}`).join(', ');
        console.log(`[LLM Alignment] ${sourceName}: assigned ${totalAssigned}/${candidateChunks.length} candidates. Per-seif: {${seifSummary}}`);

        if (mode === 'exhaustive-contiguous') {
            if (totalAssigned < candidateChunks.length) {
                console.warn(`[LLM Alignment] ${sourceName}: ${candidateChunks.length - totalAssigned} candidates were NOT assigned by the LLM!`);
            }
            enforceOrderingAndContiguity(result, candidateChunks.length);
        } else {
            enforcePartialOrdering(result);
        }
    } catch (err) {
        console.warn(`[LLM Alignment] Global LLM matching failed for ${sourceName}:`, err);
    }

    return result;
}

function buildExhaustivePrompt(sourceName: string, saStr: string, candidatesStr: string, totalCandidates: number): string {
    return `You are a rabbinic scholar expert in the mapping between the Shulchan Arukh, Tur, and Beit Yosef block structures.
You are given all the Seifim of a Shulchan Arukh Siman, and a list of all candidate segments from the ${sourceName} for that same Siman.

Your task is to assign EVERY candidate segment ID to the Shulchan Arukh Seif number it most closely relates to.
Because the Shulchan Arukh summarizes the ${sourceName}, the match might be paraphrased or significantly shorter, but the underlying Halachic concept will be identical.
DO NOT LEAVE ANY CANDIDATE ID BEHIND. If a candidate spans multiple Seifim, pick the most relevant one, or the first one it relates to.

IMPORTANT: Some Shulchan Arukh Seifim may be later additions (e.g. from the Rema) that have NO parallel in the ${sourceName}. For these seifim, use an empty array []. Do NOT force-assign candidates to seifim that have no matching content.

CRITICAL ORDERING RULES:
- The candidate segments are in their ORIGINAL TEXT ORDER and MUST be assigned in strictly increasing order across Seifim.
- All candidates assigned to Seif N must have LOWER IDs than all candidates assigned to Seif N+1.
- Within each Seif, the candidate IDs must be CONTIGUOUS (no gaps). If Seif 2 gets IDs [4,5,6], Seif 3 cannot get ID 8 without also including 7.
- In other words, you are partitioning the candidate list into consecutive blocks, one block per Seif (some blocks may be empty), in order.

SHULCHAN ARUKH SEIFIM:
"""
${saStr}
"""

CANDIDATES (${sourceName}):
${candidatesStr}

INSTRUCTIONS:
1. For each Shulchan Arukh Seif number, list the candidate IDs that correspond to it.
2. EVERY candidate ID from 0 to ${totalCandidates - 1} MUST appear exactly once in your output.
3. Seifim with no matching candidates should have an empty array [].
4. Return ONLY a raw JSON object where the keys are the Seif numbers (strings) and the values are arrays of integers.
5. Do NOT return markdown formatting like \`\`\`json. Do not explain your answer.

JSON Output:`;
}

function buildPartialPrompt(sourceName: string, saStr: string, candidatesStr: string, totalCandidates: number): string {
    return `You are a rabbinic scholar expert in the mapping between the Shulchan Arukh, Tur, and Beit Yosef block structures.
You are given all the Seifim of a Shulchan Arukh Siman, and a list of candidate text segments from the ${sourceName} for that same Siman.

Your task is to assign each candidate segment to the Shulchan Arukh Seif it actually discusses.
The ${sourceName} may NOT cover every Seif — some Seifim are additions by the Shulchan Arukh author and have NO parallel in the ${sourceName}.

IMPORTANT RULES:
- Only assign a candidate to a Seif if the candidate ACTUALLY discusses the same Halachic topic as that Seif.
- If a candidate does NOT match any Seif well, do NOT assign it. It is better to leave it unassigned than to assign it to the wrong Seif.
- Seifim with no matching candidates should have an EMPTY array [].
- The candidates are in their ORIGINAL TEXT ORDER. Assignments must respect this order: if candidate X is assigned to Seif A, and candidate Y (Y > X) is assigned to Seif B, then B >= A.
- Within each Seif, assigned candidate IDs must be contiguous (no gaps).
- A candidate may appear at most once.

SHULCHAN ARUKH SEIFIM:
"""
${saStr}
"""

CANDIDATES (${sourceName}):
${candidatesStr}

INSTRUCTIONS:
1. For each Seif that has matching candidates, list their IDs. Use an empty array [] for seifim with no match.
2. NOT every candidate needs to be assigned. Only assign candidates that genuinely match a Seif's topic.
3. Return ONLY a raw JSON object where the keys are the Seif numbers (strings) and the values are arrays of integers.
4. Do NOT return markdown formatting. Do not explain your answer.

Example:
{
  "1": [0, 1, 2],
  "2": [],
  "3": [3, 4],
  "4": [],
  "5": [5, 6, 7]
}

JSON Output:`;
}

/**
 * Post-processing for exhaustive-contiguous mode (BY).
 * Ensures monotonic ordering and contiguous blocks. Seifim the LLM left empty
 * stay empty — only the seifim WITH assignments participate in the partition.
 * Unassigned candidates are appended to the nearest preceding non-empty seif.
 */
function enforceOrderingAndContiguity(
    result: Map<number, number[]>,
    totalCandidates: number,
): void {
    const seifNums = [...result.keys()].sort((a, b) => a - b);
    if (seifNums.length === 0 || totalCandidates === 0) return;

    // Separate seifim that the LLM assigned candidates vs. left empty.
    const populatedSeifs: number[] = [];
    const emptySeifs: number[] = [];
    for (const seif of seifNums) {
        const ids = result.get(seif) ?? [];
        if (ids.length > 0) {
            populatedSeifs.push(seif);
        } else {
            emptySeifs.push(seif);
        }
    }

    if (populatedSeifs.length === 0) return;

    // Sort each populated seif's IDs and compute centroids for ordering.
    for (const seif of populatedSeifs) {
        const ids = result.get(seif)!;
        ids.sort((a, b) => a - b);
    }

    // Compute partition boundaries: assign contiguous blocks in seif order.
    // Start with the minimum ID from each seif as a hint, then enforce monotonicity.
    const boundaries: number[] = populatedSeifs.map(seif => Math.min(...(result.get(seif) ?? [0])));

    // Enforce strictly increasing boundaries.
    for (let i = 1; i < boundaries.length; i++) {
        if (boundaries[i] <= boundaries[i - 1]) {
            boundaries[i] = boundaries[i - 1] + 1;
        }
    }

    // Clamp to valid range.
    for (let i = 0; i < boundaries.length; i++) {
        boundaries[i] = Math.max(0, Math.min(boundaries[i], totalCandidates));
    }

    // Assign contiguous blocks to populated seifim.
    for (let i = 0; i < populatedSeifs.length; i++) {
        const start = boundaries[i];
        const end = i + 1 < boundaries.length ? boundaries[i + 1] : totalCandidates;
        const ids: number[] = [];
        for (let id = start; id < end && id < totalCandidates; id++) {
            ids.push(id);
        }
        result.set(populatedSeifs[i], ids);
    }

    // Ensure empty seifim stay empty.
    for (const seif of emptySeifs) {
        result.set(seif, []);
    }

    // Check for orphans (candidates not in any block) and append to the last populated seif.
    const finalAssigned = new Set<number>();
    for (const ids of result.values()) {
        for (const id of ids) finalAssigned.add(id);
    }

    const missing: number[] = [];
    for (let id = 0; id < totalCandidates; id++) {
        if (!finalAssigned.has(id)) missing.push(id);
    }

    if (missing.length > 0) {
        const lastPopulated = populatedSeifs[populatedSeifs.length - 1];
        const existing = result.get(lastPopulated) ?? [];
        result.set(lastPopulated, [...existing, ...missing].sort((a, b) => a - b));
        console.warn(`[LLM Alignment] enforceOrdering: ${missing.length} orphan IDs appended to seif ${lastPopulated}`);
    }

    const seifSummary = [...result.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([s, ids]) => `${s}:[${ids.length > 0 ? ids[0] + '-' + ids[ids.length - 1] : 'empty'}]`)
        .join(', ');
    console.log(`[LLM Alignment] After enforceOrdering: {${seifSummary}}`);
}

/**
 * Post-processing for partial-ordered mode (Tur).
 * Only ensures that assigned IDs are monotonically ordered across seifim.
 * Does NOT force all candidates to be assigned or all seifim to have content.
 */
function enforcePartialOrdering(result: Map<number, number[]>): void {
    const seifNums = [...result.keys()].sort((a, b) => a - b);

    // Sort IDs within each seif
    for (const seif of seifNums) {
        const ids = result.get(seif) ?? [];
        ids.sort((a, b) => a - b);
        result.set(seif, ids);
    }

    // Fix ordering violations: if seif N has IDs that overlap with seif N+1, remove from N+1
    let maxIdSoFar = -1;
    for (const seif of seifNums) {
        const ids = result.get(seif) ?? [];
        const cleaned = ids.filter(id => id > maxIdSoFar);
        result.set(seif, cleaned);
        if (cleaned.length > 0) {
            maxIdSoFar = Math.max(...cleaned);
        }
    }

    const seifSummary = [...result.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([s, ids]) => {
            if (ids.length === 0) return `${s}:[]`;
            return `${s}:[${ids[0]}-${ids[ids.length - 1]}]`;
        })
        .join(', ');
    console.log(`[LLM Alignment] After partialOrdering: {${seifSummary}}`);
}
