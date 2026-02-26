import { fetchSefariaText } from './src/lib/sefaria-api';

function cleanSegmentText(text: string): string {
    return text
        .replace(/<[^>]*>?/gm, '')
        .replace(/\([^)]{1,5}\)/g, '')
        .trim();
}

async function main() {
    const tur = await fetchSefariaText('Tur, Orach Chayim 24');
    const by = await fetchSefariaText('Beit Yosef, Orach Chayim 24');

    const giantText = tur.segments[0].text;
    const bySeif4Start = by.segments.find(s => s.ref === 'Beit Yosef, Orach Chayim 24:3:1');

    const text = bySeif4Start!.text;
    const words = cleanSegmentText(text)
        .replace(/[^\u05D0-\u05EA]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0)
        .slice(0, 4);

    console.log("Extracted 4 words:", words);

    const pattern = words.join('[^\\u05D0-\\u05EA]+');
    console.log("Pattern:", pattern);

    const reg = new RegExp(pattern);
    const m = giantText.match(reg);
    console.log("Match success?", m != null);

    const sub = giantText.substring(585, 620);
    console.log("Sub:", sub);
    console.log("Sub Match?", sub.match(reg) != null);
}

main();
