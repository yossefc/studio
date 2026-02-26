import { getOrBuildSimanAlignment } from './src/app/actions/siman-alignment';

async function main() {
    const alg = await getOrBuildSimanAlignment('Orach Chayim', 24);
    console.log(JSON.stringify(alg, null, 2));
}

main();
