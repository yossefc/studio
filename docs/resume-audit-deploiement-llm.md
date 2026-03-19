# Resume audit avant deploiement

Date: 2026-03-17

## 1) Etat general

Le projet compile correctement:

- `npm run typecheck`: OK
- `npm run build`: OK

Donc les principaux risques avant deploiement ne sont pas des erreurs de compilation.
Les vrais sujets sont:

- securite des server actions
- maitrise des couts LLM
- absence de vraie metrique de facturation par utilisateur
- scalabilite limitee
- quelques incoherences fonctionnelles en production

## 2) Liste des problemes

### Critiques

1. Les server actions sensibles ne verifient pas vraiment l'identite de l'utilisateur cote serveur.

- `generateMultiSourceStudyGuide` accepte `userId` et `guideId` envoyes par le client.
- ensuite la fonction ecrit avec Firebase Admin SDK.
- le meme probleme existe pour les exports Google Docs.

Fichiers:

- `src/app/actions/study-guide.ts`

Impact:

- faille d'autorisation potentielle
- possibilite d'abus de couts
- un utilisateur malveillant pourrait faire generer du contenu ou ecrire dans un autre espace logique

2. Le mode `Torah Ohr` peut exploser les couts.

- pour `torah_ohr`, la limite de chunks est retiree
- l'interface permet de traiter toute la parasha
- si le mode "passages only" est desactive, on peut lancer une grosse generation IA

Impact:

- une seule requete peut couter tres cher
- risque eleve de facture imprenable si plusieurs utilisateurs lancent ce mode

3. La logique timeout/retry peut consommer des tokens plusieurs fois pour une seule demande.

- le code lance une generation avec timeout
- si le timeout arrive, l'appel LLM continue potentiellement en arriere-plan
- le code peut ensuite relancer ou passer sur un autre modele

Impact:

- cout reel superieur au cout visible
- en cas de charge ou latence, la facture peut monter rapidement

### Majeurs

4. L'estimation de cout actuelle n'est pas fiable.

- `GEMINI_USE_BATCH` ne declenche pas la vraie Batch API
- cela sert seulement a choisir un modele moins cher
- `metrics.ts` repose sur des prix approximatifs et anciens
- le calcul ne couvre pas proprement tous les appels secondaires comme le resume ou `rav_ovadia`

Impact:

- risque de sous-estimer fortement le cout par generation
- risque de proposer un abonnement non rentable

5. Il n'existe pas de vrai ledger d'usage par utilisateur.

- tu logs seulement une estimation en console
- tu ne stockes pas les tokens reels ou estimes par appel
- tu ne stockes pas le cout facture par utilisateur

Impact:

- impossible de faire une facturation serieuse
- impossible de plafonner l'usage mensuel proprement
- impossible d'identifier les utilisateurs les plus couteux

6. Le cache canonique cross-user peut renvoyer un guide sans le re-persister proprement dans l'historique utilisateur.

- quand le cache canonique repond vite, la fonction peut retourner le resultat
- la persistance detaillee utilisateur arrive surtout a la fin du pipeline complet
- certaines vues comme `my-guides` reposent sur les `textChunks` utilisateur

Impact:

- l'utilisateur peut voir un bon resultat immediatement
- mais apres rechargement, son historique peut etre incomplet ou vide

### Importants

7. La progression n'est pas toujours coherente.

- `progressTotal` est calcule avant le traitement complet de `mishnah_berurah`
- ensuite `progressDone` continue d'augmenter

Impact:

- barre de progression fausse
- ETA fausse
- possible progression > 100%

8. Le deploiement est actuellement limite a une seule instance.

- `apphosting.yaml` contient `maxInstances: 1`

Impact:

- sous charge, les utilisateurs vont attendre
- risque de saturation rapide
- pas adapte si plusieurs utilisateurs lancent des generations en meme temps

## 3) Cout LLM: ordre de grandeur

Au 17 mars 2026, les tarifs Gemini Developer API a surveiller sont environ:

- `gemini-2.5-flash`: `$0.30 / million` tokens input, `$2.50 / million` tokens output
- `gemini-2.5-flash-lite`: `$0.10 / million` input, `$0.40 / million` output
- `gemini-2.5-pro`: `$1.25 / million` input, `$10.00 / million` output

Important:

- la vraie Batch API peut reduire le cout
- mais ton code actuel ne l'utilise pas reellement

## 4) Estimation pratique par generation

Avec l'architecture actuelle, en ordre de grandeur:

### Cas leger

- 1 source
- jusqu'a 8 chunks
- plus le resume final

Cout estime:

- environ `$0.03` sur Flash
- environ `$0.12` sur Pro

### Cas moyen

- 3 sources
- jusqu'a 24 chunks
- plus resume
- plus `rav_ovadia`

Cout estime:

- environ `$0.09` sur Flash
- environ `$0.36` sur Pro

### Marge de securite

Il faut appliquer une marge de securite d'au moins x2 a cause de:

- retries
- timeouts
- generations perdues
- traffic imprevu
- cout infra autour du LLM

## 5) Ce que je recommande pour le lancement

Ne vends pas de formule "illimitee".

### Option simple

- abonnement: `19 EUR / mois`
- inclus: `30 generations standard / mois / utilisateur`
- au-dela: `0.60 EUR` par generation supplementaire

### Option plus propre: systeme a credits

- 1 source = 1 credit
- chaque source supplementaire = +1 credit
- `rav_ovadia` = +1 credit
- `Torah Ohr full AI` = 8 credits minimum, ou desactive au lancement
- `19 EUR / mois = 40 credits`

## 6) Combien d'utilisation par utilisateur

Pour ne pas exploser ton compte au lancement:

- utilisateur payant standard: `30 generations / mois`
- utilisateur test ou anonyme: `1 a 2 generations max`
- limite de concurrence: `2 generations actives max par utilisateur`
- limite de frequence: `1 generation toutes les 30 a 60 secondes par utilisateur`

Si tu veux un lancement prudent:

- commence a `20 generations / mois`
- mesure 2 a 4 semaines
- puis monte a `30` si les couts reels restent sains

## 7) Ce qu'il faut mettre en place avant deploiment

### Obligatoire

1. Verifier l'utilisateur cote serveur dans toutes les server actions sensibles.
2. Ajouter un ledger `usageLedger` avec au minimum:
   - `userId`
   - `guideId`
   - `model`
   - `inputTokens`
   - `outputTokens`
   - `estimatedCostUsd`
   - `createdAt`
3. Bloquer une generation si le quota mensuel utilisateur est depasse.
4. Ajouter un rate limit serveur.
5. Desactiver ou surtaxer `Torah Ohr full AI`.
6. Mettre des budgets et alertes Google Cloud Billing.

### Recommande

7. Corriger la persistance quand le cache canonique repond.
8. Corriger `progressTotal` pour couvrir tous les chunks reels.
9. Augmenter `maxInstances` selon la charge attendue.
10. Stocker un vrai cout par generation dans Firestore pour pouvoir auditer ensuite.

## 8) Plan business prudent

Si tu deployes maintenant sans garde-fous, ton risque principal est:

- pas que l'application plante
- mais qu'un petit nombre d'utilisateurs consomme beaucoup trop de generations couteuses

Le bon schema de demarrage est donc:

1. Flash comme modele principal utilisateur
2. quotas mensuels stricts
3. pas d'illimite
4. ledger de cout par utilisateur
5. alerte budget cloud

## 9) Conclusion simple

Ton application est deployable techniquement.

Mais elle n'est pas encore prete economiquement ni securitairement pour une ouverture publique sans limites.

Le point le plus urgent est:

- securiser les server actions
- tracer le cout par utilisateur
- imposer des quotas

Tarification conseillee au lancement:

- `19 EUR / mois`
- `30 generations standard`
- `0.60 EUR` par generation supplementaire

Si tu veux etre encore plus prudent:

- `19 EUR / mois`
- `20 generations`
- puis ajustement apres 2 a 4 semaines de mesures reelles

## 10) Sources officielles a verifier

- Pricing Gemini: `https://ai.google.dev/pricing`
- Quotas Gemini API: `https://ai.google.dev/gemini-api/docs/quota`
- Cloud Billing Budgets: `https://docs.cloud.google.com/billing/docs/how-to/budgets`
- API usage caps: `https://docs.cloud.google.com/apis/docs/capping-api-usage`

