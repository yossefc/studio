# TalmudAI - Rabbinic Study Guide Generator

AI-powered system for generating contextual Hebrew explanations and Halacha Lema'aseh summaries for Jewish texts.

## Getting Started

### Prerequisites
- Node.js 18+
- Firebase project (Firestore enabled)
- Gemini API key
- Google Cloud service account with Docs + Firestore access (for server side)

### Environment Variables
Create a `.env` file in the root:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL_PRIMARY=googleai/gemini-3.5-pro
GEMINI_MODEL_COST=googleai/gemini-3.1-pro
GEMINI_MODEL_FALLBACK=googleai/gemini-2.5-pro
GEMINI_USE_BATCH=true
GEMINI_BATCH_THRESHOLD=5

# Optional explicit Firebase Admin credentials (fallback is Application Default Credentials)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=service-account@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Google APIs (if not using ADC)
GOOGLE_APPLICATION_CREDENTIALS=path_to_service_account.json
```

### Development
1. `npm install`
2. `npm run dev` (Next.js on port 9002)
3. `npm run genkit:dev` (Genkit Developer UI)

### Quality checks
- `npm run typecheck`
- `npm run lint`

## Architecture

### Data flow
1. Fetch text from Sefaria API.
2. Chunk into 120-180 words with sentence-aware splitting.
3. Generate per-chunk Hebrew explanation with N-1 context only.
4. Cache each explanation in global Firestore cache using deterministic SHA-256 key.
5. Generate Hebrew bullet summary (Halacha Lema'aseh).
6. Publish to Google Docs with bold formatting for `**source words**`.

### Firestore structure
- `users/{uid}/studyGuides/{guideId}`
- `users/{uid}/studyGuides/{guideId}/textChunks/{chunkId}`
- `explanationCacheEntries/{cacheKey}` (server/admin only)

### Cost controls
- Cache-first: existing explanation is reused without LLM call.
- Model selector: uses cost model for larger guides when batch mode is enabled.
- Model fallback: automatic fallback when primary model is unavailable.

## Notes
- Client cannot access global cache directly (`firestore.rules`).
- Server uses Firebase Admin SDK for cache + control operations.
- Hebrew validation runs for both chunk explanations and final summary.
