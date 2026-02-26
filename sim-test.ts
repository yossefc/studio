import { fetchSefariaText } from './src/lib/sefaria-api';
import * as fs from 'fs';

function normalizeHebrewForSimilarity(text: string): string {
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u0591-\u05C7]/g, '')
        .replace(/[׳״"'`´]/g, ' ')
        .replace(/[^\u05D0-\u05EAa-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeForSimilarity(text: string): string[] {
    const normalized = normalizeHebrewForSimilarity(text);
    if (!normalized) return [];
    return normalized
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length >= 2);
}

function buildBigramSet(tokens: string[]): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
        bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return bigrams;
}

function overlapRatio(querySet: Set<string>, candidateSet: Set<string>): number {
    if (querySet.size === 0 || candidateSet.size === 0) return 0;
    let overlap = 0;
    for (const token of querySet) {
        if (candidateSet.has(token)) overlap += 1;
    }
    return overlap / querySet.size;
}

async function main() {
    const sa = await fetchSefariaText('Shulchan Arukh, Orach Chayim 24', 'he');
    const by = await fetchSefariaText('Beit Yosef, Orach Chayim 24', 'he');

    const byIndex = by.segments
        .map((segment, index) => {
            const tokensArr = tokenizeForSimilarity(segment.text);
            return {
                ref: segment.ref,
                index,
                tokens: new Set(tokensArr),
                bigrams: buildBigramSet(tokensArr),
            };
        })
        .filter(item => item.tokens.size > 0);

    const grouped = new Map<number, string[]>();
    for (const seg of sa.segments) {
        const match = seg.ref.match(/\s(\d+):(\d+)(?::\d+)?$/);
        if (match) {
            const seif = Number.parseInt(match[2], 10);
            const bucket = grouped.get(seif) ?? [];
            bucket.push(seg.text.trim());
            grouped.set(seif, bucket);
        }
    }

    let out = '';
    for (let seif = 1; seif <= 6; seif++) {
        const queryText = (grouped.get(seif) || []).join(' ');
        const queryTokensArray = tokenizeForSimilarity(queryText);
        const queryTokenSet = new Set(queryTokensArray);
        const queryBigramSet = buildBigramSet(queryTokensArray);

        const scored = byIndex.map(candidate => {
            const tokenScore = overlapRatio(queryTokenSet, candidate.tokens);
            const bigramScore = overlapRatio(queryBigramSet, candidate.bigrams);
            const score = (tokenScore * 0.7) + (bigramScore * 0.3);
            return { ref: candidate.ref, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const bestScore = scored[0]?.score ?? 0;
        const minimumScore = Math.max(0.08, bestScore * 0.6);
        const selected = scored.filter(item => item.score >= minimumScore).slice(0, 12);

        out += `\n=== Seif ${seif} (Best Score: ${bestScore.toFixed(3)}) ===\n`;
        for (const s of selected) {
            out += `${s.ref} ${s.score.toFixed(3)}\n`;
        }
    }
    fs.writeFileSync('output-sim.txt', out, 'utf-8');
}

main();
