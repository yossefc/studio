# Analyse du système de sauvegarde Firebase

Cette analyse détaille comment les données sont sauvegardées et gérées avec Firebase Firestore au sein de l'application `studio`.

## 1. Architecture Globale (Client vs Serveur)

L'application utilise une approche hybride où **la majorité des écritures (sauvegardes) se font côté client**, tandis que le serveur effectue principalement de la lecture légère pour orchestrer les tâches longues :

*   **Côté Client (`src/app/generate/page.tsx` etc.)** : Utilise le SDK client Firebase (`firebase/firestore`). Il s'occupe de créer de nouveaux documents, de mettre à jour les statuts, et d'enregistrer les détails d'un guide d'étude une fois que l'IA a généré le contenu.
*   **Côté Serveur (`src/app/actions/study-guide.ts`)** : Les Server Actions de Next.js. Lors de la génération (qui peut prendre du temps), l'action serveur _lit_ la base de données via `firebase-admin` (`getAdminDb()`) pour vérifier si l'utilisateur a annulé la tâche (statut `Cancelled`), mais elle ne fait **quasiment aucune écriture directe**.
*   **Mode "Non-Blocking" (`src/firebase/non-blocking-updates.tsx`)** : L'application dispose d'utilitaires pour faire des écritures "fire-and-forget" (sans bloquer l'interface). Cela permet des mises à jour optimistes où on n'attend pas la réponse finale du serveur cloud pour continuer, avec un système qui attrape et remonte les erreurs de permission si elles échouent.

## 2. Structure de la Base de Données

Les données des guides d'étude sont structurées de manière hiérarchique, centrée sur l'utilisateur :

*   `users/{userId}/studyGuides/{guideId}` : Le document principal d'un guide (contenant le résumé, le `tref`, la liste des sources, le lien Google Docs, et surtout le **`status`**).
*   `users/{userId}/studyGuides/{guideId}/textChunks/{chunkId}` : Une sous-collection qui stocke chaque partie ("chunk") expliquée par l'IA indépendamment. Cela permet d'avoir la granularité de tout le texte sans faire exploser la taille du document parent.

## 3. Le Flux de Sauvegarde (Le cycle de vie d'un Guide)

Le fichier `generate/page.tsx` orchestre l'enregistrement tout au long de la création d'un guide :

1.  **Initialisation (Processing)** : 
    Dès que l'utilisateur clique sur "Générer", un document est créé côté client avec `setDoc` et le `status: 'Processing'`.
    ```typescript
    await setDoc(guideRef, { id: studyGuideId, userId: user.uid, status: 'Processing', ... });
    ```
2.  **Appel à l'IA** : L'action serveur `generateMultiSourceStudyGuide` se lance. Elle vérifie périodiquement la base de données Admin pour voir si le `status` est passé à `Cancelled`.
3.  **Succès de l'IA (Preview)** : 
    Si l'IA termine, le client écrase/met à jour le document parent avec le résumé final (`status: 'Preview'`).
    Ensuite, il boucle sur tous les `chunks` retournés par le serveur et effectue un `setDoc` pour écrire chaque bloc dans la sous-collection `textChunks`.
4.  **Annulation (Cancelled)** :
    Si l'utilisateur clique sur Annuler, le client fait un `updateDoc` pour mettre `status: 'Cancelled'`. Le serveur, qui vérifiait ce statut de son côté, arrête immédiatement d'interroger l'IA.
5.  **Échec (Failed)** :
    Si l'IA ou le serveur renvoie une erreur inattendue, le client intercepte et fait un `updateDoc` avec `status: 'Failed'`.
6.  **Export (Published)** :
    Une fois que l'utilisateur exporte vers Google Docs, le client reçoit l'ID et l'URL du document, et fait un `updateDoc` final avec `status: 'Published'`.

## Conclusion 

Le système de sauvegarde est robuste : il tire parti du côté temps-réel et asynchrone de Firestore depuis le client pour le ressenti utilisateur ("loading", annulation instantanée), tout en laissant le serveur générer le contenu lourd et lire ces mêmes statuts pour savoir quand s'arrêter (économisant ainsi des tokens d'IA sur des requêtes annulées).
