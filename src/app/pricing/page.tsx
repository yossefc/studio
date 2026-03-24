import { Navigation } from '@/components/Navigation';
import { PricingCards } from '@/components/PricingCards';

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Navigation />

      <main className="flex-grow pt-24 pb-32 px-6 max-w-5xl mx-auto w-full">
        <PricingCards />

        {/* FAQ Section */}
        <section className="mt-20" dir="rtl">
          <h2 className="text-2xl font-bold font-headline text-center mb-8">שאלות נפוצות</h2>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <FaqItem
              question="מה קורה אם נגמר לי הקרדיט באמצע החודש?"
              answer="תוכל לרכוש קרדיטים נוספים בכל עת בתשלום חד פעמי של 5₪ עבור 10 ביאורים. הקרדיטים הנוספים לא פוקעים."
            />
            <FaqItem
              question="האם אפשר לבטל בכל עת?"
              answer="כן! ניתן לבטל את המנוי בכל רגע. הגישה תישמר עד סוף תקופת החיוב הנוכחית."
            />
            <FaqItem
              question="מהם אמצעי התשלום?"
              answer="אנו מקבלים כרטיסי אשראי ישראליים ובינלאומיים, וכן תשלום באמצעות Bit. כל התשלומים מאובטחים דרך PayPlus."
            />
            <FaqItem
              question="מה ההבדל בין המסלולים?"
              answer="מסלול בסיסי מספק 30 ביאורים בחודש, בעוד מסלול פרימיום מציע 100 ביאורים עם מנוע AI מתקדם יותר לניתוח מעמיק."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-border">
      <h3 className="font-semibold text-foreground mb-2">{question}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{answer}</p>
    </div>
  );
}
