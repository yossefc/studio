import * as admin from 'firebase-admin';

// Initialize firebase admin
const serviceAccountPath = './rabbinat-app-firebase-adminsdk-fbsvc-153237595e.json';
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function run() {
    console.log('Fetching rabanutCache...');
    const snapshot = await db.collection('rabanutCache').where('sourceKey', '==', 'torah_ohr').get();
    let count = 0;
    for (const doc of snapshot.docs) {
        // Only delete if it's Tetzaveh. In rabanutCache, we don't have tref stored directly in all docs maybe? 
        // Wait, let's delete all torah_ohr just to be safe if they only generated Tetzaveh, 
        // OR we check rawText/explanationText
        const data = doc.data();
        // if there is a way to identify Tetzaveh, let's do it.
        if (data.rawText && data.rawText.includes('תצוה')) {
            await doc.ref.delete();
            count++;
        } else {
            // Just delete all torah_ohr to be sure the new prompt applies to everything
            await doc.ref.delete();
            count++;
        }
    }
    console.log(`Deleted ${count} docs from rabanutCache.`);

    console.log('Fetching explanationCacheEntries...');
    const oldSnap = await db.collection('explanationCacheEntries').get();
    let oldCount = 0;
    for (const doc of oldSnap.docs) {
        if (doc.id.includes('Torah_Ohr') || doc.id.includes('Torah Ohr')) {
            await doc.ref.delete();
            oldCount++;
        }
    }
    console.log(`Deleted ${oldCount} docs from explanationCacheEntries.`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
