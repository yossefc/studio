'use client';

import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Calendar, ExternalLink, ChevronLeft, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface StudyGuideEntity {
  id: string;
  userId: string;
  tref: string;
  summaryText: string;
  googleDocUrl: string;
  createdAt: string;
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

  const filteredGuides = guides?.filter(guide => 
    guide.tref.toLowerCase().includes(searchTerm.toLowerCase()) ||
    guide.summaryText?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isLoading = isAuthLoading || isDataLoading;

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navigation />
      <main className="pt-24 px-6 max-w-4xl mx-auto w-full">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-4xl font-headline text-primary mb-2">הספרייה שלי</h1>
            <p className="text-muted-foreground">כל מדריכי הלימוד שיצרת במקום אחד.</p>
          </div>
          <Button asChild className="rounded-2xl h-14 px-8 text-lg gap-2 shadow-lg shadow-primary/20">
            <Link href="/generate">
              <Plus className="w-5 h-5" />
              <span>מדריך חדש</span>
            </Link>
          </Button>
        </header>

        {!user && !isLoading ? (
          <Card className="text-center py-20 rounded-3xl border-dashed">
            <CardContent className="space-y-6">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto">
                <FileText className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-bold">התחבר כדי לראות את ההיסטוריה שלך</h2>
              <Button asChild variant="outline" className="rounded-xl h-12">
                <Link href="/">חזור לדף הבית</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {guides && guides.length > 0 && (
              <div className="relative group">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input 
                  placeholder="חפש במדריכים..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-14 pr-12 rounded-2xl border-none shadow-sm text-lg bg-white"
                />
              </div>
            )}

            {isLoading ? (
              <div className="space-y-6">
                <Skeleton className="h-40 w-full rounded-[2rem]" />
                <Skeleton className="h-40 w-full rounded-[2rem]" />
              </div>
            ) : !guides || guides.length === 0 ? (
              <div className="text-center py-24 space-y-8 bg-white rounded-[2rem] border border-dashed">
                <div className="w-24 h-24 bg-muted/50 rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                  <FileText className="w-12 h-12" />
                </div>
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold">הספרייה שלך עדיין ריקה</h2>
                  <p className="text-muted-foreground max-w-sm mx-auto">כאן יופיעו כל המדריכים החכמים שתייצר.</p>
                </div>
                <Button asChild className="rounded-2xl h-14 px-10 text-lg shadow-md">
                  <Link href="/generate">צור את המדריך הראשון שלי</Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-6">
                {filteredGuides?.map((guide) => (
                  <Card key={guide.id} className="group overflow-hidden rounded-[2rem] border-none shadow-sm hover:shadow-xl transition-all duration-300 bg-white">
                    <CardContent className="p-0 flex flex-col md:flex-row md:items-stretch">
                      <div className="p-8 flex-grow space-y-4">
                        <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground bg-muted/50 w-fit px-4 py-1.5 rounded-full">
                          <Calendar className="w-4 h-4" />
                          <span>{guide.createdAt ? new Date(guide.createdAt).toLocaleDateString('he-IL') : 'תאריך לא ידוע'}</span>
                        </div>
                        <h3 className="text-2xl font-bold font-headline group-hover:text-primary transition-colors">
                          {guide.tref}
                        </h3>
                        <p className="text-muted-foreground text-lg line-clamp-2 leading-relaxed">
                          {guide.summaryText}
                        </p>
                      </div>
                      <div className="bg-muted/10 p-6 md:w-56 flex flex-row md:flex-col justify-center items-center gap-4 border-t md:border-t-0 md:border-r border-muted">
                        <Button asChild variant="secondary" className="w-full h-14 rounded-2xl text-primary font-bold gap-2">
                          <a href={guide.googleDocUrl} target="_blank" rel="noopener noreferrer">
                            <span>פתח במסמך</span>
                            <ExternalLink className="w-5 h-5" />
                          </a>
                        </Button>
                        <Button variant="ghost" className="w-full h-14 rounded-2xl gap-2 group/btn">
                          <span className="font-medium">פרטים</span>
                          <ChevronLeft className="w-5 h-5 text-muted-foreground group-hover/btn:translate-x-[-4px] transition-transform" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
