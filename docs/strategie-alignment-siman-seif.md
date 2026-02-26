# Strategie: decoupage Tur / Beit Yosef par seif (avec cache Firestore)

## Objectif
Eviter de relancer Sefaria + LLM a chaque fois.
On calcule une seule fois l'alignement pour un siman complet, puis on reutilise pour tous les seifim.

## Flux propose
1. Requete utilisateur sur `section + siman + seif`.
2. Lookup Firestore sur `alignments/{section}_{siman}`.
3. Si `status=ready`: lire le mapping du seif et continuer sans appel LLM/Sefaria.
4. Si absent:
   - Creer un lock (`status=building`) pour eviter les doubles calculs.
   - Lancer un job unique de preparation pour tout le siman.
5. Sauvegarder le resultat `ready` puis servir le seif demande.

## Job unique par siman
Recuperer une fois:
- Shulchan Arukh: siman complet (structure par seif).
- Tur: siman complet (segments structures).
- Beit Yosef: siman complet (segments structures).

Puis construire:
- `seifMap`: pour chaque seif SA, liste des segments Tur / BY correspondants.
- Un segment peut etre attache a plusieurs seifim.
- Si pas de correspondance fiable: liste vide (`[]`), pas d'invention.

## Role LLM (optionnel mais utile)
Le LLM peut aider pour les cas ambigus, mais il doit sortir un JSON strict.
Approche conseillee:
1. Filtre heuristique d'abord (similarite lexicale/bigrams) pour reduire le volume.
2. LLM ensuite uniquement pour arbitrer/valider l'alignement final.

## Structure Firestore conseillee
Collection:
- `alignments/{section}_{siman}`

Document exemple:
```json
{
  "section": "Orach Chayim",
  "siman": 308,
  "status": "ready",
  "version": 1,
  "sourceHash": {
    "shulchanArukh": "sha256-...",
    "tur": "sha256-...",
    "beitYosef": "sha256-..."
  },
  "segmentsTur": [
    { "id": "t1", "ref": "Tur, Orach Chayim 308:1", "text": "..." }
  ],
  "segmentsBeitYosef": [
    { "id": "b1", "ref": "Beit Yosef, Orach Chayim 308:1", "text": "..." }
  ],
  "seifMap": {
    "1": { "turSegmentIds": ["t1"], "beitYosefSegmentIds": ["b1"], "confidence": 0.87 },
    "2": { "turSegmentIds": ["t1"], "beitYosefSegmentIds": [], "confidence": 0.52 },
    "3": { "turSegmentIds": [], "beitYosefSegmentIds": [], "confidence": 0.0 }
  },
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## Regles metier importantes
- Meme passage Tur/BY autorise sur plusieurs seifim.
- Aucun passage invente si pas d'alignement fiable.
- Fallback robuste si LLM indisponible: heuristique seule.

## Gestion concurrence
- Champ lock: `status=building` + `lockOwner` + `lockExpiresAt`.
- Si un autre utilisateur demande le meme siman pendant le build:
  - soit attente courte,
  - soit retour "processing" et retry.

## Invalidation / versioning
- Garder des hash des textes source.
- Si hash change, recalculer le siman.
- Incrementer `version` pour migrations de schema.

## Benefice final
- Premier appel sur un siman: cout de calcul.
- Tous les appels suivants (autres seifim du meme siman): lecture cache uniquement.
