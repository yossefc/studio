import { Button } from "@/components/ui/button";
import { Navigation } from "@/components/Navigation";
import { PricingCards } from "@/components/PricingCards";
import Link from "next/link";
import { Sparkles, BookCheck, ShieldCheck, FileText, Wand2, Download, ArrowLeft } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Navigation />

      <main className="flex-grow pt-24 pb-32">
        {/* Hero Section */}
        <section className="text-center mb-20 px-6 max-w-4xl mx-auto" dir="rtl">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            <span>הסייע האישי שלך ללימוד הלכה</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-headline text-foreground leading-tight mb-6">
            הפוך את הלימוד שלך
            <br />
            <span className="text-primary">למדריך הלכתי מעשי</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Talmud AI מנתח טקסטים מהשולחן ערוך, הטור, הבית יוסף והמשנה ברורה,
            מסביר אותם בשפה ברורה ומסכם את ההלכה למעשה — מותאם במיוחד למבחני הרבנות.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white px-8 h-14 rounded-xl text-lg gap-2 w-full sm:w-auto">
              <Link href="/pricing">
                התחל עכשיו
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-14 rounded-xl px-8 text-lg w-full sm:w-auto">
              <Link href="/generate">צפה בדוגמה חינמית</Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground mt-4">
            ניתן לנסות את{" "}
            <Link href="/generate" className="underline underline-offset-2 hover:text-foreground transition-colors">
              אורח חיים סימן א׳
            </Link>
            {" "}בחינם ללא חשבון
          </p>
        </section>

        {/* How it Works Section */}
        <section className="bg-muted/30 py-16 mb-20" dir="rtl">
          <div className="px-6 max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold font-headline text-center mb-4">איך זה עובד?</h2>
            <p className="text-muted-foreground text-center mb-12 max-w-xl mx-auto">
              בשלושה שלבים פשוטים תקבל ביאור מקצועי ומותאם אישית
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              <StepCard
                step={1}
                icon={<FileText className="h-6 w-6" />}
                title="בחר סימן וסעיף"
                description="בחר את המקור שברצונך ללמוד — שולחן ערוך, טור, בית יוסף, משנה ברורה או שילוב ביניהם."
              />
              <StepCard
                step={2}
                icon={<Wand2 className="h-6 w-6" />}
                title="קבל ביאור מפורט"
                description="המערכת מנתחת את הטקסט, מחלקת אותו לקטעים קריאים ומסבירה כל קטע בשפה ברורה."
              />
              <StepCard
                step={3}
                icon={<Download className="h-6 w-6" />}
                title="ייצא ל-Google Docs"
                description="ייצא את הביאור למסמך מעוצב ומוכן להדפסה — מושלם לחזרה לפני מבחנים."
              />
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="px-6 max-w-4xl mx-auto mb-20" dir="rtl">
          <h2 className="text-3xl font-bold font-headline text-center mb-12">למה Talmud AI?</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Sparkles className="text-amber-500" />}
              title="ניתוח חכם"
              description="חלוקה למקטעים קצרים וקריאים עם הסבר ממוקד לכל קטע, בדיוק כמו שיעור פרטי."
            />
            <FeatureCard
              icon={<BookCheck className="text-primary" />}
              title="הלכה למעשה"
              description="סיכום מתומצת המתמקד במסקנות ההלכתיות — מה שצריך לדעת למבחן ולחיים."
            />
            <FeatureCard
              icon={<ShieldCheck className="text-green-600" />}
              title="ריבוי מקורות"
              description="שילוב חכם של טור, בית יוסף, שולחן ערוך ומשנה ברורה בביאור אחד מקיף."
            />
          </div>
        </section>

        {/* Pricing Section */}
        <section className="px-6 max-w-5xl mx-auto mb-20" id="pricing">
          <PricingCards />
        </section>

        {/* CTA Section */}
        <section className="bg-primary text-primary-foreground py-16 px-6" dir="rtl">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold font-headline mb-4">מוכן להתחיל?</h2>
            <p className="text-primary-foreground/80 mb-8">
              הצטרף לאלפי לומדים שכבר משתמשים ב-Talmud AI להכנה למבחני הרבנות
            </p>
            <Button asChild size="lg" variant="secondary" className="h-14 px-8 rounded-xl text-lg">
              <Link href="/pricing">התחל את המסלול שלך</Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} Talmud AI. כל הזכויות שמורות.</p>
      </footer>
    </div>
  );
}

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="relative bg-white p-6 rounded-2xl shadow-sm border border-border">
      <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
        {step}
      </div>
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-bold font-headline mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
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
