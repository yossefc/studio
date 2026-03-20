'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertCircle, ArrowRight, XCircle, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TehilimReader } from '@/components/TehilimReader';
import { generateMultiSourceStudyGuide, exportSummaryToGoogleDocs, exportToGoogleDocs, type GenerationResult, type SourceResult } from '@/app/actions/study-guide';
import { getSimanOptions, getSeifOptions, type SimanOption, type SeifOption } from '@/app/actions/sefaria-metadata';
import type { SourceKey } from '@/lib/sefaria-api';
import { hebrewToNumber } from '@/lib/hebrew-utils';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser } from '@/firebase';
import { doc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, getDocs } from 'firebase/firestore';
import { syncFirebaseSession } from '@/firebase/session-sync';

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
  { key: 'rav_ovadia', label: 'רב עובדיה יוסף', onlyOC: false },
  { key: 'torah_ohr', label: 'תורה אור', onlyOC: false },
];

const SOURCE_DISPLAY_ORDER: SourceKey[] = ['tur', 'beit_yosef', 'shulchan_arukh', 'mishnah_berurah', 'rav_ovadia', 'torah_ohr'];

const CLEAN_SECTION_LABELS: Record<string, string> = {
  'Orach Chayim': 'אורח חיים',
  'Yoreh Deah': 'יורה דעה',
  'Even HaEzer': 'אבן העזר',
  'Choshen Mishpat': 'חושן משפט',
  'Torah Ohr': 'תורה אור',
};

const CLEAN_SOURCE_LABELS: Record<SourceKey, string> = {
  tur: 'טור',
  beit_yosef: 'בית יוסף',
  shulchan_arukh: 'שולחן ערוך',
  mishnah_berurah: 'משנה ברורה',
  rav_ovadia: 'רב עובדיה יוסף',
  torah_ohr: 'תורה אור',
};

const CLEAN_SOURCE_DESCRIPTIONS: Record<SourceKey, string> = {
  tur: 'יסוד הסימן והצגת מהלך הדברים.',
  beit_yosef: 'שיטות, סברות, וקיבוץ הדעות.',
  shulchan_arukh: 'הכרעת ההלכה בלשון פסוקה.',
  mishnah_berurah: 'ביאור מעשי וחילוקים להלכה.',
  rav_ovadia: 'פסיקת הרב עובדיה יוסף זצ"ל (יחוה דעת, יביע אומר, חזון עובדיה).',
  torah_ohr: 'מהלך חסידי עם ביאור פנימי.',
};

const DIRECTOR_EMAIL = 'yossefcohzar@gmail.com';

function isSourceKey(value: unknown): value is SourceKey {
  return typeof value === 'string' && (SOURCE_DISPLAY_ORDER as string[]).includes(value);
}

const SOURCE_THEME: Record<SourceKey, { accentClass: string; borderAccent: string }> = {
  tur: {
    accentClass: 'text-amber-900',
    borderAccent: 'border-r-amber-600',
  },
  beit_yosef: {
    accentClass: 'text-teal-800',
    borderAccent: 'border-r-teal-600',
  },
  shulchan_arukh: {
    accentClass: 'text-sky-800',
    borderAccent: 'border-r-sky-600',
  },
  mishnah_berurah: {
    accentClass: 'text-lime-800',
    borderAccent: 'border-r-lime-600',
  },
  rav_ovadia: {
    accentClass: 'text-purple-900',
    borderAccent: 'border-r-purple-700',
  },
  torah_ohr: {
    accentClass: 'text-[#5C3A21]',
    borderAccent: 'border-r-[#5C3A21]',
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
  const [manualMbText, setManualMbText] = useState('');

  const [simanOptions, setSimanOptions] = useState<SimanOption[]>([]);
  const [seifOptions, setSeifOptions] = useState<SeifOption[]>([]);
  const [loadingSimanim, setLoadingSimanim] = useState(true);
  const [loadingSeifim, setLoadingSeifim] = useState(false);

  const [status, setStatus] = useState<'idle' | 'processing' | 'preview' | 'exporting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [currentGuideId, setCurrentGuideId] = useState<string | null>(null);
  const [guide, setGuide] = useState<StudyGuideEntity | null>(null);

  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressPhase, setProgressPhase] = useState<string>('chunks');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydratingPreviewRef = useRef(false);

  const [previewSourceResults, setPreviewSourceResults] = useState<SourceResult[]>([]);
  const [previewSummary, setPreviewSummary] = useState('');
  const publishedDocUrl = guide?.googleDocUrl?.trim() ?? '';

  const isServerActionNetworkError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /failed to fetch|fetch failed|networkerror/i.test(message);
  };

  const callGenerateWithRetry = async (
    request: Parameters<typeof generateMultiSourceStudyGuide>[0],
    guideId: string,
  ): Promise<GenerationResult> => {
    return await generateMultiSourceStudyGuide(request, guideId);
  };

  type SummarySection = { title: string; paragraphs: string[]; items: string[] };

  const summarySections = previewSummary
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce<SummarySection[]>((sections, line) => {
      const headerMatch = line.match(/^##\s+(.+)$/);
      const bulletMatch = line.match(/^(?:[-*]|\d+\.|\u2022)\s+(.+)$/);
      if (headerMatch) {
        sections.push({ title: headerMatch[1]!.trim(), paragraphs: [], items: [] });
        return sections;
      }
      if (sections.length === 0) sections.push({ title: 'סיכום', paragraphs: [], items: [] });
      const current = sections[sections.length - 1]!;
      if (bulletMatch) current.items.push(bulletMatch[1]!.trim());
      else current.paragraphs.push(line);
      return sections;
    }, []);

  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const router = useRouter();

  const renderAccentText = (text: string, accentClass: string) =>
    text.split('**').map((part, i) =>
      i % 2 === 1
        ? <strong key={i} className={cn('font-bold', accentClass)}>{part}</strong>
        : part,
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
            hebrewLabel: sourceChunks[0]?.hebrewLabel || CLEAN_SOURCE_LABELS[sourceKey],
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

  // Listen for real-time progress updates
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

  // Reset on section change
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
    if (!pendingQuickSeif || loadingSeifim || seifOptions.length === 0) return;
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
    setSelectedSources(prev => checked ? [...prev, key] : prev.filter(s => s !== key));
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
    if (!normalized) { setQuickJumpError('הכנס סימן או סימן:סעיף.'); return; }
    const parts = normalized.split(/[:.\s/-]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0 || parts.length > 2) {
      setQuickJumpError('פורמט לא תקין. דוגמה: רפח:ג או 288:3');
      return;
    }
    const simanPart = parseRefPart(parts[0]!);
    if (!simanPart) { setQuickJumpError('הסימן שהוזן לא תקין.'); return; }
    const nextSiman = String(simanPart);
    const nextSeif = parts[1] ? parseRefPart(parts[1]!) : null;
    if (parts[1] && !nextSeif) { setQuickJumpError('הסעיף שהוזן לא תקין.'); return; }
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
    const sectionLabel = CLEAN_SECTION_LABELS[section] || 'Orach Chayim';
    const simanLabel = simanOptions.find(o => String(o.value) === siman)?.label || siman;
    const seifLabel = seifOptions.find(o => String(o.value) === seif)?.label || seif;
    const displayTref = isTorahOhrFullParasha
      ? `${sectionLabel} ${simanLabel}`
      : `${sectionLabel} ${simanLabel}${needsSeif ? `:${seifLabel}` : ''}`;
    const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', studyGuideId);
    const now = new Date().toISOString();
    try {
      await syncFirebaseSession(user);
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
          manualMbText: selectedSources.includes('mishnah_berurah') ? manualMbText : undefined,
        },
        studyGuideId,
      );
      if (result.cancelled) { setStatus('idle'); return; }
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

  const applyExportSuccess = async (googleDocUrl: string, googleDocId?: string) => {
    if (!guide || !user || !firestore) return;
    const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', guide.id);
    const updatedGuide: StudyGuideEntity = {
      ...guide,
      status: 'Published',
      googleDocId: googleDocId ?? guide.googleDocId ?? '',
      googleDocUrl,
      updatedAt: new Date().toISOString(),
    };

    await updateDoc(guideRef, {
      status: 'Published',
      googleDocId: updatedGuide.googleDocId,
      googleDocUrl,
      updatedAt: updatedGuide.updatedAt,
    });

    setGuide(updatedGuide);
    setStatus('success');
  };

  const handleExportFull = async () => {
    if (!guide || !user || !firestore) return;
    setStatus('exporting');
    setError('');
    await syncFirebaseSession(user);
    const result = await exportToGoogleDocs(guide.tref, previewSummary, previewSourceResults);
    if (result.success && result.googleDocId && result.googleDocUrl) {
      try {
        await applyExportSuccess(result.googleDocUrl, result.googleDocId);
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

  const handleExportSummary = async () => {
    if (!guide || !user || !firestore) return;
    setStatus('exporting');
    setError('');
    await syncFirebaseSession(user);
    const result = await exportSummaryToGoogleDocs(guide.tref, previewSummary);
    if (result.success && result.googleDocUrl) {
      try {
        await applyExportSuccess(result.googleDocUrl);
      } catch (e) {
        console.error(e);
        setError('שגיאה בעדכון המסמך. אנא נסה שנית.');
        setStatus('preview');
      }
    } else {
      setError(result.error || 'שגיאה ביצוא הסיכום.');
      setStatus('preview');
    }
  };

  const isInteractionDisabled = isUserLoading || status === 'processing' || !user;
  const availableSources = SOURCE_OPTIONS
    .filter(opt => !opt.onlyOC || section === 'Orach Chayim')
    .filter(opt => section === 'Torah Ohr' ? opt.key === 'torah_ohr' : opt.key !== 'torah_ohr');
  const sectionLabel = CLEAN_SECTION_LABELS[section] || section;
  const selectedSimanLabel = simanOptions.find(o => String(o.value) === siman)?.label || siman;
  const selectedSeifLabel = seifOptions.find(o => String(o.value) === seif)?.label || seif;
  const currentReference = isTorahOhrFullParasha
    ? `${sectionLabel} ${selectedSimanLabel}`.trim()
    : `${sectionLabel} ${selectedSimanLabel}${needsSeif && selectedSeifLabel ? `:${selectedSeifLabel}` : ''}`.trim();
  const canGenerate = Boolean(user && siman && selectedSources.length > 0 && (!needsSeif || seif));
  const previewChunkCount = previewSourceResults.reduce((sum, sr) => sum + sr.chunks.length, 0);
  const isDirector = (user?.email || '').toLowerCase() === DIRECTOR_EMAIL;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <Navigation />

      {/* ?? Toolbar ?? */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 pt-14 print:hidden" dir="rtl">
        <h1 className="shrink-0 text-sm font-semibold text-gray-800">בניית דף עיון</h1>
        {currentReference && (
          <span className="text-xs text-gray-500">{currentReference}</span>
        )}
        <div className="flex-1" />
        {(status === 'preview' || status === 'success') && (
          <>
            {publishedDocUrl && (
              <a
                href={publishedDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
              >
                <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                Google Docs
              </a>
            )}
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
            >
              חזרה
            </button>
          </>
        )}
        {status === 'processing' && (
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80"
          >
            <XCircle className="h-3.5 w-3.5" />
            ביטול
          </button>
        )}
      </div>

      {isUserLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ?? Sidebar – config panel ?? */}
          <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-gray-200 print:hidden">
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4" dir="rtl">

                {/* Section */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">חלק</p>
                  <Select value={section} onValueChange={setSection} disabled={isInteractionDisabled}>
                    <SelectTrigger className="h-8 rounded-md border-gray-200 text-sm">
                      <SelectValue placeholder="בחר חלק" />
                    </SelectTrigger>
                    <SelectContent>
                      {SECTIONS.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-sm">
                          {CLEAN_SECTION_LABELS[s.id] || s.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Quick jump */}
                {section !== 'Torah Ohr' && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">קפיצה מהירה</p>
                    <div className="flex gap-1.5">
                      <Input
                        value={quickJumpRef}
                        onChange={(e) => setQuickJumpRef(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); applyQuickJump(); }
                        }}
                        placeholder="288:3 או רפח:ג"
                        className="h-8 rounded-md border-gray-200 text-sm"
                        disabled={isInteractionDisabled}
                        dir="rtl"
                      />
                      <button
                        type="button"
                        onClick={applyQuickJump}
                        disabled={isInteractionDisabled}
                        className="h-8 shrink-0 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        החל
                      </button>
                    </div>
                    {quickJumpError && <p className="text-xs text-destructive">{quickJumpError}</p>}
                  </div>
                )}

                {/* Siman + Seif */}
                <div className={`grid gap-2 ${needsSeif ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {section === 'Torah Ohr' ? 'פרשה' : 'סימן'}
                    </p>
                    {loadingSimanim ? (
                      <div className="flex h-8 items-center justify-center rounded-md bg-gray-50 text-xs text-gray-400">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> טוען...
                      </div>
                    ) : (
                      <Select value={siman} onValueChange={setSiman} disabled={isInteractionDisabled}>
                        <SelectTrigger className="h-8 rounded-md border-gray-200 text-sm">
                          <SelectValue placeholder="בחר" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[260px]">
                          {simanOptions.map(opt => (
                            <SelectItem key={opt.value} value={String(opt.value)} className="text-sm">
                              {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {needsSeif && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        {section === 'Torah Ohr' ? 'מאמר' : 'סעיף'}
                      </p>
                      {loadingSeifim ? (
                        <div className="flex h-8 items-center justify-center rounded-md bg-gray-50 text-xs text-gray-400">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> טוען...
                        </div>
                      ) : (
                        <Select value={seif} onValueChange={setSeif} disabled={isInteractionDisabled || seifOptions.length === 0}>
                          <SelectTrigger className="h-8 rounded-md border-gray-200 text-sm">
                            <SelectValue placeholder="בחר" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[260px]">
                            {seifOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)} className="text-sm">
                                {opt.label}{section === 'Torah Ohr' ? '' : ` (${opt.value})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </div>

                {/* Torah Ohr options */}
                {section === 'Torah Ohr' && (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">מצב לימוד</p>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-dashed border-gray-200 p-2.5">
                      <Checkbox
                        checked={torahOhrWholeParasha}
                        onCheckedChange={(checked) => setTorahOhrWholeParasha(!!checked)}
                        disabled={isInteractionDisabled}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">כל הפרשה</p>
                        <p className="text-xs text-gray-400">כולל את כל המאמרים</p>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 p-2.5">
                      <Checkbox
                        checked={torahOhrPassagesOnly}
                        onCheckedChange={(checked) => setTorahOhrPassagesOnly(!!checked)}
                        disabled={isInteractionDisabled}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">קטעים בלבד</p>
                        <p className="text-xs text-gray-400">ללא ביאור AI</p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Sources */}
                <div className="space-y-1.5 border-t border-gray-100 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">מקורות</p>
                  <div className="space-y-1">
                    {availableSources.map((opt) => (
                      <label
                        key={opt.key}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors',
                          selectedSources.includes(opt.key)
                            ? 'border-gray-900 bg-gray-900'
                            : 'border-gray-200 hover:bg-gray-50',
                        )}
                      >
                        <Checkbox
                          checked={selectedSources.includes(opt.key)}
                          onCheckedChange={(checked) => toggleSource(opt.key, !!checked)}
                          disabled={isInteractionDisabled}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className={cn('text-sm font-medium', selectedSources.includes(opt.key) ? 'text-white' : 'text-gray-800')}>
                            {CLEAN_SOURCE_LABELS[opt.key]}
                          </p>
                          <p className={cn('text-xs leading-5', selectedSources.includes(opt.key) ? 'text-white/60' : 'text-gray-400')}>
                            {CLEAN_SOURCE_DESCRIPTIONS[opt.key]}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Manual text overrides */}
                {(selectedSources.includes('tur') || selectedSources.includes('beit_yosef') || selectedSources.includes('mishnah_berurah')) && (
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">הזנה ידנית (רשות)</p>
                    {selectedSources.includes('tur') && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">טור</p>
                        <Textarea
                          placeholder="טקסט מדויק לטור"
                          className="min-h-[80px] rounded-md border-gray-200 text-sm"
                          value={manualTurText}
                          onChange={(e) => setManualTurText(e.target.value)}
                          disabled={isInteractionDisabled}
                          dir="rtl"
                        />
                      </div>
                    )}
                    {selectedSources.includes('beit_yosef') && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">בית יוסף</p>
                        <Textarea
                          placeholder="טקסט מדויק לבית יוסף"
                          className="min-h-[80px] rounded-md border-gray-200 text-sm"
                          value={manualByText}
                          onChange={(e) => setManualByText(e.target.value)}
                          disabled={isInteractionDisabled}
                          dir="rtl"
                        />
                      </div>
                    )}
                    {selectedSources.includes('mishnah_berurah') && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">משנה ברורה</p>
                        <Textarea
                          placeholder="טקסט מדויק למשנה ברורה"
                          className="min-h-[80px] rounded-md border-gray-200 text-sm"
                          value={manualMbText}
                          onChange={(e) => setManualMbText(e.target.value)}
                          disabled={isInteractionDisabled}
                          dir="rtl"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive" dir="rtl">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

              </div>
            </ScrollArea>

            {/* Generate button */}
            <div className="shrink-0 border-t border-gray-200 p-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isInteractionDisabled || !canGenerate}
                className="flex h-8 w-full items-center justify-center rounded-md bg-gray-900 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {status === 'processing'
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />מעבד...</>
                  : !user ? 'נדרשת התחברות' : 'בנה דף עיון'}
              </button>
            </div>
          </aside>

          {/* ?? Main content ?? */}
          <main className="flex flex-1 flex-col overflow-hidden">

            {/* idle / error */}
            {(status === 'idle' || status === 'error') && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8" dir="rtl">
                <ScrollText className="h-8 w-8 text-gray-300" />
                <p className="font-medium text-gray-700">בחר מקורות וסעיף, ואז לחץ &quot;בנה דף עיון&quot;</p>
                <p className="text-sm text-gray-400">
                  {selectedSources.length > 0
                    ? `${selectedSources.length} מקורות נבחרו`
                    : 'לא נבחרו מקורות'}
                </p>
              </div>
            )}

            {/* processing / exporting */}
            {(status === 'processing' || status === 'exporting') && (() => {
              const pct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
              const isSummaryPhase = progressPhase === 'summary';
              let remainingSeconds = 0;
              if (isSummaryPhase) {
                remainingSeconds = Math.max(15 - (elapsedSeconds % 15), 0);
              } else if (progressDone > 0 && progressTotal > 0) {
                const avgSecondsPerChunk = elapsedSeconds / progressDone;
                const chunksLeft = progressTotal - progressDone;
                remainingSeconds = Math.ceil(chunksLeft * avgSecondsPerChunk + 15);
              } else if (progressTotal > 0) {
                remainingSeconds = progressTotal * 12 + 15;
              }
              const etaMins = Math.floor(remainingSeconds / 60);
              const etaSecs = remainingSeconds % 60;
              const etaStr = `${String(etaMins).padStart(2, '0')}:${String(etaSecs).padStart(2, '0')}`;
              return (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8" dir="rtl">
                  <p className="text-sm font-semibold text-gray-800">
                    {status === 'exporting' ? 'מייצא ל-Google Docs...' : isSummaryPhase ? 'מכין את הסיכום...' : 'בונה את דף העיון...'}
                  </p>
                  {status === 'processing' && (
                    <div className="w-full max-w-sm space-y-2">
                      <Progress value={isSummaryPhase ? 100 : pct} className="h-2 rounded-full" />
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>
                          {isSummaryPhase ? 'מסכם מקורות...' : progressTotal > 0 ? `${progressDone} / ${progressTotal} קטעים` : 'מתחיל...'}
                        </span>
                        <span>{etaStr}</span>
                      </div>
                    </div>
                  )}
                  {status === 'exporting' && <Loader2 className="h-6 w-6 animate-spin text-gray-400" />}
                  {status === 'processing' && <TehilimReader />}
                </div>
              );
            })()}

            {/* preview / success */}
            {(status === 'preview' || status === 'success') && (
              <div className="flex flex-1 overflow-hidden">

                {/* Sources tabs */}
                <div className="flex flex-1 flex-col overflow-hidden">
                  <Tabs
                    defaultValue={previewSourceResults[0]?.sourceKey}
                    className="flex flex-1 flex-col overflow-hidden"
                    dir="rtl"
                  >
                    <TabsList className="flex h-auto w-full shrink-0 gap-0 rounded-none border-b border-gray-200 bg-white p-0">
                      {previewSourceResults.map((sr) => (
                        <TabsTrigger
                          key={sr.sourceKey}
                          value={sr.sourceKey}
                          className="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 data-[state=active]:border-gray-900 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
                        >
                          {sr.hebrewLabel}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <div className="flex-1 overflow-hidden">
                      {previewSourceResults.map((sr) => {
                        const theme = SOURCE_THEME[sr.sourceKey] || SOURCE_THEME.shulchan_arukh;
                        return (
                          <TabsContent
                            key={sr.sourceKey}
                            value={sr.sourceKey}
                            className="mt-0 h-full overflow-y-auto"
                          >
                            <div className="space-y-5 p-5 text-right" dir="rtl">
                              {sr.chunks.map((chunk, index) => (
                                <div
                                  key={chunk.id || index}
                                  className={cn('space-y-2', index > 0 && 'border-t border-gray-100 pt-5')}
                                >
                                  <p className="font-sefer text-base leading-7 text-gray-800">
                                    {chunk.rawText.trim()}
                                  </p>
                                  <div
                                    className={cn(
                                      'whitespace-pre-wrap border-r-2 py-2 pr-3 text-sm leading-7 text-gray-600',
                                      theme.borderAccent,
                                    )}
                                  >
                                    {renderAccentText(chunk.explanation, theme.accentClass)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </TabsContent>
                        );
                      })}
                    </div>
                  </Tabs>
                </div>

                {/* Summary column */}
                <aside className="w-64 shrink-0 overflow-y-auto border-r border-gray-200 p-4 print:block" dir="rtl">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">סיכום</p>
                  <div className="space-y-4 font-sefer text-sm leading-7 text-gray-800">
                    {summarySections.length > 0 ? (
                      summarySections.map((sec, index) => (
                        <section key={`${sec.title}-${index}`}>
                          <h4 className="mb-1.5 border-b border-gray-100 pb-1 font-bold text-gray-900">
                            {sec.title}
                          </h4>
                          {sec.paragraphs.map((paragraph, pi) => (
                            <p key={pi} className="mb-1 text-gray-700">
                              {renderAccentText(paragraph, 'text-gray-900')}
                            </p>
                          ))}
                          {sec.items.length > 0 && (
                            <ul className="space-y-1 text-gray-700">
                              {sec.items.map((item, ii) => (
                                <li key={ii} className="flex gap-2">
                                  <span className="shrink-0 text-gray-400">•</span>
                                  <span>{renderAccentText(item, 'text-gray-900')}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      ))
                    ) : (
                      <p className="text-gray-400">לא נוצר סיכום.</p>
                    )}
                  </div>

                  <div className="mt-6 space-y-2 border-t border-gray-100 pt-4">
                    {guide?.tref && (
                      <div className="mb-3 text-right">
                        <p className="text-xs font-medium text-gray-700">{guide.tref}</p>
                        <p className="text-[11px] text-gray-400">
                          {previewChunkCount} קטעים · {previewSourceResults.length} מקורות
                        </p>
                      </div>
                    )}
                    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Export</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {isDirector
                          ? 'Full export and summary export are available.'
                          : 'Only summary export is available for this account.'}
                      </p>
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={handleExportSummary}
                          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                        >
                          <ArrowRight className="h-3 w-3 rotate-180" />
                          Export Summary
                        </button>
                        {isDirector && (
                          <button
                            type="button"
                            onClick={handleExportFull}
                            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <ArrowRight className="h-3 w-3 rotate-180" />
                            Export Full Guide
                          </button>
                        )}
                      </div>
                    </div>
                    {publishedDocUrl && (
                      <a
                        href={publishedDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        פתח ב-Google Docs
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      הדפס
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus('idle')}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      חזרה לעריכה
                    </button>
                  </div>
                </aside>

              </div>
            )}

          </main>
        </div>
      )}
    </div>
  );
}

