<p align="center">
  <img src="docs/logo.svg" width="110" alt="Logo Mahjong 3D">
</p>

<h1 align="center">Mahjong 3D — Le Temple des Tuiles</h1>

<p align="center">
  Un mahjong solitaire en 3D qui se joue directement dans le navigateur,<br>
  avec classement vérifié, défi du jour et duels en temps réel.
</p>

<p align="center">
  <a href="https://mahjong-omega-nine.vercel.app"><b>🀄 Jouer maintenant</b></a>
</p>

<p align="center">
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-serveur-339933?logo=nodedotjs&logoColor=white">
  <img alt="WebSocket" src="https://img.shields.io/badge/WebSocket-duel%20en%20direct-4B32C3">
  <img alt="Vercel" src="https://img.shields.io/badge/Vercel-déployé-000000?logo=vercel&logoColor=white">
</p>

---

## Présentation

Entre dans un temple éclairé à la bougie, au milieu des bambous et des cerisiers en fleurs, et vide le plateau en
associant les tuiles libres deux par deux. Joue seul pour grimper au classement, relève le défi du jour ou affronte
un autre joueur en direct, assis en face de toi de l'autre côté de la table.

## Fonctionnalités

### 🀄 Solo
- **10 plateaux** : les classiques (Tortue, Forteresse, Pyramide) et des formes originales (Chat, Papillon, Cœur,
  Fusée, Crabe, Smiley, Dragon).
- **Chaque donne a toujours une solution.**
- **4 modes** : Classique, Contre la montre, Aveugle (tuiles bloquées face cachée) et Zen (sans chrono ni score).
- **Difficultés** : Normal, Hardcore (aucun indice, 2 mélanges max) et Samouraï (ni indice ni mélange, score ×2).
- Outils : indice, mélange garanti soluble, annulation, changement de caméra, pause.
- HUD complet : chrono, coups, tuiles restantes, paires jouables, score et combo.

### 📆 Défi du jour
- La même forme, la même donne et le même mode pour tout le monde, renouvelés chaque jour à minuit.
- Classement dédié et **série** de jours joués d'affilée.

### ⚔️ Duel en temps réel
- Crée un salon et partage son code ou son lien, ou lance une **partie rapide**.
- Les deux joueurs ont la même donne et voient la progression de l'adversaire en direct.
- **Adversaire en 3D** assis en face : ses bras vont chercher les tuiles, ses émotes s'affichent dans une bulle et
  il réagit à la victoire comme à la défaite.
- Trois caméras (Mon jeu, Adversaire, Ensemble), émotes et revanche.

### 🏆 Classement anti-triche
- Classements par forme, par mode, par difficulté et pour les duels.
- **Vérification par rejeu** : le serveur rejoue chaque partie coup par coup avec les mêmes règles que le
  navigateur et recalcule lui-même le score. Coup impossible, mauvaise donne ou rythme inhumain : partie refusée.

### 🎐 Ambiance
- Décor 3D : bambous, cerisiers et pétales qui tombent, bannières calligraphiées, paravent peint, brûle-encens qui
  fume, pagodes et lune au loin.
- Musiques libres de droits au style asiatique, avec une playlist pour le menu, le solo et le duel.
- Transitions de lancement avec coup de katana, cri de samouraï et gong ; écran « VS » pour les duels.

### 🛠️ Personnalisable
- Les plateaux se dessinent en ASCII, couche par couche, dans [`public/js/layouts.js`](public/js/layouts.js) :
  un nouveau plateau apparaît tout seul dans le menu, le classement et le duel.

## Stack technique

| Partie | Techno |
|---|---|
| Jeu | JavaScript, Three.js, Lucide |
| Serveur local et duel | Node.js, WebSocket (`server.js`) |
| Classement en ligne | Fonctions serverless Vercel + Vercel Blob |
| Hébergement du duel | Railway ou Render |

## Lancer le projet

```bash
npm install
npm start      # http://localhost:3000
```

Le déploiement en ligne (Vercel + serveur de duel), les variables d'environnement et le détail de chaque mode sont
décrits dans **[INSTALLATION.md](INSTALLATION.md)**.

## Crédits

Musiques : OpenGameArt (CC0, CC-BY, OGA-BY), voir [`public/music/CREDITS.md`](public/music/CREDITS.md).
Bruitages : Freesound (CC0), voir [`public/sfx/CREDITS.md`](public/sfx/CREDITS.md). Icônes : [Lucide](https://lucide.dev).
