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
- Machine à états (`games.phase`) : `lobby → intro → question → results → (leaderboard) → question … → intro
  (épreuve suivante) … → final → boxes → end`.
- **Programme** (`src/content/programme-enfants.json`) = liste d'épreuves + finale + nombre de box.
  `getProgramme` (`src/lib/content.ts`) aplatit toutes les questions : `question_index` est un index **global**.
  Types d'épreuve : `quiz`, `blindtest` (audio joué par la télé), `memoire` (objets affichés pendant l'intro),
  `quiestce` (photo floue sur la télé), `justeprix` (saisie d'un prix, `answers.choice` = prix en euros,
  points distribués à la fermeture par `close_price_question`).

### Base (`supabase/schema.sql`, ré-exécutable)
| Table | Rôle |
|---|---|
| `games` | une partie = une session : code, mode, phase, question en cours, heure d'ouverture, flag test, version. **Seule table lisible par `anon`** (rien de secret dedans). |
| `game_secrets` | jeton animateur |
| `players` | prénom (unique par partie, insensible à la casse **et aux accents**), couleur, genre, **jeton d'appareil** (reconnexion), `is_bot`, `claimable` (prénom libéré par l'animateur) |
| `answers` | heure posée par la base, points ; **unique (partie, joueur, question)** contre les doubles réponses |
| `adjustments` | points donnés/retirés à la main (plan B) et bonus de la finale (`reason = 'finale'`) |
| `final_buttons` | 20 boutons, `is_bomb` tiré par la base, **jamais envoyé** tant que le bouton n'est pas appuyé |
| `final_players` | ordre de passage (classement inversé), éliminations, place |
| `boxes` | numéro de box choisi par joueur (unique), ordre = classement |

Fonctions SQL : `open_question` (durée par épreuve), `open_intro`, `close_question`, `close_price_question`,
`submit_answer` (verrou sur la partie ; refuse si fermée, en retard > T+1,5 s, ou en double), `start_final`, `finish_final`, `final_after_kick`, `press_button` (tour,
bombe, élimination et bonus sous verrou), `server_now_ms`, `bump_game`. Classement = somme `answers.points` + `adjustments.points` (calculé dans
`buildState`, jamais stocké).

### Fichiers clés
- `src/lib/game-server.ts` — chargement partie, auth animateur/joueur, `buildState` (état envoyé aux clients ;
  la bonne réponse n'est envoyée qu'en phase `results`).
- `src/app/api/games/[code]/host/route.ts` — actions animateur : start, close, show-leaderboard, next,
  restart-question, end, reset, add-bots, remove-bots, bot-answer, adjust, release, kick.
  Les actions de déroulé (start, begin-round, show-leaderboard, next, skip-round) envoient `at` =
  « phase:question » vu par la télé : le serveur ignore l'action si l'état a changé (double clic, deux télés).
- `src/hooks/useGameState.ts` — synchro Realtime + polling, chrono.
- `src/app/host/[code]/HostScreen.tsx` (lobby, intro, questions, résultats, son du blind test) + `HostFinal.tsx`
  (finale, box) + `HostPanel.tsx` (⚙ : bots, relancer, sauter une épreuve, aller à la finale/aux box, points à
  la main, lien animateur).
- Routes joueur : `answer`, `final` (appui sur un bouton), `box` (choix d'une box).
- `src/app/play/[code]/PlayerGame.tsx` — écrans téléphone.
- `src/lib/game-audio.ts` — musique de fond + tic-tac (synthétisés en Web Audio, aucun fichier) joués par la
  télé seule : tempo fixe, baissée pendant les questions ; tic-tac à 1/s pendant toute
  la question puis 2/s sur les 5 dernières s, sonnerie à 0. Pas de musique pendant le blind test. Bouton 🔊/🔇 en haut à droite de la télé.
- `src/content/*.json` — **contenu des épreuves, séparé du code**. Guide : `CONTENU.md`.
  `npm run check:content` liste les mp3 / photos manquants. Fichiers dans `public/audio/blindtest/` et
  `public/photos/quiestce/`.

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
- [x] Autres épreuves : blind test, mémoire 10 objets, juste prix, qui est-ce (testé avec bots le 21/11).
- [x] Blind test rempli (10 enfants, 7 adultes dans `blindtest-adultes.json`, pas encore branché).
- [ ] **Contenu à fournir par Anthony** : photos du qui est-ce + prénoms,
      vérifier les prix du juste prix (voir `CONTENU.md`).
- [x] Finale 20 boutons / 6 bombes : dernier survivant +3000, dernier éliminé +1500, le dernier du classement
      commence (règles validées par Anthony).
- [x] Écran des box (numéros 1–7 uniquement, l'animateur peut choisir à la place d'un joueur).
- [ ] Mode adultes (genre à l'inscription, 2 classements, épreuves adultes).
- [ ] Admin : liste/suppression des parties de test, saut de phase.
- [ ] Mise en ligne + répétition générale avec 5–6 vrais téléphones (Wi-Fi **et** 4G, tests de casse).

## Pièges déjà rencontrés (test du 21/11)
- Le chrono des écrans se cale sur l'heure **de la base** (`server_now_ms()`), pas sur `Date.now()` du serveur
  Next : l'horloge du PC avait 14,6 s d'écart avec Supabase.
- `useRemaining` ne doit jamais renvoyer la valeur de la question précédente (sinon la télé refermait la
  question suivante au bout de 1,2 s).
- Pendant une question, les points de cette question ne comptent pas dans les totaux envoyés (spoiler).

## Cas limites gérés (revue du 21/11, testés par script + navigateur)
- Double clic / télécommande qui répète / deux écrans animateur → `at` + verrou côté télé, une seule étape.
- Fermeture de question qui échoue (réseau) → la télé réessaie toutes les 3 s.
- Réponse envoyée pendant la fermeture → `submit_answer` verrouille la partie (refusée proprement).
- Téléphone changé / historique effacé → ⚙ 🔓 « libérer » le prénom : le prochain téléphone qui tape ce prénom
  reprend le joueur et ses points, l'ancien est déconnecté. Sans ça : « demande à l'animateur ».
- « ines » = « Inès » = « INES » (pas de doublon par accent/majuscule).
- Joueur exclu pendant la finale → tour suivant, ou fin de finale s'il ne reste qu'un survivant.
- Finale rejouée → les bonus de la précédente sont annulés. Moins de 2 joueurs → directement aux box.
- Question relancée → les téléphones repartent de zéro ; le champ du juste prix se vide à chaque question.
- Requêtes coupées au bout de 8–10 s (pas de téléphone bloqué sur « Envoi… »), messages réseau en français.
- Joueur exclu → son téléphone recharge la page d'inscription (Next garde l'état des pages : bouton débloqué).
- Arrivé pendant la finale → écran spectateur. Démarrer sans joueur refusé. Bots dans une vraie partie → alerte au lobby.

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
