'use client';

import type { User } from 'firebase/auth';

let lastSyncedToken: string | null = null;

export async function syncFirebaseSession(user: User | null): Promise<void> {
  if (!user) {
    lastSyncedToken = null;
    await fetch('/api/auth/session', {
      method: 'DELETE',
      cache: 'no-store',
    });
    return;
  }

  const idToken = await user.getIdToken();
  if (idToken === lastSyncedToken) {
    return;
  }

  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    throw new Error('Failed to sync authenticated session.');
  }

  lastSyncedToken = idToken;
}
