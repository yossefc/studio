# Analyse du stockage du texte dans Firestore

## Portee
- Analyse basee sur le code local du projet `studio`.
- Pas de verification directe des donnees de production Firestore.

## Collections et champs texte

### 1) Guide principal
- Chemin: `users/{userId}/studyGuides/{guideId}`
- Ecritures client:
  - Creation initiale (`status: Processing`)
  - Ecrasement en version finale (`status: Preview`) avec le resume
  - Mises a jour de statut (`Cancelled`, `Failed`, `Published`)
- Champs texte importants:
  - `tref`
  - `summaryText`
  - `googleDocUrl`
  - `googleDocId`
- References code:
  - `src/app/generate/page.tsx:158`
  - `src/app/generate/page.tsx:202`
  - `src/app/generate/page.tsx:263`

### 2) Sous-collection des chunks
- Chemin: `users/{userId}/studyGuides/{guideId}/textChunks/{chunkId}`
- Ecriture client en boucle, un document par chunk.
- Champs texte importants:
  - `rawText` (texte source)
  - `explanationText` (explication IA)
  - `rawHash` (hash du texte brut)
- References code:
  - `src/app/generate/page.tsx:207`
  - `src/app/generate/page.tsx:214`
  - `src/app/generate/page.tsx:216`

### 3) Cache global des explications
- Chemin: `explanationCacheEntries/{cacheKey}`
- Ecriture serveur (Admin SDK).
- Champs texte importants:
  - `explanationText`
  - `modelName`
  - `promptVersion`
- Timestamps: `createdAt`, `updatedAt` via `FieldValue.serverTimestamp()`
- References code:
  - `src/ai/flows/talmud-ai-chatbot-explanation.ts:82`
  - `src/ai/flows/talmud-ai-chatbot-explanation.ts:180`
  - `src/ai/flows/talmud-ai-chatbot-explanation.ts:188`

## Flux de sauvegarde (cycle de vie)
1. Le client cree le guide avec `status: Processing`.
2. Le serveur genere le contenu et verifie periodiquement l'annulation.
3. Le client ecrit le guide final (`summaryText`, `sources`, `validated`, etc.).
4. Le client ecrit tous les chunks dans `textChunks`.
5. Si export Google Docs reussi, le client met `status: Published` + URL/ID doc.

References:
- `src/app/generate/page.tsx:158`
- `src/app/actions/study-guide.ts:53`
- `src/app/generate/page.tsx:202`
- `src/app/generate/page.tsx:208`
- `src/app/generate/page.tsx:263`

## Regles de securite Firestore
- `studyGuides` et `textChunks`: acces reserve au proprietaire (`request.auth.uid == userId`).
- `explanationCacheEntries`: acces client totalement refuse.
- Fallback global deny all.

References:
- `firestore.rules:22`
- `firestore.rules:28`
- `firestore.rules:36`
- `firestore.rules:42`

## Points solides
- Separation guide/chunks: reduit le risque de depasser la taille max par document.
- Limitation du volume de chunks:
  - Chunks de 120 a 180 mots
  - Maximum 8 chunks par source
- Cache serveur dedie pour eviter des regenerations IA inutiles.

References:
- `src/lib/chunker.ts:40`
- `src/lib/constants.ts:12`
- `src/ai/flows/talmud-ai-chatbot-explanation.ts:170`

## Risques et limites observes

### 1) Horodatage client
- Cote client, les dates utilisent `new Date().toISOString()`.
- Risque: horloge locale non fiable, manipulation possible.
- Reference: `src/app/generate/page.tsx:155`

### 2) Validation faible dans les rules
- Les rules verifient la propriete, mais pas une validation stricte de schema:
  - pas de liste stricte des champs autorises
  - pas de contrainte de type fine
  - pas de limite de taille des champs texte
- References:
  - `firestore.rules:24`
  - `firestore.rules:30`

### 3) Ecriture non atomique des chunks
- Les chunks sont ecrits un par un dans une boucle.
- Si erreur au milieu, etat partiel possible (guide final + subset de chunks).
- Reference: `src/app/generate/page.tsx:205`

### 4) Cout lecture/croissance
- La liste des guides charge les documents puis filtre cote client sur `summaryText`.
- Avec beaucoup de guides, cela augmente les lectures et la latence.
- References:
  - `src/app/my-guides/page.tsx:43`
  - `src/app/my-guides/page.tsx:55`

### 5) Croissance du cache global
- Pas de strategie TTL/purge visible pour `explanationCacheEntries`.
- Risque de croissance continue des donnees et des couts.

## Recommandations prioritaires

### Priorite 1
- Passer les timestamps critiques cote serveur (`serverTimestamp`) quand possible.
- Introduire des rules avec validation de schema minimale (champs, type, presence de `userId` coherent).
- Ecriture batch des chunks (`writeBatch`) pour limiter les etats partiels.

### Priorite 2
- Ajouter une politique de retention/TTL pour le cache global.
- Reduire la charge de liste:
  - conserver un champ resume court pour l'index/liste
  - garder le texte long ailleurs si necessaire

### Priorite 3
- Ajouter de la telemetrie metier:
  - nombre moyen de chunks par guide
  - taux d'echec ecriture chunks
  - taille moyenne `summaryText` / `explanationText`

## Fichiers sources examines
- `src/app/generate/page.tsx`
- `src/app/actions/study-guide.ts`
- `src/ai/flows/talmud-ai-chatbot-explanation.ts`
- `src/lib/chunker.ts`
- `src/lib/constants.ts`
- `src/app/my-guides/page.tsx`
- `firestore.rules`
- `firebase.json`
