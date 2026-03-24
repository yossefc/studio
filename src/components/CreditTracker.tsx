'use client';

import { useEffect, useState } from 'react';
import { Zap, AlertTriangle, Sparkles, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMonthlyUsageCount } from '@/app/actions/study-guide';
import { checkSubscriptionStatus, createTopUpSession } from '@/app/actions/payment';
import { useUser } from '@/firebase';
import Link from 'next/link';

interface CreditTrackerProps {
  compact?: boolean;
  onUpgradeClick?: () => void;
}

export function CreditTracker({ compact = false, onUpgradeClick }: CreditTrackerProps) {
  const { user } = useUser();
  const [usage, setUsage] = useState<{ count: number; limit: number } | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Check subscription status first
    checkSubscriptionStatus()
      .then((status) => {
        setIsSubscribed(status.isActive);
        if (status.isActive) {
          // Only fetch usage for subscribed users
          return getMonthlyUsageCount();
        }
        return null;
      })
      .then((usageData) => {
        if (usageData) {
          setUsage(usageData);
        }
      })
      .catch(() => {
        setIsSubscribed(false);
      });
  }, [user]);

  if (!user) return null;

  // Still loading subscription status
  if (isSubscribed === null) return null;

  // User is NOT subscribed - show upgrade prompt instead of credit tracker
  if (!isSubscribed) {
    if (compact) {
      return (
        <Link href="/pricing" className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700">
          <Crown className="h-4 w-4" />
          <span>שדרג</span>
        </Link>
      );
    }

    return (
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-5 shadow-sm" dir="rtl">
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-full bg-amber-100 p-2">
            <Crown className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">שדרג לפרימיום</h3>
            <p className="text-xs text-muted-foreground">גישה מלאה לכל התכנים</p>
          </div>
        </div>

        <ul className="text-sm text-muted-foreground space-y-1.5 mb-4">
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            30 ביאורים בחודש
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            ייצוא ל-Google Docs
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            גישה לכל השולחן ערוך
          </li>
        </ul>

        <Button asChild className="w-full bg-amber-600 hover:bg-amber-700 text-white">
          <Link href="/pricing">
            <Crown className="h-4 w-4 ml-2" />
            התחל ב-14₪ לחודש
          </Link>
        </Button>
      </div>
    );
  }

  // User IS subscribed - show normal credit tracker
  if (!usage) return null;

  const percentUsed = Math.min((usage.count / usage.limit) * 100, 100);
  const remaining = Math.max(usage.limit - usage.count, 0);
  const isLow = percentUsed >= 80;
  const isEmpty = remaining === 0;

  const handleTopUp = async () => {
    setIsLoading(true);
    try {
      const result = await createTopUpSession();
      if ('url' in result && result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      console.error('Top-up error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Zap className={`h-4 w-4 ${isEmpty ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-primary'}`} />
        <span className="text-muted-foreground">
          {usage.count}/{usage.limit}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-sm" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`rounded-full p-2 ${isEmpty ? 'bg-red-100' : isLow ? 'bg-amber-100' : 'bg-primary/10'}`}>
            <Zap className={`h-5 w-5 ${isEmpty ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-primary'}`} />
          </div>
          <h3 className="font-semibold text-foreground">המכסה החודשית</h3>
        </div>
        <span className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1.5">
          <span className="text-foreground font-medium">
            נוצרו {usage.count} מתוך {usage.limit} ביאורים
          </span>
          <span className={`font-semibold ${isEmpty ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-green-600'}`}>
            {remaining} נותרו
          </span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isEmpty ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-primary'
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
      </div>

      {/* Warning / Upsell */}
      {(isLow || isEmpty) && (
        <div className={`rounded-xl p-3 ${isEmpty ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${isEmpty ? 'text-red-600' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${isEmpty ? 'text-red-800' : 'text-amber-800'}`}>
                {isEmpty ? 'נגמרה המכסה החודשית!' : 'המכסה עומדת להיגמר'}
              </p>
              <p className={`text-xs mt-0.5 ${isEmpty ? 'text-red-600' : 'text-amber-600'}`}>
                {isEmpty
                  ? 'לא ניתן ליצור ביאורים חדשים עד לחידוש החודשי'
                  : `נותרו לך רק ${remaining} ביאורים החודש`
                }
              </p>
            </div>
          </div>

          <Button
            onClick={handleTopUp}
            disabled={isLoading}
            size="sm"
            className={`w-full mt-3 gap-2 ${
              isEmpty
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {isLoading ? 'טוען...' : 'הוסף 10 ביאורים ב-5₪'}
          </Button>
        </div>
      )}

      {/* Normal state - subtle upsell */}
      {!isLow && !isEmpty && (
        <button
          onClick={onUpgradeClick || handleTopUp}
          className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors mt-2"
        >
          צריך עוד? הוסף קרדיט נוסף
        </button>
      )}
    </div>
  );
}
