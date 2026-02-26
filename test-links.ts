import { getLinkedSourcesForShulchanArukhSeif } from './src/lib/sefaria-api';

async function main() {
    for (let i = 1; i <= 6; i++) {
        const links = await getLinkedSourcesForShulchanArukhSeif('Orach Chayim', 24, i);
        console.log(`Seif ${i} BY Links:`, links.beitYosefRefs);
    }
}
main();
