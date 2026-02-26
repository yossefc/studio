import { getStructuredSiman } from './src/app/actions/sefaria-api';
import { chunkStructuredText } from './src/app/actions/chunker';

async function main() {
    console.log("Fetching Orach Chayim 10 from Sefaria...");

    const [rawTur, rawBY] = await Promise.all([
        getStructuredSiman('Tur, Orach Chayim 10'),
        getStructuredSiman('Beit Yosef, Orach Chayim 10')
    ]);

    const turChunks = chunkStructuredText(rawTur);
    const byChunks = chunkStructuredText(rawBY);

    console.log(`Tur Chunks post-chunking: ${turChunks.length}`);
    console.log(`Beit Yosef Chunks post-chunking: ${byChunks.length}`);
}

main().catch(console.error);
