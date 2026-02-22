# Resume modele + couts API

Date: 2026-02-22

## 1) Probleme actuel

Erreur:

- `404 Not Found` sur `models/gemini-1.5-pro` avec `generateContent` (`v1beta`).

Cause:

- Le modele cible n'est plus disponible (ou pas supporte pour cette methode/version d'API).

Correction:

1. Remplacer le modele dans le code par un modele actif.
2. Verifier la liste des modeles disponibles avant appel (endpoint `models.list`).
3. Mettre le SDK a jour si necessaire.

## 2) Choix modele performant

Options discutees:

- Gemini Pro recent (ex: `gemini-3.x-pro` selon disponibilite du moment).
- OpenAI `gpt-5.2`.
- Claude Sonnet `4.6`.

## 3) Estimation de cout API (ordre de grandeur)

Exemple de charge: `100k` tokens input + `60k` tokens output par execution.

- Gemini Pro recent: ~`$0.92` / execution.
- GPT-5.2: ~`$1.02` / execution.
- Claude Sonnet 4.6: ~`$1.20` / execution.
- GPT-5.2 Pro: ~`$12.18` / execution (beaucoup plus cher).

## 4) Important sur "j'ai deja Pro"

- ChatGPT Pro n'inclut pas les couts API.
- Claude Pro n'inclut pas les couts API.
- Gemini API est facturee via Cloud Billing (separe de l'usage chat).

## 5) Recommandation simple

1. Corriger tout de suite le modele invalide.
2. Demarrer avec un modele "pro" standard (pas "pro premium").
3. Mesurer 1 semaine de trafic reel.
4. Ajuster ensuite selon qualite/cout.

