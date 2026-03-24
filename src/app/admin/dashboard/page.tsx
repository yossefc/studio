import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Users, CreditCard, TrendingUp, Shield, Book } from 'lucide-react';
import { Navigation } from '@/components/Navigation';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { isAdminUser } from '@/lib/admin-role';
import { getDashboardStats, listDashboardUsers } from '@/app/actions/admin-dashboard';
import { UserTable } from './UserTable';
import { PricingConfigSection } from './PricingConfig';

function formatIls(value: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function AdminDashboardPage() {
  // Server-side auth + admin check
  let authUser;
  try {
    authUser = await getAuthenticatedUser();
  } catch {
    redirect('/login');
  }

  const adminAccess = await isAdminUser(authUser);
  if (!adminAccess) redirect('/');

  // Fetch data in parallel
  const [stats, users] = await Promise.all([
    getDashboardStats(),
    listDashboardUsers(500),
  ]);

  return (
    <div className="min-h-screen bg-background pb-32" dir="rtl">
      <Navigation />
      <main className="mx-auto w-full max-w-5xl px-6 pt-24">

        {/* Back link */}
        <div className="mb-4">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-sm text-muted-foreground shadow-sm hover:bg-muted/30 hover:text-foreground transition-colors"
          >
            <Book className="h-3.5 w-3.5" />
            ניהול ביאורים
          </Link>
        </div>

        {/* Header */}
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary">לוח בקרה — מנהל</h1>
            <p className="text-sm text-muted-foreground">סטטיסטיקות ומשתמשים</p>
          </div>
        </header>

        {/* KPI Cards */}
        <section className="mb-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              סך משתמשים
            </div>
            <div className="text-3xl font-extrabold text-primary">{stats.totalUsers}</div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CreditCard className="h-4 w-4" />
              מנויים פעילים
            </div>
            <div className="text-3xl font-extrabold text-primary">{stats.activeSubscriptions}</div>
            {stats.totalUsers > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {Math.round((stats.activeSubscriptions / stats.totalUsers) * 100)}% מכלל המשתמשים
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              הכנסות מצטברות
            </div>
            <div className="text-3xl font-extrabold text-primary">
              {formatIls(stats.totalRevenueIls)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              מבוסס תשלומי PayPlus
            </div>
          </div>
        </section>

        {/* Pricing Configuration */}
        <section className="mb-10">
          <PricingConfigSection />
        </section>

        {/* User Management */}
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-primary">ניהול משתמשים</h2>
            <span className="text-xs text-muted-foreground">{users.length} משתמשים</span>
          </div>
          <UserTable users={users} currentUid={authUser.uid} />
        </section>

      </main>
    </div>
  );
}
