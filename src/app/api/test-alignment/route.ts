import * as fs from 'fs';
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/server/firebase-admin';
import { getOrBuildSimanAlignment } from '@/app/actions/siman-alignment';

export async function GET() {
  try {
    const db = getAdminDb();
    await db.collection('alignments').doc('orach_chayim_1').delete();

    const result = await getOrBuildSimanAlignment('Orach Chayim', 1);
    if (!result) {
      return NextResponse.json({ error: 'Failed to build alignment.' }, { status: 500 });
    }

    let output = '# Alignment Results for Orach Chayim 1\n\n';
    output += '> Mapping by seif with Tur / Beit Yosef refs only.\n\n';

    for (const [seifNum, mapping] of Object.entries(result.seifMap)) {
      output += `## Seif ${seifNum}\n\n`;

      output += `### Tur (${mapping.turRefs.length} refs)\n`;
      if (mapping.turRefs.length === 0) {
        output += '*No Tur refs mapped for this seif.*\n';
      } else {
        for (const ref of mapping.turRefs) {
          output += `- ${ref}\n`;
        }
      }

      output += `\n### Beit Yosef (${mapping.byRefs.length} refs)\n`;
      if (mapping.byRefs.length === 0) {
        output += '*No Beit Yosef refs mapped for this seif.*\n';
      } else {
        for (const ref of mapping.byRefs) {
          output += `- ${ref}\n`;
        }
      }

      output += '\n---\n\n';
    }

    fs.writeFileSync(
      'C:\\Users\\USER\\.gemini\\antigravity\\brain\\e058abfb-27c8-425d-8136-4da5e0c55221\\LLM_Alignment_Demo.md',
      output,
    );

    return NextResponse.json({ success: true, message: 'Wrote LLM_Alignment_Demo.md' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
