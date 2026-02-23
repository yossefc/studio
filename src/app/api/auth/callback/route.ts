import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'http://localhost:3000/api/auth/callback',
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    return NextResponse.json({
      message: 'Copy the refresh_token below and add it to your .env as GOOGLE_OAUTH_REFRESH_TOKEN',
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token?.substring(0, 20) + '...',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
