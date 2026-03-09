'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Book, XCircle, Minus, FileText, Info, Bookmark, Copyright, Sparkles, ScrollText, LibraryBig, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TehilimReader } from '@/components/TehilimReader';
import { generateMultiSourceStudyGuide, exportToGoogleDocs, type GenerationResult, type SourceResult } from '@/app/actions/study-guide';
import { getSimanOptions, getSeifOptions, type SimanOption, type SeifOption } from '@/app/actions/sefaria-metadata';
import type { SourceKey } from '@/lib/sefaria-api';
import { hebrewToNumber } from '@/lib/hebrew-utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { doc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, getDocs } from 'firebase/firestore';

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

type StoredChunkEntity = {
  id: string;
  sourceKey: SourceKey;
  orderIndex: number;
  rawText: string;
  explanationText: string;
  validated?: boolean;
  modelUsed?: string;
  tref?: string;
  hebrewLabel?: string;
};

const SECTIONS = [
  { id: 'Orach Chayim', label: 'אורח חיים' },
  { id: 'Yoreh Deah', label: 'יורה דעה' },
  { id: 'Even HaEzer', label: 'אבן העזר' },
  { id: 'Choshen Mishpat', label: 'חושן משפט' },
  { id: 'Torah Ohr', label: 'תורה אור' },
];

const SOURCE_OPTIONS: { key: SourceKey; label: string; onlyOC: boolean }[] = [
  { key: 'tur', label: 'טור', onlyOC: false },
  { key: 'beit_yosef', label: 'בית יוסף', onlyOC: false },
  { key: 'shulchan_arukh', label: 'שולחן ערוך', onlyOC: false },
  { key: 'mishnah_berurah', label: 'משנה ברורה', onlyOC: true },
  { key: 'torah_ohr', label: 'תורה אור', onlyOC: false },
];

const SOURCE_DESCRIPTIONS: Record<SourceKey, string> = {
  tur: 'יסוד הסימן ותמצית הכיוון ההלכתי.',
  beit_yosef: 'שיטות, טעמים, וקיבוץ הדעות.',
  shulchan_arukh: 'הפסיקה המרכזית בלשון ברורה.',
  mishnah_berurah: 'הערות מעשיות, חילוקים והסתייגויות.',
  torah_ohr: 'מהלך חסידי רציף עם ביאור עומק.',
};

const SOURCE_LABEL_BY_KEY: Record<SourceKey, string> = SOURCE_OPTIONS.reduce((acc, option) => {
  acc[option.key] = option.label;
  return acc;
}, {} as Record<SourceKey, string>);

const SOURCE_DISPLAY_ORDER: SourceKey[] = ['tur', 'beit_yosef', 'shulchan_arukh', 'mishnah_berurah', 'torah_ohr'];

function isSourceKey(value: unknown): value is SourceKey {
  return typeof value === 'string' && (SOURCE_DISPLAY_ORDER as string[]).includes(value);
}

// Reading-oriented palette: warm paper background + high-contrast ink + source accents.
const SOURCE_THEME: Record<SourceKey, {
  titleColor: string;
  badgeBg: string;
  badgeText: string;
  accentClass: string;
  borderAccent: string;
  sourceCardClass: string;
  explanationCardClass: string;
  panelClass: string;
  isMainSource: boolean;
}> = {
  tur: {
    titleColor: 'text-slate-800',
    badgeBg: '',
    badgeText: '',
    accentClass: 'text-slate-800',
    borderAccent: 'border-r-slate-300',
    sourceCardClass: 'bg-transparent border-slate-200 text-slate-800',
    explanationCardClass: 'bg-transparent border-transparent',
    panelClass: 'bg-white border-slate-200',
    isMainSource: true,
  },
  shulchan_arukh: {
    titleColor: 'text-slate-800',
    badgeBg: '',
    badgeText: '',
    accentClass: 'text-slate-800',
    borderAccent: 'border-r-slate-300',
    sourceCardClass: 'bg-transparent border-slate-200 text-slate-800',
    explanationCardClass: 'bg-transparent border-transparent',
    panelClass: 'bg-white border-slate-200',
    isMainSource: true,
  },
  beit_yosef: {
    titleColor: 'text-slate-800',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    accentClass: 'text-slate-700',
    borderAccent: 'border-r-slate-200',
    sourceCardClass: 'bg-transparent border-slate-200 text-slate-700',
    explanationCardClass: 'bg-transparent border-transparent',
    panelClass: 'bg-stone-50 border-slate-200',
    isMainSource: false,
  },
  mishnah_berurah: {
    titleColor: 'text-slate-800',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    accentClass: 'text-slate-700',
    borderAccent: 'border-r-slate-200',
    sourceCardClass: 'bg-transparent border-slate-200 text-slate-700',
    explanationCardClass: 'bg-transparent border-transparent',
    panelClass: 'bg-stone-50 border-slate-200',
    isMainSource: false,
  },
  torah_ohr: {
    titleColor: 'text-[#5C3A21]',
    badgeBg: 'bg-stone-100',
    badgeText: 'text-[#5C3A21]',
    accentClass: 'text-[#5C3A21]',
    borderAccent: 'border-r-[#5C3A21]/30',
    sourceCardClass: 'bg-transparent border-slate-200 text-slate-800',
    explanationCardClass: 'bg-transparent border-transparent',
    panelClass: 'bg-white border-slate-200',
    isMainSource: true,
  },
};

export default function GeneratePage() {
  const [section, setSection] = useState('Orach Chayim');
  const [siman, setSiman] = useState('1');
  const [seif, setSeif] = useState('1');
  const [torahOhrWholeParasha, setTorahOhrWholeParasha] = useState(false);
  const [torahOhrPassagesOnly, setTorahOhrPassagesOnly] = useState(false);
  const [quickJumpRef, setQuickJumpRef] = useState('');
  const [quickJumpError, setQuickJumpError] = useState('');
  const [pendingQuickSeif, setPendingQuickSeif] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<SourceKey[]>(['shulchan_arukh']);

  const [manualTurText, setManualTurText] = useState('');
  const [manualByText, setManualByText] = useState('');

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
  const hydratingPreviewRef = useRef(false);

  // Local state for preview
  const [previewSourceResults, setPreviewSourceResults] = useState<SourceResult[]>([]);
  const [previewSummary, setPreviewSummary] = useState('');
  const publishedDocUrl = guide?.googleDocUrl?.trim() ?? '';

  const isServerActionNetworkError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /failed to fetch|fetch failed|networkerror/i.test(message);
  };

  const callGenerateWithRetry = async (
    request: Parameters<typeof generateMultiSourceStudyGuide>[0],
    userId: string,
    guideId: string,
  ): Promise<GenerationResult> => {
    return await generateMultiSourceStudyGuide(request, userId, guideId);
  };

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

  const renderAccentText = (text: string, accentClass: string) => (
    text.split('**').map((part, i) =>
      i % 2 === 1
        ? <strong key={i} className={cn('font-extrabold text-slate-900', accentClass)}>{part}</strong>
        : part,
    )
  );

  const hydratePreviewFromSavedGuide = useCallback(async (guideId: string, rawGuide: Record<string, unknown>) => {
    if (!user || !firestore || hydratingPreviewRef.current) return;
    hydratingPreviewRef.current = true;

    try {
      const chunksRef = collection(firestore, 'users', user.uid, 'studyGuides', guideId, 'textChunks');
      const chunksSnap = await getDocs(query(chunksRef, orderBy('orderIndex', 'asc')));
      const storedChunks: StoredChunkEntity[] = chunksSnap.docs.map(d => ({ ...(d.data() as StoredChunkEntity), id: d.id }));

      const grouped = new Map<SourceKey, StoredChunkEntity[]>();
      for (const chunk of storedChunks) {
        if (!isSourceKey(chunk.sourceKey)) continue;
        const bucket = grouped.get(chunk.sourceKey) ?? [];
        bucket.push(chunk);
        grouped.set(chunk.sourceKey, bucket);
      }

      const fallbackTref = typeof rawGuide.sefariaRef === 'string'
        ? rawGuide.sefariaRef
        : (typeof rawGuide.tref === 'string' ? rawGuide.tref : '');

      const sourceResults: SourceResult[] = SOURCE_DISPLAY_ORDER
        .filter(sourceKey => grouped.has(sourceKey))
        .map((sourceKey) => {
          const sourceChunks = grouped.get(sourceKey)!;
          sourceChunks.sort((a, b) => a.orderIndex - b.orderIndex);

          return {
            sourceKey,
            hebrewLabel: sourceChunks[0]?.hebrewLabel || SOURCE_LABEL_BY_KEY[sourceKey],
            tref: sourceChunks[0]?.tref || fallbackTref,
            chunks: sourceChunks.map(chunk => ({
              id: chunk.id,
              rawText: chunk.rawText,
              explanation: chunk.explanationText,
              rawHash: '',
              cacheHit: false,
              orderIndex: chunk.orderIndex,
              modelUsed: chunk.modelUsed,
              validated: chunk.validated,
            })),
          };
        });

      const guideEntity: StudyGuideEntity = {
        id: guideId,
        userId: user.uid,
        tref: typeof rawGuide.tref === 'string' ? rawGuide.tref : fallbackTref,
        sefariaRef: typeof rawGuide.sefariaRef === 'string' ? rawGuide.sefariaRef : undefined,
        language: typeof rawGuide.language === 'string' ? rawGuide.language : 'he',
        status: 'Preview',
        summaryText: typeof rawGuide.summaryText === 'string' ? rawGuide.summaryText : '',
        googleDocUrl: typeof rawGuide.googleDocUrl === 'string' ? rawGuide.googleDocUrl : '',
        googleDocId: typeof rawGuide.googleDocId === 'string' ? rawGuide.googleDocId : '',
        validated: typeof rawGuide.validated === 'boolean' ? rawGuide.validated : undefined,
        sources: Array.isArray(rawGuide.sources)
          ? rawGuide.sources.filter(isSourceKey)
          : sourceResults.map(sr => sr.sourceKey),
        createdAt: typeof rawGuide.createdAt === 'string' ? rawGuide.createdAt : new Date().toISOString(),
        updatedAt: typeof rawGuide.updatedAt === 'string' ? rawGuide.updatedAt : new Date().toISOString(),
      };

      setGuide(guideEntity);
      setPreviewSourceResults(sourceResults);
      setPreviewSummary(guideEntity.summaryText);
      setStatus('preview');
      setError('');
    } catch (hydrateError) {
      console.error('[Generate] Failed to hydrate preview from Firestore:', hydrateError);
    } finally {
      hydratingPreviewRef.current = false;
    }
  }, [user, firestore]);

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

      const remoteStatus = typeof data.status === 'string' ? data.status : '';
      if (remoteStatus === 'Preview' || remoteStatus === 'Published') {
        void hydratePreviewFromSavedGuide(currentGuideId, data as Record<string, unknown>);
      } else if (remoteStatus === 'Failed') {
        setError(typeof data.error === 'string' ? data.error : 'Generation failed on server.');
        setStatus('error');
      }
    });
    return () => unsub();
  }, [status, currentGuideId, user, firestore, hydratePreviewFromSavedGuide]);

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
    if (section === 'Torah Ohr') {
      setSelectedSources(['torah_ohr']);
      setSiman('');
      setSeif('');
      setTorahOhrWholeParasha(true);
      setTorahOhrPassagesOnly(true);
    } else {
      setSelectedSources(prev => prev.filter(s => s !== 'torah_ohr'));
      setTorahOhrWholeParasha(false);
      setTorahOhrPassagesOnly(false);
    }
    setQuickJumpRef('');
    setQuickJumpError('');
    setPendingQuickSeif(null);
  }, [section]);

  // Fetch simanim when section changes
  useEffect(() => {
    let cancelled = false;
    setLoadingSimanim(true);
    setSimanOptions([]);
    setSeifOptions([]);
    const isTorahOhr = section === 'Torah Ohr';
    setSiman(isTorahOhr ? '' : '1');
    setSeif(isTorahOhr ? '' : '1');
    getSimanOptions(section).then(options => {
      if (!cancelled) {
        setSimanOptions(options);
        setLoadingSimanim(false);
      }
    });
    return () => { cancelled = true; };
  }, [section]);

  const isTorahOhrSection = section === 'Torah Ohr';
  const isTorahOhrFullParasha = isTorahOhrSection && torahOhrWholeParasha;

  // Fetch seifim when siman changes
  const needsSeif = selectedSources.some(s => s === 'shulchan_arukh' || s === 'mishnah_berurah' || s === 'torah_ohr')
    && !isTorahOhrFullParasha;

  const fetchSeifim = useCallback(async (sec: string, sim: string) => {
    if (sec !== 'Torah Ohr') {
      const simanNum = parseInt(sim);
      if (!simanNum || simanNum < 1) return;
    }
    setLoadingSeifim(true);
    setSeifOptions([]);
    setSeif('1');
    const options = await getSeifOptions(sec, sec === 'Torah Ohr' ? sim : parseInt(sim));
    setSeifOptions(options);
    setLoadingSeifim(false);
  }, []);

  useEffect(() => {
    if (isTorahOhrFullParasha) {
      setLoadingSeifim(false);
      setSeifOptions([]);
      setSeif('');
      return;
    }

    if (needsSeif && siman) {
      fetchSeifim(section, siman);
    }
  }, [siman, section, needsSeif, fetchSeifim, isTorahOhrFullParasha]);

  useEffect(() => {
    if (!pendingQuickSeif || loadingSeifim || seifOptions.length === 0) {
      return;
    }

    const exists = seifOptions.some(opt => String(opt.value) === pendingQuickSeif);
    if (exists) {
      setSeif(pendingQuickSeif);
      setQuickJumpError('');
    } else {
      setQuickJumpError('הסעיף לא נמצא עבור הסימן שנבחר.');
    }
    setPendingQuickSeif(null);
  }, [pendingQuickSeif, loadingSeifim, seifOptions]);

  const toggleSource = (key: SourceKey, checked: boolean) => {
    setSelectedSources(prev =>
      checked ? [...prev, key] : prev.filter(s => s !== key)
    );
  };

  const parseRefPart = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = hebrewToNumber(trimmed);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return Math.trunc(parsed);
  };

  const applyQuickJump = () => {
    const normalized = quickJumpRef.trim();
    if (!normalized) {
      setQuickJumpError('הכנס סימן או סימן:סעיף.');
      return;
    }

    const parts = normalized
      .split(/[:.\s/-]+/)
      .map(part => part.trim())
      .filter(Boolean);

    if (parts.length === 0 || parts.length > 2) {
      setQuickJumpError('פורמט לא תקין. דוגמה: רפח:ג או 288:3');
      return;
    }

    const simanPart = parseRefPart(parts[0]!);
    if (!simanPart) {
      setQuickJumpError('הסימן שהוזן לא תקין.');
      return;
    }

    const nextSiman = String(simanPart);
    const nextSeif = parts[1] ? parseRefPart(parts[1]!) : null;
    if (parts[1] && !nextSeif) {
      setQuickJumpError('הסעיף שהוזן לא תקין.');
      return;
    }

    setQuickJumpError('');
    setSiman(nextSiman);

    if (nextSeif) {
      const seifAsString = String(nextSeif);
      const sameSiman = siman === nextSiman;
      if (sameSiman && seifOptions.some(opt => String(opt.value) === seifAsString)) {
        setSeif(seifAsString);
      } else {
        setPendingQuickSeif(seifAsString);
      }
    } else {
      setPendingQuickSeif(null);
    }
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
    const displayTref = isTorahOhrFullParasha
      ? `${sectionLabel} ${simanLabel}`
      : `${sectionLabel} ${simanLabel}${needsSeif ? `:${seifLabel}` : ''}`;

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

      const result: GenerationResult = await callGenerateWithRetry(
        {
          section,
          siman,
          seif: needsSeif ? seif : undefined,
          sources: selectedSources,
          torahOhrPassagesOnly: section === 'Torah Ohr' ? torahOhrPassagesOnly : undefined,
          manualTurText: selectedSources.includes('tur') ? manualTurText : undefined,
          manualByText: selectedSources.includes('beit_yosef') ? manualByText : undefined,
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
          await setDoc(guideRef, finalGuide, { merge: true });

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
      if (isServerActionNetworkError(err)) {
        setError('Server connection dropped, but generation continues in background. Keep this page open; it will appear when Firestore status becomes Preview.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Unexpected error. Please try again.');
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
  const availableSources = SOURCE_OPTIONS
    .filter(opt => !opt.onlyOC || section === 'Orach Chayim')
    .filter(opt => section === 'Torah Ohr' ? opt.key === 'torah_ohr' : opt.key !== 'torah_ohr');
  const selectedSourceDetails = availableSources.filter(opt => selectedSources.includes(opt.key));
  const sectionLabel = SECTIONS.find(s => s.id === section)?.label || section;
  const selectedSimanLabel = simanOptions.find(o => String(o.value) === siman)?.label || siman;
  const selectedSeifLabel = seifOptions.find(o => String(o.value) === seif)?.label || seif;
  const currentReference = isTorahOhrFullParasha
    ? `${sectionLabel} ${selectedSimanLabel}`.trim()
    : `${sectionLabel} ${selectedSimanLabel}${needsSeif && selectedSeifLabel ? `:${selectedSeifLabel}` : ''}`.trim();
  const canGenerate = Boolean(user && siman && selectedSources.length > 0 && (!needsSeif || seif));
  const studyModeLabel = section === 'Torah Ohr'
    ? (torahOhrPassagesOnly ? 'קטעי מקור בלבד' : (torahOhrWholeParasha ? 'פרשה שלמה' : 'מאמר בודד'))
    : 'ביאור הלכתי מלא';

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
      <main
        className={cn(
          'pt-24 px-6 mx-auto w-full',
          status === 'preview'
            ? 'max-w-[90rem]'
            : (status === 'idle' || status === 'error' ? 'max-w-7xl' : 'max-w-3xl'),
        )}
      >
        {(status === 'idle' || status === 'error') && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_22rem]">
            <Card className="overflow-hidden rounded-[2rem] border border-stone-200 bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <CardHeader className="border-b border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_34%),linear-gradient(135deg,#1f2937_0%,#334155_100%)] p-8 text-white">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl space-y-3">
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
                      <Book className="h-7 w-7" />
                    </div>
                    <CardTitle className="text-3xl font-headline">׳‘׳™׳׳•׳¨ ׳׳™׳׳•׳“׳™ ׳‘׳ ׳•׳™ ׳˜׳•׳‘</CardTitle>
                    <CardDescription className="max-w-xl text-base leading-7 text-white/75">
                      ׳‘׳—׳¨ ׳׳§׳•׳¨, ׳§׳‘׳¢ ׳׳× ׳”׳׳•׳•׳—, ׳•׳‘׳ ׳” ׳“׳£ ׳׳™׳׳•׳“ ׳©׳׳׳¨׳’׳ ׳׳× ׳”׳”׳׳›׳”, ׳”׳©׳™׳˜׳•׳× ׳•׳”׳¡׳™׳›׳•׳ ׳‘׳¦׳•׳¨׳” ׳§׳¨׳™׳׳”.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="rounded-full border-0 bg-white/12 px-3 py-1 text-white">
                      <Sparkles className="ml-1.5 h-3.5 w-3.5" />
                      ׳¡׳“׳¨ ׳׳ª׳™׳‘׳ª׳
                    </Badge>
                    <Badge variant="secondary" className="rounded-full border-0 bg-white/12 px-3 py-1 text-white">
                      <ScrollText className="ml-1.5 h-3.5 w-3.5" />
                      ׳¡׳™׳›׳•׳ ׳׳•׳‘׳ ׳”
                    </Badge>
                    <Badge variant="secondary" className="rounded-full border-0 bg-white/12 px-3 py-1 text-white">
                      <LibraryBig className="ml-1.5 h-3.5 w-3.5" />
                      ׳§׳¨׳™׳׳” ׳ ׳•׳—׳”
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 p-6 md:p-8">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                  <section className="space-y-6">
                    <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-bold text-slate-900">׳‘׳—׳™׳¨׳× ׳׳§׳•׳¨</h2>
                          <p className="text-sm text-slate-500">׳‘׳—׳¨ ׳—׳׳§, ׳¡׳™׳׳ ׳•׳¡׳¢׳™׳£ ׳׳₪׳™ ׳׳” ׳©׳׳×׳” ׳¨׳•׳¦׳” ׳׳׳׳•׳“.</p>
                        </div>
                        <Badge variant="outline" className="rounded-full border-stone-300 bg-stone-50 text-slate-700">
                          {studyModeLabel}
                        </Badge>
                      </div>

                      <div className="space-y-5">
                        <div className="space-y-3">
                          <Label className="text-base font-bold">׳—׳׳§ ׳‘׳©׳•׳׳—׳ ׳¢׳¨׳•׳</Label>
                          <Select value={section} onValueChange={setSection} disabled={isInteractionDisabled}>
                            <SelectTrigger className="h-14 rounded-2xl border-stone-300 bg-stone-50 text-xl">
                              <SelectValue placeholder="׳‘׳—׳¨ ׳—׳׳§" />
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

                        {section !== 'Torah Ohr' && (
                          <div className="space-y-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 p-4">
                            <Label className="text-sm font-semibold text-slate-700">׳§׳₪׳™׳¦׳” ׳׳”׳™׳¨׳”</Label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Input
                                value={quickJumpRef}
                                onChange={(e) => setQuickJumpRef(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    applyQuickJump();
                                  }
                                }}
                                placeholder='׳“׳•׳’׳׳”: ׳¨׳₪׳—:׳’ ׳׳• 288:3'
                                className="h-11 border-stone-300 bg-white"
                                disabled={isInteractionDisabled}
                                dir="rtl"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                className="h-11 shrink-0 rounded-xl border-stone-300 bg-white"
                                onClick={applyQuickJump}
                                disabled={isInteractionDisabled}
                              >
                                ׳§׳₪׳™׳¦׳”
                              </Button>
                            </div>
                            {quickJumpError && (
                              <p className="text-xs text-destructive">{quickJumpError}</p>
                            )}
                          </div>
                        )}

                        <div className={`grid gap-4 ${needsSeif ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                          <div className="space-y-3">
                            <Label className="text-base font-bold">{section === 'Torah Ohr' ? '׳₪׳¨׳©׳”' : '׳¡׳™׳׳'}</Label>
                            {loadingSimanim ? (
                              <div className="flex h-14 items-center justify-center rounded-2xl bg-stone-100 text-sm text-slate-500">
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                {section === 'Torah Ohr' ? '׳˜׳•׳¢׳ ׳₪׳¨׳©׳•׳×...' : '׳˜׳•׳¢׳ ׳¡׳™׳׳ ׳™׳...'}
                              </div>
                            ) : (
                              <Select value={siman} onValueChange={setSiman} disabled={isInteractionDisabled}>
                                <SelectTrigger className="h-14 rounded-2xl border-stone-300 bg-stone-50 text-xl">
                                  <SelectValue placeholder={section === 'Torah Ohr' ? '׳‘׳—׳¨ ׳₪׳¨׳©׳”' : '׳‘׳—׳¨ ׳¡׳™׳׳'} />
                                </SelectTrigger>
                                <SelectContent className="max-h-[320px]">
                                  {simanOptions.map(opt => (
                                    <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                                      {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          {needsSeif && (
                            <div className="space-y-3">
                              <Label className="text-base font-bold">{section === 'Torah Ohr' ? '׳׳׳׳¨' : '׳¡׳¢׳™׳£'}</Label>
                              {loadingSeifim ? (
                                <div className="flex h-14 items-center justify-center rounded-2xl bg-stone-100 text-sm text-slate-500">
                                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                  {section === 'Torah Ohr' ? '׳˜׳•׳¢׳ ׳׳׳׳¨׳™׳...' : '׳˜׳•׳¢׳ ׳¡׳¢׳™׳₪׳™׳...'}
                                </div>
                              ) : (
                                <Select value={seif} onValueChange={setSeif} disabled={isInteractionDisabled || seifOptions.length === 0}>
                                  <SelectTrigger className="h-14 rounded-2xl border-stone-300 bg-stone-50 text-xl">
                                    <SelectValue placeholder={section === 'Torah Ohr' ? '׳‘׳—׳¨ ׳׳׳׳¨' : '׳‘׳—׳¨ ׳¡׳¢׳™׳£'} />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[320px]">
                                    {seifOptions.map(opt => (
                                      <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                                        {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {section === 'Torah Ohr' && (
                      <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                        <div className="mb-4">
                          <h2 className="text-lg font-bold text-slate-900">׳׳¦׳‘ ׳׳™׳׳•׳“</h2>
                          <p className="text-sm text-slate-500">׳§׳‘׳¢ ׳׳ ׳׳¢׳‘׳•׳“ ׳¢׳ ׳›׳ ׳”׳₪׳¨׳©׳” ׳׳• ׳¨׳§ ׳׳”׳¦׳’׳× ׳”׳§׳˜׳¢׳™׳.</p>
                        </div>
                        <div className="space-y-3">
                          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 p-4">
                            <Checkbox
                              checked={torahOhrWholeParasha}
                              onCheckedChange={(checked) => setTorahOhrWholeParasha(!!checked)}
                              disabled={isInteractionDisabled}
                            />
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-800">׳›׳ ׳”׳₪׳¨׳©׳” (׳›׳ ׳”׳׳׳׳¨׳™׳)</p>
                              <p className="text-xs leading-6 text-slate-600">׳׳•׳׳׳¥ ׳›׳“׳™ ׳׳©׳׳•׳¨ ׳¢׳ ׳”׳¨׳¦׳£ ׳”׳¤׳ ׳™׳׳™ ׳©׳ ׳”׳׳׳׳¨׳™׳.</p>
                            </div>
                          </label>
                          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4">
                            <Checkbox
                              checked={torahOhrPassagesOnly}
                              onCheckedChange={(checked) => setTorahOhrPassagesOnly(!!checked)}
                              disabled={isInteractionDisabled}
                            />
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-800">׳׳¦׳‘ ׳§׳˜׳¢׳™׳ ׳‘׳׳‘׳“ (׳׳׳ ׳‘׳™׳׳•׳¨ AI)</p>
                              <p className="text-xs leading-6 text-slate-600">׳׳׳™׳¨ ׳™׳•׳×׳¨ ׳•׳׳¦׳™׳’ ׳׳× ׳”׳§׳˜׳¢׳™׳ ׳›׳׳• ׳©׳”׳.</p>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                      <div className="mb-4">
                        <h2 className="text-lg font-bold text-slate-900">׳׳§׳•׳¨׳•׳× ׳׳©׳™׳׳•׳‘</h2>
                        <p className="text-sm text-slate-500">׳‘׳—׳¨ ׳׳™׳–׳” ׳׳§׳•׳¨׳•׳× ׳™׳›׳ ׳¡׳• ׳׳׳•׳×׳• ׳“׳£ ׳׳™׳׳•׳“.</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {availableSources.map(opt => (
                          <label
                            key={opt.key}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all',
                              selectedSources.includes(opt.key)
                                ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10'
                                : 'border-stone-200 bg-stone-50/70 hover:border-stone-300 hover:bg-white',
                            )}
                          >
                            <Checkbox
                              checked={selectedSources.includes(opt.key)}
                              onCheckedChange={(checked) => toggleSource(opt.key, !!checked)}
                              disabled={isInteractionDisabled}
                            />
                            <div className="space-y-1">
                              <p className="text-lg font-semibold">{opt.label}</p>
                              <p className={cn('text-sm leading-6', selectedSources.includes(opt.key) ? 'text-white/80' : 'text-slate-500')}>
                                {SOURCE_DESCRIPTIONS[opt.key]}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {(selectedSources.includes('tur') || selectedSources.includes('beit_yosef')) && (
                      <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                        <div className="mb-4">
                          <h2 className="text-lg font-bold text-slate-900">׳׳׳ ׳” ׳™׳“׳ ׳™׳×</h2>
                          <p className="text-sm text-slate-500">׳¨׳§ ׳׳ ׳׳×׳” ׳¨׳•׳¦׳” ׳׳›׳₪׳•׳ª ׳˜׳§׳¡׳˜ ׳¢׳ ׳¤׳ ׳™ ׳”׳׳©׳™׳›׳” ׳”׳׳•׳˜׳•׳׳˜׳™׳×.</p>
                        </div>
                        <div className="space-y-5">
                          {selectedSources.includes('tur') && (
                            <div className="space-y-3">
                              <Label className="text-base font-bold text-slate-700">׳˜׳•׳¨ (׳¨׳©׳•׳×)</Label>
                              <Textarea
                                placeholder="׳˜׳§׳¡׳˜ ׳׳“׳•׳™׳§ ׳׳˜׳•׳¨ (׳”׳©׳׳¨ ׳¨׳™׳§ ׳׳׳©׳™׳›׳” ׳׳•׳˜׳•׳׳˜׳™׳× ׳”׳—׳›׳׳”)"
                                className="min-h-[120px] rounded-2xl border-stone-300 bg-stone-50/70 text-base font-sefer"
                                value={manualTurText}
                                onChange={(e) => setManualTurText(e.target.value)}
                                disabled={isInteractionDisabled}
                                dir="rtl"
                              />
                            </div>
                          )}
                          {selectedSources.includes('beit_yosef') && (
                            <div className="space-y-3">
                              <Label className="text-base font-bold text-slate-700">׳‘׳™׳× ׳™׳•׳¡׳£ (׳¨׳©׳•׳×)</Label>
                              <Textarea
                                placeholder="׳˜׳§׳¡׳˜ ׳׳“׳•׳™׳§ ׳׳‘׳™׳× ׳™׳•׳¡׳£ (׳”׳©׳׳¨ ׳¨׳™׳§ ׳׳׳©׳™׳›׳” ׳׳•׳˜׳•׳׳˜׳™׳× ׳”׳—׳›׳׳”)"
                                className="min-h-[120px] rounded-2xl border-stone-300 bg-stone-50/70 text-base font-sefer"
                                value={manualByText}
                                onChange={(e) => setManualByText(e.target.value)}
                                disabled={isInteractionDisabled}
                                dir="rtl"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>

                  <aside className="space-y-5">
                    <Card className="rounded-[1.5rem] border border-stone-200 bg-stone-50/80 shadow-sm xl:sticky xl:top-28">
                      <CardHeader className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <CardTitle className="text-xl font-bold text-slate-900">׳ª׳¦׳•׳’׳ ׳׳¤׳ ׳™ ׳™׳¦׳™׳¨׳”</CardTitle>
                            <CardDescription className="text-sm text-slate-500">
                              ׳›׳š ׳™׳¨׳׳” ׳׳•׳§׳“ ׳”׳׳™׳׳•׳“ ׳©׳׳×׳” ׳‘׳•׳ ׳”.
                            </CardDescription>
                          </div>
                          <Badge variant="outline" className="rounded-full border-stone-300 bg-white text-slate-700">
                            {selectedSourceDetails.length} ׳׳§׳•׳¨׳•׳×
                          </Badge>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-right" dir="rtl">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Reference</p>
                          <p className="mt-2 text-lg font-bold text-slate-900">{currentReference || '׳‘׳—׳¨ ׳׳§׳•׳¨'}</p>
                          <p className="mt-2 text-sm text-slate-500">{studyModeLabel}</p>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2 text-right" dir="rtl">
                          {selectedSourceDetails.length > 0 ? selectedSourceDetails.map((source) => (
                            <div key={source.key} className="rounded-2xl border border-stone-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-900">{source.label}</span>
                                <Badge variant="secondary" className="rounded-full bg-stone-100 text-slate-700">
                                  ׳₪׳¢׳™׳
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500">
                                {SOURCE_DESCRIPTIONS[source.key]}
                              </p>
                            </div>
                          )) : (
                            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-4 text-sm text-slate-500" dir="rtl">
                              ׳‘׳—׳¨ ׳׳₪׳—׳•׳× ׳׳§׳•׳¨ ׳׳—׳“ ׳›׳“׳™ ׳׳”׳×׳—׳™׳.
                            </div>
                          )}
                        </div>

                        <Separator className="bg-stone-200" />

                        <div className="space-y-3 text-right" dir="rtl">
                          <div className="flex items-center gap-2 text-slate-700">
                            <Clock3 className="h-4 w-4" />
                            <span className="text-sm font-medium">׳׳•׳×׳׳ ׳׳§׳¨׳™׳׳” ׳•׳׳—׳–׳¨׳”</span>
                          </div>
                          <ul className="space-y-2 text-sm leading-6 text-slate-500">
                            <li>׳¢׳¨׳™׳›׳” ׳¡׳•׳₪׳™׳× ׳‘׳¡׳’׳ ׳•׳ ׳׳ª׳™׳‘׳ª׳ ׳¢׳ ׳¡׳™׳›׳•׳ ׳׳¢׳©׳™.</li>
                            <li>׳§׳™׳‘׳•׳¥ ׳“׳¢׳•׳× ׳“׳•׳׳•׳× ׳‘׳׳§׳•׳ ׳—׳–׳¨׳•׳× ׳׳™׳™׳’׳¢׳•׳×.</li>
                            <li>׳”׳¦׳’׳” ׳ ׳§׳™׳” ׳¢׳ ׳”׳₪׳¨׳“׳” ׳‘׳™׳ ׳׳§׳•׳¨, ׳‘׳™׳׳•׳¨ ׳•׳”׳›׳¨׳¢׳”.</li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  </aside>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-destructive animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">{error}</span>
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-right" dir="rtl">
                    <p className="text-sm font-semibold text-slate-800">׳׳•׳›׳ ׳׳”׳₪׳§׳× ׳“׳£ ׳”׳׳™׳׳•׳“</p>
                    <p className="text-sm text-slate-500">׳”׳׳¢׳¨׳›׳× ׳ª׳‘׳ ׳” ׳‘׳™׳׳•׳¨׳™׳, ׳ª׳¦׳•׳¨ ׳¡׳™׳›׳•׳ ׳•׳ª׳׳₪׳©׳¨ ׳™׳™׳¦׳•׳ ׳-Google Docs.</p>
                  </div>
                  <Button
                    onClick={handleGenerate}
                    className="h-14 rounded-2xl bg-slate-900 px-8 text-lg text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800"
                    disabled={isInteractionDisabled || !canGenerate}
                  >
                    {!user ? '׳׳×׳—׳‘׳¨ ׳׳׳¢׳¨׳›׳×...' : '׳”׳×׳—׳ ׳‘׳ ׳™׳™׳× ׳”׳“׳£'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {false && (status === 'idle' || status === 'error') && (
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

                {section !== 'Torah Ohr' && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <Label className="text-sm font-semibold">קפיצה מהירה לסימן/סעיף</Label>
                    <div className="flex gap-2">
                      <Input
                        value={quickJumpRef}
                        onChange={(e) => setQuickJumpRef(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            applyQuickJump();
                          }
                        }}
                        placeholder='דוגמה: רפח:ג או 288:3'
                        className="h-11 bg-white"
                        disabled={isInteractionDisabled}
                        dir="rtl"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 shrink-0"
                        onClick={applyQuickJump}
                        disabled={isInteractionDisabled}
                      >
                        קפיצה
                      </Button>
                    </div>
                    {quickJumpError && (
                      <p className="text-xs text-destructive">{quickJumpError}</p>
                    )}
                  </div>
                )}

                <div className={`grid gap-4 ${needsSeif ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="space-y-3">
                    <Label className="text-base font-bold">{section === 'Torah Ohr' ? 'פרשה' : 'סימן'}</Label>
                    {loadingSimanim ? (
                      <div className="h-14 flex items-center justify-center bg-muted/50 rounded-2xl">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        <span className="mr-2 text-muted-foreground">{section === 'Torah Ohr' ? 'טוען פרשות...' : 'טוען סימנים...'}</span>
                      </div>
                    ) : (
                      <Select value={siman} onValueChange={setSiman} disabled={isInteractionDisabled}>
                        <SelectTrigger className="h-14 text-xl rounded-2xl">
                          <SelectValue placeholder={section === 'Torah Ohr' ? 'בחר פרשה' : 'בחר סימן'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {simanOptions.map(opt => (
                            <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                              {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {needsSeif && (
                    <div className="space-y-3">
                      <Label className="text-base font-bold">{section === 'Torah Ohr' ? 'מאמר' : 'סעיף'}</Label>
                      {loadingSeifim ? (
                        <div className="h-14 flex items-center justify-center bg-muted/50 rounded-2xl">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                          <span className="mr-2 text-muted-foreground">{section === 'Torah Ohr' ? 'טוען מאמרים...' : 'טוען סעיפים...'}</span>
                        </div>
                      ) : (
                        <Select value={seif} onValueChange={setSeif} disabled={isInteractionDisabled || seifOptions.length === 0}>
                          <SelectTrigger className="h-14 text-xl rounded-2xl">
                            <SelectValue placeholder={section === 'Torah Ohr' ? 'בחר מאמר' : 'בחר סעיף'} />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {seifOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)} className="text-lg">
                                {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </div>

                {section === 'Torah Ohr' && (
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 cursor-pointer">
                      <Checkbox
                        checked={torahOhrWholeParasha}
                        onCheckedChange={(checked) => setTorahOhrWholeParasha(!!checked)}
                        disabled={isInteractionDisabled}
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-800">כל הפרשה (כל המאמרים)</p>
                        <p className="text-xs text-slate-600">מומלץ כדי לא לפספס חלקים מהטקסט.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 cursor-pointer">
                      <Checkbox
                        checked={torahOhrPassagesOnly}
                        onCheckedChange={(checked) => setTorahOhrPassagesOnly(!!checked)}
                        disabled={isInteractionDisabled}
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-800">מצב קטעים בלבד (ללא ביאור AI)</p>
                        <p className="text-xs text-slate-600">מציג את כל קטעי הפרשה כמו שהם, מהר ויציב.</p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Source selection checkboxes */}
                <div className="space-y-3">
                  <Label className="text-base font-bold">מקורות לכלול בביאור</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {SOURCE_OPTIONS
                      .filter(opt => !opt.onlyOC || section === 'Orach Chayim')
                      .filter(opt => section === 'Torah Ohr' ? opt.key === 'torah_ohr' : opt.key !== 'torah_ohr')
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

                {/* Optional Manual Overrides */}
                {(selectedSources.includes('tur') || selectedSources.includes('beit_yosef')) && (
                  <div className="space-y-5 border-t border-border/50 pt-5 mt-2">
                    {selectedSources.includes('tur') && (
                      <div className="space-y-3">
                        <Label className="text-base font-bold text-muted-foreground">הדבקת טקסט ידנית - טור (רשות)</Label>
                        <Textarea
                          placeholder="טקסט מדויק לטור (השאר ריק למשיכה אוטומטית החכמה)"
                          className="min-h-[100px] text-base rounded-xl font-sefer bg-muted/20"
                          value={manualTurText}
                          onChange={(e) => setManualTurText(e.target.value)}
                          disabled={isInteractionDisabled}
                          dir="rtl"
                        />
                      </div>
                    )}
                    {selectedSources.includes('beit_yosef') && (
                      <div className="space-y-3">
                        <Label className="text-base font-bold text-muted-foreground">הדבקת טקסט ידנית - בית יוסף (רשות)</Label>
                        <Textarea
                          placeholder="טקסט מדויק לבית יוסף (השאר ריק למשיכה אוטומטית החכמה)"
                          className="min-h-[100px] text-base rounded-xl font-sefer bg-muted/20"
                          value={manualByText}
                          onChange={(e) => setManualByText(e.target.value)}
                          disabled={isInteractionDisabled}
                          dir="rtl"
                        />
                      </div>
                    )}
                  </div>
                )}
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
                    <Progress
                      value={isSummaryPhase ? 100 : pct}
                      className="h-3 overflow-hidden rounded-full bg-muted shadow-inner"
                    />

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
          const mainSources = ['tur', 'shulchan_arukh', 'torah_ohr']
            .map(key => previewSourceResults.find(sr => sr.sourceKey === key))
            .filter(Boolean) as SourceResult[];
          const commentarySources = ['mishnah_berurah', 'beit_yosef']
            .map(key => previewSourceResults.find(sr => sr.sourceKey === key))
            .filter(Boolean) as SourceResult[];

          const Toolbar = () => (
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <button className="text-[#8B8B82] hover:text-[#5D5D56] transition-colors"><Minus className="w-3.5 h-3.5" /></button>
              <button className="text-[#8B8B82] hover:text-[#5D5D56] transition-colors"><FileText className="w-3.5 h-3.5" /></button>
              <button className="text-[#8B8B82] hover:text-[#5D5D56] transition-colors"><Info className="w-3.5 h-3.5" /></button>
              <button className="text-[#8B8B82] hover:text-[#5D5D56] transition-colors"><Copyright className="w-3.5 h-3.5" /></button>
              <button className="text-[#8B8B82] hover:text-[#5D5D56] transition-colors"><Bookmark className="w-3.5 h-3.5" /></button>
            </div>
          );

          const renderSourcePanel = (sr: SourceResult, compact = false) => {
            const fallbackTheme = compact ? SOURCE_THEME.beit_yosef : SOURCE_THEME.shulchan_arukh;
            const theme = SOURCE_THEME[sr.sourceKey] || fallbackTheme;
            const isBeitYosef = sr.sourceKey === 'beit_yosef';
            const isTorahOhr = sr.sourceKey === 'torah_ohr';

            return (
              <div key={sr.sourceKey} className={cn('mb-8 overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.05)]', theme.panelClass)}>
                <div className="mb-2 flex items-center justify-between border-b border-stone-200 bg-stone-50/80 px-4 py-3">
                  <Toolbar />
                  {theme.isMainSource || !compact ? (
                    <h2 className={cn('text-2xl md:text-3xl font-bold font-sefer pl-2', theme.titleColor)}>
                      {sr.hebrewLabel}
                    </h2>
                  ) : (
                    <h3 className={cn('text-xl md:text-2xl font-bold font-sefer pl-2', theme.titleColor)}>
                      {sr.hebrewLabel}
                    </h3>
                  )}
                </div>

                <ScrollArea className={compact ? 'max-h-[60vh]' : undefined}>
                  <div className={cn('mx-auto text-right', compact ? 'px-4 py-5' : 'px-5 py-6 md:px-7', isTorahOhr ? 'max-w-3xl' : '')} dir="rtl">
                    {sr.chunks.map((chunk, index) => (
                      isBeitYosef || isTorahOhr ? (
                        <div key={chunk.id || index} className={cn(index > 0 ? (isTorahOhr ? 'mt-4' : 'mt-6 border-t border-stone-200 pt-6') : '')}>
                          {!isTorahOhr && (
                            <p className={cn(
                              'font-sefer leading-[1.4] text-slate-800 space-y-2 mb-3',
                              compact ? 'text-lg' : 'text-xl',
                            )}>
                              {chunk.rawText.trim()}
                            </p>
                          )}
                          <div className={cn(
                            'whitespace-pre-wrap rounded-r-2xl',
                            !isTorahOhr && 'mt-3 border-r-2 bg-stone-50/70 pr-4 py-3',
                            isTorahOhr ? 'font-sefer text-slate-800' : 'text-slate-700',
                            compact ? 'text-base leading-[1.4]' : (isTorahOhr ? 'text-lg leading-[1.5]' : 'text-lg leading-[1.4]'),
                            !isTorahOhr && theme.borderAccent,
                          )}>
                            {renderAccentText(chunk.explanation, theme.accentClass)}
                          </div>
                        </div>
                      ) : (
                        <article
                          key={chunk.id || index}
                          className={cn('py-2', index > 0 ? 'mt-6 border-t border-stone-200 pt-6' : '')}
                        >
                          <p className={cn(
                            'font-sefer leading-[1.4] space-y-2 mb-3 text-slate-800',
                            compact ? 'text-lg' : 'text-2xl',
                          )}>
                            {chunk.rawText.trim()}
                          </p>
                          <div className={cn(
                            'mt-3 whitespace-pre-wrap rounded-r-2xl border-r-2 bg-stone-50/70 pr-4 py-3 text-slate-700',
                            compact ? 'text-base leading-[1.4]' : 'text-lg leading-[1.4]',
                            theme.borderAccent,
                          )}>
                            {renderAccentText(chunk.explanation, theme.accentClass)}
                          </div>
                        </article>
                      )
                    ))}
                  </div>
                </ScrollArea>
              </div>
            );
          };

          return (
            <div className="animate-in fade-in py-8 space-y-12 bg-stone-50 -mx-6 px-6 md:px-8 lg:px-12">
              <div className="flex items-center justify-between pb-4 border-b border-slate-300">
                <div className="flex gap-2">
                  <Button
                    onClick={handleExport}
                    size="sm"
                    className="h-9 text-sm bg-slate-800 hover:bg-slate-700 text-white rounded-lg gap-2"
                  >
                    לייצא ל-Google Docs <ArrowRight className="w-4 h-4 rotate-180" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus('idle')}
                    className="h-9 text-sm rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  >
                    חזור
                  </Button>
                </div>
                <h1 className="text-xl font-bold font-sefer text-slate-800">{guide?.tref}</h1>
              </div>

              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="space-y-8">
                  <div className="hidden lg:flex flex-col gap-5">
                    {mainSources.map(sr => renderSourcePanel(sr, false))}
                    {commentarySources.length > 0 && (
                      <div className={cn('grid gap-5', commentarySources.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                        {commentarySources.map(sr => renderSourcePanel(sr, true))}
                      </div>
                    )}
                  </div>

                  <div className="lg:hidden">
                    <Tabs defaultValue={previewSourceResults[0]?.sourceKey} dir="rtl">
                      <TabsList className="mb-6 flex h-auto w-full flex-wrap gap-2 rounded-none border-b border-slate-300 bg-transparent p-0 pb-2">
                        {previewSourceResults.map((sr) => {
                          const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
                          return (
                            <TabsTrigger
                              key={sr.sourceKey}
                              value={sr.sourceKey}
                              className={cn(
                                'min-w-[4rem] flex-1 rounded-none bg-transparent py-2 text-lg font-bold font-sefer data-[state=active]:border-b-2 data-[state=active]:border-slate-800 data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                                theme.isMainSource ? 'data-[state=active]:text-slate-900' : 'text-slate-600'
                              )}
                            >
                              {sr.hebrewLabel}
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>

                      {previewSourceResults.map((sr) => (
                        <TabsContent key={sr.sourceKey} value={sr.sourceKey}>
                          {renderSourcePanel(sr, true)}
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                </div>

                <aside className="space-y-6 xl:sticky xl:top-28 xl:self-start">
                  <Card className="rounded-[1.75rem] border border-stone-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                    <CardHeader className="border-b border-stone-200">
                      <div className="flex items-center justify-between">
                        <Toolbar />
                        <h2 className="pl-2 text-2xl font-bold font-sefer text-slate-800">
                          ׳¡׳™׳›׳•׳
                        </h2>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-6 font-sefer text-right text-lg leading-[1.5] text-slate-800" dir="rtl">
                      {summarySections.length > 0 ? (
                        summarySections.map((section, idx) => (
                          <section key={`${section.title}-${idx}`}>
                            <h3 className="mb-3 inline-block border-b border-stone-200 pb-2 text-xl font-bold text-slate-900">
                              {section.title}
                            </h3>
                            {section.paragraphs.map((paragraph, pIdx) => (
                              <p key={`p-${pIdx}`} className="mb-2 text-slate-700">
                                {renderAccentText(paragraph, 'text-slate-900')}
                              </p>
                            ))}
                            {section.items.length > 0 && (
                              <ul className="mt-3 space-y-2 text-slate-700">
                                {section.items.map((item, itemIdx) => (
                                  <li key={`i-${itemIdx}`} className="flex items-start gap-2.5">
                                    <span className="mt-1 text-slate-400">ג€¢</span>
                                    <span>{renderAccentText(item, 'text-slate-900')}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        ))
                      ) : (
                        <p className="text-slate-400">׳׳ ׳ ׳•׳¦׳¨ ׳¡׳™׳›׳•׳.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-[1.5rem] border border-stone-200 bg-stone-50/80">
                    <CardContent className="space-y-4 p-5">
                      <div className="text-right" dir="rtl">
                        <p className="text-sm font-semibold text-slate-800">{guide?.tref}</p>
                        <p className="mt-1 text-sm text-slate-500">׳׳¦׳‘ ׳§׳¨׳™׳׳” ׳•׳™׳™׳¦׳•׳</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          onClick={handleExport}
                          className="h-11 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                        >
                          ׳׳™׳™׳¦׳ ׳-Google Docs <ArrowRight className="mr-2 h-4 w-4 rotate-180" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setStatus('idle')}
                          className="h-11 rounded-xl border-stone-300 bg-white text-slate-700 hover:bg-stone-50"
                        >
                          ׳—׳–׳•׳¨ ׳׳¢׳¨׳™׳›׳”
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </aside>
              </div>

              <div className="hidden">
                {mainSources.map(sr => renderSourcePanel(sr, false))}
                {commentarySources.length > 0 && (
                  <div className={cn('grid gap-5', commentarySources.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                    {commentarySources.map(sr => renderSourcePanel(sr, true))}
                  </div>
                )}
              </div>

              <div className="hidden">
                <Tabs defaultValue={previewSourceResults[0]?.sourceKey} dir="rtl">
                  <TabsList className="w-full h-auto flex-wrap gap-2 bg-transparent border-b border-slate-300 p-0 mb-6 pb-2 rounded-none">
                    {previewSourceResults.map((sr) => {
                      const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
                      return (
                        <TabsTrigger
                          key={sr.sourceKey}
                          value={sr.sourceKey}
                          className={cn(
                            'flex-1 min-w-[4rem] text-lg font-bold font-sefer py-2 data-[state=active]:border-b-2 data-[state=active]:border-slate-800 rounded-none bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                            theme.isMainSource ? 'data-[state=active]:text-slate-900' : 'text-slate-600'
                          )}
                        >
                          {sr.hebrewLabel}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  {previewSourceResults.map((sr) => (
                    <TabsContent key={sr.sourceKey} value={sr.sourceKey}>
                      {renderSourcePanel(sr, true)}
                    </TabsContent>
                  ))}
                </Tabs>
              </div>

              <div className="hidden">
                <div className="flex items-center justify-between border-b-2 border-slate-300 pb-2 mb-6">
                  <Toolbar />
                  <h2 className="text-2xl md:text-3xl font-bold font-sefer pl-2 text-slate-800">
                    סיכום
                  </h2>
                </div>
                <div className="font-sefer text-lg leading-[1.4] text-slate-800 text-right space-y-8" dir="rtl">
                  {summarySections.length > 0 ? (
                    summarySections.map((section, idx) => (
                      <section key={`${section.title}-${idx}`}>
                        <h3 className="text-xl font-bold text-slate-900 mb-3 border-b border-slate-200 pb-2 inline-block">
                          {section.title}
                        </h3>
                        {section.paragraphs.map((paragraph, pIdx) => (
                          <p key={`p-${pIdx}`} className="mb-2 text-slate-700">
                            {renderAccentText(paragraph, 'text-slate-900')}
                          </p>
                        ))}
                        {section.items.length > 0 && (
                          <ul className="space-y-2 mt-3 text-slate-700">
                            {section.items.map((item, itemIdx) => (
                              <li key={`i-${itemIdx}`} className="flex items-start gap-2.5">
                                <span className="mt-1 text-slate-400">•</span>
                                <span>{renderAccentText(item, 'text-slate-900')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ))
                  ) : (
                    <p className="text-slate-400">לא נוצר סיכום.</p>
                  )}
                </div>
              </div>

              <div className="hidden">
                <Button
                  onClick={handleExport}
                  size="sm"
                  className="h-9 text-sm bg-slate-800 hover:bg-slate-700 text-white rounded-lg gap-2"
                >
                  לייצא ל-Google Docs <ArrowRight className="w-4 h-4 rotate-180" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus('idle')}
                  className="h-9 text-sm rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
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
