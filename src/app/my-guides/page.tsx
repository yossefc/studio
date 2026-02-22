'use client';

import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ExternalLink, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { hebrewToNumber } from '@/lib/hebrew-utils';

interface StudyGuideEntity {
  id: string;
  userId: string;
  tref: string;
  summaryText: string;
  googleDocUrl: string;
  createdAt: string;
}

/** Extract the siman number from a tref like "אורח חיים א':ב'" */
function extractSimanNumber(tref: string): number {
  // tref format: "{section} {simanHeb}:{seifHeb}" or "{section} {simanHeb}"
  const parts = tref.split(' ');
  if (parts.length < 2) return 0;
  // Last meaningful part before colon is the siman
  const lastPart = parts[parts.length - 1];
  const simanPart = lastPart.split(':')[0];
  return hebrewToNumber(simanPart);
}

export default function MyGuidesPage() {
  const { user, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();
  const [searchTerm, setSearchTerm] = useState('');

  const guidesQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, 'users', user.uid, 'studyGuides'),
      orderBy('createdAt', 'desc')
    );
  }, [user, firestore]);

  const { data: guides, isLoading: isDataLoading } = useCollection<StudyGuideEntity>(guidesQuery);

  const sortedGuides = useMemo(() => {
    if (!guides) return [];
    return [...guides]
      .filter(guide =>
        guide.tref.toLowerCase().includes(searchTerm.toLowerCase()) ||
        guide.summaryText?.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => extractSimanNumber(a.tref) - extractSimanNumber(b.tref));
  }, [guides, searchTerm]);

  const isLoading = isAuthLoading || isDataLoading;

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navigation />
      <main className="pt-24 px-6 max-w-4xl mx-auto w-full">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-headline text-primary mb-1">הספרייה שלי</h1>
            <p className="text-muted-foreground text-sm">כל מדריכי הלימוד שיצרת במקום אחד.</p>
          </div>
          <Button asChild className="rounded-xl h-10 px-6 text-sm gap-2 shadow-sm">
            <Link href="/generate">
              <Plus className="w-4 h-4" />
              <span>מדריך חדש</span>
            </Link>
          </Button>
        </header>

        {!user && !isLoading ? (
          <Card className="text-center py-16 rounded-2xl border-dashed">
            <CardContent className="space-y-4">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
              <h2 className="text-xl font-bold">התחבר כדי לראות את ההיסטוריה שלך</h2>
              <Button asChild variant="outline" className="rounded-xl h-10">
                <Link href="/">חזור לדף הבית</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {guides && guides.length > 0 && (
              <div className="relative group">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="חפש במדריכים..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-10 pr-10 rounded-xl border-none shadow-sm text-sm bg-white"
                />
              </div>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : !guides || guides.length === 0 ? (
              <div className="text-center py-16 space-y-4 bg-white rounded-2xl border border-dashed">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
                <div className="space-y-2">
                  <h2 className="text-xl font-bold">הספרייה שלך עדיין ריקה</h2>
                  <p className="text-muted-foreground text-sm max-w-sm mx-auto">כאן יופיעו כל המדריכים החכמים שתייצר.</p>
                </div>
                <Button asChild className="rounded-xl h-10 px-6 text-sm shadow-sm">
                  <Link href="/generate">צור את המדריך הראשון שלי</Link>
                </Button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 bg-muted/40 border-b text-xs font-bold text-muted-foreground">
                  <span>מקור</span>
                  <span className="w-24 text-center">תאריך</span>
                  <span className="w-10" />
                </div>
                {/* Rows */}
                {sortedGuides.map((guide, idx) => (
                  <div
                    key={guide.id}
                    className={`grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors ${idx < sortedGuides.length - 1 ? 'border-b border-muted/60' : ''}`}
                  >
                    <span className="font-semibold text-sm truncate">{guide.tref}</span>
                    <span className="w-24 text-center text-xs text-muted-foreground">
                      {guide.createdAt ? new Date(guide.createdAt).toLocaleDateString('he-IL') : '—'}
                    </span>
                    {guide.googleDocUrl ? (
                      <a
                        href={guide.googleDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Docs</span>
                      </a>
                    ) : (
                      <span className="h-8 px-3 inline-flex items-center rounded-lg text-xs text-muted-foreground bg-muted/50">
                        טרם יוצא
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
