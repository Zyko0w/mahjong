# Mahjong 3D — Le Temple des Tuiles

Mahjong solitaire en 3D (Three.js) qui se joue dans le navigateur : classement par pseudo et duel en temps réel.

## Lancer

```bash
npm install
npm start
```

Ensuite, ouvre http://localhost:3000. Pour un duel entre deux PC du même réseau, utilise l'IP locale de la machine qui fait tourner le serveur (ex. `http://192.168.1.20:3000`). Le port se change avec la variable `PORT`.

## Contenu

- **Solo** : 10 plateaux. Il y a les classiques (la Tortue, la Forteresse, la Pyramide) et des formes rigolotes : Chat, Papillon, Cœur, Fusée, Crabe, Smiley et Dragon. Chaque donne a toujours une solution.
- **Créer un plateau** : dans `public/js/layouts.js`, chaque forme est dessinée en ASCII, couche par couche (`#` = une tuile). Il faut un nombre pair de tuiles, 144 au maximum. Le plateau apparaît ensuite tout seul dans le menu, le classement et le duel.
- **HUD** : timer, coups, tuiles restantes, paires jouables, score et combo.
- **Outils** : indice (H), mélange garanti soluble (M), annulation (Z), caméra (C), pause (Échap).
- **Classement sans base de données** : les scores vont dans `data/leaderboard.json`, avec le meilleur score de chaque pseudo pour chaque disposition, plus le bilan victoires/défaites des duels.
- **Duel en direct** (WebSocket) : on crée un salon et on partage son code ou son lien d'invitation, ou on lance une partie rapide. Les deux joueurs ont la même donne, voient la progression de l'adversaire en direct et peuvent s'envoyer des émotes. Le premier qui vide le plateau gagne, puis une revanche est possible.

## Ambiance

- **Musiques libres de droits** (OpenGameArt, licences CC0, CC-BY et OGA-BY) au style chinois et asiatique. Chaque ambiance a sa playlist (menu, solo, duel), définie dans `public/music/playlist.json`. Les auteurs et licences sont dans `public/music/CREDITS.md` et dans le jeu (rubrique Règles).
- **Ajouter des morceaux** : voir `public/music/LISEZMOI.txt`.
- **Effets sonores** : synthétisés (`public/js/music.js`).
- **Décor** (`public/js/props.js`) : bambous, cerisiers en fleurs et pétales qui tombent, bannières calligraphiées, paravent peint, vases bleu et blanc, brûle-encens qui fume, service à thé, pagodes et lune au loin.
- **Icônes** : [Lucide](https://lucide.dev), servies en local.

Pour remettre le classement à zéro, arrête le serveur et supprime `data/leaderboard.json`.
# mahjong
