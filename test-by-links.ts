import { fetchSefariaText } from './src/lib/sefaria-api';

async function main() {
    const by = await fetchSefariaText('Beit Yosef, Orach Chayim 24', 'he');
    console.log("BY Segments:", by.segments.map(s => s.ref));

    // Let's fetch the actual Sefaria JSON for links for Beit Yosef
    for (const s of by.segments) {
        console.log(`Checking links for ${s.ref}`);
        const res = await fetch(`https://www.sefaria.org/api/links/${encodeURIComponent(s.ref)}`);
        const links = await res.json();
        const saLinks = links.filter((l: any) => l.category === "Halakhah" && l.ref.startsWith("Shulchan Arukh"));
        console.log(`  -> SA Links:`, saLinks.map((l: any) => l.ref));
    }
}
main();
