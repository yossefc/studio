'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { BookOpen, History, PlusCircle, User as UserIcon, LogOut, Shield, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser, useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { signOut } from 'firebase/auth';
import { checkSubscriptionStatus, checkAdminStatus } from '@/app/actions/payment';

export function Navigation() {
  const pathname = usePathname();
  const { user } = useUser();
  const auth = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const lastCheckedUid = useRef<string | null>(null);

  // Check subscription and admin status via server actions
  useEffect(() => {
    if (!user) {
      setIsSubscribed(false);
      setIsAdmin(false);
      lastCheckedUid.current = null;
      return;
    }

    // Avoid re-fetching for the same user
    if (lastCheckedUid.current === user.uid) {
      return;
    }

    const checkUserStatus = async () => {
      try {
        // Fetch both in parallel
        const [subStatus, adminStatus] = await Promise.all([
          checkSubscriptionStatus(),
          checkAdminStatus(),
        ]);
        setIsSubscribed(subStatus.isActive);
        setIsAdmin(adminStatus.isAdmin);
        lastCheckedUid.current = user.uid;
      } catch (error) {
        console.warn('[Navigation] Status check failed:', error);
        setIsSubscribed(false);
        setIsAdmin(false);
        lastCheckedUid.current = user.uid;
      }
    };

    checkUserStatus();
  }, [user]);

  const handleLogout = () => {
    if (auth) signOut(auth);
  };

  const canGenerate = isAdmin || isSubscribed;

  // Links for users who CAN generate
  const fullLinks = [
    { href: '/', label: 'ראשי', icon: BookOpen },
    { href: '/generate', label: 'בניית דף', icon: PlusCircle },
    { href: '/my-guides', label: 'הביאורים שלי', icon: History },
  ];

  // Links for FREE users - no generate button
  const freeLinks = [
    { href: '/', label: 'ראשי', icon: BookOpen },
    { href: '/my-guides', label: 'הביאורים שלי', icon: History },
  ];

  const links = canGenerate ? fullLinks : freeLinks;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-white px-6 py-2 md:top-0 md:bottom-auto md:justify-start md:gap-8 print:hidden">
      <div className="ml-8 hidden text-xl font-bold font-headline text-primary md:block">Talmud</div>

      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors md:flex-row md:gap-2 md:text-sm',
            pathname === href ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </Link>
      ))}

      {/* Upgrade CTA for free users */}
      {user && !canGenerate && (
        <Link
          href="/pricing"
          className={cn(
            'flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors md:flex-row md:gap-2 md:text-sm',
            'bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700 shadow-sm',
          )}
        >
          <Crown className="h-5 w-5" />
          <span>שדרג עכשיו</span>
        </Link>
      )}

      {isAdmin && (
        <Link
          href="/admin/dashboard"
          className={cn(
            'flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors md:flex-row md:gap-2 md:text-sm',
            pathname.startsWith('/admin') ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Shield className="h-5 w-5" />
          <span>ניהול</span>
        </Link>
      )}

      <div className="mr-auto flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-4">
            {user.email && (
              <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
                <UserIcon className="h-4 w-4" />
                <span>{user.email}</span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2 text-muted-foreground hover:text-destructive">
              <LogOut className="h-4 w-4" />
              <span className="hidden md:inline">התנתק</span>
            </Button>
          </div>
        ) : (
          <Button asChild variant="default" size="sm" className="rounded-lg">
            <Link href="/login" className="gap-2">
              <UserIcon className="h-4 w-4" />
              <span>התחברות</span>
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
