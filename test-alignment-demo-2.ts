import * as fs from 'fs';
import { getAdminDb } from './src/server/firebase-admin';
import { getOrBuildSimanAlignment } from './src/app/actions/siman-alignment';

async function main() {
  const db = getAdminDb();
  await db.collection('alignments').doc('orach_chayim_2').delete();

  const result = await getOrBuildSimanAlignment('Orach Chayim', 2);
  if (!result) {
    console.error('Failed to build alignment.');
    return;
  }

  let output = '# Alignment Results for Orach Chayim 2\n\n';
  output += '> Mapping by seif with refs only.\n\n';

  for (const [seifNum, map] of Object.entries(result.seifMap)) {
    output += `## Seif ${seifNum}\n\n`;
    output += `Tur (${map.turRefs.length}): ${map.turRefs.join(', ') || 'none'}\n\n`;
    output += `Beit Yosef (${map.byRefs.length}): ${map.byRefs.join(', ') || 'none'}\n\n`;
    output += '---\n\n';
  }

  fs.writeFileSync(
    'C:\\Users\\USER\\.gemini\\antigravity\\brain\\e058abfb-27c8-425d-8136-4da5e0c55221\\LLM_Alignment_Demo.md',
    output,
    { encoding: 'utf-8' },
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
