'use client';

import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileText, ExternalLink, Plus, Search, ChevronDown, ChevronLeft,
  Book, X, Loader2, Printer
} from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import {
  collection, query, orderBy, getDocs,
} from 'firebase/firestore';
import { useMemo, useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { hebrewToNumber, numberToHebrew } from '@/lib/hebrew-utils';
import type { SourceKey } from '@/lib/sefaria-api';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface StudyGuideEntity {
  id: string;
  userId: string;
  tref: string;
  summaryText: string;
  googleDocUrl: string;
  sources?: SourceKey[];
  status?: string;
  createdAt: string;
}

interface TextChunkEntity {
  id: string;
  sourceKey: string;
  orderIndex: number;
  rawText: string;
  explanationText: string;
}

/* ------------------------------------------------------------------ */
/*  Parsing helpers                                                   */
/* ------------------------------------------------------------------ */

interface ParsedTref {
  section: string;   // e.g. "אורח חיים"
  simanRaw: string;  // e.g. "ש\"ח"  (Hebrew numeral)
  seifRaw: string;   // e.g. "ל\"א"
  simanNum: number;
  seifNum: number;
}

/** Map English Sefaria section names to Hebrew */
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

function parseTref(tref: string): ParsedTref {
  // Try to detect English Sefaria format: "Shulchan Arukh, Orach Chayim 308:31"
  const englishMatch = tref.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);

  if (englishMatch) {
    const sectionEng = englishMatch[1].trim();
    const simanNum = parseInt(englishMatch[2]);
    const seifNum = englishMatch[3] ? parseInt(englishMatch[3]) : 0;
    const section = ENGLISH_TO_HEBREW_SECTION[sectionEng.toLowerCase()] || sectionEng;

    return {
      section,
      simanRaw: numberToHebrew(simanNum),
      seifRaw: seifNum ? numberToHebrew(seifNum) : '',
      simanNum,
      seifNum,
    };
  }

  // Hebrew format: "אורח חיים ש\"ח:ל\"א"
  const colonIndex = tref.lastIndexOf(':');
  const spaceIndex = tref.lastIndexOf(' ', colonIndex === -1 ? undefined : colonIndex);

  if (spaceIndex === -1) {
    return { section: tref, simanRaw: '', seifRaw: '', simanNum: 0, seifNum: 0 };
  }

  const section = tref.slice(0, spaceIndex).trim();
  const rest = tref.slice(spaceIndex + 1).trim();

  let simanRaw: string;
  let seifRaw = '';

  if (colonIndex !== -1) {
    const relColon = rest.indexOf(':');
    simanRaw = rest.slice(0, relColon).trim();
    seifRaw = rest.slice(relColon + 1).trim();
  } else {
    simanRaw = rest;
  }

  return {
    section,
    simanRaw,
    seifRaw,
    simanNum: hebrewToNumber(simanRaw),
    seifNum: seifRaw ? hebrewToNumber(seifRaw) : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Grouping structure                                                */
/* ------------------------------------------------------------------ */

interface SeifEntry {
  guide: StudyGuideEntity & { id: string };
  parsed: ParsedTref;
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

function buildHierarchy(guides: (StudyGuideEntity & { id: string })[]): SectionGroup[] {
  const sectionMap = new Map<string, Map<number, SimanGroup>>();

  for (const guide of guides) {
    const parsed = parseTref(guide.tref);
    const { section, simanNum, simanRaw } = parsed;

    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const simanMap = sectionMap.get(section)!;

    if (!simanMap.has(simanNum)) {
      simanMap.set(simanNum, { simanNum, simanRaw, seifEntries: [] });
    }

    // Update simanRaw if we get a better (non-empty) value
    const group = simanMap.get(simanNum)!;
    if (!group.simanRaw && simanRaw) group.simanRaw = simanRaw;

    group.seifEntries.push({ guide, parsed });
  }

  const result: SectionGroup[] = [];
  for (const [section, simanMap] of sectionMap) {
    const simanim = [...simanMap.values()]
      .sort((a, b) => a.simanNum - b.simanNum);
    for (const s of simanim) {
      s.seifEntries.sort((a, b) => a.parsed.seifNum - b.parsed.seifNum);
    }
    result.push({ section, simanim });
  }

  // Sort sections in canonical order
  const sectionOrder = ['אורח חיים', 'יורה דעה', 'אבן העזר', 'חושן משפט'];
  result.sort((a, b) => {
    const ia = sectionOrder.indexOf(a.section);
    const ib = sectionOrder.indexOf(b.section);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return result;
}

/* ------------------------------------------------------------------ */
/*  Source labels & themes                                              */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<string, string> = {
  tur: 'טור',
  beit_yosef: 'בית יוסף',
  shulchan_arukh: 'שולחן ערוך',
  mishnah_berurah: 'משנה ברורה',
};

const SOURCE_THEME: Record<string, { headerClass: string; sourceCardClass: string; accentClass: string }> = {
  tur: {
    headerClass: 'text-amber-700 border-amber-300',
    sourceCardClass: 'bg-amber-50 border border-amber-200 text-amber-900',
    accentClass: 'text-amber-700',
  },
  beit_yosef: {
    headerClass: 'text-teal-700 border-teal-300',
    sourceCardClass: 'bg-teal-50 border border-teal-200 text-teal-900',
    accentClass: 'text-teal-700',
  },
  shulchan_arukh: {
    headerClass: 'text-blue-700 border-blue-300',
    sourceCardClass: 'bg-blue-50 border border-blue-200 text-blue-900',
    accentClass: 'text-blue-700',
  },
  mishnah_berurah: {
    headerClass: 'text-emerald-700 border-emerald-300',
    sourceCardClass: 'bg-emerald-50 border border-emerald-200 text-emerald-900',
    accentClass: 'text-emerald-700',
  },
};

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */

export default function MyGuidesPage() {
  const { user, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();
  const [searchTerm, setSearchTerm] = useState('');

  // Accordion state
  const [openSimanim, setOpenSimanim] = useState<Set<string>>(new Set());

  // Reader state
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  const [activeGuide, setActiveGuide] = useState<StudyGuideEntity | null>(null);
  const [chunks, setChunks] = useState<TextChunkEntity[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);

  // Fetch all guides
  const guidesQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, 'users', user.uid, 'studyGuides'),
      orderBy('createdAt', 'desc')
    );
  }, [user, firestore]);

  const { data: guides, isLoading: isDataLoading } = useCollection<StudyGuideEntity>(guidesQuery);

  // Filter + group + deduplicate
  const hierarchy = useMemo(() => {
    if (!guides) return [];

    // Deduplicate by tref, keeping the newest one (since guides are sorted desc)
    const uniqueGuidesMap = new Map<string, StudyGuideEntity & { id: string }>();
    for (const g of guides) {
      if (!uniqueGuidesMap.has(g.tref)) {
        uniqueGuidesMap.set(g.tref, g);
      }
    }
    const uniqueGuides = Array.from(uniqueGuidesMap.values());

    const filtered = uniqueGuides.filter(g =>
      g.tref.includes(searchTerm) ||
      g.summaryText?.includes(searchTerm)
    );
    return buildHierarchy(filtered);
  }, [guides, searchTerm]);

  const isLoading = isAuthLoading || isDataLoading;

  // Toggle accordion
  const toggleSiman = useCallback((key: string) => {
    setOpenSimanim(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Load chunks for a guide
  const openGuide = useCallback(async (guide: StudyGuideEntity & { id: string }) => {
    if (!user || !firestore) return;
    if (activeGuideId === guide.id) {
      // Toggle off
      setActiveGuideId(null);
      setActiveGuide(null);
      setChunks([]);
      return;
    }

    setActiveGuideId(guide.id);
    setActiveGuide(guide);
    setIsLoadingChunks(true);
    setChunks([]);

    try {
      const chunksRef = collection(
        firestore, 'users', user.uid, 'studyGuides', guide.id, 'textChunks'
      );
      const snap = await getDocs(query(chunksRef, orderBy('orderIndex', 'asc')));
      const loaded: TextChunkEntity[] = snap.docs.map(d => ({
        ...(d.data() as TextChunkEntity),
        id: d.id,
      }));
      setChunks(loaded);
    } catch (err) {
      console.error('[MyGuides] Failed to load chunks:', err);
    } finally {
      setIsLoadingChunks(false);
    }
  }, [user, firestore, activeGuideId]);

  // Group chunks by sourceKey
  const chunksBySource = useMemo(() => {
    const map = new Map<string, TextChunkEntity[]>();
    for (const c of chunks) {
      if (!map.has(c.sourceKey)) map.set(c.sourceKey, []);
      map.get(c.sourceKey)!.push(c);
    }
    return map;
  }, [chunks]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-background pb-32 select-none">
      <Navigation />
      <main className="pt-24 px-6 max-w-4xl mx-auto w-full">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-headline text-primary mb-1">הספרייה שלי</h1>
            <p className="text-muted-foreground text-sm">כל מדריכי הלימוד שיצרת, מסודרים לפי סימן וסעיף.</p>
          </div>
          <Button asChild className="rounded-xl h-10 px-6 text-sm gap-2 shadow-sm">
            <Link href="/generate">
              <Plus className="w-4 h-4" />
              <span>מדריך חדש</span>
            </Link>
          </Button>
        </header>

        {/* Not logged in */}
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
            {/* Search */}
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

            {/* Loading */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : !guides || guides.length === 0 ? (
              /* Empty state */
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
            ) : hierarchy.length === 0 ? (
              /* No search results */
              <div className="text-center py-12 text-muted-foreground">
                <p>לא נמצאו תוצאות עבור &quot;{searchTerm}&quot;</p>
              </div>
            ) : (
              /* --- MAIN HIERARCHY --- */
              <div className="space-y-6">
                {hierarchy.map(sectionGroup => (
                  <div key={sectionGroup.section} className="space-y-2">
                    {/* Section title */}
                    <h2 className="text-lg font-bold text-primary flex items-center gap-2 pb-2 border-b border-primary/20">
                      <Book className="w-5 h-5" />
                      {sectionGroup.section}
                    </h2>

                    {/* Simanim accordion list */}
                    <div className="space-y-1">
                      {sectionGroup.simanim.map(siman => {
                        const simanKey = `${sectionGroup.section}:${siman.simanNum}`;
                        const isOpen = openSimanim.has(simanKey);

                        return (
                          <div key={simanKey} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                            {/* Siman header (accordion toggle) */}
                            <button
                              onClick={() => toggleSiman(simanKey)}
                              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors text-right"
                            >
                              <div className="flex items-center gap-3">
                                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary text-sm font-bold">
                                  {siman.simanRaw || numberToHebrew(siman.simanNum)}
                                </span>
                                <span className="font-semibold text-sm">
                                  סימן {siman.simanRaw || numberToHebrew(siman.simanNum)}
                                </span>
                                <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                                  {numberToHebrew(siman.seifEntries.length)} {siman.seifEntries.length === 1 ? 'סעיף' : 'סעיפים'}
                                </span>
                              </div>
                              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Seifim list (expanded) */}
                            {isOpen && (
                              <div className="border-t bg-muted/10 divide-y divide-muted/40">
                                {siman.seifEntries.map(entry => {
                                  const isActive = activeGuideId === entry.guide.id;
                                  return (
                                    <div key={entry.guide.id}>
                                      <button
                                        onClick={() => openGuide(entry.guide)}
                                        className={`w-full flex items-center justify-between px-5 py-3 text-right transition-colors ${isActive
                                          ? 'bg-primary/10 border-r-[3px] border-r-primary'
                                          : 'hover:bg-muted/30'
                                          }`}
                                      >
                                        <div className="flex items-center gap-3">
                                          <ChevronLeft className={`w-3.5 h-3.5 text-primary transition-transform duration-200 ${isActive ? '-rotate-90' : ''}`} />
                                          <span className="text-sm font-medium">
                                            {entry.parsed.seifRaw ? `סעיף ${entry.parsed.seifRaw}` : entry.guide.tref}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-muted-foreground">
                                            {entry.guide.createdAt ? new Date(entry.guide.createdAt).toLocaleDateString('he-IL') : ''}
                                          </span>
                                          {entry.guide.googleDocUrl && (
                                            <a
                                              href={entry.guide.googleDocUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                                            >
                                              <ExternalLink className="w-3 h-3" />
                                              פתח
                                            </a>
                                          )}
                                        </div>
                                      </button>

                                      {/* Inline reader panel */}
                                      {isActive && (
                                        <div className="border-t bg-white">
                                          {isLoadingChunks ? (
                                            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                                              <Loader2 className="w-5 h-5 animate-spin" />
                                              <span className="text-sm">טוען ביאור...</span>
                                            </div>
                                          ) : chunks.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                              לא נמצאו קטעים שמורים עבור מדריך זה.
                                            </div>
                                          ) : (
                                            <div className="p-5 space-y-6 max-h-[60vh] overflow-y-auto print:max-h-none print:overflow-visible print:absolute print:inset-0 print:bg-white print:z-50 print:p-8">
                                              {/* Close button & Print button */}
                                              <div className="flex items-center justify-between print:hidden">
                                                <h3 className="text-lg font-bold text-primary">
                                                  ביאור — {activeGuide?.tref}
                                                </h3>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    onClick={() => window.print()}
                                                    className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-primary"
                                                    title="הדפס ביאור"
                                                  >
                                                    <Printer className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => { setActiveGuideId(null); setActiveGuide(null); setChunks([]); }}
                                                    className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                                                  >
                                                    <X className="w-4 h-4 text-muted-foreground" />
                                                  </button>
                                                </div>
                                              </div>



                                              {/* Chunks grouped by source */}
                                              {[...chunksBySource.entries()]
                                                .sort(([keyA], [keyB]) => {
                                                  const order = ['tur', 'beit_yosef', 'shulchan_arukh', 'mishnah_berurah'];
                                                  const a = order.indexOf(keyA);
                                                  const b = order.indexOf(keyB);
                                                  return (a === -1 ? 99 : a) - (b === -1 ? 99 : b);
                                                })
                                                .map(([sourceKey, sourceChunks]) => {
                                                  const theme = SOURCE_THEME[sourceKey] || SOURCE_THEME.shulchan_arukh;
                                                  return (
                                                    <div key={sourceKey} className="space-y-6 print:hidden">
                                                      <h2 className={`text-2xl font-bold border-b pb-2 ${theme.headerClass}`}>
                                                        {SOURCE_LABELS[sourceKey] || sourceKey}
                                                      </h2>
                                                      <div className="space-y-8">
                                                        {sourceChunks.map(chunk => (
                                                          <div key={chunk.id} className="space-y-2 pb-6 border-b last:border-0 border-muted">
                                                            <p className={`text-lg p-4 rounded-xl font-semibold ${theme.sourceCardClass}`}>
                                                              {chunk.rawText}
                                                            </p>
                                                            <p className="text-lg text-black px-2 whitespace-pre-wrap">
                                                              {chunk.explanationText.split('**').map((text, i) =>
                                                                i % 2 === 1 ? <strong key={i} className={`${theme.accentClass} font-bold`}>{text}</strong> : text
                                                              )}
                                                            </p>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>
                                                  );
                                                })}

                                              {/* Summary section */}
                                              {activeGuide?.summaryText && (() => {
                                                type SummarySection = {
                                                  title: string;
                                                  paragraphs: string[];
                                                  items: string[];
                                                };

                                                const summarySections = activeGuide.summaryText
                                                  .split('\n')
                                                  .map((line) => line.trim())
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
                                                        title: 'סיכום למבחן רבנות',
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

                                                return (
                                                  <div className="pt-8 border-t-2 border-primary/30">
                                                    <div className="bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 rounded-2xl p-8 space-y-6 border border-primary/20">
                                                      <div className="flex items-center gap-3 pb-4 border-b border-primary/20">
                                                        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-lg">📋</div>
                                                        <h2 className="text-2xl font-bold text-primary">סיכום למבחן רבנות</h2>
                                                      </div>
                                                      <div className="space-y-4 text-lg leading-relaxed">
                                                        {summarySections.length === 0 ? (
                                                          <p className="text-black">לא נמצאו פסקאות לסיכום.</p>
                                                        ) : (
                                                          summarySections.map((section, sectionIndex) => (
                                                            <div
                                                              key={`${section.title}-${sectionIndex}`}
                                                              className="rounded-xl border border-primary/20 bg-white/70 p-5 space-y-3"
                                                            >
                                                              <h3 className="text-xl font-bold text-primary border-b border-primary/20 pb-2">
                                                                {section.title}
                                                              </h3>

                                                              {section.paragraphs.map((paragraph, paragraphIndex) => (
                                                                <p key={`p-${paragraphIndex}`} className="text-black leading-relaxed">
                                                                  {paragraph.split('**').map((text, i) =>
                                                                    i % 2 === 1 ? <strong key={i} className="text-primary font-bold">{text}</strong> : text
                                                                  )}
                                                                </p>
                                                              ))}

                                                              {section.items.length > 0 && (
                                                                <ul className="space-y-2">
                                                                  {section.items.map((item, itemIndex) => (
                                                                    <li key={`i-${itemIndex}`} className="flex gap-3 pr-2">
                                                                      <span className="text-primary font-bold mt-0.5 shrink-0">•</span>
                                                                      <p className="text-black">
                                                                        {item.split('**').map((text, i) =>
                                                                          i % 2 === 1 ? <strong key={i} className="text-primary font-bold">{text}</strong> : text
                                                                        )}
                                                                      </p>
                                                                    </li>
                                                                  ))}
                                                                </ul>
                                                              )}
                                                            </div>
                                                          ))
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
