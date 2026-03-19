'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ChevronDown, ChevronLeft, Book, Shield, ShieldX, Trash2, BarChart3, DollarSign, Users, Clock3,
} from 'lucide-react';
import { fetchRabanutData, deleteRabanutChunk, SOURCE_LABELS } from '@/app/actions/admin-guides';
import type { RabanutSection, RabanutTextChunk } from '@/app/actions/admin-guides';
import { fetchAdminManagedUsers, updateAdminUserUsagePolicy } from '@/app/actions/admin-user-policies';
import type { AdminManagedUser } from '@/app/actions/admin-user-policies';
import { fetchAdminUsageReport } from '@/app/actions/admin-usage';
import type { AdminUsageReport } from '@/app/actions/admin-usage';
import { numberToHebrew } from '@/lib/hebrew-utils';
import { USAGE_PLAN_PRESETS, type ManagedUsagePlanId } from '@/lib/usage-plans';
import { useUser } from '@/firebase';
import Link from 'next/link';

/* ---- Source color themes (same as generate page) ---- */
const SOURCE_THEME: Record<string, { headerClass: string; bgClass: string }> = {
    tur: { headerClass: 'text-amber-700', bgClass: 'bg-amber-50 border-amber-200' },
    beit_yosef: { headerClass: 'text-teal-700', bgClass: 'bg-teal-50 border-teal-200' },
    shulchan_arukh: { headerClass: 'text-blue-700', bgClass: 'bg-blue-50 border-blue-200' },
    mishnah_berurah: { headerClass: 'text-emerald-700', bgClass: 'bg-emerald-50 border-emerald-200' },
};

function getCurrentMonthInputValue(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    }).format(value);
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
}

function isUnauthorizedAdminError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /unauthorized|admin access required/i.test(message);
}

function getPresetValues(planId: ManagedUsagePlanId) {
    const preset = USAGE_PLAN_PRESETS.find((plan) => plan.id === planId);
    if (!preset) {
        throw new Error(`Unknown usage plan: ${planId}`);
    }

    return preset;
}

export default function AdminGuidesPage() {
    const { user, isUserLoading } = useUser();
    const [data, setData] = useState<RabanutSection[] | null>(null);
    const [managedUsers, setManagedUsers] = useState<AdminManagedUser[]>([]);
    const [usageReport, setUsageReport] = useState<AdminUsageReport | null>(null);
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthInputValue);
    const [isLoading, setIsLoading] = useState(true);
    const [isUsageLoading, setIsUsageLoading] = useState(true);
    const [isManagedUsersLoading, setIsManagedUsersLoading] = useState(true);
    const [isUnauthorized, setIsUnauthorized] = useState(false);
    const [savingUserId, setSavingUserId] = useState<string | null>(null);

    // Accordion state
    const [openSimanim, setOpenSimanim] = useState<Set<string>>(new Set());
    const [openSeifim, setOpenSeifim] = useState<Set<string>>(new Set());
    const [expandedChunkPath, setExpandedChunkPath] = useState<string | null>(null);

    // Load guide cache data once authenticated
    useEffect(() => {
        if (isUserLoading || !user) return;
        let cancelled = false;

        const loadGuideData = async () => {
            try {
                const token = await user.getIdToken();
                const guides = await fetchRabanutData(token);
                if (cancelled) return;
                setData(guides);
                setIsUnauthorized(false);
            } catch (error) {
                console.error('[Admin] Guide load failed:', error);
                if (!cancelled && isUnauthorizedAdminError(error)) {
                    setIsUnauthorized(true);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void loadGuideData();

        return () => {
            cancelled = true;
        };
    }, [user, isUserLoading]);

    // Load usage ledger report when the selected month changes
    useEffect(() => {
        if (isUserLoading || !user) return;
        let cancelled = false;

        const loadUsageReport = async () => {
            setIsUsageLoading(true);
            try {
                const token = await user.getIdToken();
                const usage = await fetchAdminUsageReport(token, selectedMonth);
                if (cancelled) return;
                setUsageReport(usage);
                setIsUnauthorized(false);
            } catch (error) {
                console.error('[Admin] Usage report load failed:', error);
                if (!cancelled && isUnauthorizedAdminError(error)) {
                    setIsUnauthorized(true);
                }
            } finally {
                if (!cancelled) {
                    setIsUsageLoading(false);
                }
            }
        };

        void loadUsageReport();

        return () => {
            cancelled = true;
        };
    }, [user, isUserLoading, selectedMonth]);

    // Load managed users and their policies
    useEffect(() => {
        if (isUserLoading || !user) return;
        let cancelled = false;

        const loadManagedUsers = async () => {
            setIsManagedUsersLoading(true);
            try {
                const token = await user.getIdToken();
                const users = await fetchAdminManagedUsers(token, selectedMonth);
                if (cancelled) return;
                setManagedUsers(users);
                setIsUnauthorized(false);
            } catch (error) {
                console.error('[Admin] Managed users load failed:', error);
                if (!cancelled && isUnauthorizedAdminError(error)) {
                    setIsUnauthorized(true);
                }
            } finally {
                if (!cancelled) {
                    setIsManagedUsersLoading(false);
                }
            }
        };

        void loadManagedUsers();

        return () => {
            cancelled = true;
        };
    }, [user, isUserLoading, selectedMonth]);

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

    const handleManagedUserPolicyChange = useCallback((
        userId: string,
        field: 'unlimited' | 'monthlyGenerationLimit' | 'generationRateLimitUserMax' | 'exportRateLimitUserMax',
        value: boolean | number,
    ) => {
        setManagedUsers((previous) => previous.map((managedUser) => (
            managedUser.userId === userId && !managedUser.isDirector
                ? {
                    ...managedUser,
                    policy: {
                        ...managedUser.policy,
                        planId: 'custom',
                        [field]: value,
                    },
                }
                : managedUser
        )));
    }, []);

    const handleApplyManagedUserPlan = useCallback(async (
        managedUser: AdminManagedUser,
        planId: ManagedUsagePlanId,
    ) => {
        if (!user || managedUser.isDirector) return;

        const preset = getPresetValues(planId);
        setManagedUsers((previous) => previous.map((entry) => (
            entry.userId === managedUser.userId
                ? {
                    ...entry,
                    policy: {
                        ...entry.policy,
                        planId,
                        unlimited: false,
                        monthlyGenerationLimit: preset.monthlyGenerationLimit,
                        generationRateLimitUserMax: preset.generationRateLimitUserMax,
                        exportRateLimitUserMax: preset.exportRateLimitUserMax,
                    },
                }
                : entry
        )));

        setSavingUserId(managedUser.userId);
        try {
            const token = await user.getIdToken();
            const updatedPolicy = await updateAdminUserUsagePolicy(token, managedUser.userId, {
                planId,
            });

            setManagedUsers((previous) => previous.map((entry) => (
                entry.userId === managedUser.userId
                    ? { ...entry, policy: updatedPolicy }
                    : entry
            )));
        } catch (error) {
            console.error('[Admin] Failed to apply usage plan:', error);
        } finally {
            setSavingUserId(null);
        }
    }, [user]);

    const handleSaveManagedUserPolicy = useCallback(async (managedUser: AdminManagedUser) => {
        if (!user || managedUser.isDirector) return;

        setSavingUserId(managedUser.userId);
        try {
            const token = await user.getIdToken();
            const updatedPolicy = await updateAdminUserUsagePolicy(token, managedUser.userId, {
                planId: 'custom',
                unlimited: Boolean(managedUser.policy.unlimited),
                monthlyGenerationLimit: Number(managedUser.policy.monthlyGenerationLimit),
                generationRateLimitUserMax: Number(managedUser.policy.generationRateLimitUserMax),
                exportRateLimitUserMax: Number(managedUser.policy.exportRateLimitUserMax),
            });

            setManagedUsers((previous) => previous.map((entry) => (
                entry.userId === managedUser.userId
                    ? { ...entry, policy: updatedPolicy }
                    : entry
            )));
        } catch (error) {
            console.error('[Admin] Failed to save user policy:', error);
        } finally {
            setSavingUserId(null);
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
    const topUsers = usageReport?.users.slice(0, 8) ?? [];
    const recentEntries = usageReport?.recentEntries.slice(0, 12) ?? [];
    const modelSummaries = usageReport?.models.slice(0, 6) ?? [];
    const visibleManagedUsers = managedUsers;

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

                <section className="mb-10 space-y-4">
                    <div className="flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm md:flex-row md:items-end md:justify-between">
                        <div>
                            <h2 className="flex items-center gap-2 text-xl font-bold text-primary">
                                <BarChart3 className="h-5 w-5" />
                                Suivi mensuel du coût LLM
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Ledger Firestore agrégé par utilisateur, modèle et génération.
                            </p>
                        </div>
                        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                            <span>Mois analysé</span>
                            <input
                                type="month"
                                value={selectedMonth}
                                onChange={(event) => setSelectedMonth(event.target.value)}
                                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                            />
                        </label>
                    </div>

                    {isUsageLoading ? (
                        <div className="grid gap-3 md:grid-cols-4">
                            {[...Array(4)].map((_, index) => (
                                <Skeleton key={index} className="h-28 rounded-2xl" />
                            ))}
                        </div>
                    ) : usageReport ? (
                        <>
                            <div className="grid gap-3 md:grid-cols-4">
                                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <DollarSign className="h-4 w-4" />
                                        Coût total
                                    </div>
                                    <div className="mt-3 text-2xl font-bold text-primary">{formatUsd(usageReport.totalCostUsd)}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{usageReport.monthLabel}</div>
                                </div>
                                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Book className="h-4 w-4" />
                                        Générations
                                    </div>
                                    <div className="mt-3 text-2xl font-bold text-primary">{formatNumber(usageReport.totalGenerations)}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">Ledger mensuel validé</div>
                                </div>
                                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Users className="h-4 w-4" />
                                        Utilisateurs actifs
                                    </div>
                                    <div className="mt-3 text-2xl font-bold text-primary">{formatNumber(usageReport.totalUsers)}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">Au moins une génération ce mois</div>
                                </div>
                                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Clock3 className="h-4 w-4" />
                                        Tokens totaux
                                    </div>
                                    <div className="mt-3 text-2xl font-bold text-primary">{formatNumber(usageReport.totalTokens)}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        Entrée {formatNumber(usageReport.totalInputTokens)} · sortie {formatNumber(usageReport.totalOutputTokens)}
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <h3 className="text-base font-bold text-primary">Coût par utilisateur</h3>
                                        <span className="text-xs text-muted-foreground">{topUsers.length} affichés</span>
                                    </div>
                                    <div className="space-y-3">
                                        {topUsers.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">Aucune génération sur le mois sélectionné.</p>
                                        ) : topUsers.map((userSummary) => (
                                            <div key={userSummary.userId} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-semibold text-foreground">
                                                            {userSummary.userEmail || userSummary.userId}
                                                        </div>
                                                        <div className="mt-1 text-xs text-muted-foreground">
                                                            {formatNumber(userSummary.generationCount)} générations · {formatNumber(userSummary.totalTokens)} tokens
                                                        </div>
                                                    </div>
                                                    <div className="text-sm font-bold text-primary">
                                                        {formatUsd(userSummary.totalCostUsd)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <h3 className="text-base font-bold text-primary">Répartition par modèle</h3>
                                        <span className="text-xs text-muted-foreground">{modelSummaries.length} modèles</span>
                                    </div>
                                    <div className="space-y-3">
                                        {modelSummaries.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">Aucune donnée disponible.</p>
                                        ) : modelSummaries.map((model) => (
                                            <div key={model.modelUsed} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                                                <div className="text-sm font-semibold text-foreground">{model.modelUsed}</div>
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    {formatNumber(model.generationCount)} générations · {formatNumber(model.totalTokens)} tokens
                                                </div>
                                                <div className="mt-2 text-sm font-bold text-primary">{formatUsd(model.totalCostUsd)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h3 className="text-base font-bold text-primary">Dernières écritures du ledger</h3>
                                    <span className="text-xs text-muted-foreground">{recentEntries.length} affichées</span>
                                </div>
                                {recentEntries.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Aucune écriture pour ce mois.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium">Utilisateur</th>
                                                    <th className="px-3 py-2 text-left font-medium">Guide</th>
                                                    <th className="px-3 py-2 text-left font-medium">Modèle</th>
                                                    <th className="px-3 py-2 text-left font-medium">Tokens</th>
                                                    <th className="px-3 py-2 text-left font-medium">Coût</th>
                                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recentEntries.map((entry) => (
                                                    <tr key={entry.id} className="border-b last:border-0">
                                                        <td className="px-3 py-2">{entry.userEmail || entry.userId}</td>
                                                        <td className="px-3 py-2 font-mono text-xs">{entry.guideId}</td>
                                                        <td className="px-3 py-2">{entry.modelUsed}</td>
                                                        <td className="px-3 py-2">{formatNumber(entry.totalTokens)}</td>
                                                        <td className="px-3 py-2 font-semibold text-primary">{formatUsd(entry.estimatedCostUsd)}</td>
                                                        <td className="px-3 py-2 text-muted-foreground">
                                                            {entry.createdAt ? new Date(entry.createdAt).toLocaleString('fr-FR') : ''}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="rounded-2xl border border-dashed bg-white p-6 text-sm text-muted-foreground">
                            Impossible de charger le reporting de coût.
                        </div>
                    )}
                </section>

                <section className="mb-10 space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm">
                        <div>
                            <h2 className="text-xl font-bold text-primary">Pilotage utilisateurs</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Le directeur est illimite. Les autres utilisateurs peuvent etre ajustes individuellement.
                            </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {managedUsers.length} utilisateurs charges
                        </div>
                    </div>

                    {isManagedUsersLoading ? (
                        <div className="grid gap-3 md:grid-cols-2">
                            {[...Array(4)].map((_, index) => (
                                <Skeleton key={index} className="h-52 rounded-2xl" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {visibleManagedUsers.map((managedUser) => (
                                <div key={managedUser.userId} className="rounded-2xl border bg-white p-5 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-base font-bold text-primary">
                                                {managedUser.email || managedUser.userId}
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {managedUser.displayName || managedUser.userId}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {managedUser.isDirector ? (
                                                <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                                    Directeur illimite
                                                </span>
                                            ) : null}
                                            {managedUser.disabled ? (
                                                <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">
                                                    Desactive
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                                        <div className="rounded-xl bg-muted/30 p-3">
                                            <div className="text-muted-foreground">Generations</div>
                                            <div className="mt-1 text-sm font-bold text-foreground">
                                                {formatNumber(managedUser.monthUsage.generationCount)}
                                            </div>
                                        </div>
                                        <div className="rounded-xl bg-muted/30 p-3">
                                            <div className="text-muted-foreground">Tokens</div>
                                            <div className="mt-1 text-sm font-bold text-foreground">
                                                {formatNumber(managedUser.monthUsage.totalTokens)}
                                            </div>
                                        </div>
                                        <div className="rounded-xl bg-muted/30 p-3">
                                            <div className="text-muted-foreground">Cout</div>
                                            <div className="mt-1 text-sm font-bold text-foreground">
                                                {formatUsd(managedUser.monthUsage.totalCostUsd)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-xl border border-border/70 p-3">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <span className="text-sm font-medium">Plan actif</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {managedUser.policy.planId === 'director'
                                                        ? 'Directeur'
                                                        : managedUser.policy.planId === 'custom'
                                                            ? 'Custom'
                                                            : managedUser.policy.planId}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {USAGE_PLAN_PRESETS.map((plan) => (
                                                    <button
                                                        key={plan.id}
                                                        type="button"
                                                        disabled={managedUser.isDirector || savingUserId === managedUser.userId}
                                                        onClick={() => void handleApplyManagedUserPlan(managedUser, plan.id)}
                                                        className={
                                                            managedUser.policy.planId === plan.id
                                                                ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-semibold text-primary'
                                                                : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary'
                                                        }
                                                    >
                                                        {plan.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <label className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-sm">
                                            <span>Acces illimite</span>
                                            <input
                                                type="checkbox"
                                                checked={managedUser.policy.unlimited}
                                                disabled={managedUser.isDirector}
                                                onChange={(event) => handleManagedUserPolicyChange(
                                                    managedUser.userId,
                                                    'unlimited',
                                                    event.target.checked,
                                                )}
                                            />
                                        </label>

                                        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                                            <span>Quota mensuel de generations</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={managedUser.policy.monthlyGenerationLimit}
                                                disabled={managedUser.isDirector || managedUser.policy.unlimited}
                                                onChange={(event) => handleManagedUserPolicyChange(
                                                    managedUser.userId,
                                                    'monthlyGenerationLimit',
                                                    Number(event.target.value),
                                                )}
                                                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                                            />
                                        </label>

                                        <div className="grid grid-cols-2 gap-3">
                                            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                                                <span>Generations par minute</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={managedUser.policy.generationRateLimitUserMax}
                                                    disabled={managedUser.isDirector || managedUser.policy.unlimited}
                                                    onChange={(event) => handleManagedUserPolicyChange(
                                                        managedUser.userId,
                                                        'generationRateLimitUserMax',
                                                        Number(event.target.value),
                                                    )}
                                                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                                                <span>Exports par minute</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={managedUser.policy.exportRateLimitUserMax}
                                                    disabled={managedUser.isDirector || managedUser.policy.unlimited}
                                                    onChange={(event) => handleManagedUserPolicyChange(
                                                        managedUser.userId,
                                                        'exportRateLimitUserMax',
                                                        Number(event.target.value),
                                                    )}
                                                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                                        <div className="text-xs text-muted-foreground">
                                            {managedUser.policy.updatedByEmail
                                                ? `Mis a jour par ${managedUser.policy.updatedByEmail}`
                                                : 'Politique par defaut'}
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void handleSaveManagedUserPolicy(managedUser)}
                                            disabled={managedUser.isDirector || savingUserId === managedUser.userId}
                                        >
                                            {savingUserId === managedUser.userId ? 'Enregistrement...' : 'Enregistrer'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

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
