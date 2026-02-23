'use client';

import { useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth, useUser } from '@/firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initiateAnonymousSignIn } from '@/firebase/non-blocking-login';
import { useRouter } from 'next/navigation';
import { Ghost, Loader2 } from 'lucide-react';
import { useEffect } from 'react';

const googleProvider = new GoogleAuthProvider();

export default function LoginPage() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (user && !isUserLoading) {
      router.push('/generate');
    }
  }, [user, isUserLoading, router]);

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('[Auth] Google sign-in failed:', err);
      setError('ההתחברות עם Google נכשלה. נסה שנית.');
      setIsSubmitting(false);
    }
  };

  const handleAnonymous = () => {
    if (!auth) return;
    setIsSubmitting(true);
    setError(null);
    initiateAnonymousSignIn(auth);
  };

  if (isUserLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navigation />
      <main className="pt-24 px-6 max-w-md mx-auto w-full">
        <Card className="shadow-2xl border-none rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground p-8 text-center">
            <CardTitle className="text-3xl font-headline">ברוכים הבאים</CardTitle>
            <CardDescription className="text-primary-foreground/70">
              התחבר כדי לשמור את מדריכי הלימוד שלך
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl text-center">
                {error}
              </div>
            )}

            {/* Google Sign-In */}
            <Button
              variant="outline"
              onClick={handleGoogleSignIn}
              className="w-full h-14 rounded-xl gap-3 text-base font-medium border-2 hover:bg-muted/50 transition-all"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
              )}
              התחבר עם Google
            </Button>

            {/* Separator */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">או</span>
              </div>
            </div>

            {/* Anonymous */}
            <Button
              variant="ghost"
              onClick={handleAnonymous}
              className="w-full h-12 rounded-xl gap-2 text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
            >
              <Ghost className="w-5 h-5" /> כניסה אנונימית
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

