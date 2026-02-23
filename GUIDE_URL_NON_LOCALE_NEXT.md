# Guide URL non locale (Next.js)

Objectif: donner ton site a d'autres personnes avec une vraie URL (pas localhost).

## Option 1 - Rapide (meme reseau Wi-Fi/LAN)

Ton serveur est sur le port `9003`.

1. Lance le projet:
```bash
npm run dev -- -p 9003
```

2. Donne cette URL aux personnes sur le meme reseau:
```text
http://10.71.243.215:9003
```

Limite: ne marche pas hors de ton reseau local.

## Option 2 - URL internet immediate (Tunnel gratuit)

Utilise Cloudflare Tunnel (simple et gratuit pour test/partage rapide).

### A) Installer cloudflared (Windows)
```powershell
winget install --id Cloudflare.cloudflared -e
```

### B) Lancer Next.js
```powershell
cmd /c npm run dev -- -p 9003
```

### C) Ouvrir le tunnel
```powershell
cloudflared tunnel --url http://localhost:9003
```

Cloudflare affiche une URL du type:
```text
https://xxxx-xxxx.trycloudflare.com
```

Partage cette URL.  
Limite: URL temporaire (change si tu relances le tunnel).

## Option 3 - URL stable de production (Vercel, gratuit au debut)

### A) Push sur GitHub
```bash
git add .
git commit -m "deploy"
git push
```

### B) Deploy sur Vercel
1. Va sur `https://vercel.com`
2. Clique `New Project`
3. Importe ton repo GitHub
4. Framework detecte: Next.js
5. Clique `Deploy`

Tu obtiens une URL stable:
```text
https://ton-projet.vercel.app
```

### C) Variables d'environnement (important)

Dans Vercel: `Project -> Settings -> Environment Variables`  
Copie les variables de ton `.env.local` (Firebase, Gemini, etc.) avant redeploy.

## Quelle option choisir ?

- Besoin maintenant: Option 2 (Tunnel)
- Besoin propre et durable: Option 3 (Vercel)

## Verification rapide

1. Ouvre l'URL depuis ton telephone en 4G (pas Wi-Fi local)
2. Teste une generation complete
3. Verifie Google Docs + Firestore en production
