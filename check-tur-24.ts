import { getOrBuildSimanAlignment } from './src/app/actions/siman-alignment';
import { getTurSegmentsForSeif } from './src/lib/sefaria-api';
import * as fs from 'fs';

async function main() {
    const alg = await getOrBuildSimanAlignment('Orach Chayim', 24);
    let out = '';
    if (alg) {
        for (let seifNum = 1; seifNum <= 6; seifNum++) {
            let providedStartIndex: number | null = null;
            let providedEndIndex: number | null = null;

            const map = alg.seifMap;
            const currentMapping = map[seifNum.toString()];
            if (currentMapping && currentMapping.byRefs.length > 0) {
                const indices = currentMapping.byRefs
                    .map(ref => {
                        const match = ref.match(/(\d+)[:\s](\d+)/);
                        return match ? parseInt(match[2], 10) : null;
                    })
                    .filter((i): i is number => i !== null)
                    .sort((a, b) => a - b);
                if (indices.length > 0) providedStartIndex = indices[0];
            }
            let seekEnd = seifNum + 1;
            while (seekEnd <= 24 + 5) {
                const nextMap = map[seekEnd.toString()];
                if (nextMap && nextMap.byRefs.length > 0) {
                    const indices = nextMap.byRefs
                        .map(ref => {
                            const match = ref.match(/(\d+)[:\s](\d+)/);
                            return match ? parseInt(match[2], 10) : null;
                        })
                        .filter((i): i is number => i !== null)
                        .sort((a, b) => a - b);
                    if (indices.length > 0) {
                        providedEndIndex = indices[0];
                        break;
                    }
                }
                seekEnd++;
            }

            try {
                const chunks = await getTurSegmentsForSeif('Orach Chayim', 24, seifNum, providedStartIndex, providedEndIndex);
                out += `\n=== Tur 24:${seifNum} ===\n`;
                if (chunks.length > 0) {
                    out += `START: ${chunks[0].text.substring(0, 80)}\n`;
                    out += `END: ${chunks[chunks.length - 1].text.substring(chunks[chunks.length - 1].text.length - 80)}\n`;
                    out += `INDEX USED: start=${providedStartIndex}, end=${providedEndIndex}\n`;
                } else {
                    out += `EMPTY\n`;
                }
            } catch (e) {
                out += `ERROR: ${e}\n`;
            }
        }
    }
    fs.writeFileSync('output-tur-24.txt', out, 'utf-8');
}
main();
