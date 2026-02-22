# Analyse du code TalmudAI

Date: 2026-02-22

## Points critiques a corriger

- Le cache global des explications risque de ne pas fonctionner en prod:
  - `src/ai/flows/talmud-ai-chatbot-explanation.ts` est un fichier serveur.
  - Il importe `initializeFirebase` depuis `src/firebase/index.ts` qui est marque `'use client'`.
- Les regles Firestore bloquent l'ecriture du cache global:
  - `firestore.rules` autorise `get` sur `explanationCacheEntries`, mais refuse `create/update/delete`.
  - Le flow fait `setDoc`, donc l'ecriture peut echouer.
- L'historique par utilisateur depend d'un user connecte, mais aucun login n'est lance automatiquement:
  - La generation bloque si `!user`.
  - Aucun appel visible a `initiateAnonymousSignIn`.

## Points importants a ameliorer

- La cle de cache est `segmentId` seulement, pas `rawHash`:
  - risque de cache incoherent si le texte change mais garde le meme ID.
- Le chunking n'est pas conforme a la spec 15-25 mots:
  - code actuel: 20-35 mots.
- Le bouton Annuler n'arrete pas le traitement serveur:
  - il annule seulement l'etat UI.
- L'URL Google Docs est encore mockee:
  - pas d'integration Google Docs API reelle.

## Points deja bien avances

- Historique stocke par utilisateur dans Firestore:
  - `users/{uid}/studyGuides` + sous-collection `textChunks`.
- Pipeline force en hebreu:
  - fetch Sefaria en `he`.
  - prompts explication + resume contraints en hebreu.
- Verifications build retablies:
  - `ignoreBuildErrors: false`
  - `ignoreDuringBuilds: false`

## Verification locale

- `typecheck` et `lint` non verifiables ici sans dependances:
  - `node_modules` absent sur cet environnement.

