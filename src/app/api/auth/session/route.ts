import { NextRequest, NextResponse } from 'next/server';

import { FIREBASE_ID_TOKEN_COOKIE } from '@/lib/server-auth';
import { getAdminAuth } from '@/server/firebase-admin';

const COOKIE_MAX_AGE_SECONDS = 55 * 60;

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { idToken?: string } | null;
    const idToken = body?.idToken?.trim();

    if (!idToken) {
      return NextResponse.json({ error: 'Missing idToken.' }, { status: 400 });
    }

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const response = NextResponse.json({ ok: true, uid: decoded.uid });
    response.cookies.set(FIREBASE_ID_TOKEN_COOKIE, idToken, buildCookieOptions());
    return response;
  } catch (error) {
    console.error('[AuthSession] Failed to set Firebase session cookie:', error);
    return NextResponse.json({ error: 'Unable to set session cookie.' }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(FIREBASE_ID_TOKEN_COOKIE, '', {
    ...buildCookieOptions(),
    maxAge: 0,
  });
  return response;
}
