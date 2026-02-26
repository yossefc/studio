import { fetchSefariaText } from './src/lib/sefaria-api';

async function main() {
    const tur = await fetchSefariaText('Tur, Orach Chayim 24');
    console.log(`Tur 24 has ${tur.segments.length} segments.`);
    if (tur.segments.length > 0) {
        console.log(`Length of segment 1 text: ${tur.segments[0].text.length} chars`);
        console.log(`Contains phrase 1 (seif 4 start): ${tur.segments[0].text.includes('כתב בעל העיטור: ואותם שמקבצים הציציות')}`);
        console.log(`Contains phrase 2 (seif 5 start): ${tur.segments[0].text.includes('גדולה מצות ציצית ששקולה')}`);
    }
}

main();
