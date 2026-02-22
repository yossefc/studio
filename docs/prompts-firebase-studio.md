# Prompts Firebase Studio (correction complete)

Date: 2026-02-22

## Prompt 1: Server/Client boundaries

```text
You are a senior Firebase/Next.js engineer. Refactor this project to fix server/client boundaries.

Goal:
- No server file (`'use server'`, Genkit flows, server actions) may import modules marked `'use client'`.

Tasks:
- Create `src/server/firebase-admin.ts` using `firebase-admin` (`initializeApp`, `applicationDefault`, `getFirestore`).
- Export `getAdminDb()` and `getAdminAuth()`.
- Replace server-side Firestore usage in:
  - `src/ai/flows/talmud-ai-chatbot-explanation.ts`
  - `src/app/actions/study-guide.ts`
  so they use Admin SDK only.
- Keep client SDK usage only in client components/hooks.
- Remove any invalid import chain from server -> client.

Acceptance criteria:
- `npm run typecheck` passes.
- `npm run lint` passes.
- No Next.js RSC error about importing client modules into server code.
- Show exact file diffs.
```

## Prompt 2: Firestore reel + historique utilisateur + cache global

```text
Implement real Firestore architecture with per-user history + global explanation cache.

Data model:
- `users/{uid}/studyGuides/{guideId}`
- `users/{uid}/studyGuides/{guideId}/textChunks/{chunkId}`
- `explanationCacheEntries/{cacheKey}` (global shared cache)

Rules for cache key:
- deterministic key = SHA-256 of:
  `normalizedTref + chunkOrder + rawHash + promptVersion + modelName`

Behavior:
- Cache-first for every chunk:
  1) read cache by `cacheKey`
  2) if exists, return cached explanation and `cacheHit=true`
  3) if missing, call LLM once, persist, return `cacheHit=false`
- Never call LLM again for same cache key.
- Save `modelName`, `promptVersion`, `createdAt`, `updatedAt`, token metadata if available.

Acceptance criteria:
- Re-running same tref does not regenerate already cached chunks.
- User history is isolated by UID.
- Global cache is reused across users.
- Add robust TypeScript types (remove `any` from guide/chunk pipelines).
```

## Prompt 3: Firestore rules + indexes

```text
Update Firestore Security Rules and indexes for the new architecture.

Requirements:
- Users can read/write only their own documents under `users/{uid}/...`.
- Global cache:
  - deny list/enumeration
  - deny client writes
  - allow minimal reads only if needed by client (or deny all client access if cache is server-only via Admin SDK).
- Add composite indexes if required by queries (`orderBy(createdAt desc)` etc.).

Deliverables:
- Updated `firestore.rules`
- `firestore.indexes.json` (if needed)
- Short explanation of why each rule is secure.
```

## Prompt 4: Optimisation cout/perf

```text
Optimize generation pipeline for cost/performance while keeping quality.

Hard constraints:
- Chunk size target: 120-180 words.
- Preserve sentence boundaries when possible.
- Context window: only Segment N-1 + explanation N-1 (not full history).
- Hebrew-only generation and explanation.
- Add retry with exponential backoff for transient errors (429/503/timeouts).
- Add per-chunk timeout guard.

Output requirements:
- explanation should follow strict order of source text
- keep original words highlighted in bold where relevant
- summary should be concise, practical (Halacha Lemaaseh)

Acceptance criteria:
- chunker enforces 120-180 words (except final remainder)
- context history never exceeds N-1
- retries happen only on transient failures
```

## Prompt 5: Migration modele Gemini 3.5 + fallback

```text
Migrate model configuration to Gemini 3.5 with safe fallback and cost mode.

Model config via env:
- `GEMINI_MODEL_PRIMARY=gemini-3.5-pro`
- `GEMINI_MODEL_COST=gemini-3.1-pro`
- `GEMINI_MODEL_FALLBACK=gemini-2.5-pro`
- `GEMINI_USE_BATCH=true|false`

Behavior:
- Default model: primary.
- If model unavailable/not supported, fallback automatically.
- Add startup validation with models list endpoint once (or graceful runtime fallback).
- If `GEMINI_USE_BATCH=true` and chunk count exceeds threshold, use batch flow.
- Log selected model, fallback reason, and token usage estimate.

Acceptance criteria:
- No hardcoded deprecated model names.
- 404 model-not-found errors are handled automatically.
```

## Prompt 6: Qualite hebreu + format strict

```text
Enforce Hebrew output quality and format compliance.

Tasks:
- All user-facing messages in Hebrew.
- All LLM prompts and expected outputs in Hebrew.
- Add post-generation validator:
  - Hebrew ratio threshold
  - required formatting constraints
  - summary bullet format
- If validation fails, regenerate once with a stricter repair prompt.
- Store validation status in Firestore (`validated: true/false`, `validationErrors`).

Acceptance criteria:
- explanations and summaries are Hebrew consistently
- validator catches non-compliant outputs
```

## Prompt 7: Auth + UX robuste

```text
Fix authentication and UX flow for per-user history reliability.

Tasks:
- Ensure user authentication exists before writes:
  - anonymous sign-in auto-init on app start (if no signed-in user)
  - graceful error UI if sign-in fails
- Prevent generate button when auth/firestore not ready.
- Keep history page stable for unauthenticated state.
- Remove dead code and unreachable states.

Acceptance criteria:
- Generation works on fresh session without manual login.
- Guide is always saved under correct UID path.
```

## Prompt 8: Tests + observabilite + doc

```text
Add tests + observability + migration notes.

Tests:
- unit tests: chunking (120-180), cache key determinism, N-1 context enforcement
- integration tests (Firestore emulator):
  - user isolation
  - cache reuse across users
  - no duplicate LLM call on cache hit

Observability:
- structured logs: tref, chunkId, cacheHit, modelName, duration, retryCount
- aggregate metrics helper for average cost estimate per guide

Docs:
- update README with env vars, local run steps, emulator steps, and cost controls.
- include a migration note from old mock storage to Firestore schema.
```

## Version mega-prompt (optionnel)

```text
Execute prompts 1 to 8 sequentially in one PR:
1) fix server/client boundaries with firebase-admin for server side
2) implement real Firestore per-user history + global cache
3) secure Firestore rules and required indexes
4) enforce 120-180 words chunking + N-1 context + retries/backoff
5) migrate to Gemini 3.5 with fallback and cost mode (3.1 pro + batch option)
6) enforce Hebrew output and strict format validation
7) harden auth + UX for reliable per-user writes
8) add tests, observability, and docs

Return:
- complete code diffs
- list of changed files
- migration notes
- residual risks
```

