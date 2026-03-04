# Résumé implémentation découpage Tur / Beit Yosef

## Règle métier appliquée

Pour un סעיף `N` du שולחן ערוך :

1. Début du Tur = début du Beit Yosef lié au même סעיף `N`.
2. Fin du Tur = début du Beit Yosef du prochain סעיף qui possède un lien BY (borne de fin exclue).
3. Recherche de fin : `N+1`, puis `N+2`, puis `N+3`, etc.
4. Si aucun סעיף suivant n'a de lien BY, le Tur va jusqu'à la fin du סימן.

## Fallback robuste (quand les liens Sefaria sont incomplets)

1. Si le lien BY du סעיף `N` est absent :
   - recherche arrière (`N-1`, `N-2`, ...),
   - puis fallback structurel du BY du סימן (index exact si présent, sinon index précédent),
   - puis début de סימן si rien n'est trouvable.
2. Si la borne de fin n'est trouvée par aucun lien :
   - fallback structurel du BY du סימן (premier index strictement supérieur au début choisi),
   - sinon fin de סימן.
3. Quand le Tur est renvoyé par Sefaria en un seul bloc géant :
   - on cherche les marqueurs de début/fin dans le texte via plusieurs segments BY du même index,
   - matching progressif (8 mots -> 2 mots) en hébreu normalisé,
   - essais sur plusieurs points d'ancrage du segment BY (pas uniquement les tout premiers mots), pour éviter de reprendre tout le Tur.

## Modifications faites

1. `getTurSegmentsForSeif(section, siman, seif)` suit maintenant cette logique stricte de bornes BY via `/api/links`.
2. Suppression de l'ancienne heuristique :
   - plus de recherche "seif précédent",
   - plus de fenêtre `seif + 5` pour trouver la fin.
3. Si la borne de départ BY (sur `N`) manque, une erreur explicite est levée.
4. Le pipeline principal appelle directement `getTurSegmentsForSeif(...)` pour Tur.

## Fichiers modifiés

1. `src/lib/sefaria-api.ts`
2. `src/app/actions/study-guide.ts`

## Vérification

1. Parse TypeScript OK sur les 2 fichiers modifiés.

## Invalidation cache

1. `canonicalStudyGuides`: version passée à `v3`.
2. `alignments`: version passée à `4`.
3. Objectif : ne pas réutiliser les anciens résultats où le Tur revenait trop large.

## Correctif refs hors סימן

1. Filtrage strict des liens Tur/BY au même סימן demandé.
2. Tri numérique des références (`24:3` avant `24:10`) pour garder l'ordre logique.
3. Objectif : empêcher des refs parasites (ex: `25:5:1`) dans une demande `24:x`.

## Correctif cache/log par chunk

1. `normalizedTref` envoyé au flow d'explication = `chunk.ref` (et non plus uniquement le `tref` global de la source).
2. Effet :
   - logs `[Flow-Cache]` reflètent les refs réelles des chunks,
   - cache plus précis quand une source contient plusieurs refs BY/Tur.
