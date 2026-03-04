import { fetchSefariaText } from './src/lib/sefaria-api';
import * as fs from 'fs';

async function main() {
    const by = await fetchSefariaText('Beit Yosef, Orach Chayim 24', 'he');
    let out = '';
    out += `Total BY segments: ${by.segments.length}\n\n`;
    for (const s of by.segments) {
        out += `REF: ${s.ref}\n`;
        out += `PATH: ${JSON.stringify(s.path)}\n`;
        out += `TEXT (first 100 chars): ${s.text.replace(/<[^>]*>/g, '').substring(0, 100)}\n\n`;
    }

    const sa = await fetchSefariaText('Shulchan Arukh, Orach Chayim 24', 'he');
    out += `\n--- Shulchan Arukh segments ---\n`;
    for (const s of sa.segments) {
        out += `REF: ${s.ref}, PATH: ${JSON.stringify(s.path)}\n`;
    }

    const tur = await fetchSefariaText('Tur, Orach Chayim 24', 'he');
    out += `\n--- Tur segments ---\n`;
    out += `Total Tur segments: ${tur.segments.length}\n`;
    for (const s of tur.segments) {
        out += `REF: ${s.ref}, PATH: ${JSON.stringify(s.path)}, TEXT (50): ${s.text.replace(/<[^>]*>/g, '').substring(0, 50)}\n`;
    }

    fs.writeFileSync('output-structure.txt', out, 'utf-8');
}
main();
