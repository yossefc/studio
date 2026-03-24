'use client';

import { useState, useEffect } from 'react';
import { Check, Zap, Crown, Sparkles, Shield, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createCheckoutSession, createTopUpSession } from '@/app/actions/payment';
import { getPricingConfig, type PricingPlan } from '@/app/actions/admin-pricing';
import { useUser } from '@/firebase';
import Link from 'next/link';

interface PricingCardProps {
  title: string;
  titleHe: string;
  price: number;
  period?: string;
  features: string[];
  icon: React.ReactNode;
  popular?: boolean;
  onSubscribe: () => Promise<void>;
  isLoading?: boolean;
  isLoggedIn: boolean;
  buttonText: string;
  variant?: 'default' | 'premium' | 'topup';
}

function PricingCard({
  title,
  titleHe,
  price,
  period,
  features,
  icon,
  popular,
  onSubscribe,
  isLoading,
  isLoggedIn,
  buttonText,
  variant = 'default',
}: PricingCardProps) {
  const variantStyles = {
    default: {
      border: 'border-border',
      bg: 'bg-white',
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
      button: 'bg-primary hover:bg-primary/90',
    },
    premium: {
      border: 'border-amber-300 ring-2 ring-amber-200',
      bg: 'bg-gradient-to-b from-amber-50 to-white',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      button: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700',
    },
    topup: {
      border: 'border-green-200',
      bg: 'bg-green-50/50',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      button: 'bg-green-600 hover:bg-green-700',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={`relative rounded-2xl border ${styles.border} ${styles.bg} p-6 shadow-sm transition-shadow hover:shadow-md`}
      dir="rtl"
    >
      {popular && (
        <div className="absolute -top-3 right-4 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
          הכי פופולרי
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className={`rounded-xl ${styles.iconBg} p-3`}>
          <div className={styles.iconColor}>{icon}</div>
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">{titleHe}</h3>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-end gap-1">
          <span className="text-4xl font-extrabold text-foreground">{price}</span>
          <span className="text-xl font-bold text-foreground mb-1">₪</span>
          {period && <span className="text-sm text-muted-foreground mb-1">/ {period}</span>}
        </div>
      </div>

      <ul className="space-y-2.5 mb-6">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 mt-0.5">
              <Check className="h-3 w-3 text-green-600" strokeWidth={3} />
            </span>
            {feature}
          </li>
        ))}
      </ul>

      {isLoggedIn ? (
        <Button
          onClick={onSubscribe}
          disabled={isLoading}
          className={`w-full h-12 rounded-xl text-base font-semibold text-white ${styles.button}`}
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : buttonText}
        </Button>
      ) : (
        <Button asChild className={`w-full h-12 rounded-xl text-base font-semibold text-white ${styles.button}`}>
          <Link href="/login">התחבר כדי להירשם</Link>
        </Button>
      )}
    </div>
  );
}

export function PricingCards() {
  const { user } = useUser();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PricingPlan[] | null>(null);

  // Load pricing config on mount
  useEffect(() => {
    getPricingConfig()
      .then((config) => setPlans(config.plans.filter(p => p.isActive)))
      .catch(() => {
        // Fallback to default values if config fails to load
        setPlans([
          { id: 'standard', name: 'Standard', nameHe: 'מסלול בסיסי', price: 14, period: 'month', credits: 30, features: ['30 ביאורים בחודש', 'גישה מלאה לשולחן ערוך', 'ייצוא ל-Google Docs', 'ביאור משנה ברורה ובית יוסף', 'ביטול בכל עת'], isActive: true },
          { id: 'premium', name: 'Premium', nameHe: 'מסלול פרימיום', price: 29, period: 'month', credits: 100, features: ['100 ביאורים בחודש', 'מנוע AI מתקדם (Gemini Pro)', 'ניתוח מעמיק יותר', 'עדיפות בתור העיבוד', 'תמיכה מועדפת'], isActive: true },
          { id: 'topup', name: 'Top-up', nameHe: 'הוספת קרדיטים', price: 5, period: 'one-time', credits: 10, features: ['10 ביאורים נוספים', 'תשלום חד פעמי', 'ללא התחייבות', 'שימוש מיידי'], isActive: true },
        ]);
      });
  }, []);

  const standardPlan = plans?.find(p => p.id === 'standard');
  const premiumPlan = plans?.find(p => p.id === 'premium');
  const topupPlan = plans?.find(p => p.id === 'topup');

  const handleStandardSubscribe = async () => {
    setLoadingPlan('standard');
    setError(null);
    try {
      const result = await createCheckoutSession();
      if ('url' in result && result.url) {
        window.location.href = result.url;
      } else if ('error' in result) {
        setError(result.error || 'שגיאה בהתחברות למערכת התשלום');
        console.error('[Payment] Checkout error:', result.error);
      }
    } catch (err) {
      setError('שגיאה בהתחברות למערכת התשלום. נסה שוב.');
      console.error('[Payment] Checkout exception:', err);
    } finally {
      setLoadingPlan(null);
    }
  };

  const handlePremiumSubscribe = async () => {
    setLoadingPlan('premium');
    setError(null);
    try {
      // For now, premium uses same checkout - can be updated later
      const result = await createCheckoutSession();
      if ('url' in result && result.url) {
        window.location.href = result.url;
      } else if ('error' in result) {
        setError(result.error || 'שגיאה בהתחברות למערכת התשלום');
        console.error('[Payment] Checkout error:', result.error);
      }
    } catch (err) {
      setError('שגיאה בהתחברות למערכת התשלום. נסה שוב.');
      console.error('[Payment] Checkout exception:', err);
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleTopUp = async () => {
    setLoadingPlan('topup');
    setError(null);
    try {
      const result = await createTopUpSession();
      if ('url' in result && result.url) {
        window.location.href = result.url;
      } else if ('error' in result) {
        setError(result.error || 'שגיאה בהתחברות למערכת התשלום');
        console.error('[Payment] Top-up error:', result.error);
      }
    } catch (err) {
      setError('שגיאה בהתחברות למערכת התשלום. נסה שוב.');
      console.error('[Payment] Top-up exception:', err);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="w-full" dir="rtl">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold font-headline text-foreground mb-3">
          בחר את המסלול שלך
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          גישה מלאה לכל תכני השולחן ערוך עם ביאורים מותאמים אישית למבחני הרבנות
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 mx-auto max-w-md rounded-xl bg-red-50 border border-red-200 p-4 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-red-600 underline hover:text-red-800"
          >
            סגור
          </button>
        </div>
      )}

      {/* Cards Grid */}
      {!plans ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {/* Standard Plan */}
          {standardPlan && (
            <PricingCard
              title={standardPlan.name}
              titleHe={standardPlan.nameHe}
              price={standardPlan.price}
              period="חודש"
              icon={<Zap className="h-6 w-6" />}
              features={standardPlan.features}
              onSubscribe={handleStandardSubscribe}
              isLoading={loadingPlan === 'standard'}
              isLoggedIn={!!user}
              buttonText="התחל עכשיו"
              variant="default"
              popular
            />
          )}

          {/* Premium Plan */}
          {premiumPlan && (
            <PricingCard
              title={premiumPlan.name}
              titleHe={premiumPlan.nameHe}
              price={premiumPlan.price}
              period="חודש"
              icon={<Crown className="h-6 w-6" />}
              features={premiumPlan.features}
              onSubscribe={handlePremiumSubscribe}
              isLoading={loadingPlan === 'premium'}
              isLoggedIn={!!user}
              buttonText="שדרג לפרימיום"
              variant="premium"
            />
          )}

          {/* Top-up */}
          {topupPlan && (
            <PricingCard
              title={topupPlan.name}
              titleHe={topupPlan.nameHe}
              price={topupPlan.price}
              icon={<Sparkles className="h-6 w-6" />}
              features={topupPlan.features}
              onSubscribe={handleTopUp}
              isLoading={loadingPlan === 'topup'}
              isLoggedIn={!!user}
              buttonText="רכוש קרדיטים"
              variant="topup"
            />
          )}
        </div>
      )}

      {/* Trust badges */}
      <div className="mt-10 flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-green-600" />
          <span>תשלום מאובטח 100%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-blue-600">PayPlus</span>
          <span>|</span>
          <span className="font-semibold text-purple-600">Bit</span>
          <span>|</span>
          <span>כרטיס אשראי</span>
        </div>
      </div>
    </div>
  );
}
