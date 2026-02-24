'use server';

import { getAdminDb } from '@/server/firebase-admin';
import { getAdminAuth } from '@/server/firebase-admin';

const ADMIN_EMAIL = 'yossefcohzar@gmail.com';

async function verifyAdmin(idToken: string): Promise<void> {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    if (decoded.email !== ADMIN_EMAIL) {
        throw new Error('Unauthorized: admin access required.');
    }
}

/* ---- Rabanout types ---- */

const SECTION_LABELS: Record<string, string> = {
    orach_chayim: 'אורח חיים',
    yoreh_deah: 'יורה דעה',
    even_haezer: 'אבן העזר',
    choshen_mishpat: 'חושן משפט',
};

const SOURCE_LABELS: Record<string, string> = {
    tur: 'טור',
    beit_yosef: 'בית יוסף',
    shulchan_arukh: 'שולחן ערוך',
    mishnah_berurah: 'משנה ברורה',
};

export interface RabanutTextChunk {
    id: string;            // Firestore doc ID
    path: string;          // full Firestore path for deletion
    sourceKey: string;
    chunkOrder: number;
    rawText: string;
    explanationText: string;
    modelName: string;
    promptVersion: string;
    validated: boolean;
    createdAt: string;
}

export interface RabanutSeif {
    seifNum: string;
    sources: Record<string, RabanutTextChunk[]>; // sourceKey → chunks
}

export interface RabanutSiman {
    simanNum: string;
    seifim: RabanutSeif[];
}

export interface RabanutSection {
    sectionKey: string;
    sectionLabel: string;
    simanim: RabanutSiman[];
}

/** Fetch the entire rabanout hierarchy (admin only). */
export async function fetchRabanutData(idToken: string): Promise<RabanutSection[]> {
    await verifyAdmin(idToken);
    const db = getAdminDb();

    const sections: RabanutSection[] = [];
    const sectionRefs = await db.collection('rabanout').listDocuments();

    for (const sectionRef of sectionRefs) {
        const sectionKey = sectionRef.id;
        const sectionLabel = SECTION_LABELS[sectionKey] || sectionKey;

        const simanRefs = await sectionRef.collection('simanim').listDocuments();
        const simanim: RabanutSiman[] = [];

        for (const simanRef of simanRefs) {
            const simanNum = simanRef.id;
            const seifRefs = await simanRef.collection('seifim').listDocuments();
            const seifim: RabanutSeif[] = [];

            for (const seifRef of seifRefs) {
                const seifNum = seifRef.id;
                const sources: Record<string, RabanutTextChunk[]> = {};

                // Each source is a sub-collection (shulchan_arukh, tur, etc.)
                const sourceCollections = await seifRef.listCollections();
                for (const sourceCol of sourceCollections) {
                    const sourceKey = sourceCol.id;
                    const chunkSnap = await sourceCol.orderBy('chunkOrder', 'asc').get();

                    sources[sourceKey] = chunkSnap.docs.map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            path: doc.ref.path,
                            sourceKey,
                            chunkOrder: data.chunkOrder ?? 0,
                            rawText: data.rawText || '',
                            explanationText: data.explanationText || '',
                            modelName: data.modelName || '',
                            promptVersion: data.promptVersion || '',
                            validated: data.validated ?? false,
                            createdAt: data.createdAt?.toDate?.()?.toISOString?.() || '',
                        };
                    });
                }

                if (Object.keys(sources).length > 0) {
                    seifim.push({ seifNum, sources });
                }
            }

            seifim.sort((a, b) => parseInt(a.seifNum) - parseInt(b.seifNum));
            if (seifim.length > 0) {
                simanim.push({ simanNum, seifim });
            }
        }

        simanim.sort((a, b) => parseInt(a.simanNum) - parseInt(b.simanNum));
        if (simanim.length > 0) {
            sections.push({ sectionKey, sectionLabel, simanim });
        }
    }

    // Sort canonical order
    const order = ['orach_chayim', 'yoreh_deah', 'even_haezer', 'choshen_mishpat'];
    sections.sort((a, b) => {
        const ia = order.indexOf(a.sectionKey);
        const ib = order.indexOf(b.sectionKey);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    return sections;
}

/** Delete a text chunk from rabanout (admin only). */
export async function deleteRabanutChunk(idToken: string, docPath: string): Promise<void> {
    await verifyAdmin(idToken);
    const db = getAdminDb();
    await db.doc(docPath).delete();
}

export { SOURCE_LABELS };
