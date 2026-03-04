import { fetchSefariaText } from './src/lib/sefaria-api';
import * as fs from 'fs';

function cleanSegmentText(text: string): string {
    return text
        .replace(/<[^>]*>?/gm, '')
        .replace(/\([^)]{1,5}\)/g, '')
        .trim();
}

const buildRegexMarker = (text: string, numWords = 8) => {
    const words = cleanSegmentText(text)
        .replace(/[^\u05D0-\u05EA]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0)
        .slice(0, numWords);

    if (words.length === 0) return null;
    const pattern = words.join('[^\\u05D0-\\u05EA]+');
    return new RegExp(pattern);
};

async function main() {
    const tur = await fetchSefariaText('Tur, Orach Chayim 24', 'he');
    const by = await fetchSefariaText('Beit Yosef, Orach Chayim 24', 'he');
    const giantText = tur.segments[0].text;

    let out = '';
    for (let i = 4; i <= 6; i++) {
        const bySeg = by.segments.find((s: any) => s.ref === `Beit Yosef, Orach Chayim 24:${i}:1`);
        if (bySeg) {
            out += `\n=== BY ${i} ===\n`;
            out += `Raw BY: ${bySeg.text.substring(0, 100)}\n`;
            const words = cleanSegmentText(bySeg.text)
                .replace(/[^\u05D0-\u05EA]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 0)
                .slice(0, 8);
            out += `Regex Array (8): ${words.join(', ')}\n`;

            for (let w = 8; w >= 1; w--) {
                const shortRegex = buildRegexMarker(bySeg.text, w);
                const m = shortRegex ? giantText.match(shortRegex) : null;
                if (m && m.index !== undefined) {
                    out += `MATCH SUCCESS with ${w} words (Index: ${m.index})\n`;
                    out += `Matched String in Tur: ${giantText.substring(m.index, m.index + 50)}\n`;
                    break;
                }
            }
        }
    }
    fs.writeFileSync('output-regex-debug.txt', out, 'utf-8');
}
main();
