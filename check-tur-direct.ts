import { getTurSegmentsForSeif, fetchSefariaText } from './src/lib/sefaria-api';
import * as fs from 'fs';

async function main() {
    const simanNum = 24;
    const sectionName = 'Orach Chayim';

    const byRef = `Beit Yosef, ${sectionName} ${simanNum}`;
    const byData = await fetchSefariaText(byRef, 'he');

    let out = '';

    if (byData && byData.segments.length > 0) {
        const byIndices = byData.segments
            .map(s => {
                const m = s.ref.match(/(\d+):(\d+)(?::(\d+))?$/);
                return m ? parseInt(m[2], 10) : null;
            })
            .filter((i): i is number => i !== null)
            .sort((a, b) => a - b);
        const uniqueByIndices = [...new Set(byIndices)];

        out += `Unique BY Indices: ${uniqueByIndices.join(', ')}\n\n`;

        for (let seifNum = 1; seifNum <= 6; seifNum++) {
            let providedStartIndex: number | null = null;
            let providedEndIndex: number | null = null;

            const startCandidates = uniqueByIndices.filter(i => i <= seifNum);
            if (startCandidates.length > 0) {
                providedStartIndex = startCandidates[startCandidates.length - 1];
            }

            const endCandidates = uniqueByIndices.filter(i => i > seifNum);
            if (endCandidates.length > 0) {
                providedEndIndex = endCandidates[0];
            }

            out += `=== Seif ${seifNum} ===\n`;
            out += `Indices to use: start=${providedStartIndex}, end=${providedEndIndex}\n`;

            try {
                const turSegments = await getTurSegmentsForSeif(sectionName, simanNum, seifNum, providedStartIndex, providedEndIndex);
                if (turSegments.length > 0) {
                    out += `START: ${turSegments[0].text.substring(0, 80)}\n`;
                    out += `END: ${turSegments[turSegments.length - 1].text.substring(turSegments[turSegments.length - 1].text.length - 80)}\n\n`;
                } else {
                    out += `EMPTY\n\n`;
                }
            } catch (e) {
                out += `ERROR: ${e}\n\n`;
            }
        }
    }

    fs.writeFileSync('output-tur-direct.txt', out, 'utf-8');
}
main();
