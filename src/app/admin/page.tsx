'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
    Search, ChevronDown, ChevronLeft, Book, X, Loader2, ExternalLink, Shield, ShieldX, Trash2,
} from 'lucide-react';
import { fetchAllGuides, fetchGuideChunks, fetchCacheEntries, deleteCacheEntry } from '@/app/actions/admin-guides';
import type { AdminGuide, AdminTextChunk, CacheEntry } from '@/app/actions/admin-guides';
import { hebrewToNumber, numberToHebrew } from '@/lib/hebrew-utils';
import { useUser } from '@/firebase';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Tref parsing (English Sefaria refs → Hebrew)                      */
/* ------------------------------------------------------------------ */

const ENGLISH_TO_HEBREW_SECTION: Record<string, string> = {
    'shulchan arukh, orach chayim': 'אורח חיים',
    'orach chayim': 'אורח חיים',
    'shulchan arukh, yoreh deah': 'יורה דעה',
    'yoreh deah': 'יורה דעה',
    'shulchan arukh, even haezer': 'אבן העזר',
    'even haezer': 'אבן העזר',
    'shulchan arukh, choshen mishpat': 'חושן משפט',
    'choshen mishpat': 'חושן משפט',
};

interface ParsedTref {
    section: string;
    simanRaw: string;
    seifRaw: string;
    simanNum: number;
    seifNum: number;
}

function parseTref(tref: string): ParsedTref {
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
    const colonIndex = tref.lastIndexOf(':');
    const spaceIndex = tref.lastIndexOf(' ', colonIndex === -1 ? undefined : colonIndex);
    if (spaceIndex === -1) return { section: tref, simanRaw: '', seifRaw: '', simanNum: 0, seifNum: 0 };
    const section = tref.slice(0, spaceIndex).trim();
    const rest = tref.slice(spaceIndex + 1).trim();
    let simanRaw: string, seifRaw = '';
    if (colonIndex !== -1) {
        const relColon = rest.indexOf(':');
        simanRaw = rest.slice(0, relColon).trim();
        seifRaw = rest.slice(relColon + 1).trim();
    } else {
        simanRaw = rest;
    }
    return { section, simanRaw, seifRaw, simanNum: hebrewToNumber(simanRaw), seifNum: seifRaw ? hebrewToNumber(seifRaw) : 0 };
}

/* ------------------------------------------------------------------ */
/*  Source labels                                                     */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<string, string> = {
    tur: 'טור',
    beit_yosef: 'בית יוסף',
    shulchan_arukh: 'שולחן ערוך',
    mishnah_berurah: 'משנה ברורה',
};

/* ------------------------------------------------------------------ */
/*  Cache grouping by tref                                            */
/* ------------------------------------------------------------------ */

interface CacheSimanGroup {
    trefLabel: string;
    section: string;
    simanNum: number;
    entries: CacheEntry[];
}

function buildCacheHierarchy(entries: CacheEntry[]): { grouped: CacheSimanGroup[]; ungrouped: CacheEntry[] } {
    const ungrouped: CacheEntry[] = [];
    const trefMap = new Map<string, CacheSimanGroup>();

    for (const entry of entries) {
        if (!entry.normalizedTref) {
            ungrouped.push(entry);
            continue;
        }
        const parsed = parseTref(entry.normalizedTref);
        const key = `${parsed.section}|${parsed.simanNum}|${parsed.seifNum}`;

        if (!trefMap.has(key)) {
            const label = parsed.seifRaw
                ? `${parsed.section} סימן ${parsed.simanRaw} סעיף ${parsed.seifRaw}`
                : `${parsed.section} סימן ${parsed.simanRaw}`;
            trefMap.set(key, { trefLabel: label, section: parsed.section, simanNum: parsed.simanNum, entries: [] });
        }
        trefMap.get(key)!.entries.push(entry);
    }

    // Sort entries within each group by sourceKey then chunkOrder
    for (const group of trefMap.values()) {
        group.entries.sort((a, b) => {
            if (a.sourceKey !== b.sourceKey) return a.sourceKey.localeCompare(b.sourceKey);
            return a.chunkOrder - b.chunkOrder;
        });
    }

    const grouped = [...trefMap.values()].sort((a, b) => a.simanNum - b.simanNum);
    return { grouped, ungrouped };
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function AdminGuidesPage() {
    const { user, isUserLoading } = useUser();
    const [isLoading, setIsLoading] = useState(true);
    const [isUnauthorized, setIsUnauthorized] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Study guides
    const [guides, setGuides] = useState<AdminGuide[] | null>(null);
    const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
    const [activeGuide, setActiveGuide] = useState<AdminGuide | null>(null);
    const [chunks, setChunks] = useState<AdminTextChunk[]>([]);
    const [isLoadingChunks, setIsLoadingChunks] = useState(false);

    // Cache entries
    const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
    const [openTrefs, setOpenTrefs] = useState<Set<string>>(new Set());
    const [expandedCacheId, setExpandedCacheId] = useState<string | null>(null);

    // Load data
    useEffect(() => {
        if (isUserLoading || !user) return;
        user.getIdToken().then(token => {
            fetchAllGuides(token)
                .then(setGuides)
                .catch(() => setIsUnauthorized(true))
                .finally(() => setIsLoading(false));

            fetchCacheEntries(token)
                .then(setCacheEntries)
                .catch(err => console.error('[Admin] Cache fetch failed:', err));
        });
    }, [user, isUserLoading]);

    // Cache hierarchy
    const { grouped: cacheGroups, ungrouped: ungroupedCache } = useMemo(
        () => buildCacheHierarchy(cacheEntries.filter(e =>
            !searchTerm || e.explanationText.includes(searchTerm) || e.normalizedTref.includes(searchTerm)
        )),
        [cacheEntries, searchTerm]
    );

    // Delete handler
    const handleDelete = useCallback(async (entryId: string) => {
        if (!user) return;
        const token = await user.getIdToken();
        try {
            await deleteCacheEntry(token, entryId);
            setCacheEntries(prev => prev.filter(e => e.id !== entryId));
            if (expandedCacheId === entryId) setExpandedCacheId(null);
        } catch (err) {
            console.error('[Admin] Delete failed:', err);
        }
    }, [user, expandedCacheId]);

    // Guide chunks reader
    const openGuide = useCallback(async (guide: AdminGuide) => {
        if (activeGuideId === guide.id) {
            setActiveGuideId(null); setActiveGuide(null); setChunks([]);
            return;
        }
        setActiveGuideId(guide.id); setActiveGuide(guide); setIsLoadingChunks(true); setChunks([]);
        try {
            const token = await user!.getIdToken();
            const loaded = await fetchGuideChunks(token, guide.userId, guide.id);
            setChunks(loaded);
        } catch (err) { console.error(err); }
        finally { setIsLoadingChunks(false); }
    }, [activeGuideId, user]);

    const chunksBySource = useMemo(() => {
        const map = new Map<string, AdminTextChunk[]>();
        for (const c of chunks) {
            if (!map.has(c.sourceKey)) map.set(c.sourceKey, []);
            map.get(c.sourceKey)!.push(c);
        }
        return map;
    }, [chunks]);

    // Guards
    if (isUnauthorized || (!isUserLoading && !user)) {
        return (
            <div className="min-h-screen bg-background pb-32">
                <Navigation />
                <main className="pt-24 px-6 max-w-md mx-auto text-center space-y-6">
                    <ShieldX className="w-16 h-16 text-destructive mx-auto" />
                    <h1 className="text-2xl font-bold">גישה נדחתה</h1>
                    <p className="text-muted-foreground">עמוד זה מיועד למנהל המערכת בלבד.</p>
                    <Button asChild variant="outline" className="rounded-xl">
                        <Link href="/">חזור לדף הבית</Link>
                    </Button>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background pb-32">
            <Navigation />
            <main className="pt-24 px-6 max-w-4xl mx-auto w-full">
                {/* Header */}
                <header className="mb-8">
                    <h1 className="text-3xl font-headline text-primary mb-1 flex items-center gap-3">
                        <Shield className="w-7 h-7" />
                        ניהול ביאורים
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        {numberToHebrew(cacheEntries.length)} טקסטים מעובדים
                        {guides && guides.length > 0 ? ` · ${numberToHebrew(guides.length)} מדריכים שלמים` : ''}
                    </p>
                </header>

                {/* Search */}
                {cacheEntries.length > 0 && (
                    <div className="relative group mb-6">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                            placeholder="חפש בטקסטים..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-10 pr-10 rounded-xl border-none shadow-sm text-sm bg-white"
                        />
                    </div>
                )}

                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* ===== Cache entries grouped by siman/seif ===== */}
                        {cacheGroups.length > 0 && (
                            <div className="space-y-2">
                                {cacheGroups.map(group => {
                                    const isOpen = openTrefs.has(group.trefLabel);
                                    return (
                                        <div key={group.trefLabel} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                            <button
                                                onClick={() => setOpenTrefs(prev => {
                                                    const next = new Set(prev);
                                                    next.has(group.trefLabel) ? next.delete(group.trefLabel) : next.add(group.trefLabel);
                                                    return next;
                                                })}
                                                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors text-right"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Book className="w-5 h-5 text-primary" />
                                                    <span className="font-semibold text-sm">{group.trefLabel}</span>
                                                    <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                                                        {numberToHebrew(group.entries.length)} קטעים
                                                    </span>
                                                </div>
                                                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {isOpen && (
                                                <div className="border-t divide-y divide-muted/40">
                                                    {group.entries.map(entry => {
                                                        const isExpanded = expandedCacheId === entry.id;
                                                        const sourceLabel = SOURCE_LABELS[entry.sourceKey] || entry.sourceKey;
                                                        return (
                                                            <div key={entry.id}>
                                                                <button
                                                                    onClick={() => setExpandedCacheId(isExpanded ? null : entry.id)}
                                                                    className={`w-full flex items-center justify-between px-5 py-3 text-right transition-colors ${isExpanded ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <ChevronLeft className={`w-3.5 h-3.5 text-primary transition-transform duration-200 ${isExpanded ? '-rotate-90' : ''}`} />
                                                                        <span className="text-sm font-medium">{sourceLabel}</span>
                                                                        {entry.chunkOrder >= 0 && (
                                                                            <span className="text-xs text-muted-foreground">קטע {numberToHebrew(entry.chunkOrder + 1)}</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`text-xs px-2 py-0.5 rounded-full ${entry.validated ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                            {entry.validated ? '✓' : '⚠'}
                                                                        </span>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                            title="מחק"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </button>

                                                                {isExpanded && (
                                                                    <div className="border-t p-5 bg-muted/10">
                                                                        <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                                                            {entry.explanationText.split('**').map((text, i) =>
                                                                                i % 2 === 1
                                                                                    ? <strong key={i} className="text-primary">{text}</strong>
                                                                                    : text
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-3 mt-4 text-xs text-muted-foreground">
                                                                            <span>{entry.modelName}</span>
                                                                            <span>{entry.promptVersion}</span>
                                                                            <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('he-IL') : ''}</span>
                                                                        </div>
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
                        )}

                        {/* ===== Ungrouped cache entries (no tref metadata) ===== */}
                        {ungroupedCache.length > 0 && (
                            <div className="space-y-2">
                                <h2 className="text-lg font-bold text-muted-foreground flex items-center gap-2 pb-2">
                                    טקסטים ללא מטא-דאטה ({numberToHebrew(ungroupedCache.length)})
                                </h2>
                                {ungroupedCache.map(entry => {
                                    const isExpanded = expandedCacheId === entry.id;
                                    const preview = entry.explanationText.slice(0, 100).replace(/\*\*/g, '') + '...';
                                    return (
                                        <div key={entry.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                            <button
                                                onClick={() => setExpandedCacheId(isExpanded ? null : entry.id)}
                                                className={`w-full flex items-center justify-between px-5 py-3 text-right transition-colors ${isExpanded ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                                            >
                                                <p className="text-sm text-foreground truncate flex-1">{preview}</p>
                                                <div className="flex items-center gap-2 flex-shrink-0 mr-3">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                </div>
                                            </button>
                                            {isExpanded && (
                                                <div className="border-t p-5 bg-muted/10">
                                                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                                        {entry.explanationText.split('**').map((text, i) =>
                                                            i % 2 === 1
                                                                ? <strong key={i} className="text-primary">{text}</strong>
                                                                : text
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {cacheGroups.length === 0 && ungroupedCache.length === 0 && (
                            <div className="text-center py-16 space-y-4 bg-white rounded-2xl border border-dashed">
                                <Book className="w-10 h-10 text-muted-foreground mx-auto" />
                                <h2 className="text-xl font-bold">אין טקסטים מעובדים</h2>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
