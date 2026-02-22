
import { Button } from "@/components/ui/button";
import { Navigation } from "@/components/Navigation";
import Link from "next/link";
import { Sparkles, BookCheck, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Navigation />
      
      <main className="flex-grow pt-24 pb-32 px-6 max-w-4xl mx-auto w-full">
        <section className="text-center mb-16 space-y-6">
          <h1 className="text-4xl md:text-6xl font-headline text-primary leading-tight">
            הפוך את הלימוד שלך <br /> <span className="text-accent">למדריך הלכתי מעשי</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            TalmudAI משתמש בבינה מלאכותית מתקדמת כדי לנתח טקסטים תורניים, להסביר אותם בהקשרם ולסכם את המסקנות ההלכתיות למבחני הרבנות.
          </p>
          <div className="flex justify-center gap-4 pt-4">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white px-8 h-14 rounded-xl text-lg">
              <Link href="/generate">התחל עכשיו</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-14 rounded-xl px-8 text-lg">
              <Link href="/my-guides">צפה בהיסטוריה</Link>
            </Button>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-8 mt-12">
          <FeatureCard 
            icon={<Sparkles className="text-accent" />}
            title="ניתוח חכם"
            description="חלוקה למקטעים קצרים וקריאים עם הסבר ממוקד לכל קטע."
          />
          <FeatureCard 
            icon={<BookCheck className="text-primary" />}
            title="סיכום הלכתי"
            description="התמקדות ב'הלכה למעשה' המותאמת לדרישות מבחני הסמיכה."
          />
          <FeatureCard 
            icon={<ShieldCheck className="text-green-600" />}
            title="אינטגרציה עם Docs"
            description="ייצוא אוטומטי למסמכי Google Docs מעוצבים ומוכנים להדפסה."
          />
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-border flex flex-col items-center text-center space-y-4 hover:shadow-md transition-shadow">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
        {icon}
      </div>
      <h3 className="text-xl font-bold font-headline">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
