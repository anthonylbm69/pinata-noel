# 🎁 Remplir le contenu des épreuves

Tout le contenu est dans `src/content/` (un fichier JSON par épreuve). Après chaque modification :

```bash
npm run check:content
```

Il liste les fichiers manquants et les erreurs (mauvaise réponse hors des choix, prix invalide…).

> Dans les questions à 4 choix, `"correct"` est la **position** de la bonne réponse : `0` = 1er choix (▲ rouge),
> `1` = 2e (◆ bleu), `2` = 3e (● vert), `3` = 4e (■ jaune). Pense à varier la position.

## 🧠 Quiz sur tonton — `quiz-tonton.json`
Déjà rempli et validé.

## 🎵 Blind test — `blindtest.json` (enfants) et `blindtest-adultes.json`
Rempli : 10 morceaux enfants dans `public/audio/blindtest/enfant/`, 7 adultes dans `public/audio/blindtest/adulte/`
(les noms de fichiers d'origine sont gardés, l'URL est encodée par la télé).
- `choices` = les 4 titres, `correct` = position du bon.
- `start` = seconde de départ de l'extrait (calée sur le moment où le morceau démarre vraiment, après
  l'intro du clip) : à ajuster à l'oreille si besoin.
Le son est joué **par la télé uniquement**. Si la télé affiche « 🔊 Activer le son », clique dessus.
Le blind test adultes sera branché avec le mode adultes.

## 👀 Mémoire — `memoire.json`
Prêt à jouer : 10 objets (emoji + nom) affichés 20 s, puis 7 questions. Tu peux changer les objets
(garde-en 10) et les questions. « Tout en haut à gauche » = le 1er objet de la liste.

## 💶 Juste prix — `justeprix.json`
Prix en **euros entiers**. ⚠️ **Vérifie les prix** avant le jour J, ce sont des estimations.
Tu peux ajouter une photo avec `"image": "/photos/justeprix/xxx.jpg"` (sinon l'emoji est affiché).
Points : le plus proche sans dépasser 1000, puis 700, 500, 350, 250, 150, 100 ; dépassé = 0.

## 🕵️ Qui est-ce ? — `quiestce.json`
1. Mets les photos (bébés, vieilles photos…) dans `public/photos/quiestce/`, nommées `01.jpg`, `02.jpg`…
2. Remplace les prénoms dans `choices` (ceux écrits sont des exemples).
La photo apparaît très floue et devient nette à la fin du chrono. Elle n'est affichée que sur la télé.

## 🍷 Mode adultes — `programme-adultes.json`
Épreuves : blind test adultes → quiz de Noël → bébé mystère. Pas de finale ni de box : on termine sur la
gagnante (femmes) et le gagnant (hommes).
- **Quiz de Noël** (`quiz-noel.json`) : 8 questions de culture de Noël, jouables telles quelles. Remplace-les par
  des questions sur la famille si tu veux.
- **Bébé mystère** (`bebe-mystere.json`) : photos de bébé des adultes dans `public/photos/bebe/`, nommées
  `01.jpg`, `02.jpg`… et les prénoms dans `choices` (ceux écrits sont des exemples).

## 💣 Finale et 🎁 box — `programme-enfants.json`
- `rounds` : l'ordre des épreuves (tu peux en retirer une).
- `final` : 20 boutons, 6 bombes, le dernier survivant +3000, le dernier éliminé +1500.
  Le dernier du classement commence.
- `boxes` : nombre de box (7). Le classement donne l'ordre de choix.

## Plan B (bouton ⚙ sur la télé)
- **Sauter cette épreuve** (son ou photos qui ne marchent pas), **Aller à la finale**, **Aller aux box**.
- Pendant la finale et les box, l'animateur peut cliquer sur la télé à la place d'un joueur
  dont le téléphone est en panne.
