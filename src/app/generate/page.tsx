'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Book, XCircle } from 'lucide-react';
import { generateMultiSourceStudyGuide, exportToGoogleDocs, type GenerationResult, type SourceResult } from '@/app/actions/study-guide';
import { getSimanOptions, getSeifOptions, type SimanOption, type SeifOption } from '@/app/actions/sefaria-metadata';
import type { SourceKey } from '@/lib/sefaria-api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

interface StudyGuideEntity {
  id: string;
  userId: string;
  tref: string;
  sefariaRef?: string;
  language: string;
  status: 'Pending' | 'Processing' | 'Preview' | 'Published' | 'Cancelled' | 'Failed';
  summaryText: string;
  googleDocUrl: string;
  googleDocId: string;
  validated?: boolean;
  sources?: SourceKey[];
  createdAt: string;
  updatedAt: string;
}

const SECTIONS = [
  { id: 'Orach Chayim', label: 'אורח חיים' },
  { id: 'Yoreh Deah', label: 'יורה דעה' },
  { id: 'Even HaEzer', label: 'אבן העזר' },
  { id: 'Choshen Mishpat', label: 'חושן משפט' },
];

const SOURCE_OPTIONS: { key: SourceKey; label: string; onlyOC: boolean }[] = [
  { key: 'tur', label: 'טור', onlyOC: false },
  { key: 'beit_yosef', label: 'בית יוסף', onlyOC: false },
  { key: 'shulchan_arukh', label: 'שולחן ערוך', onlyOC: false },
  { key: 'mishnah_berurah', label: 'משנה ברורה', onlyOC: true },
];

export default function GeneratePage() {
  const [section, setSection] = useState('Orach Chayim');
  const [siman, setSiman] = useState('1');
  const [seif, setSeif] = useState('1');
  const [selectedSources, setSelectedSources] = useState<SourceKey[]>(['shulchan_arukh']);

  // Dynamic dropdown options from Sefaria
  const [simanOptions, setSimanOptions] = useState<SimanOption[]>([]);
  const [seifOptions, setSeifOptions] = useState<SeifOption[]>([]);
  const [loadingSimanim, setLoadingSimanim] = useState(true);
  const [loadingSeifim, setLoadingSeifim] = useState(false);

  const [status, setStatus] = useState<'idle' | 'processing' | 'preview' | 'exporting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [currentGuideId, setCurrentGuideId] = useState<string | null>(null);
  const [guide, setGuide] = useState<StudyGuideEntity | null>(null);

  // Local state for preview
  const [previewSourceResults, setPreviewSourceResults] = useState<SourceResult[]>([]);
  const [previewSummary, setPreviewSummary] = useState('');
  const publishedDocUrl = guide?.googleDocUrl?.trim() ?? '';

  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Remove MB from selection when switching away from Orach Chayim
  useEffect(() => {
    if (section !== 'Orach Chayim') {
      setSelectedSources(prev => prev.filter(s => s !== 'mishnah_berurah'));
    }
  }, [section]);

  // Fetch simanim when section changes
  useEffect(() => {
    let cancelled = false;
    setLoadingSimanim(true);
    setSimanOptions([]);
    setSeifOptions([]);
    setSiman('1');
    setSeif('1');
    getSimanOptions(section).then(options => {
      if (!cancelled) {
        setSimanOptions(options);
        setLoadingSimanim(false);
      }
    });
    return () => { cancelled = true; };
  }, [section]);

  // Fetch seifim when siman changes
  const needsSeif = selectedSources.some(s => s === 'shulchan_arukh' || s === 'mishnah_berurah');

  const fetchSeifim = useCallback(async (sec: string, sim: string) => {
    const simanNum = parseInt(sim);
    if (!simanNum || simanNum < 1) return;
    setLoadingSeifim(true);
    setSeifOptions([]);
    setSeif('1');
    const options = await getSeifOptions(sec, simanNum);
    setSeifOptions(options);
    setLoadingSeifim(false);
  }, []);

  useEffect(() => {
    if (needsSeif && siman) {
      fetchSeifim(section, siman);
    }
  }, [siman, section, needsSeif, fetchSeifim]);

  const toggleSource = (key: SourceKey, checked: boolean) => {
    setSelectedSources(prev =>
      checked ? [...prev, key] : prev.filter(s => s !== key)
    );
  };

  const handleCancel = async () => {
    if (!currentGuideId || !user || !firestore) return;
    const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', currentGuideId);
    await updateDoc(guideRef, { status: 'Cancelled', updatedAt: new Date().toISOString() });
    setStatus('idle');
    setError('הפעולה בוטלה על ידי המשתמש.');
  };

  const handleGenerate = async () => {
    if (!siman || !user || !firestore || selectedSources.length === 0) return;
    if (needsSeif && !seif) return;

    setStatus('processing');
    setError('');

    const studyGuideId = `guide_${Date.now()}`;
    setCurrentGuideId(studyGuideId);

    const sectionLabel = SECTIONS.find(s => s.id === section)?.label || 'אורח חיים';
    const simanLabel = simanOptions.find(o => String(o.value) === siman)?.label || siman;
    const seifLabel = seifOptions.find(o => String(o.value) === seif)?.label || seif;
    const displayTref = `${sectionLabel} ${simanLabel}${needsSeif ? `:${seifLabel}` : ''}`;

    const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', studyGuideId);
    const now = new Date().toISOString();

    try {
      await setDoc(guideRef, {
        id: studyGuideId,
        userId: user.uid,
        tref: displayTref,
        sources: selectedSources,
        status: 'Processing',
        createdAt: now,
        updatedAt: now,
      });

      const result: GenerationResult = await generateMultiSourceStudyGuide(
        {
          section,
          siman,
          seif: needsSeif ? seif : undefined,
          sources: selectedSources,
        },
        user.uid,
        studyGuideId,
      );

      if (result.cancelled) {
        setStatus('idle');
        return;
      }

      if (result.success && result.guideData) {
        const { guideData } = result;
        const finalGuide: StudyGuideEntity = {
          id: studyGuideId,
          userId: user.uid,
          tref: displayTref,
          sefariaRef: guideData.tref,
          language: 'he',
          status: 'Preview',
          summaryText: guideData.summary,
          googleDocUrl: '',
          googleDocId: '',
          validated: guideData.validated,
          sources: guideData.sources,
          createdAt: now,
          updatedAt: new Date().toISOString(),
        };

        try {
          await setDoc(guideRef, finalGuide);

          // Store chunks per source
          for (const sr of guideData.sourceResults) {
            for (const chunk of sr.chunks) {
              const chunkRef = doc(firestore, 'users', user.uid, 'studyGuides', studyGuideId, 'textChunks', chunk.id);
              await setDoc(chunkRef, {
                id: chunk.id,
                studyGuideId: studyGuideId,
                userId: user.uid,
                sourceKey: sr.sourceKey,
                orderIndex: chunk.orderIndex,
                rawText: chunk.rawText,
                rawHash: chunk.rawHash,
                explanationText: chunk.explanation,
                validated: chunk.validated,
                createdAt: new Date().toISOString(),
              });
            }
          }

          setGuide(finalGuide);
          setPreviewSourceResults(guideData.sourceResults);
          setPreviewSummary(guideData.summary);
          setStatus('preview');
        } catch {
          setError('שגיאה בשמירת הביאור. אנא נסה שנית.');
          setStatus('error');
        }
      } else {
        setError(result.error || 'לא הצלחנו למצוא את המקור או להפיק ביאור.');
        setStatus('error');
        await updateDoc(guideRef, { status: 'Failed', updatedAt: new Date().toISOString() });
      }
    } catch (err: unknown) {
      console.error('[handleGenerate] Error:', err);
      setError(err instanceof Error ? err.message : 'שגיאה לא צפויה. אנא נסה שנית.');
      setStatus('error');
    }
  };

  const handleExport = async () => {
    if (!guide || !user || !firestore) return;

    setStatus('exporting');
    setError('');

    const result = await exportToGoogleDocs(guide.tref, previewSummary, previewSourceResults);

    if (result.success && result.googleDocId && result.googleDocUrl) {
      const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', guide.id);

      const updatedGuide: StudyGuideEntity = {
        ...guide,
        status: 'Published',
        googleDocId: result.googleDocId,
        googleDocUrl: result.googleDocUrl,
        updatedAt: new Date().toISOString()
      };

      try {
        await updateDoc(guideRef, {
          status: 'Published',
          googleDocId: result.googleDocId,
          googleDocUrl: result.googleDocUrl,
          updatedAt: updatedGuide.updatedAt
        });

        setGuide(updatedGuide);
        setStatus('success');
      } catch (e) {
        console.error(e);
        setError('שגיאה בעדכון המסמך. אנא נסה שנית.');
        setStatus('preview');
      }
    } else {
      setError(result.error || 'שגיאה ביצירת מסמך Google Docs.');
      setStatus('preview');
    }
  };

  const isInteractionDisabled = isUserLoading || status === 'processing' || !user;

  if (isUserLoading && status === 'idle') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navigation />
      <main className="pt-24 px-6 max-w-2xl mx-auto w-full">
        {(status === 'idle' || status === 'error') && (
          <Card className="shadow-2xl border-none rounded-[2.5rem] overflow-hidden bg-white">
            <CardHeader className="bg-primary text-primary-foreground p-10 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Book className="w-8 h-8" />
              </div>
              <CardTitle className="text-3xl font-headline mb-2">קבל ביאור מפורט</CardTitle>
              <CardDescription className="text-primary-foreground/70 text-lg">
                בחר את הסעיף והמקורות, והבינה המלאכותית תסביר אותם עבורך.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-10 space-y-8">
              <div className="grid gap-6">
                <div className="space-y-3">
                  <Label className="text-base font-bold">חלק בשולחן ערוך</Label>
                  <Select value={section} onValueChange={setSection} disabled={isInteractionDisabled}>
                    <SelectTrigger className="h-14 text-xl rounded-2xl">
                      <SelectValue placeholder="בחר חלק" />
                    </SelectTrigger>
                    <SelectContent>
                      {SECTIONS.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-lg">
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={`grid gap-4 ${needsSeif ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="space-y-3">
                    <Label className="text-base font-bold">סימן</Label>
                    {loadingSimanim ? (
                      <div className="h-14 flex items-center justify-center bg-muted/50 rounded-2xl">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        <span className="mr-2 text-muted-foreground">טוען סימנים...</span>
                      </div>
                    ) : (
                      <Select value={siman} onValueChange={setSiman} disabled={isInteractionDisabled}>
                        <SelectTrigger className="h-14 text-xl rounded-2xl">
                          <SelectValue placeholder="בחר סימן" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {simanOptions.map(opt => (
                            <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                              {opt.label} ({opt.value})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {needsSeif && (
                    <div className="space-y-3">
                      <Label className="text-base font-bold">סעיף</Label>
                      {loadingSeifim ? (
                        <div className="h-14 flex items-center justify-center bg-muted/50 rounded-2xl">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                          <span className="mr-2 text-muted-foreground">טוען סעיפים...</span>
                        </div>
                      ) : (
                        <Select value={seif} onValueChange={setSeif} disabled={isInteractionDisabled || seifOptions.length === 0}>
                          <SelectTrigger className="h-14 text-xl rounded-2xl">
                            <SelectValue placeholder="בחר סעיף" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {seifOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                                {opt.label} ({opt.value})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </div>

                {/* Source selection checkboxes */}
                <div className="space-y-3">
                  <Label className="text-base font-bold">מקורות לכלול בביאור</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {SOURCE_OPTIONS
                      .filter(opt => !opt.onlyOC || section === 'Orach Chayim')
                      .map(opt => (
                        <label key={opt.key} className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer hover:bg-muted/50 transition-colors">
                          <Checkbox
                            checked={selectedSources.includes(opt.key)}
                            onCheckedChange={(checked) => toggleSource(opt.key, !!checked)}
                            disabled={isInteractionDisabled}
                          />
                          <span className="text-lg font-medium">{opt.label}</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-3 p-4 bg-destructive/10 text-destructive rounded-2xl animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="text-sm font-medium">{error}</span>
                </div>
              )}

              <Button
                onClick={handleGenerate}
                className="w-full h-16 text-xl bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-xl transition-all"
                disabled={isInteractionDisabled || selectedSources.length === 0}
              >
                {!user ? 'מתחבר למערכת...' : 'קבל ביאור עכשיו'}
              </Button>
            </CardContent>
          </Card>
        )}

        {(status === 'processing' || status === 'exporting') && (
          <div className="flex flex-col items-center justify-center space-y-10 py-20 text-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/10 rounded-full blur-3xl animate-pulse" />
              <Loader2 className="w-24 h-24 text-primary animate-spin relative" />
            </div>
            <div className="space-y-4 max-w-sm">
              <h2 className="text-3xl font-bold font-headline">
                {status === 'processing' ? 'מכין את הביאור...' : 'מייצא ל-Google Docs...'}
              </h2>
              <p className="text-muted-foreground text-lg">
                {status === 'processing'
                  ? 'אנחנו מנתחים את הטקסט מכל המקורות, ומכינים את הביאור עבורך.'
                  : 'יוצר מסמך חדש ב-Google Docs ומעצב את הטקסט...'}
              </p>
            </div>
            {status === 'processing' && (
              <Button variant="outline" onClick={handleCancel} className="rounded-xl border-destructive text-destructive hover:bg-destructive/10 gap-2">
                <XCircle className="w-4 h-4" /> ביטול הפעולה
              </Button>
            )}
          </div>
        )}

        {status === 'preview' && (
          <div className="space-y-8 animate-in fade-in py-8">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-headline text-primary">תצוגה מקדימה</h1>
              <p className="text-muted-foreground text-xl">
                הביאור עבור <strong>{guide?.tref}</strong> נוצר בהצלחה. תוכל לעבור עליו לפני הייצוא ל-Google Docs.
              </p>
            </div>

            <Card className="p-8 space-y-8 bg-card shadow-lg rounded-[2rem]">
              {/* Per-source sections */}
              {previewSourceResults.map((sr) => (
                <div key={sr.sourceKey} className="space-y-6">
                  <h2 className="text-2xl font-bold text-primary border-b pb-2">
                    {sr.hebrewLabel}
                  </h2>
                  <div className="space-y-8">
                    {sr.chunks.map((chunk, index) => (
                      <div key={index} className="space-y-2 pb-6 border-b last:border-0 border-muted">
                        <p className="text-lg bg-muted/50 p-4 rounded-xl text-foreground font-semibold">
                          {chunk.rawText}
                        </p>
                        <p className="text-lg text-foreground px-2 whitespace-pre-wrap">
                          {chunk.explanation.split('**').map((text, i) =>
                            i % 2 === 1 ? <strong key={i} className="text-primary">{text}</strong> : text
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Summary - styled as a study card */}
              <div className="pt-8 border-t-2 border-primary/30">
                <div className="bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 rounded-2xl p-8 space-y-6 border border-primary/20">
                  <div className="flex items-center gap-3 pb-4 border-b border-primary/20">
                    <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-lg">📋</div>
                    <h2 className="text-2xl font-bold text-primary">סיכום למבחן רבנות</h2>
                  </div>
                  <div className="space-y-4 text-lg leading-relaxed">
                    {previewSummary.split('\n').filter(line => line.trim()).map((line, idx) => {
                      const trimmed = line.trim();
                      // Detect markdown headers (## ...)
                      if (trimmed.startsWith('## ')) {
                        return (
                          <h3 key={idx} className="text-xl font-bold text-primary mt-6 mb-2 border-b border-primary/20 pb-1">
                            {trimmed.replace('## ', '')}
                          </h3>
                        );
                      }
                      // Detect bullet points
                      const isBullet = /^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
                      const cleanLine = trimmed.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');
                      return (
                        <div key={idx} className={`flex gap-3 ${isBullet ? 'pr-2' : ''}`}>
                          {isBullet && <span className="text-primary font-bold mt-0.5 shrink-0">●</span>}
                          <p className={`${isBullet ? '' : 'font-semibold text-primary'}`}>
                            {(isBullet ? cleanLine : trimmed).split('**').map((text, i) =>
                              i % 2 === 1 ? <strong key={i} className="text-primary font-bold">{text}</strong> : text
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t">
                <Button
                  onClick={handleExport}
                  className="w-full h-16 text-xl bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-xl transition-all gap-2"
                >
                  לייצא ל-Google Docs <ArrowRight className="w-6 h-6 rotate-180" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatus('idle')}
                  className="w-full h-16 text-xl rounded-2xl transition-all"
                >
                  חזור לעמוד הראשי
                </Button>
              </div>
            </Card>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-4 py-8">
              <div className="inline-flex items-center justify-center w-24 h-24 bg-green-100 text-green-600 rounded-full mb-4 shadow-inner">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h1 className="text-4xl font-headline text-primary">הביאור מוכן!</h1>
              <p className="text-muted-foreground text-xl">
                הביאור עבור <strong>{guide?.tref}</strong> נשמר בספרייה ופורסם ב-Google Docs.
              </p>
            </div>

            <div className="grid gap-4 max-w-sm mx-auto">
              {publishedDocUrl ? (
                <Button asChild className="h-16 rounded-2xl text-xl gap-3 shadow-lg">
                  <a href={publishedDocUrl} target="_blank" rel="noopener noreferrer">
                    פתח ב-Google Docs <ArrowRight className="w-6 h-6 rotate-180" />
                  </a>
                </Button>
              ) : (
                <Button disabled className="h-16 rounded-2xl text-xl gap-3 shadow-lg">
                  קישור ל-Google Docs לא זמין
                </Button>
              )}
              <Button variant="outline" asChild className="h-14 rounded-2xl text-lg">
                <Link href="/my-guides">לספרייה שלי</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
