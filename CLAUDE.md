# La Pinata de Noël — contexte du projet

Jeu de Noël 2026 façon **Kahoot**, joué en famille le soir du réveillon. Une **télé** (écran animateur) affiche
les questions ; chaque joueur répond sur **son téléphone**. Le **classement cumulé** de toutes les épreuves
donne l'ordre dans lequel chacun choisit une **box** (cadeau emballé et numéroté).

Lire aussi `AGENTS.md` (règles Next.js 16 : lire `node_modules/next/dist/docs/` avant d'écrire du code).

## Règles du jeu (décidées avec Anthony)

### Côté enfants — 7 joueurs (2 filles 13–15 ans, 5 garçons 10–17 ans)
- Épreuves : **quiz sur tonton** → blind test → mémoire 10 objets → juste prix → qui est-ce → **finale**.
- Points façon Kahoot à chaque question : juste = `round(1000 × (1 − (t / T) ÷ 2))`, faux = 0.
  Le temps `t` est mesuré par **l'horloge de la base** (jamais celle du téléphone).
- Juste prix : le plus proche **sans dépasser** gagne, le temps départage les égalités.
- **Finale « bouton de la mort »** : 20 boutons dont **6 piégés**, tour par tour. Les bombes sont tirées côté
  serveur et **ne sont jamais envoyées aux clients**. (Règles exactes de points à confirmer avec Anthony.)
- **Fin** : le classement cumulé donne l'ordre de choix. L'écran affiche **7 box numérotées (1 à 7) sans aucun
  contenu** ; le joueur clique une box puis ouvre le vrai paquet devant tout le monde. Le serveur ne connaît
  que les numéros. Pas d'indices, pas de joker : le 1er peut tomber sur le cadeau troll, c'est voulu.

### Côté adultes
- Même moteur, 2 classements séparés (**F / H**, choisi à l'inscription), 1 gagnant par camp.
- Épreuves envisagées : blind test années 80–2000, bébé mystère, quiz famille.

## Stack

- **Next.js 16** (App Router, `cacheComponents` activé) déployé sur **Vercel**, pas de serveur à gérer.
- **Supabase** : Postgres (état des parties) + **Realtime** (les clients écoutent les UPDATE de `games`).
- Tailwind v4, police Fredoka. Maquette Figma : https://www.figma.com/design/pSDly6PBWod24z7WRBH3zF
- Pas de Socket.io : les WebSockets Vercel sont en bêta (connexions coupées après ~5 min, pas d'état partagé).

## Architecture

```
Télé  /host/[code] ──┐                         ┌── Postgres (games, players, answers, …)
                     ├── POST/GET /api/games/* ┤
Tél   /play/[code] ──┘   (clé service_role)    └── Realtime : UPDATE games.version → les clients rechargent
```

- **Toutes les lectures/écritures passent par les route handlers** (`src/app/api/games/...`) avec la clé
  `service_role`. Les navigateurs n'ont que la clé `anon`, qui ne sert qu'à Realtime sur `games`.
- Chaque changement incrémente `games.version` (`bump_game`) → Realtime → les clients appellent `/state`.
- Filet de sécurité dans `useGameState` : rechargement toutes les 4 s, au retour au premier plan et au retour
  du réseau. Le chrono est recalé sur `serverNow`.
- **La télé pilote** : elle ferme la question quand le chrono est fini ou que tout le monde a répondu
  (`close`, idempotent côté SQL) et fait répondre les bots de test.
- Machine à états (`games.phase`) : `lobby → question → results → (leaderboard) → question … → end`.

### Base (`supabase/schema.sql`, ré-exécutable)
| Table | Rôle |
|---|---|
| `games` | une partie = une session : code, mode, phase, question en cours, heure d'ouverture, flag test, version. **Seule table lisible par `anon`** (rien de secret dedans). |
| `game_secrets` | jeton animateur |
| `players` | prénom (unique par partie, insensible à la casse), couleur, genre, **jeton d'appareil** (reconnexion), `is_bot` |
| `answers` | heure posée par la base, points ; **unique (partie, joueur, question)** contre les doubles réponses |
| `adjustments` | points donnés/retirés à la main (plan B) |

Fonctions SQL : `open_question`, `close_question`, `submit_answer` (refuse si fermée, en retard > T+1,5 s, ou
en double), `bump_game`. Classement = somme `answers.points` + `adjustments.points` (calculé dans
`buildState`, jamais stocké).

### Fichiers clés
- `src/lib/game-server.ts` — chargement partie, auth animateur/joueur, `buildState` (état envoyé aux clients ;
  la bonne réponse n'est envoyée qu'en phase `results`).
- `src/app/api/games/[code]/host/route.ts` — actions animateur : start, close, show-leaderboard, next,
  restart-question, end, reset, add-bots, remove-bots, bot-answer, adjust, kick.
- `src/hooks/useGameState.ts` — synchro Realtime + polling, chrono.
- `src/app/host/[code]/HostScreen.tsx` + `HostPanel.tsx` (⚙ : bots, relancer, points à la main, lien animateur).
- `src/app/play/[code]/PlayerGame.tsx` — écrans téléphone.
- `src/content/*.json` — **contenu des épreuves, séparé du code** (le quiz sur tonton est validé).

## Lancer en local

1. Créer un projet Supabase.
2. `cp .env.example .env.local` et remplir les variables (Project Settings → API Keys ; la clé publique peut
   s'appeler `NEXT_PUBLIC_SUPABASE_ANON_KEY` ou `..._PUBLISHABLE_KEY`, la secrète `sb_secret_…` va dans
   `SUPABASE_SERVICE_ROLE_KEY`), plus `DATABASE_URL` (Connect → Session pooler).
3. `npm run db:push` applique `supabase/schema.sql` (refuse s'il y a déjà des parties ; `-- --force` pour passer
   outre — **jamais le soir du réveillon**, ça efface tout). Claude peut le lancer seul.
4. `npm install && npm run dev` → http://localhost:3000. Pour tester avec des téléphones sur le même Wi-Fi :
   `npm run dev -- -H 0.0.0.0` puis ouvrir l'IP de l'ordinateur.

Vercel : importer le dépôt, ajouter les 3 variables d'environnement, déployer.

## État d'avancement

- [x] V1 (cible : dimanche 22/11) — sessions, lobby QR, quiz Kahoot complet, résultats, classement cumulé,
      reconnexion, bots, plan B (points à la main, relancer une question), lien animateur.
- [ ] Autres épreuves : blind test (audio joué **uniquement par la télé**, bouton « Activer le son »),
      mémoire 10 objets, juste prix (saisie numérique), qui est-ce (photo floutée qui se dévoile).
- [ ] Finale 20 boutons / 6 bombes (table `final_buttons`, bombes illisibles par les clients).
- [ ] Écran des box (table `boxes`, numéros 1–7 uniquement).
- [ ] Mode adultes (genre à l'inscription, 2 classements, épreuves adultes).
- [ ] Admin : liste/suppression des parties de test, saut de phase.
- [ ] Mise en ligne + répétition générale avec 5–6 vrais téléphones (Wi-Fi **et** 4G, tests de casse).

## Pièges déjà rencontrés (test du 21/11)
- Le chrono des écrans se cale sur l'heure **de la base** (`server_now_ms()`), pas sur `Date.now()` du serveur
  Next : l'horloge du PC avait 14,6 s d'écart avec Supabase.
- `useRemaining` ne doit jamais renvoyer la valeur de la question précédente (sinon la télé refermait la
  question suivante au bout de 1,2 s).
- Pendant une question, les points de cette question ne comptent pas dans les totaux envoyés (spoiler).

## Risques à garder en tête
- Téléphone verrouillé / onglet en arrière-plan → reconnexion par jeton + rechargement de l'état (fait).
- Supabase gratuit se met en pause après inactivité → le réveiller la veille.
- Audio bloqué sans interaction → bouton « Activer le son » sur la télé.
- Wi-Fi saturé → hébergé en ligne, la 4G marche aussi.
- Erreurs de contenu → faire une partie complète seul avant le jour J.
- Tester Safari iOS + Chrome Android, texte lisible depuis le canapé sur la vraie télé.

## Plan B (le jeu ne doit jamais bloquer les cadeaux)
1. Téléphones KO → **mode animateur manuel** : réponses à l'oral, points donnés depuis ⚙.
2. Supabase/Internet KO → version papier : questions lues à voix haute, 20 papiers dont 6 💣, box physiques.

## Conventions
- Interface et messages **en français**. Code commenté en français.
- Ne jamais exposer la clé `service_role` côté client ; ne jamais envoyer une bonne réponse ou une bombe
  avant qu'elle soit révélée.
- `localStorage` via `src/lib/storage.ts` (try/catch).
