# 🎄 La Pinata de Noël

Jeu de Noël façon Kahoot : la télé affiche les questions, chacun répond sur son téléphone,
le classement final donne l'ordre de choix des cadeaux.

**Stack** : Next.js 16 · Supabase (Postgres + Realtime) · Tailwind · Vercel

## Mise en route

### 1. Supabase
1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor → New query** : colle le contenu de [`supabase/schema.sql`](supabase/schema.sql), puis **Run**.
3. **Project Settings → API** : récupère l'URL du projet, la clé `anon` (publique) et la clé `service_role` (secrète).

### 2. Vercel
1. **Add New → Project** → importe ce dépôt GitHub.
2. Dans **Environment Variables**, ajoute :
   | Nom | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé `anon` / publishable |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` / secret (⚠️ jamais côté client) |
3. **Deploy**.

### 3. Jouer
- Sur la **télé / l'ordinateur** : ouvre le site → **Créer une partie**.
- Sur les **téléphones** : scanne le QR code affiché.
- Pour tester seul : bouton **⚙** en bas à droite de la télé → **+ 6 bots**.

## En local
```bash
cp .env.example .env.local   # puis remplis les 3 variables
npm install
npm run dev -- -H 0.0.0.0    # accessible depuis les téléphones du même Wi-Fi
```

## Contenu
Les questions sont dans `src/content/` (JSON). Voir `CLAUDE.md` pour l'architecture et la feuille de route.
