'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TOTAL_CHAPTERS = 150;

interface TehilimVerse {
    text: string;
    index: number;
}

export function TehilimReader() {
    const [chapter, setChapter] = useState(() => Math.floor(Math.random() * TOTAL_CHAPTERS) + 1);
    const [verses, setVerses] = useState<TehilimVerse[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchChapter = useCallback(async (chap: number) => {
        setLoading(true);
        setVerses([]);
        try {
            const res = await fetch(
                `https://www.sefaria.org/api/v3/texts/Psalms.${chap}?lang=he&context=0`
            );
            if (!res.ok) throw new Error('Fetch failed');
            const data = await res.json();

            let heTexts: string[] = data.he || [];
            if (!heTexts.length && data.versions) {
                const heVer = data.versions.find((v: { language: string }) => v.language === 'he');
                if (heVer) heTexts = heVer.text || [];
            }

            // Flatten if nested
            const flat = (arr: unknown): string[] => {
                if (!Array.isArray(arr)) return [String(arr ?? '')];
                return arr.reduce<string[]>((a, v) => a.concat(Array.isArray(v) ? flat(v) : String(v ?? '')), []);
            };

            const cleaned = flat(heTexts)
                .map(t =>
                    t
                        .replace(/<[^>]*>?/gm, '')           // Strip HTML tags
                        .replace(/&[a-z]+;/gi, ' ')           // Strip HTML entities (&thinsp; etc.)
                        .replace(/[\u0591-\u05AF]/g, '')      // Strip cantillation marks (taamim)
                        .replace(/[\u200B-\u200F\u2009\u202A-\u202E]/g, '') // Strip zero-width & thin spaces
                        .replace(/\s+/g, ' ')                 // Collapse whitespace
                        .trim()
                )
                .filter(Boolean);

            setVerses(cleaned.map((text, i) => ({ text, index: i + 1 })));
        } catch (err) {
            console.error('[Tehilim] Fetch error:', err);
            setVerses([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchChapter(chapter);
    }, [chapter, fetchChapter]);

    const goNext = () => setChapter(c => (c >= TOTAL_CHAPTERS ? 1 : c + 1));
    const goPrev = () => setChapter(c => (c <= 1 ? TOTAL_CHAPTERS : c - 1));

    return (
        <div className="w-full max-w-lg mx-auto mt-8">
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200 shadow-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 bg-amber-100/80 border-b border-amber-200">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={goPrev}
                        className="text-amber-800 hover:bg-amber-200/50 rounded-xl h-8 w-8 p-0"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </Button>
                    <h3 className="text-lg font-bold text-amber-900 font-headline">
                        תהילים פרק {chapter}
                    </h3>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={goNext}
                        className="text-amber-800 hover:bg-amber-200/50 rounded-xl h-8 w-8 p-0"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-5 max-h-[40vh] overflow-y-auto select-text" dir="rtl">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 gap-2 text-amber-700">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span className="text-sm">טוען פרק תהילים...</span>
                        </div>
                    ) : verses.length === 0 ? (
                        <p className="text-center text-amber-700 text-sm py-4">לא נמצא טקסט לפרק זה.</p>
                    ) : (
                        <div className="space-y-2 text-base leading-relaxed text-amber-950">
                            {verses.map(v => (
                                <p key={v.index}>
                                    <span className="inline-block w-7 text-amber-600 font-bold text-sm ml-1">
                                        {v.index}.
                                    </span>
                                    {v.text}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
