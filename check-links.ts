import { getLinkedSourcesForShulchanArukhSeif } from './src/lib/sefaria-api';

async function main() {
    try {
        const links = await getLinkedSourcesForShulchanArukhSeif('Orach Chayim', 24, 4);
        console.log(JSON.stringify(links, null, 2));
    } catch (error) {
        console.error('Error fetching links:', error);
    }
}

main();
