'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Book, XCircle, Minus, FileText, Info, Bookmark, Copyright } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TehilimReader } from '@/components/TehilimReader';
import { generateMultiSourceStudyGuide, exportToGoogleDocs, type GenerationResult, type SourceResult } from '@/app/actions/study-guide';
import { getSimanOptions, getSeifOptions, type SimanOption, type SeifOption } from '@/app/actions/sefaria-metadata';
import type { SourceKey } from '@/lib/sefaria-api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

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

// Main sources (full-width top) use bordeaux title. Commentaries (bottom) use colored badges.
const SOURCE_THEME: Record<SourceKey, {
  titleColor: string;        // Title text color
  badgeBg: string;           // Badge background (commentaries only)
  badgeText: string;         // Badge text color
  accentClass: string;       // Bold accent in explanations
  borderAccent: string;      // Right-border color for explanations
  isMainSource: boolean;     // true = full-width top section
}> = {
  tur: {
    titleColor: 'text-[#722F37]',
    badgeBg: '',
    badgeText: '',
    accentClass: 'text-[#722F37]',
    borderAccent: 'border-r-[#722F37]',
    isMainSource: true,
  },
  shulchan_arukh: {
    titleColor: 'text-[#722F37]',
    badgeBg: '',
    badgeText: '',
    accentClass: 'text-[#722F37]',
    borderAccent: 'border-r-[#722F37]',
    isMainSource: true,
  },
  beit_yosef: {
    titleColor: 'text-white',
    badgeBg: 'bg-[#008080]',
    badgeText: 'text-white',
    accentClass: 'text-[#008080]',
    borderAccent: 'border-r-[#008080]',
    isMainSource: false,
  },
  mishnah_berurah: {
    titleColor: 'text-black',
    badgeBg: 'bg-[#84CC16]',
    badgeText: 'text-black',
    accentClass: 'text-[#166534]',
    borderAccent: 'border-r-[#84CC16]',
    isMainSource: false,
  },
};

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

  // Progress tracking
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressPhase, setProgressPhase] = useState<string>('chunks');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local state for preview
  const [previewSourceResults, setPreviewSourceResults] = useState<SourceResult[]>([]);
  const [previewSummary, setPreviewSummary] = useState('');
  const publishedDocUrl = guide?.googleDocUrl?.trim() ?? '';

  type SummarySection = {
    title: string;
    paragraphs: string[];
    items: string[];
  };

  const summarySections = previewSummary
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce<SummarySection[]>((sections, line) => {
      const headerMatch = line.match(/^##\s+(.+)$/);
      const bulletMatch = line.match(/^(?:[-*]|\d+\.|\u2022)\s+(.+)$/);

      if (headerMatch) {
        sections.push({
          title: headerMatch[1]!.trim(),
          paragraphs: [],
          items: [],
        });
        return sections;
      }

      if (sections.length === 0) {
        sections.push({
          title: 'Summary',
          paragraphs: [],
          items: [],
        });
      }

      const current = sections[sections.length - 1]!;
      if (bulletMatch) {
        current.items.push(bulletMatch[1]!.trim());
      } else {
        current.paragraphs.push(line);
      }

      return sections;
    }, []);

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

  // Listen for real-time progress updates from the server
  useEffect(() => {
    if (status !== 'processing' || !currentGuideId || !user || !firestore) return;
    const guideDocRef = doc(firestore, 'users', user.uid, 'studyGuides', currentGuideId);
    const unsub = onSnapshot(guideDocRef, (snap) => {
      const data = snap.data();
      if (!data) return;
      if (typeof data.progressDone === 'number') setProgressDone(data.progressDone);
      if (typeof data.progressTotal === 'number') setProgressTotal(data.progressTotal);
      if (typeof data.progressPhase === 'string') setProgressPhase(data.progressPhase);
    });
    return () => unsub();
  }, [status, currentGuideId, user, firestore]);

  // Elapsed time counter
  useEffect(() => {
    if (status === 'processing') {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

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
      <main className={cn("pt-24 px-6 mx-auto w-full", status === 'preview' ? 'max-w-[90rem]' : 'max-w-2xl')}>
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

        {(status === 'processing' || status === 'exporting') && (() => {
          const pct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
          const isSummaryPhase = progressPhase === 'summary';

          // Estimate remaining seconds based on average rate
          let remainingSeconds = 0;
          if (isSummaryPhase) {
            remainingSeconds = Math.max(15 - (elapsedSeconds % 15), 0); // ~15s for summary
          } else if (progressDone > 0 && progressTotal > 0) {
            const avgSecondsPerChunk = elapsedSeconds / progressDone;
            const chunksLeft = progressTotal - progressDone;
            const summaryEstimate = 15;
            remainingSeconds = Math.ceil(chunksLeft * avgSecondsPerChunk + summaryEstimate);
          } else if (progressTotal > 0) {
            // No chunks done yet, rough estimate: ~12s per chunk + 15s summary
            remainingSeconds = progressTotal * 12 + 15;
          }

          const etaMins = Math.floor(remainingSeconds / 60);
          const etaSecs = remainingSeconds % 60;
          const etaStr = `${String(etaMins).padStart(2, '0')}:${String(etaSecs).padStart(2, '0')}`;

          return (
            <div className="flex flex-col items-center space-y-4 py-6 text-center">
              {/* Title + cancel row */}
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold font-headline">
                  {status === 'exporting' ? 'מייצא ל-Google Docs...' : isSummaryPhase ? 'מכין סיכום...' : 'מכין את הביאור...'}
                </h2>
                {status === 'processing' && (
                  <Button variant="outline" size="sm" onClick={handleCancel} className="rounded-xl border-destructive text-destructive hover:bg-destructive/10 gap-1 text-xs h-8">
                    <XCircle className="w-3.5 h-3.5" /> ביטול
                  </Button>
                )}
              </div>

              {status === 'processing' && (
                <div className="space-y-2 w-full max-w-md">
                  {/* Progress bar */}
                  <div className="w-full bg-muted rounded-full h-3 overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-l from-primary to-primary/70 rounded-full transition-all duration-500 ease-out"
                      style={{ width: isSummaryPhase ? '100%' : `${pct}%` }}
                    />
                  </div>

                  {/* Progress details */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <span>
                      {isSummaryPhase
                        ? '📋 מסכם את כל המקורות...'
                        : progressTotal > 0
                          ? `${progressDone} / ${progressTotal} קטעים עובדו`
                          : 'מתחיל עיבוד...'}
                    </span>
                  </div>
                </div>
              )}

              {status === 'exporting' && (
                <>
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  <p className="text-muted-foreground text-sm">
                    יוצר מסמך חדש ב-Google Docs ומעצב את הטקסט...
                  </p>
                </>
              )}

              {/* Tehilim reader while waiting */}
              {status === 'processing' && <TehilimReader />}
            </div>
          );
        })()}

        {status === 'preview' && (() => {
          // Separate main sources (top, full-width) from commentaries (bottom, side-by-side)
          const mainSources = ['tur', 'shulchan_arukh']
            .map(key => previewSourceResults.find(sr => sr.sourceKey === key))
            .filter(Boolean) as SourceResult[];
          const commentarySources = ['mishnah_berurah', 'beit_yosef']
            .map(key => previewSourceResults.find(sr => sr.sourceKey === key))
            .filter(Boolean) as SourceResult[];

          // Toolbar icons row (alhatorah-style)
          const Toolbar = () => (
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <button className="text-gray-400 hover:text-gray-600"><Minus className="w-3.5 h-3.5" /></button>
              <button className="text-gray-400 hover:text-gray-600"><FileText className="w-3.5 h-3.5" /></button>
              <button className="text-gray-400 hover:text-gray-600"><Info className="w-3.5 h-3.5" /></button>
              <button className="text-gray-400 hover:text-gray-600"><Copyright className="w-3.5 h-3.5" /></button>
              <button className="text-gray-400 hover:text-gray-600"><Bookmark className="w-3.5 h-3.5" /></button>
            </div>
          );

          // Render a main source block (Tur / Shulchan Arukh) - full width, bordeaux title
          const renderMainSource = (sr: SourceResult) => {
            const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
            return (
              <div key={sr.sourceKey} className="bg-white">
                {/* Toolbar + Title */}
                <div className="flex items-center justify-between border-b border-gray-100">
                  <Toolbar />
                  <h2 className={cn('text-xl font-bold font-sefer pl-4', theme.titleColor)}>
                    {sr.hebrewLabel}
                  </h2>
                </div>
                {/* Content */}
                <div className="px-6 py-4 text-right" dir="rtl">
                  {sr.chunks.map((chunk, index) => (
                    <div key={chunk.id || index} className={index > 0 ? 'mt-4 pt-4 border-t border-gray-50' : ''}>
                      <p className="font-sefer text-[1.08rem] leading-[1.7] text-[#333]">
                        {chunk.rawText}
                      </p>
                      <div className={cn(
                        'mt-2 border-r-[3px] pr-3 text-[0.95rem] leading-[1.6] text-[#555] whitespace-pre-wrap',
                        theme.borderAccent
                      )}>
                        {chunk.explanation.split('**').map((text, i) =>
                          i % 2 === 1
                            ? <strong key={i} className={cn('font-bold', theme.accentClass)}>{text}</strong>
                            : text
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          };

          // Render a commentary block (Beit Yosef / Mishnah Berurah) - badge title, scrollable
          const renderCommentary = (sr: SourceResult) => {
            const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.beit_yosef;
            return (
              <div key={sr.sourceKey} className="bg-white flex flex-col overflow-hidden">
                {/* Toolbar + Badge */}
                <div className="flex items-center justify-between border-b border-gray-100 flex-shrink-0">
                  <Toolbar />
                  <span className={cn(
                    'px-3 py-1 ml-3 text-sm font-bold font-sefer rounded-sm border',
                    theme.badgeBg, theme.badgeText
                  )}>
                    {sr.hebrewLabel}
                  </span>
                </div>
                {/* Scrollable content */}
                <ScrollArea className="h-[45vh]">
                  <div className="px-4 py-3 text-right" dir="rtl">
                    {sr.chunks.map((chunk, index) => (
                      <div key={chunk.id || index} className={index > 0 ? 'mt-3 pt-3 border-t border-gray-50' : ''}>
                        <p className="font-sefer text-[0.95rem] leading-[1.65] text-[#333]">
                          {chunk.rawText}
                        </p>
                        <div className={cn(
                          'mt-1.5 border-r-[3px] pr-3 text-[0.88rem] leading-[1.55] text-[#555] whitespace-pre-wrap',
                          theme.borderAccent
                        )}>
                          {chunk.explanation.split('**').map((text, i) =>
                            i % 2 === 1
                              ? <strong key={i} className={cn('font-bold', theme.accentClass)}>{text}</strong>
                              : text
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            );
          };

          return (
            <div className="animate-in fade-in py-4 space-y-4 bg-[#F5F5F5] -mx-6 px-6">
              {/* Header bar */}
              <div className="flex items-center justify-between bg-white px-5 py-3 border border-gray-200">
                <div className="flex gap-2">
                  <Button
                    onClick={handleExport}
                    size="sm"
                    className="h-9 text-sm bg-[#722F37] hover:bg-[#5a252c] text-white rounded gap-2"
                  >
                    לייצא ל-Google Docs <ArrowRight className="w-4 h-4 rotate-180" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus('idle')}
                    className="h-9 text-sm rounded"
                  >
                    חזור
                  </Button>
                </div>
                <h1 className="text-xl font-bold font-sefer text-[#722F37]">{guide?.tref}</h1>
              </div>

              {/* ====== Desktop layout ====== */}
              <div className="hidden lg:flex flex-col gap-[1px] bg-gray-200 border border-gray-200">
                {/* Top: main sources stacked full-width */}
                {mainSources.map(sr => renderMainSource(sr))}

                {/* Bottom: commentaries side by side */}
                {commentarySources.length > 0 && (
                  <div className="grid gap-[1px]" style={{
                    gridTemplateColumns: `repeat(${commentarySources.length}, minmax(0, 1fr))`,
                  }}>
                    {commentarySources.map(sr => renderCommentary(sr))}
                  </div>
                )}
              </div>

              {/* ====== Mobile: Tabbed Interface ====== */}
              <div className="lg:hidden">
                <Tabs defaultValue={previewSourceResults[0]?.sourceKey} dir="rtl">
                  <TabsList className="w-full h-auto flex-wrap gap-1 bg-white border border-gray-200 rounded-none p-1">
                    {previewSourceResults.map((sr) => {
                      const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
                      return (
                        <TabsTrigger
                          key={sr.sourceKey}
                          value={sr.sourceKey}
                          className={cn(
                            'flex-1 min-w-[4rem] text-sm font-bold font-sefer rounded-sm py-1.5',
                            'data-[state=active]:shadow-sm',
                            theme.isMainSource ? 'data-[state=active]:text-[#722F37]' : ''
                          )}
                        >
                          {sr.hebrewLabel}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  {previewSourceResults.map((sr) => {
                    const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
                    return (
                      <TabsContent key={sr.sourceKey} value={sr.sourceKey}>
                        <div className="bg-white border border-gray-200">
                          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                            <Toolbar />
                            {theme.isMainSource ? (
                              <h2 className={cn('text-lg font-bold font-sefer', theme.titleColor)}>
                                {sr.hebrewLabel}
                              </h2>
                            ) : (
                              <span className={cn('px-3 py-1 text-sm font-bold font-sefer rounded-sm', theme.badgeBg, theme.badgeText)}>
                                {sr.hebrewLabel}
                              </span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-right" dir="rtl">
                            {sr.chunks.map((chunk, index) => (
                              <div key={chunk.id || index} className={index > 0 ? 'mt-3 pt-3 border-t border-gray-50' : ''}>
                                <p className="font-sefer text-[1rem] leading-[1.65] text-[#333]">
                                  {chunk.rawText}
                                </p>
                                <div className={cn(
                                  'mt-1.5 border-r-[3px] pr-3 text-[0.9rem] leading-[1.55] text-[#555] whitespace-pre-wrap',
                                  theme.borderAccent
                                )}>
                                  {chunk.explanation.split('**').map((text, i) =>
                                    i % 2 === 1
                                      ? <strong key={i} className={cn('font-bold', theme.accentClass)}>{text}</strong>
                                      : text
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>

              {/* ====== Summary ====== */}
              <div className="bg-white border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                  <Toolbar />
                  <span className="px-3 py-1 text-sm font-bold font-sefer rounded-sm bg-[#722F37] text-white">
                    סיכום
                  </span>
                </div>
                <div className="px-6 py-4 font-sefer text-[0.95rem] leading-[1.6] text-[#333] text-right" dir="rtl">
                  {previewSummary.trim() ? (
                    previewSummary
                      .split('\n')
                      .map(line => line.trim())
                      .filter(Boolean)
                      .map((line, idx) => {
                        const headerMatch = line.match(/^##\s+(.+)$/);
                        if (headerMatch) {
                          return (
                            <h3 key={idx} className="text-base font-bold text-[#722F37] mt-4 mb-1 font-sefer first:mt-0 border-b border-[#722F37]/15 pb-1">
                              {headerMatch[1]}
                            </h3>
                          );
                        }
                        const bulletMatch = line.match(/^(?:[-*]|\u2022|\d+\.)\s+(.+)$/);
                        if (bulletMatch) {
                          return (
                            <p key={idx} className="pr-3 relative mb-0.5">
                              <span className="absolute right-0 top-0 text-[#722F37] font-bold">-</span>
                              {bulletMatch[1]!.split('**').map((text, i) =>
                                i % 2 === 1
                                  ? <strong key={i} className="text-[#722F37] font-bold">{text}</strong>
                                  : text
                              )}
                            </p>
                          );
                        }
                        return (
                          <p key={idx} className="mb-0.5">
                            {line.split('**').map((text, i) =>
                              i % 2 === 1
                                ? <strong key={i} className="text-[#722F37] font-bold">{text}</strong>
                                : text
                            )}
                          </p>
                        );
                      })
                  ) : (
                    <p className="text-gray-400">לא נוצר סיכום.</p>
                  )}
                </div>
              </div>

              {/* Bottom Action Buttons */}
              <div className="flex gap-2 justify-center pt-1 pb-8">
                <Button
                  onClick={handleExport}
                  size="sm"
                  className="h-9 text-sm bg-[#722F37] hover:bg-[#5a252c] text-white rounded gap-2"
                >
                  לייצא ל-Google Docs <ArrowRight className="w-4 h-4 rotate-180" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus('idle')}
                  className="h-9 text-sm rounded"
                >
                  חזור
                </Button>
              </div>
            </div>
          );
        })()}

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
