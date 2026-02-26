'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ChevronDown, ChevronLeft, Book, Loader2, Shield, ShieldX, Trash2,
} from 'lucide-react';
import { fetchRabanutData, deleteRabanutChunk, SOURCE_LABELS } from '@/app/actions/admin-guides';
import type { RabanutSection, RabanutTextChunk } from '@/app/actions/admin-guides';
import { numberToHebrew } from '@/lib/hebrew-utils';
import { useUser } from '@/firebase';
import Link from 'next/link';

/* ---- Source color themes (same as generate page) ---- */
const SOURCE_THEME: Record<string, { headerClass: string; bgClass: string }> = {
    tur: { headerClass: 'text-amber-700', bgClass: 'bg-amber-50 border-amber-200' },
    beit_yosef: { headerClass: 'text-teal-700', bgClass: 'bg-teal-50 border-teal-200' },
    shulchan_arukh: { headerClass: 'text-blue-700', bgClass: 'bg-blue-50 border-blue-200' },
    mishnah_berurah: { headerClass: 'text-emerald-700', bgClass: 'bg-emerald-50 border-emerald-200' },
};

export default function AdminGuidesPage() {
    const { user, isUserLoading } = useUser();
    const [data, setData] = useState<RabanutSection[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUnauthorized, setIsUnauthorized] = useState(false);

    // Accordion state
    const [openSimanim, setOpenSimanim] = useState<Set<string>>(new Set());
    const [openSeifim, setOpenSeifim] = useState<Set<string>>(new Set());
    const [expandedChunkPath, setExpandedChunkPath] = useState<string | null>(null);

    // Load data
    useEffect(() => {
        if (isUserLoading || !user) return;
        user.getIdToken().then(token => {
            fetchRabanutData(token)
                .then(setData)
                .catch(() => setIsUnauthorized(true))
                .finally(() => setIsLoading(false));
        });
    }, [user, isUserLoading]);

    // Delete handler
    const handleDelete = useCallback(async (chunk: RabanutTextChunk) => {
        if (!user || !confirm('למחוק את הקטע הזה?')) return;
        const token = await user.getIdToken();
        try {
            await deleteRabanutChunk(token, chunk.path);
            // Remove from local state
            setData(prev => {
                if (!prev) return prev;
                return prev.map(section => ({
                    ...section,
                    simanim: section.simanim.map(siman => ({
                        ...siman,
                        seifim: siman.seifim.map(seif => ({
                            ...seif,
                            sources: Object.fromEntries(
                                Object.entries(seif.sources).map(([key, chunks]) => [
                                    key, chunks.filter(c => c.path !== chunk.path)
                                ]).filter(([, chunks]) => (chunks as RabanutTextChunk[]).length > 0)
                            ),
                        })).filter(seif => Object.keys(seif.sources).length > 0),
                    })).filter(siman => siman.seifim.length > 0),
                })).filter(section => section.simanim.length > 0);
            });
        } catch (err) {
            console.error('[Admin] Delete failed:', err);
        }
    }, [user]);

    const toggleSet = (set: Set<string>, key: string) => {
        const next = new Set(set);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    };

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

    // Count total chunks
    const totalChunks = data?.reduce((acc, s) =>
        acc + s.simanim.reduce((a2, sim) =>
            a2 + sim.seifim.reduce((a3, seif) =>
                a3 + Object.values(seif.sources).reduce((a4, chunks) => a4 + chunks.length, 0)
                , 0)
            , 0)
        , 0) || 0;

    return (
        <div className="min-h-screen bg-background pb-32 select-none">
            <Navigation />
            <main className="pt-24 px-6 max-w-4xl mx-auto w-full">
                <header className="mb-8">
                    <h1 className="text-3xl font-headline text-primary mb-1 flex items-center gap-3">
                        <Shield className="w-7 h-7" />
                        ניהול ביאורים
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        {totalChunks > 0 ? `${numberToHebrew(totalChunks)} קטעים מעובדים` : 'טוען...'}
                    </p>
                </header>

                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                    </div>
                ) : !data || data.length === 0 ? (
                    <div className="text-center py-16 space-y-4 bg-white rounded-2xl border border-dashed">
                        <Book className="w-10 h-10 text-muted-foreground mx-auto" />
                        <h2 className="text-xl font-bold">אין ביאורים עדיין</h2>
                        <p className="text-muted-foreground text-sm">צור ביאור חדש דרך עמוד היצירה</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {data.map(section => (
                            <div key={section.sectionKey} className="space-y-2">
                                {/* Section header */}
                                <h2 className="text-lg font-bold text-primary flex items-center gap-2 pb-2 border-b border-primary/20">
                                    <Book className="w-5 h-5" />
                                    {section.sectionLabel}
                                </h2>

                                {/* Simanim */}
                                <div className="space-y-1">
                                    {section.simanim.map(siman => {
                                        const simanKey = `${section.sectionKey}:${siman.simanNum}`;
                                        const simanOpen = openSimanim.has(simanKey);
                                        return (
                                            <div key={simanKey} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                                <button
                                                    onClick={() => setOpenSimanim(prev => toggleSet(prev, simanKey))}
                                                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors text-right"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary text-sm font-bold">
                                                            {numberToHebrew(parseInt(siman.simanNum))}
                                                        </span>
                                                        <span className="font-semibold text-sm">
                                                            סימן {numberToHebrew(parseInt(siman.simanNum))}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                                                            {numberToHebrew(siman.seifim.length)} {siman.seifim.length === 1 ? 'סעיף' : 'סעיפים'}
                                                        </span>
                                                    </div>
                                                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${simanOpen ? 'rotate-180' : ''}`} />
                                                </button>

                                                {simanOpen && (
                                                    <div className="border-t divide-y divide-muted/30">
                                                        {siman.seifim.map(seif => {
                                                            const seifKey = `${simanKey}:${seif.seifNum}`;
                                                            const seifOpen = openSeifim.has(seifKey);
                                                            const sourceKeys = Object.keys(seif.sources);

                                                            return (
                                                                <div key={seifKey}>
                                                                    <button
                                                                        onClick={() => setOpenSeifim(prev => toggleSet(prev, seifKey))}
                                                                        className={`w-full flex items-center justify-between px-5 py-3 text-right transition-colors ${seifOpen ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                                                                    >
                                                                        <div className="flex items-center gap-3">
                                                                            <ChevronLeft className={`w-3.5 h-3.5 text-primary transition-transform duration-200 ${seifOpen ? '-rotate-90' : ''}`} />
                                                                            <span className="text-sm font-medium">
                                                                                סעיף {numberToHebrew(parseInt(seif.seifNum))}
                                                                            </span>
                                                                            {/* Show which sources exist */}
                                                                            <div className="flex gap-1">
                                                                                {sourceKeys.map(sk => (
                                                                                    <span key={sk} className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_THEME[sk]?.bgClass || 'bg-muted'}`}>
                                                                                        {SOURCE_LABELS[sk] || sk}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    </button>

                                                                    {seifOpen && (
                                                                        <div className="border-t bg-muted/5 px-5 py-4 space-y-5">
                                                                            {sourceKeys.map(sourceKey => {
                                                                                const chunks = seif.sources[sourceKey];
                                                                                const theme = SOURCE_THEME[sourceKey] || SOURCE_THEME.shulchan_arukh;
                                                                                return (
                                                                                    <div key={sourceKey} className="space-y-3">
                                                                                        <h4 className={`text-base font-bold border-b pb-1 ${theme.headerClass}`}>
                                                                                            {SOURCE_LABELS[sourceKey] || sourceKey}
                                                                                        </h4>
                                                                                        {chunks.map(chunk => {
                                                                                            const isExpanded = expandedChunkPath === chunk.path;
                                                                                            return (
                                                                                                <div key={chunk.path} className="rounded-xl border overflow-hidden">
                                                                                                    <button
                                                                                                        onClick={() => setExpandedChunkPath(isExpanded ? null : chunk.path)}
                                                                                                        className={`w-full flex items-center justify-between px-4 py-2.5 text-right transition-colors ${isExpanded ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                                                                                                    >
                                                                                                        <span className="text-sm truncate flex-1">
                                                                                                            {chunk.rawText.slice(0, 80)}{chunk.rawText.length > 80 ? '...' : ''}
                                                                                                        </span>
                                                                                                        <div className="flex items-center gap-2 flex-shrink-0 mr-2">
                                                                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${chunk.validated ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                                                                {chunk.validated ? '✓' : '⚠'}
                                                                                                            </span>
                                                                                                            <button
                                                                                                                onClick={(e) => { e.stopPropagation(); handleDelete(chunk); }}
                                                                                                                className="p-1 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                                                            >
                                                                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                                                            </button>
                                                                                                        </div>
                                                                                                    </button>
                                                                                                    {isExpanded && (
                                                                                                        <div className="border-t p-4 space-y-3">
                                                                                                            {/* Raw text */}
                                                                                                            <div className={`p-3 rounded-xl text-sm font-semibold leading-relaxed border ${theme.bgClass}`}>
                                                                                                                {chunk.rawText}
                                                                                                            </div>
                                                                                                            {/* Explanation */}
                                                                                                            <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                                                                                                {chunk.explanationText.split('**').map((text, i) =>
                                                                                                                    i % 2 === 1
                                                                                                                        ? <strong key={i} className="text-black font-bold">{text}</strong>
                                                                                                                        : text
                                                                                                                )}
                                                                                                            </div>
                                                                                                            {/* Meta */}
                                                                                                            <div className="flex gap-3 text-[10px] text-muted-foreground pt-2 border-t">
                                                                                                                <span>{chunk.modelName}</span>
                                                                                                                <span>{chunk.promptVersion}</span>
                                                                                                                <span>{chunk.createdAt ? new Date(chunk.createdAt).toLocaleDateString('he-IL') : ''}</span>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        })}
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
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
