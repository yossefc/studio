Voici un prompt résumant toutes nos récentes améliorations sur l'application, idéal pour donner tout le contexte à une IA :

***

**Contexte du Projet : Application de Génération de Guides d'Étude (Rabbinat)**

**Récents développements et correctifs apportés au code :**

1. **Génération Multi-Sources avec Sefaria & Genkit (IA) :**
   * Implémentation de la génération de guides d'étude basés sur plusieurs sources simultanées (ex: Shulchan Arukh + Mishnah Berurah, Tur, Beit Yosef).
   * Intégration de Genkit avec sélection dynamique du modèle d'IA (Gemini Flash vs Pro) en fonction du volume de texte (système de "chunks").
   * Gestion du découpage intelligent du texte pour respecter les limites de l'IA (Token limits) et traitement en parallèle des sources.

2. **Amélioration des Prompts IA et de l'Encodage (Hébreu) :**
   * Correction des problèmes d'encodage des caractères hébreux (UTF-8) dans l'interface (notamment dans `page.tsx`).
   * Affinage très strict des instructions (prompts) pour empêcher l'IA d'ajouter des méta-commentaires (du style "Voici l'explication..."). L'IA renvoie désormais exactement le texte formaté demandé.

3. **Architecture de Sauvegarde Firebase (Mode "Non-Blocking") :**
   * Mise en place d'une gestion d'état hybride : le Front-End (client) s'occupe de la majorité des écritures Firestore (`setDoc`, `updateDoc`) de manière asynchrone et non-bloquante (`non-blocking-updates.tsx`) pour garder une UI ultra-réactive.
   * Gestion complète du cycle de vie du guide : statuts `Processing`, `Preview`, `Cancelled`, `Failed`, et `Published`.
   * Le Back-End (`Server Actions`) écoute la base via `firebase-admin` pour stopper la facturation/génération IA immédiatement si l'utilisateur annule la requête côté client.
   * Stockage granulaire : les résultats de l'IA sont sauvegardés proprement dans une sous-collection `textChunks` pour éviter d'exploser la limite de taille des documents Firestore.

4. **Interface Client et Export Google Docs :**
   * Interface enrichie affichant la progression en temps réel et un rendu final propre, classé par source.
   * Exécution de l'export vers Google Docs fonctionnelle, où le lien du document et son ID sont rattachés et mis à jour automatiquement dans le document Firestore de l'utilisateur.

**Objectif actuel :**
[Insère ici ta nouvelle demande, en gardant à l'esprit que l'architecture Firebase, l'IA Genkit et la gestion des UI/Statuts sont désormais stables et inter-connectées.]

***
