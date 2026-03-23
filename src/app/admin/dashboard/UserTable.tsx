'use client';

import { useTransition } from 'react';
import { Shield, ShieldOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { promoteToAdmin, revokeAdmin, setSubscriptionActive } from '@/app/actions/admin-dashboard';
import type { DashboardUser } from '@/app/actions/admin-dashboard';

interface UserTableProps {
  users: DashboardUser[];
  currentUid: string;
}

function formatIls(value: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function UserTable({ users, currentUid }: UserTableProps) {
  const [isPending, startTransition] = useTransition();

  function handlePromote(uid: string) {
    startTransition(async () => {
      await promoteToAdmin(uid);
      // Reload to reflect the change
      window.location.reload();
    });
  }

  function handleRevoke(uid: string) {
    startTransition(async () => {
      await revokeAdmin(uid);
      window.location.reload();
    });
  }

  function handleToggleSub(uid: string, activate: boolean) {
    startTransition(async () => {
      await setSubscriptionActive(uid, activate);
      window.location.reload();
    });
  }

  if (users.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">אין משתמשים להצגה.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">דואר אלקטרוני</th>
            <th className="px-4 py-3 text-left font-medium">UID</th>
            <th className="px-4 py-3 text-left font-medium">תפקיד</th>
            <th className="px-4 py-3 text-left font-medium">מנוי</th>
            <th className="px-4 py-3 text-left font-medium">תשלום מצטבר</th>
            <th className="px-4 py-3 text-left font-medium">פעולות</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {users.map((user) => {
            const isSelf = user.uid === currentUid;
            const isAdmin = user.role === 'admin';

            return (
              <tr key={user.uid} className={user.disabled ? 'opacity-50' : ''}>
                {/* Email */}
                <td className="max-w-[200px] truncate px-4 py-3 font-medium">
                  {user.email ?? <span className="text-muted-foreground">—</span>}
                </td>

                {/* UID */}
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {user.uid.slice(0, 12)}…
                </td>

                {/* Role badge */}
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      <Shield className="h-3 w-3" />
                      מנהל
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">משתמש</span>
                  )}
                </td>

                {/* Subscription */}
                <td className="px-4 py-3">
                  {user.isSubscriptionActive ? (
                    <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                      פעיל — {user.planId ?? 'standard'}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      חינמי
                    </span>
                  )}
                </td>

                {/* Revenue */}
                <td className="px-4 py-3 font-semibold text-primary">
                  {user.totalSpent > 0 ? formatIls(user.totalSpent) : '—'}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {/* Subscription toggle */}
                    {!isSelf && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={
                          user.isSubscriptionActive
                            ? 'h-7 rounded-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive'
                            : 'h-7 rounded-full text-xs text-green-700 hover:bg-green-50 hover:text-green-800'
                        }
                        disabled={isPending}
                        onClick={() => handleToggleSub(user.uid, !user.isSubscriptionActive)}
                      >
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : user.isSubscriptionActive ? (
                          'בטל מנוי'
                        ) : (
                          'הפעל מנוי'
                        )}
                      </Button>
                    )}

                    {/* Admin role toggle */}
                    {isSelf ? (
                      <span className="text-xs text-muted-foreground">אתה</span>
                    ) : isAdmin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 rounded-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isPending}
                        onClick={() => handleRevoke(user.uid)}
                      >
                        <ShieldOff className="h-3 w-3" />
                        בטל מנהל
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 rounded-full text-xs"
                        disabled={isPending}
                        onClick={() => handlePromote(user.uid)}
                      >
                        <Shield className="h-3 w-3" />
                        קדם למנהל
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
