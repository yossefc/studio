'use client';

import { Loader2, BookOpen, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscribe: () => void;
  isLoading?: boolean;
}

const FEATURES = [
  'גישה מלאה לכל השולחן ערוך',
  '30 הפקות לחודש',
  'ייצוא ל-Google Docs',
  'ביאור משנה ברורה, בית יוסף, רב עובדיה',
];

export function PaywallModal({
  isOpen,
  onClose,
  onSubscribe,
  isLoading = false,
}: PaywallModalProps) {
  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="הצטרף לתלמוד AI"
    >
      <div
        className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
        dir="rtl"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute left-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label="סגור"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="bg-primary px-8 pt-10 pb-8 text-center text-primary-foreground">
          <div className="mb-3 flex justify-center">
            <div className="rounded-2xl bg-white/20 p-3">
              <BookOpen className="h-8 w-8" />
            </div>
          </div>
          <h2 className="text-2xl font-bold">הצטרף לתלמוד AI</h2>
          <p className="mt-1 text-sm text-primary-foreground/70">
            גישה מלאה לכל תכני הפסיקה
          </p>
        </div>

        {/* Price */}
        <div className="px-8 pt-6">
          <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 py-4 text-center">
            <div className="flex items-end justify-center gap-1">
              <span className="text-5xl font-extrabold text-primary leading-none">14</span>
              <div className="mb-1 flex flex-col items-start">
                <span className="text-xl font-bold text-primary">₪</span>
                <span className="text-xs text-gray-500">לחודש</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-400">ביטול בכל עת</p>
          </div>
        </div>

        {/* Features */}
        <ul className="px-8 py-5 space-y-2.5">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2.5 text-sm text-gray-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100">
                <Check className="h-3 w-3 text-green-600" strokeWidth={3} />
              </span>
              {feature}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="px-8 pb-8 space-y-3">
          <Button
            className="w-full h-12 rounded-xl text-base font-semibold"
            onClick={onSubscribe}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              'הירשם עכשיו'
            )}
          </Button>
          <p className="text-center text-xs text-gray-400">
            תשלום מאובטח דרך{' '}
            <span className="font-semibold text-gray-500">PayPlus</span>
            {' '}&#xB7; ניתן לשלם ב-
            <span className="font-semibold text-gray-500">Bit</span>
            {' '}או כרטיס אשראי
          </p>
          <button
            onClick={onClose}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            אולי מאוחר יותר
          </button>
        </div>
      </div>
    </div>
  );
}
