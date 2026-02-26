'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, History, PlusCircle, User as UserIcon, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser, useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { signOut } from 'firebase/auth';

export function Navigation() {
  const pathname = usePathname();
  const { user } = useUser();
  const auth = useAuth();

  const handleLogout = () => {
    if (auth) signOut(auth);
  };

  const links = [
    { href: '/', label: 'ראשי', icon: BookOpen },
    { href: '/generate', label: 'צור מדריך', icon: PlusCircle },
    { href: '/my-guides', label: 'המדריכים שלי', icon: History },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-border py-2 px-6 flex justify-around items-center z-50 md:top-0 md:bottom-auto md:justify-start md:gap-8 print:hidden">
      <div className="hidden md:block font-headline text-primary text-xl font-bold ml-8">TalmudAI</div>

      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex flex-col items-center gap-1 text-xs font-medium transition-colors md:flex-row md:text-sm md:gap-2 px-3 py-1 rounded-md",
            pathname === href ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="w-5 h-5" />
          <span>{label}</span>
        </Link>
      ))}

      <div className="flex items-center gap-4 mr-auto">
        {user ? (
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <UserIcon className="w-4 h-4" />
              <span>{user.email || 'משתמש אנונימי'}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-destructive gap-2">
              <LogOut className="w-4 h-4" />
              <span className="hidden md:inline">התנתק</span>
            </Button>
          </div>
        ) : (
          <Button asChild variant="default" size="sm" className="rounded-lg">
            <Link href="/login" className="gap-2">
              <UserIcon className="w-4 h-4" />
              <span>התחברות</span>
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
