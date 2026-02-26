// import 'server-only';

import { getApps, initializeApp, cert, applicationDefault, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getServiceAccountFromEnv(): ServiceAccount | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  if (!privateKey.includes('-----BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    console.error('[Firebase-Admin] FIREBASE_PRIVATE_KEY does not look like a valid PEM key. Falling back to ADC.');
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function getAdminApp() {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0]!;
  }

  const serviceAccount = getServiceAccountFromEnv();
  if (serviceAccount) {
    console.info(`[Firebase-Admin] Using service account for project "${serviceAccount.projectId}".`);
    return initializeApp({
      credential: cert(serviceAccount),
    });
  }

  console.info('[Firebase-Admin] No service account in env, using Application Default Credentials.');
  return initializeApp({
    credential: applicationDefault(),
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
