'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Save, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPricingConfig, updatePricingConfig, type PricingConfig, type PricingPlan } from '@/app/actions/admin-pricing';
import { useUser } from '@/firebase';

export function PricingConfigSection() {
  const { user } = useUser();
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    getPricingConfig()
      .then(setConfig)
      .catch(() => setError('Failed to load pricing config'))
      .finally(() => setIsLoading(false));
  }, []);

  const handlePlanChange = (planId: string, field: keyof PricingPlan, value: string | number | boolean) => {
    if (!config) return;

    const updatedPlans = config.plans.map(plan => {
      if (plan.id === planId) {
        return { ...plan, [field]: value };
      }
      return plan;
    });

    setConfig({ ...config, plans: updatedPlans });
  };

  const handleFeatureChange = (planId: string, featureIndex: number, value: string) => {
    if (!config) return;

    const updatedPlans = config.plans.map(plan => {
      if (plan.id === planId) {
        const newFeatures = [...plan.features];
        newFeatures[featureIndex] = value;
        return { ...plan, features: newFeatures };
      }
      return plan;
    });

    setConfig({ ...config, plans: updatedPlans });
  };

  const handleAddFeature = (planId: string) => {
    if (!config) return;

    const updatedPlans = config.plans.map(plan => {
      if (plan.id === planId) {
        return { ...plan, features: [...plan.features, ''] };
      }
      return plan;
    });

    setConfig({ ...config, plans: updatedPlans });
  };

  const handleRemoveFeature = (planId: string, featureIndex: number) => {
    if (!config) return;

    const updatedPlans = config.plans.map(plan => {
      if (plan.id === planId) {
        const newFeatures = plan.features.filter((_, i) => i !== featureIndex);
        return { ...plan, features: newFeatures };
      }
      return plan;
    });

    setConfig({ ...config, plans: updatedPlans });
  };

  const handleSave = async () => {
    if (!config || !user) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await user.getIdToken();
      const updated = await updatePricingConfig(token, config);
      setConfig(updated);
      setSuccess('התמחור נשמר בהצלחה');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('שגיאה בשמירת התמחור');
      console.error('[Admin] Save pricing error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-center text-muted-foreground">לא ניתן לטעון את הגדרות התמחור</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
            <DollarSign className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">הגדרות תמחור</h2>
            <p className="text-xs text-muted-foreground">
              {config.updatedBy && `עודכן לאחרונה ע"י ${config.updatedBy}`}
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          שמור שינויים
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {config.plans.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-xl border p-5 ${plan.isActive ? 'border-border' : 'border-dashed border-gray-300 bg-gray-50'}`}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    plan.id === 'standard' ? 'bg-blue-100 text-blue-700' :
                    plan.id === 'premium' ? 'bg-amber-100 text-amber-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {plan.id.toUpperCase()}
                  </span>
                  <button
                    onClick={() => handlePlanChange(plan.id, 'isActive', !plan.isActive)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {plan.isActive ? (
                      <><ToggleRight className="h-5 w-5 text-green-600" /> פעיל</>
                    ) : (
                      <><ToggleLeft className="h-5 w-5 text-gray-400" /> לא פעיל</>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">שם בעברית</label>
                    <input
                      type="text"
                      value={plan.nameHe}
                      onChange={(e) => handlePlanChange(plan.id, 'nameHe', e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">שם באנגלית</label>
                    <input
                      type="text"
                      value={plan.name}
                      onChange={(e) => handlePlanChange(plan.id, 'name', e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="text-left">
                <label className="text-xs text-muted-foreground block mb-1">מחיר (₪)</label>
                <input
                  type="number"
                  min="0"
                  value={plan.price}
                  onChange={(e) => handlePlanChange(plan.id, 'price', Number(e.target.value))}
                  className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-lg font-bold text-center"
                />
              </div>

              <div className="text-left">
                <label className="text-xs text-muted-foreground block mb-1">קרדיטים</label>
                <input
                  type="number"
                  min="0"
                  value={plan.credits}
                  onChange={(e) => handlePlanChange(plan.id, 'credits', Number(e.target.value))}
                  className="w-20 rounded-lg border border-input bg-background px-3 py-2 text-lg font-bold text-center"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-2">תכונות (כל שורה = תכונה)</label>
              <div className="space-y-2">
                {plan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feature}
                      onChange={(e) => handleFeatureChange(plan.id, idx, e.target.value)}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="תכונה..."
                      dir="rtl"
                    />
                    <button
                      onClick={() => handleRemoveFeature(plan.id, idx)}
                      className="text-xs text-red-500 hover:text-red-700 px-2"
                    >
                      מחק
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => handleAddFeature(plan.id)}
                  className="text-xs text-primary hover:underline"
                >
                  + הוסף תכונה
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
