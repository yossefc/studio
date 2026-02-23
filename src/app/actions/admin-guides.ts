'use server';

import { getAdminDb } from '@/server/firebase-admin';
import { getAdminAuth } from '@/server/firebase-admin';

const ADMIN_EMAIL = 'yossefcohzar@gmail.com';

/** Verify the caller is the admin. Throws if not. */
async function verifyAdmin(idToken: string): Promise<void> {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    if (decoded.email !== ADMIN_EMAIL) {
        throw new Error('Unauthorized: admin access required.');
    }
}

export interface AdminGuide {
    id: string;
    userId: string;
    tref: string;
    summaryText: string;
    googleDocUrl: string;
    status: string;
    createdAt: string;
}

export interface AdminTextChunk {
    id: string;
    sourceKey: string;
    orderIndex: number;
    rawText: string;
    explanationText: string;
}

export interface CacheEntry {
    id: string;
    normalizedTref: string;
    sourceKey: string;
    chunkOrder: number;
    explanationText: string;
    modelName: string;
    promptVersion: string;
    validated: boolean;
    createdAt: string;
}

/** Fetch ALL study guides across all users (admin only). */
export async function fetchAllGuides(idToken: string): Promise<AdminGuide[]> {
    await verifyAdmin(idToken);
    const db = getAdminDb();
    const guides: AdminGuide[] = [];

    const userRefs = await db.collection('users').listDocuments();

    for (const userRef of userRefs) {
        const userId = userRef.id;
        const guidesSnap = await userRef
            .collection('studyGuides')
            .get();

        for (const guideDoc of guidesSnap.docs) {
            const data = guideDoc.data();
            guides.push({
                id: guideDoc.id,
                userId,
                tref: data.tref || '',
                summaryText: data.summaryText || '',
                googleDocUrl: data.googleDocUrl || '',
                status: data.status || '',
                createdAt: data.createdAt || '',
            });
        }
    }

    return guides;
}

/** Fetch text chunks for a specific guide. */
export async function fetchGuideChunks(idToken: string, userId: string, guideId: string): Promise<AdminTextChunk[]> {
    await verifyAdmin(idToken);
    const db = getAdminDb();
    const snap = await db
        .collection('users')
        .doc(userId)
        .collection('studyGuides')
        .doc(guideId)
        .collection('textChunks')
        .orderBy('orderIndex', 'asc')
        .get();

    return snap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            sourceKey: data.sourceKey || '',
            orderIndex: data.orderIndex || 0,
            rawText: data.rawText || '',
            explanationText: data.explanationText || '',
        };
    });
}

/** Fetch all cached AI explanation entries (admin only). */
export async function fetchCacheEntries(idToken: string): Promise<CacheEntry[]> {
    await verifyAdmin(idToken);
    const db = getAdminDb();
    const snap = await db.collection('explanationCacheEntries')
        .orderBy('createdAt', 'desc')
        .get();

    return snap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            normalizedTref: data.normalizedTref || '',
            sourceKey: data.sourceKey || '',
            chunkOrder: data.chunkOrder ?? -1,
            explanationText: data.explanationText || '',
            modelName: data.modelName || '',
            promptVersion: data.promptVersion || '',
            validated: data.validated ?? false,
            createdAt: data.createdAt?.toDate?.()?.toISOString?.() || '',
        };
    });
}

/** Delete a cache entry (admin only). */
export async function deleteCacheEntry(idToken: string, entryId: string): Promise<void> {
    await verifyAdmin(idToken);
    const db = getAdminDb();
    await db.collection('explanationCacheEntries').doc(entryId).delete();
}
