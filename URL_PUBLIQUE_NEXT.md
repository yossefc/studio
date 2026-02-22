# Avoir une URL non locale avec Next.js

Tu as 2 options.

## 1) URL publique rapide (depuis ton PC, temporaire)

1. Lance Next.js:
```bash
npm run dev -- -p 3000
```

2. Ouvre un tunnel:

Option A (Cloudflare Tunnel):
```bash
npx cloudflared tunnel --url http://localhost:3000
```

Option B (ngrok):
```bash
npx ngrok http 3000
```

3. Recupere l'URL `https://...` affichee par l'outil.
Cette URL n'est pas locale et peut etre ouverte depuis un autre appareil.

## 2) URL publique stable (production)

Le plus simple pour Next.js: Vercel.

1. Push ton code sur GitHub.
2. Va sur https://vercel.com
3. "New Project" -> importe ton repo.
4. Deploy.
5. Tu obtiens une URL publique du type:
`https://ton-projet.vercel.app`

## Domaine perso (optionnel)

Dans Vercel:
`Project Settings -> Domains -> Add`
Puis configure les DNS chez ton registrar.

## Notes utiles

- En local, `localhost` n'est visible que sur ta machine.
- Une URL tunnel est temporaire.
- Une URL Vercel est faite pour le vrai usage (plus stable).
