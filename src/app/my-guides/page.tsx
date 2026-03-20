'use client';

import Link from 'next/link';
import {
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Printer,
  ScrollText,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportAllGuidesToGoogleDocs, exportSimanSummariesToGoogleDocs } from '@/app/actions/study-guide';

import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { syncFirebaseSession } from '@/firebase/session-sync';
import { hebrewToNumber, numberToHebrew } from '@/lib/hebrew-utils';
import { normalizeTref } from '@/lib/sefaria-api';
import type { SourceKey } from '@/lib/sefaria-api';
import { cn } from '@/lib/utils';

interface StudyGuideEntity {
  id: string;
  userId: string;
  tref: string;
  summaryText: string;
  googleDocUrl: string;
  sources?: SourceKey[];
  status?: string;
  createdAt: string;
  rating?: number;
  topics?: string[];
  sefariaRef?: string;
}

type GuideRecord = StudyGuideEntity & { id: string };

interface TextChunkEntity {
  id: string;
  sourceKey: string;
  orderIndex: number;
  rawText: string;
  explanationText: string;
}

interface SummarySection {
  title: string;
  paragraphs: string[];
  items: string[];
}

interface ParsedTref {
  section: string;
  simanRaw: string;
  seifRaw: string;
  simanNum: number;
  seifNum: number;
}

interface SeifEntry {
  guide: GuideRecord;
  parsed: ParsedTref;
}

interface PrintGuideData {
  guide: GuideRecord;
  chunks: TextChunkEntity[];
}

interface SimanGroup {
  simanNum: number;
  simanRaw: string;
  seifEntries: SeifEntry[];
}

interface SectionGroup {
  section: string;
  simanim: SimanGroup[];
}

const ENGLISH_TO_HEBREW_SECTION: Record<string, string> = {
  'shulchan arukh, orach chayim': 'אורח חיים',
  'orach chayim': 'אורח חיים',
  'shulchan arukh, yoreh deah': 'יורה דעה',
  'yoreh deah': 'יורה דעה',
  'shulchan arukh, even haezer': 'אבן העזר',
  'even haezer': 'אבן העזר',
  'shulchan arukh, choshen mishpat': 'חושן משפט',
  'choshen mishpat': 'חושן משפט',
  'tur, orach chayim': 'אורח חיים',
  'tur, yoreh deah': 'יורה דעה',
  'tur, even haezer': 'אבן העזר',
  'tur, choshen mishpat': 'חושן משפט',
  'beit yosef, orach chayim': 'אורח חיים',
  'beit yosef, yoreh deah': 'יורה דעה',
  'beit yosef, even haezer': 'אבן העזר',
  'beit yosef, choshen mishpat': 'חושן משפט',
  'mishnah berurah': 'אורח חיים',
};

const SECTION_TO_BOOK_TITLE: Record<string, string> = {
  'אורח חיים': 'Shulchan Arukh, Orach Chayim',
  'יורה דעה': 'Shulchan Arukh, Yoreh Deah',
  'אבן העזר': 'Shulchan Arukh, Even HaEzer',
  'חושן משפט': 'Shulchan Arukh, Choshen Mishpat',
};

async function fetchSimanSubjectsForSection(bookTitle: string): Promise<Record<number, string>> {
  try {
    const res = await fetch(`https://www.sefaria.org/api/v2/index/${encodeURIComponent(bookTitle)}`);
    if (!res.ok) return {};
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return {};
    const subjects: Record<number, string> = {};
        const alts = (data as Record<string, unknown>).alts;
    const altObj = alts && typeof alts === 'object' ? alts as Record<string, unknown> : null;
    const structKey = altObj ? Object.keys(altObj)[0] : null;
    const struct = structKey && altObj ? altObj[structKey] : null;
    const nodes = Array.isArray((struct as Record<string, unknown> | null)?.nodes)
      ? ((struct as Record<string, unknown>).nodes as unknown[])
      : [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      const heTitle = typeof n.heTitle === 'string'
        ? n.heTitle
        : (Array.isArray(n.titles)
            ? (n.titles as Array<{ lang: string; text: string }>).find(t => t.lang === 'he')?.text
            : undefined);
      if (!heTitle) continue;
      const rangeRef = typeof n.wholeRef === 'string' ? n.wholeRef : null;
      if (rangeRef) {
        const m = rangeRef.match(/(\d+)(?:-(\d+))?$/);
        if (m) {
          const from = parseInt(m[1]!, 10);
          const to = m[2] ? parseInt(m[2], 10) : from;
          for (let i = from; i <= to; i++) { if (!subjects[i]) subjects[i] = heTitle; }
          continue;
        }
      }
      const refs = Array.isArray(n.refs) ? (n.refs as unknown[]) : [];
      for (const ref of refs) {
        if (typeof ref !== 'string') continue;
        const m = ref.match(/(\d+)(?:-(\d+))?$/);
        if (m) {
          const from = parseInt(m[1]!, 10);
          const to = m[2] ? parseInt(m[2], 10) : from;
          for (let i = from; i <= to; i++) { if (!subjects[i]) subjects[i] = heTitle; }
        }
      }
    }
    return subjects;
  } catch {
    return {};
  }
}

function extractFirstTopic(summaryText: string): string {
  if (!summaryText) return '';
  const match = summaryText.match(/^##\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

const SOURCE_LABELS: Record<string, string> = {
  tur: 'טור',
  beit_yosef: 'בית יוסף',
  shulchan_arukh: 'שולחן ערוך',
  mishnah_berurah: 'משנה ברורה',
  rav_ovadia: 'רב עובדיה יוסף',
  torah_ohr: 'תורה אור',
};

const SOURCE_THEME: Record<string, {
  accentClass: string;
  badgeClass: string;
  borderAccent: string;
  panelGlowClass: string;
}> = {
  tur: {
    accentClass: 'text-amber-900',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    borderAccent: 'border-r-amber-600',
    panelGlowClass: 'bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.15),transparent_38%),linear-gradient(180deg,#fffef8_0%,#ffffff_100%)]',
  },
  beit_yosef: {
    accentClass: 'text-teal-800',
    badgeClass: 'border-teal-200 bg-teal-50 text-teal-800',
    borderAccent: 'border-r-teal-600',
    panelGlowClass: 'bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.14),transparent_38%),linear-gradient(180deg,#fbfffe_0%,#ffffff_100%)]',
  },
  shulchan_arukh: {
    accentClass: 'text-sky-800',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-800',
    borderAccent: 'border-r-sky-600',
    panelGlowClass: 'bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_38%),linear-gradient(180deg,#f9fdff_0%,#ffffff_100%)]',
  },
  mishnah_berurah: {
    accentClass: 'text-lime-800',
    badgeClass: 'border-lime-200 bg-lime-50 text-lime-800',
    borderAccent: 'border-r-lime-600',
    panelGlowClass: 'bg-[radial-gradient(circle_at_top_right,rgba(132,204,22,0.14),transparent_38%),linear-gradient(180deg,#fcfff8_0%,#ffffff_100%)]',
  },
  rav_ovadia: {
    accentClass: 'text-purple-900',
    badgeClass: 'border-purple-200 bg-purple-50 text-purple-900',
    borderAccent: 'border-r-purple-700',
    panelGlowClass: 'bg-[radial-gradient(circle_at_top_right,rgba(147,51,234,0.12),transparent_38%),linear-gradient(180deg,#fdf4ff_0%,#ffffff_100%)]',
  },
};

const SOURCE_ORDER = ['tur', 'beit_yosef', 'shulchan_arukh', 'mishnah_berurah', 'rav_ovadia'];
const DIRECTOR_EMAIL = 'yossefcohzar@gmail.com';

function parseTref(tref: string): ParsedTref {
  const englishMatch = tref.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);

  if (englishMatch) {
    const sectionEng = englishMatch[1].trim();
    const simanNum = parseInt(englishMatch[2], 10);
    const seifNum = englishMatch[3] ? parseInt(englishMatch[3], 10) : 0;
    const section = ENGLISH_TO_HEBREW_SECTION[sectionEng.toLowerCase()] || sectionEng;

    return {
      section,
      simanRaw: numberToHebrew(simanNum),
      seifRaw: seifNum ? numberToHebrew(seifNum) : '',
      simanNum,
      seifNum,
    };
  }

  const colonIndex = tref.lastIndexOf(':');
  const spaceIndex = tref.lastIndexOf(' ', colonIndex === -1 ? undefined : colonIndex);

  if (spaceIndex === -1) {
    return { section: tref, simanRaw: '', seifRaw: '', simanNum: 0, seifNum: 0 };
  }

  const section = tref.slice(0, spaceIndex).trim();
  const rest = tref.slice(spaceIndex + 1).trim();
  let simanRaw = rest;
  let seifRaw = '';

  if (colonIndex !== -1) {
    const relColon = rest.indexOf(':');
    simanRaw = rest.slice(0, relColon).trim();
    seifRaw = rest.slice(relColon + 1).trim();
  }

  return {
    section,
    simanRaw,
    seifRaw,
    simanNum: hebrewToNumber(simanRaw),
    seifNum: seifRaw ? hebrewToNumber(seifRaw) : 0,
  };
}

function buildHierarchy(guides: GuideRecord[]): SectionGroup[] {
  const sectionMap = new Map<string, Map<number, SimanGroup>>();

  for (const guide of guides) {
    const parsed = parseTref(guide.tref);
    const { section, simanNum, simanRaw } = parsed;

    if (!sectionMap.has(section)) {
      sectionMap.set(section, new Map());
    }

    const simanMap = sectionMap.get(section)!;
    if (!simanMap.has(simanNum)) {
      simanMap.set(simanNum, { simanNum, simanRaw, seifEntries: [] });
    }

    const group = simanMap.get(simanNum)!;
    if (!group.simanRaw && simanRaw) {
      group.simanRaw = simanRaw;
    }
    group.seifEntries.push({ guide, parsed });
  }

  const result: SectionGroup[] = [];
  for (const [section, simanMap] of sectionMap) {
    const simanim = [...simanMap.values()].sort((a, b) => a.simanNum - b.simanNum);
    for (const siman of simanim) {
      siman.seifEntries.sort((a, b) => a.parsed.seifNum - b.parsed.seifNum);
    }
    result.push({ section, simanim });
  }

  const sectionOrder = ['אורח חיים', 'יורה דעה', 'אבן העזר', 'חושן משפט'];
  result.sort((a, b) => {
    const ia = sectionOrder.indexOf(a.section);
    const ib = sectionOrder.indexOf(b.section);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return result;
}

function renderAccentText(text: string, accentClass: string) {
  return text.split('**').map((part, index) => (
    index % 2 === 1 ? <strong key={index} className={cn('font-bold', accentClass)}>{part}</strong> : part
  ));
}

function parseSummarySections(summaryText: string): SummarySection[] {
  if (!summaryText.trim()) {
    return [];
  }

  return summaryText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<SummarySection[]>((sections, line) => {
      const headerMatch = line.match(/^##\s+(.+)$/);
      const bulletMatch = line.match(/^(?:[-*]|\d+\.|\u2022)\s+(.+)$/);

      if (headerMatch) {
        sections.push({ title: headerMatch[1]!.trim(), paragraphs: [], items: [] });
        return sections;
      }

      if (sections.length === 0) {
        sections.push({ title: 'סיכום למבחן רבנות', paragraphs: [], items: [] });
      }

      const current = sections[sections.length - 1]!;
      if (bulletMatch) {
        current.items.push(bulletMatch[1]!.trim());
      } else {
        current.paragraphs.push(line);
      }

      return sections;
    }, []);
}

function formatGuideDate(dateString?: string) {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function MyGuidesPage() {
  const { user, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();

  const [searchTerm, setSearchTerm] = useState('');
  const [openSimanim, setOpenSimanim] = useState<Set<string>>(new Set());
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  const [activeGuide, setActiveGuide] = useState<GuideRecord | null>(null);
  const [chunks, setChunks] = useState<TextChunkEntity[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [simanSubjects, setSimanSubjects] = useState<Record<string, Record<number, string>>>({});

  const [printAllData, setPrintAllData] = useState<PrintGuideData[] | null>(null);
  const [isPrintAllLoading, setIsPrintAllLoading] = useState(false);
  const [isExportAllLoading, setIsExportAllLoading] = useState(false);
  const [isExportSummariesLoading, setIsExportSummariesLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const printStyleRef = useRef<HTMLStyleElement | null>(null);

  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editedSummaryText, setEditedSummaryText] = useState('');
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [clientTopics, setClientTopics] = useState<Record<string, string[]>>({});
  const [summaryWidth, setSummaryWidth] = useState(256);
  const summaryTextareaRef = useRef<HTMLTextAreaElement>(null);
  const summaryResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // Inject print-override CSS and trigger print when printAllData is ready
  useEffect(() => {
    if (!printAllData) return;
    const style = document.createElement('style');
    style.textContent = '@media print { #main-layout { display: none !important; } #print-all-section { display: block !important; } }';
    document.head.appendChild(style);
    printStyleRef.current = style;
    const timer = setTimeout(() => {
      window.print();
      const cleanup = () => {
        if (printStyleRef.current && document.head.contains(printStyleRef.current)) {
          document.head.removeChild(printStyleRef.current);
          printStyleRef.current = null;
        }
        setPrintAllData(null);
      };
      window.addEventListener('afterprint', cleanup, { once: true });
    }, 200);
    return () => clearTimeout(timer);
  }, [printAllData]);

  const guidesQuery = useMemoFirebase(() => {
    if (!user || !firestore) {
      return null;
    }

    return query(
      collection(firestore, 'users', user.uid, 'studyGuides'),
      orderBy('createdAt', 'desc'),
    );
  }, [user, firestore]);

  const { data: guides, isLoading: isDataLoading } = useCollection<StudyGuideEntity>(guidesQuery);
  const isLoading = isAuthLoading || isDataLoading;

  const uniqueGuides = useMemo<GuideRecord[]>(() => {
    if (!guides) {
      return [];
    }

    const uniqueGuidesMap = new Map<string, GuideRecord>();
    for (const guide of guides) {
      if (!uniqueGuidesMap.has(guide.tref)) {
        uniqueGuidesMap.set(guide.tref, guide);
      }
    }

    return Array.from(uniqueGuidesMap.values());
  }, [guides]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  const filteredGuides = useMemo(() => (
    uniqueGuides.filter((guide) => {
      if (!normalizedSearchTerm) {
        return true;
      }

      return guide.tref.toLowerCase().includes(normalizedSearchTerm)
        || guide.summaryText?.toLowerCase().includes(normalizedSearchTerm);
    })
  ), [normalizedSearchTerm, uniqueGuides]);

  const hierarchy = useMemo(() => buildHierarchy(filteredGuides), [filteredGuides]);

  useEffect(() => {
    for (const sectionGroup of hierarchy) {
      const bookTitle = SECTION_TO_BOOK_TITLE[sectionGroup.section];
      if (!bookTitle || simanSubjects[sectionGroup.section]) continue;
      fetchSimanSubjectsForSection(bookTitle).then((subjects) => {
        setSimanSubjects((prev) => ({ ...prev, [sectionGroup.section]: subjects }));
      }).catch(() => { /* ignore */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy]);

  // Backfill topics for old guides that don't have them in Firestore
  useEffect(() => {
    if (!guides || !user || !firestore) return;
    const guidesWithoutTopics = guides.filter(g => !g.topics || g.topics.length === 0);
    if (guidesWithoutTopics.length === 0) return;

    guidesWithoutTopics.forEach((guide) => {
      const rawRef = guide.sefariaRef || guide.tref;
      if (!rawRef) return;
      const ref = normalizeTref(rawRef);
      fetch(`https://www.sefaria.org/api/related/${encodeURIComponent(ref)}`)
        .then(res => res.ok ? res.json() : null)
        .then((data: unknown) => {
          if (!data || typeof data !== 'object') return;
          const topicsArr = (data as Record<string, unknown>).topics;
          if (!Array.isArray(topicsArr) || topicsArr.length === 0) return;
          const names: string[] = topicsArr
            .map((t: unknown) => {
              if (!t || typeof t !== 'object') return null;
              const obj = t as Record<string, unknown>;
              const direct = typeof obj.he === 'string' ? obj.he.trim() : '';
              const nested = obj.title && typeof obj.title === 'object'
                ? ((obj.title as Record<string, unknown>).he ?? '')
                : '';
              const name = direct || (typeof nested === 'string' ? nested.trim() : '');
              return name.length > 0 ? name : null;
            })
            .filter((n): n is string => n !== null)
            .slice(0, 3);
          if (names.length === 0) return;
          setClientTopics(prev => ({ ...prev, [guide.id]: names }));
          const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', guide.id);
          updateDoc(guideRef, { topics: names }).catch(() => { /* ignore */ });
        })
        .catch(() => { /* ignore */ });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guides]);

  const totalSimanim = useMemo(
    () => hierarchy.reduce((sum, section) => sum + section.simanim.length, 0),
    [hierarchy],
  );
  const totalEntries = filteredGuides.length;
  const recentGuides = filteredGuides.slice(0, 3);

  const toggleSiman = useCallback((key: string) => {
    setOpenSimanim((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearActiveGuide = useCallback(() => {
    setActiveGuideId(null);
    setActiveGuide(null);
    setChunks([]);
    setIsEditingSummary(false);
  }, []);

  const openGuide = useCallback(async (guide: GuideRecord) => {
    if (!user || !firestore) {
      return;
    }

    if (activeGuideId === guide.id) {
      clearActiveGuide();
      return;
    }

    setActiveGuideId(guide.id);
    setActiveGuide(guide);
    setIsLoadingChunks(true);
    setChunks([]);
    setIsEditingSummary(false);

    try {
      const chunksRef = collection(firestore, 'users', user.uid, 'studyGuides', guide.id, 'textChunks');
      const snap = await getDocs(query(chunksRef, orderBy('orderIndex', 'asc')));
      const loaded: TextChunkEntity[] = snap.docs.map((doc) => ({
        ...(doc.data() as TextChunkEntity),
        id: doc.id,
      }));
      setChunks(loaded);
    } catch (error) {
      console.error('[MyGuides] Failed to load chunks:', error);
    } finally {
      setIsLoadingChunks(false);
    }
  }, [activeGuideId, clearActiveGuide, firestore, user]);

  const deleteGuide = useCallback(async (guide: GuideRecord, event: MouseEvent) => {
    event.stopPropagation();
    if (!user || !firestore) return;
    if (!window.confirm(`למחוק את הביאור "${guide.tref}"?`)) return;

    try {
      await deleteDoc(doc(firestore, 'users', user.uid, 'studyGuides', guide.id));
      if (activeGuideId === guide.id) {
        clearActiveGuide();
      }
    } catch (error) {
      console.error('[MyGuides] Failed to delete guide:', error);
    }
  }, [user, firestore, activeGuideId, clearActiveGuide]);

  const saveRating = useCallback(async (guide: GuideRecord, rating: number) => {
    if (!user || !firestore) return;
    try {
      await updateDoc(doc(firestore, 'users', user.uid, 'studyGuides', guide.id), { rating });
      setActiveGuide((prev) => (prev && prev.id === guide.id ? { ...prev, rating } : prev));
    } catch (error) {
      console.error('[MyGuides] Failed to save rating:', error);
    }
  }, [user, firestore]);

  const startEditingSummary = useCallback(() => {
    setEditedSummaryText(activeGuide?.summaryText ?? '');
    setIsEditingSummary(true);
  }, [activeGuide?.summaryText]);

  const cancelEditingSummary = useCallback(() => {
    setIsEditingSummary(false);
    setEditedSummaryText('');
  }, []);

  const insertFormat = useCallback((prefix: string, suffix = '') => {
    const el = summaryTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = editedSummaryText.slice(start, end);
    const before = editedSummaryText.slice(0, start);
    const after = editedSummaryText.slice(end);
    const insertion = prefix + (selected || '') + suffix;
    const newText = before + insertion + after;
    setEditedSummaryText(newText);
    setTimeout(() => {
      el.focus();
      const cursor = start + prefix.length + (selected || '').length + suffix.length;
      el.setSelectionRange(cursor, cursor);
    }, 0);
  }, [editedSummaryText, summaryTextareaRef]);

  const saveSummary = useCallback(async () => {
    if (!user || !firestore || !activeGuide) return;
    setIsSavingSummary(true);
    try {
      await updateDoc(doc(firestore, 'users', user.uid, 'studyGuides', activeGuide.id), {
        summaryText: editedSummaryText,
      });
      setActiveGuide((prev) => (prev && prev.id === activeGuide.id ? { ...prev, summaryText: editedSummaryText } : prev));
      setIsEditingSummary(false);
    } catch (error) {
      console.error('[MyGuides] Failed to save summary:', error);
    } finally {
      setIsSavingSummary(false);
    }
  }, [user, firestore, activeGuide, editedSummaryText]);

  // All guides in the same siman as the currently open guide
  const simanGuides = useMemo<GuideRecord[]>(() => {
    if (!activeGuide) return [];
    const activeParsed = parseTref(activeGuide.tref);
    return filteredGuides.filter((g) => {
      const p = parseTref(g.tref);
      return p.section === activeParsed.section && p.simanNum === activeParsed.simanNum;
    });
  }, [activeGuide, filteredGuides]);

  const handlePrint = useCallback(async (guidesToPrint: GuideRecord[]) => {
    if (!user || !firestore || isPrintAllLoading || guidesToPrint.length === 0) return;
    setIsPrintAllLoading(true);
    try {
      const loaded: PrintGuideData[] = [];
      for (const guide of guidesToPrint) {
        const chunksRef = collection(firestore, 'users', user.uid, 'studyGuides', guide.id, 'textChunks');
        const snap = await getDocs(query(chunksRef, orderBy('orderIndex', 'asc')));
        const guideChunks: TextChunkEntity[] = snap.docs.map((d) => ({
          ...(d.data() as TextChunkEntity),
          id: d.id,
        }));
        loaded.push({ guide, chunks: guideChunks });
      }
      setPrintAllData(loaded);
    } catch (error) {
      console.error('[MyGuides] Failed to load chunks for print:', error);
    } finally {
      setIsPrintAllLoading(false);
    }
  }, [user, firestore, isPrintAllLoading]);

  const handlePrintSiman = useCallback(() => handlePrint(simanGuides), [handlePrint, simanGuides]);

  const handleExport = useCallback(async (guidesToExport: GuideRecord[]) => {
    if (!user || isExportAllLoading || guidesToExport.length === 0) return;
    setIsExportAllLoading(true);
    setExportError(null);
    try {
      await syncFirebaseSession(user);
      const result = await exportAllGuidesToGoogleDocs(guidesToExport.map((g) => g.id));
      if (result.success && result.googleDocUrl) {
        window.open(result.googleDocUrl, '_blank');
      } else {
        setExportError(result.error ?? 'שגיאה לא ידועה');
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'שגיאה לא ידועה');
    } finally {
      setIsExportAllLoading(false);
    }
  }, [user, isExportAllLoading]);

  const handleExportSiman = useCallback(() => handleExport(simanGuides), [handleExport, simanGuides]);

  const handleExportSimanSummaries = useCallback(async () => {
    if (!user || isExportSummariesLoading || simanGuides.length === 0 || !activeGuide) return;
    setIsExportSummariesLoading(true);
    setExportError(null);
    try {
      const activeParsed = parseTref(activeGuide.tref);
      const simanLabel = activeParsed.simanRaw || String(activeParsed.simanNum);
      await syncFirebaseSession(user);
      const result = await exportSimanSummariesToGoogleDocs(
        simanGuides.map((g) => g.id),
        simanLabel,
      );
      if (result.success && result.googleDocUrl) {
        window.open(result.googleDocUrl, '_blank');
      } else {
        setExportError(result.error ?? 'שגיאה לא ידועה');
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'שגיאה לא ידועה');
    } finally {
      setIsExportSummariesLoading(false);
    }
  }, [user, isExportSummariesLoading, simanGuides, activeGuide]);

  const chunksBySource = useMemo(() => {
    const map = new Map<string, TextChunkEntity[]>();
    for (const chunk of chunks) {
      if (!map.has(chunk.sourceKey)) {
        map.set(chunk.sourceKey, []);
      }
      map.get(chunk.sourceKey)!.push(chunk);
    }
    return map;
  }, [chunks]);

  const orderedSourceEntries = useMemo(() => (
    [...chunksBySource.entries()].sort(([sourceA], [sourceB]) => {
      const a = SOURCE_ORDER.indexOf(sourceA);
      const b = SOURCE_ORDER.indexOf(sourceB);
      return (a === -1 ? 99 : a) - (b === -1 ? 99 : b);
    })
  ), [chunksBySource]);

  const activeGuideSources = useMemo(() => {
    if (activeGuide?.sources?.length) {
      return activeGuide.sources;
    }
    return orderedSourceEntries.map(([sourceKey]) => sourceKey);
  }, [activeGuide?.sources, orderedSourceEntries]);

  const summarySections = useMemo(
    () => parseSummarySections(activeGuide?.summaryText ?? ''),
    [activeGuide?.summaryText],
  );
  const isDirector = (user?.email || '').toLowerCase() === DIRECTOR_EMAIL;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <Navigation />

      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 pt-14 print:hidden" dir="rtl">
        <h1 className="shrink-0 text-sm font-semibold text-gray-800">הספריה שלי</h1>
        <div className="relative max-w-xs flex-1">
          <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="חיפוש..."
            className="h-7 rounded-md border-gray-200 pr-8 text-right text-sm"
            dir="rtl"
          />
        </div>
        <span className="shrink-0 text-xs text-gray-400">
          {totalEntries} ביאורים · {totalSimanim} סימנים
        </span>
        <Button asChild size="sm" className="h-7 shrink-0 rounded-md bg-gray-900 px-3 text-xs text-white hover:bg-gray-700">
          <Link href="/generate">
            <Plus className="ml-1 h-3 w-3" />
            מדריך חדש
          </Link>
        </Button>
      </div>

      {/* ── States ── */}
      {!user && !isLoading ? (
        <div className="flex flex-1 items-center justify-center" dir="rtl">
          <div className="space-y-3 text-center">
            <p className="text-sm text-gray-500">התחבר כדי לראות את הספריה שלך</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/">חזור לדף הבית</Link>
            </Button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        </div>
      ) : !guides || guides.length === 0 ? (
        <div className="flex flex-1 items-center justify-center" dir="rtl">
          <div className="space-y-3 text-center">
            <ScrollText className="mx-auto h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-700">הספריה ריקה</p>
            <p className="text-sm text-gray-400">צור ביאור ראשון כדי להתחיל</p>
            <Button asChild size="sm" className="bg-gray-900 text-white hover:bg-gray-700">
              <Link href="/generate">
                <Plus className="ml-1.5 h-3.5 w-3.5" />
                צור ביאור
              </Link>
            </Button>
          </div>
        </div>
      ) : (

        /* ── Main layout ── */
        <div id="main-layout" className="flex flex-1 overflow-hidden">

          {/* ── Sidebar tree ── */}
          <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-l border-gray-200 print:hidden">
            <ScrollArea className="flex-1">
              {hierarchy.length === 0 ? (
                <p className="p-4 text-center text-xs text-gray-400" dir="rtl">
                  אין תוצאות עבור &quot;{searchTerm}&quot;
                </p>
              ) : (
                hierarchy.map((sectionGroup) => (
                  <div key={sectionGroup.section}>
                    {/* Section label */}
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        {sectionGroup.section}
                      </span>
                      <span className="text-[11px] text-gray-400">{sectionGroup.simanim.length}</span>
                    </div>

                    {/* Simanim */}
                    {sectionGroup.simanim.map((siman) => {
                      const simanKey = `${sectionGroup.section}:${siman.simanNum}`;
                      const isOpen = openSimanim.has(simanKey);
                      const simanLabel = siman.simanRaw || numberToHebrew(siman.simanNum);
                      const subject = simanSubjects[sectionGroup.section]?.[siman.simanNum] ?? '';

                      return (
                        <div key={simanKey}>
                          {/* Siman row */}
                          <button
                            type="button"
                            onClick={() => toggleSiman(simanKey)}
                            className="flex w-full items-center justify-between border-b border-gray-100 px-3 py-2 hover:bg-gray-50"
                            dir="rtl"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <ChevronDown
                                className={cn('h-3 w-3 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')}
                              />
                              <div className="flex min-w-0 flex-col">
                                <span className="text-sm font-medium text-gray-800">סימן {simanLabel}</span>
                                {subject && (
                                  <span className="truncate text-[11px] leading-tight text-gray-500">{subject}</span>
                                )}
                              </div>
                            </div>
                            <span className="text-[11px] text-gray-400">{siman.seifEntries.length}</span>
                          </button>

                          {/* Seif entries */}
                          {isOpen && siman.seifEntries.map((entry) => {
                            const isActive = activeGuideId === entry.guide.id;
                            const label = entry.parsed.seifRaw
                              ? `סעיף ${entry.parsed.seifRaw}`
                              : entry.guide.tref;

                            return (
                              <div
                                key={entry.guide.id}
                                className={cn(
                                  'group flex items-center justify-between border-b border-gray-100 px-3 py-1.5',
                                  isActive ? 'bg-gray-900' : 'hover:bg-gray-50',
                                )}
                                dir="rtl"
                              >
                                <button
                                  type="button"
                                  onClick={() => openGuide(entry.guide)}
                                  className={cn(
                                    'flex flex-1 flex-col items-stretch',
                                    isActive ? 'text-white' : 'text-gray-700',
                                  )}
                                >
                                  <span className={cn('w-full truncate text-right text-sm', isActive && 'font-medium')}>{label}</span>
                                  {subject && (
                                    <span className={cn('w-full truncate text-right text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>
                                      {subject}
                                    </span>
                                  )}
                                </button>
                                <div className={cn(
                                  'flex shrink-0 items-center gap-0.5',
                                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                                )}>
                                  {entry.guide.googleDocUrl && (
                                    <a
                                      href={entry.guide.googleDocUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className={cn(
                                        'rounded p-1 transition-colors',
                                        isActive ? 'text-white/60 hover:text-white' : 'text-gray-400 hover:text-gray-700',
                                      )}
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => deleteGuide(entry.guide, e)}
                                    className={cn(
                                      'rounded p-1 transition-colors',
                                      isActive ? 'text-white/60 hover:text-red-300' : 'text-gray-400 hover:text-red-500',
                                    )}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </ScrollArea>
          </aside>

          {/* ── Content area ── */}
          <main className="flex flex-1 flex-col overflow-hidden">
            {activeGuide ? (
              <>
                {/* Guide header bar */}
                <div className="flex shrink-0 flex-col gap-3 border-b border-gray-200 px-5 py-3 print:hidden" dir="rtl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="font-semibold text-gray-900">{activeGuide.tref}</span>
                      <span className="mr-3 text-xs text-gray-400">
                        {formatGuideDate(activeGuide.createdAt)} · {activeGuideSources.length} מקורות
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={clearActiveGuide}
                      className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:border-gray-300 hover:text-gray-900"
                    >
                      <X className="h-3.5 w-3.5" />
                      סגור
                    </button>
                  </div>

                  <div className="flex flex-wrap items-stretch gap-3">
                    <section className="min-w-[280px] flex-1 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                      <div className="mb-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Export</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {isDirector
                            ? 'כל אפשרויות הייצוא וההדפסה זמינות לחשבון המנהל.'
                            : 'למשתמש רגיל זמין רק ייצוא הסיכום.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleExportSimanSummaries}
                          disabled={isExportSummariesLoading}
                          className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-right transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">ייצוא סיכומי הסימן</span>
                            <span className="block text-xs text-gray-500">Google Docs עם הסיכומים בלבד</span>
                          </span>
                          {isExportSummariesLoading
                            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-700" />
                            : <FileText className="h-4 w-4 shrink-0 text-emerald-700" />}
                        </button>

                        {isDirector && (
                          <button
                            type="button"
                            onClick={handleExportSiman}
                            disabled={isExportAllLoading}
                            className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-right transition hover:border-gray-300 hover:bg-gray-100 disabled:opacity-40"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-900">ייצוא הסימן המלא</span>
                              <span className="block text-xs text-gray-500">מקורות, ביאורים וסיכום ל-Google Docs</span>
                            </span>
                            {isExportAllLoading
                              ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-700" />
                              : <ExternalLink className="h-4 w-4 shrink-0 text-gray-700" />}
                          </button>
                        )}
                      </div>
                    </section>

                    {isDirector && (
                      <section className="min-w-[260px] rounded-xl border border-gray-200 bg-white p-3">
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Admin Tools</p>
                          <p className="mt-1 text-xs text-gray-500">כלי עבודה מלאים לחשבון המנהל.</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handlePrintSiman}
                            disabled={isPrintAllLoading}
                            className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
                          >
                            {isPrintAllLoading
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            הדפסת סימן מלא
                          </button>

                          <button
                            type="button"
                            onClick={() => window.print()}
                            className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            הדפסת עמוד
                          </button>

                          {activeGuide.googleDocUrl && (
                            <a
                              href={activeGuide.googleDocUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Google Docs
                            </a>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                </div>

                {/* Export error banner */}
                {exportError && (
                  <div
                    className="flex shrink-0 items-center justify-between border-b border-red-200 bg-red-50 px-5 py-2 print:hidden"
                    dir="rtl"
                  >
                    <p className="text-xs text-red-700">{exportError}</p>
                    <button
                      type="button"
                      onClick={() => setExportError(null)}
                      className="rounded p-0.5 text-red-400 hover:text-red-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Chunks or loading */}
                {isLoadingChunks ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
                  </div>
                ) : chunks.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-gray-400" dir="rtl">
                    לא נמצאו קטעים שמורים
                  </div>
                ) : (
                  <div className="flex flex-1 overflow-hidden">
                    {/* Sources tabs */}
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <Tabs defaultValue={orderedSourceEntries[0]?.[0]} className="flex flex-1 flex-col overflow-hidden" dir="rtl">
                        <TabsList className="flex h-auto w-full shrink-0 gap-0 rounded-none border-b border-gray-200 bg-white p-0">
                          {orderedSourceEntries.map(([sourceKey]) => (
                            <TabsTrigger
                              key={sourceKey}
                              value={sourceKey}
                              className="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 data-[state=active]:border-gray-900 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
                            >
                              {SOURCE_LABELS[sourceKey] || sourceKey}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        <div className="flex-1 overflow-hidden">
                          {orderedSourceEntries.map(([sourceKey, sourceChunks]) => {
                            const theme = SOURCE_THEME[sourceKey] || SOURCE_THEME.shulchan_arukh;
                            return (
                              <TabsContent
                                key={sourceKey}
                                value={sourceKey}
                                className="mt-0 h-full overflow-y-auto"
                              >
                                <div className="space-y-5 p-5 text-right" dir="rtl">
                                  {sourceChunks.map((chunk, index) => (
                                    <div
                                      key={chunk.id}
                                      className={cn('space-y-2', index > 0 && 'border-t border-gray-100 pt-5')}
                                    >
                                      <p className="font-sefer text-base leading-7 text-gray-800">
                                        {chunk.rawText.trim()}
                                      </p>
                                      {chunk.explanationText && (
                                        <div
                                          className={cn(
                                            'whitespace-pre-wrap border-r-2 py-2 pr-3 text-sm leading-7 text-gray-600',
                                            theme.borderAccent,
                                          )}
                                        >
                                          {renderAccentText(chunk.explanationText, theme.accentClass)}
                                        </div>
                                      )}
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
                    <aside
                      className="relative flex shrink-0 flex-col overflow-hidden border-r border-gray-200 print:block"
                      style={{ width: summaryWidth }}
                      dir="rtl"
                    >
                      {/* Drag-to-resize handle */}
                      <div
                        className="group absolute bottom-0 right-0 top-0 z-10 flex w-3 cursor-col-resize items-center justify-center"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          summaryResizeRef.current = { startX: e.clientX, startW: summaryWidth };
                          const onMove = (ev: globalThis.MouseEvent) => {
                            if (!summaryResizeRef.current) return;
                            const delta = ev.clientX - summaryResizeRef.current.startX;
                            setSummaryWidth(Math.max(200, Math.min(700, summaryResizeRef.current.startW + delta)));
                          };
                          const onUp = () => {
                            summaryResizeRef.current = null;
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                      >
                        <div className="h-16 w-0.5 rounded-full bg-gray-300 transition-colors group-hover:bg-blue-400 group-active:bg-blue-500" />
                      </div>
                      {/* Header */}
                      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                          סיכום למבחן
                        </p>
                        {!isEditingSummary ? (
                          <button
                            type="button"
                            onClick={startEditingSummary}
                            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                            title="ערוך סיכום"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={saveSummary}
                              disabled={isSavingSummary}
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-700 disabled:opacity-40"
                              title="שמור"
                            >
                              {isSavingSummary
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingSummary}
                              disabled={isSavingSummary}
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                              title="בטל"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Star rating */}
                      <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-100 px-4 py-1.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => activeGuide && saveRating(activeGuide, star)}
                            className="rounded p-0.5 transition-colors hover:text-yellow-500 focus:outline-none"
                            title={`דרג ${star} כוכבים`}
                          >
                            <Star
                              className={cn(
                                'h-4 w-4 transition-colors',
                                (activeGuide?.rating ?? 0) >= star
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-300',
                              )}
                            />
                          </button>
                        ))}
                        {activeGuide?.rating && (
                          <span className="mr-1 text-[10px] text-gray-400">{activeGuide.rating}/5</span>
                        )}
                      </div>

                      {/* Formatting toolbar - only in edit mode */}
                      {isEditingSummary && (
                        <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-100 bg-gray-50 px-2 py-1" dir="ltr">
                          <button type="button" onClick={() => insertFormat('\n## ', '')} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="כותרת">##</button>
                          <button type="button" onClick={() => insertFormat('**', '**')} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="מודגש">B</button>
                          <button type="button" onClick={() => insertFormat('\n- ', '')} className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="נקודה">•—</button>
                          <div className="mx-1 h-3 w-px bg-gray-300" />
                          <button type="button" onClick={() => insertFormat('\n---\n', '')} className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="קו הפרדה">—</button>
                        </div>
                      )}

                      {/* Content: edit mode or read mode */}
                      {isEditingSummary ? (
                        <textarea
                          ref={summaryTextareaRef}
                          value={editedSummaryText}
                          onChange={(e) => setEditedSummaryText(e.target.value)}
                          className="flex-1 resize-none p-4 font-sefer text-sm leading-7 text-gray-800 focus:outline-none"
                          dir="rtl"
                          placeholder="כתוב את הסיכום כאן..."
                          autoFocus
                        />
                      ) : (
                        <div className="flex-1 overflow-y-auto p-4">
                          <div className="space-y-4 font-sefer text-sm leading-7 text-gray-800">
                            {summarySections.length > 0 ? (
                              summarySections.map((section, index) => (
                                <section key={`${section.title}-${index}`}>
                                  <h4 className="mb-1.5 border-b border-gray-100 pb-1 font-bold text-gray-900">
                                    {section.title}
                                  </h4>
                                  {section.paragraphs.map((paragraph, pi) => (
                                    <p key={pi} className="mb-1 text-gray-700">
                                      {renderAccentText(paragraph, 'text-gray-900')}
                                    </p>
                                  ))}
                                  {section.items.length > 0 && (
                                    <ul className="space-y-1 text-gray-700">
                                      {section.items.map((item, ii) => (
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
                        </div>
                      )}
                    </aside>
                  </div>
                )}
              </>
            ) : (
              /* No guide selected */
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8" dir="rtl">
                {recentGuides.length > 0 ? (
                  <>
                    <p className="text-sm text-gray-400">בחר ביאור מהעץ, או התחל עם אחד מהאחרונים:</p>
                    <div className="grid w-full max-w-lg gap-2">
                      {recentGuides.map((guide) => (
                        <button
                          key={guide.id}
                          type="button"
                          onClick={() => openGuide(guide)}
                          className="rounded-lg border border-gray-200 px-4 py-2.5 text-right transition hover:border-gray-400 hover:bg-gray-50"
                        >
                          <p className="text-sm font-medium text-gray-900">{guide.tref}</p>
                          <p className="text-xs text-gray-400">
                            {formatGuideDate(guide.createdAt)} · {guide.sources?.length || 0} מקורות
                          </p>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">בחר ביאור מהרשימה</p>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {/* ── Print-all section (screen: hidden; print: shown via injected CSS) ── */}
      {printAllData && (
        <div id="print-all-section" className="hidden p-8" dir="rtl">
          {printAllData.map(({ guide, chunks: gChunks }, guideIdx) => {
            const summarySecs = parseSummarySections(guide.summaryText ?? '');
            const cbs = new Map<string, TextChunkEntity[]>();
            for (const chunk of gChunks) {
              if (!cbs.has(chunk.sourceKey)) cbs.set(chunk.sourceKey, []);
              cbs.get(chunk.sourceKey)!.push(chunk);
            }
            const orderedSources = [...cbs.entries()].sort(([a], [b]) => {
              const ia = SOURCE_ORDER.indexOf(a);
              const ib = SOURCE_ORDER.indexOf(b);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });

            return (
              <div
                key={guide.id}
                style={{ pageBreakAfter: guideIdx < printAllData.length - 1 ? 'always' : 'auto' }}
                className="mb-12"
              >
                <h2 className="mb-4 border-b-2 border-gray-800 pb-2 text-xl font-bold text-gray-900">
                  {guide.tref}
                </h2>

                {orderedSources.map(([sourceKey, sourceChunks]) => {
                  const theme = SOURCE_THEME[sourceKey] || SOURCE_THEME.shulchan_arukh!;
                  return (
                    <div key={sourceKey} className="mb-6">
                      <h3 className={cn('mb-2 text-base font-bold', theme.accentClass)}>
                        {SOURCE_LABELS[sourceKey] || sourceKey}
                      </h3>
                      {sourceChunks.map((chunk, idx) => (
                        <div
                          key={chunk.id}
                          className={cn('mb-3', idx > 0 && 'border-t border-gray-100 pt-3')}
                        >
                          <p className="font-sefer text-sm leading-7 text-gray-800">
                            {chunk.rawText.trim()}
                          </p>
                          {chunk.explanationText && (
                            <div className={cn('mt-1 border-r-2 py-1 pr-3 text-sm leading-7 text-gray-600', theme.borderAccent)}>
                              {renderAccentText(chunk.explanationText, theme.accentClass)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}

                {summarySecs.length > 0 && (
                  <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4">
                    <h3 className="mb-3 font-bold text-gray-900">סיכום למבחן</h3>
                    {summarySecs.map((sec, si) => (
                      <section key={si} className="mb-3">
                        <h4 className="font-bold text-gray-800">{sec.title}</h4>
                        {sec.paragraphs.map((p, pi) => (
                          <p key={pi} className="text-sm text-gray-700">{p}</p>
                        ))}
                        {sec.items.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                            {sec.items.map((item, ii) => (
                              <li key={ii} className="flex gap-2">
                                <span className="shrink-0 text-gray-400">•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
