# Mahjong 3D — Le Temple des Tuiles

Mahjong solitaire en 3D (Three.js) qui se joue dans le navigateur : classement par pseudo et duel en temps réel.

## Lancer

```bash
npm install
npm start
```

Ensuite, ouvre http://localhost:3000. Pour un duel entre deux PC du même réseau, utilise l'IP locale de la machine qui fait tourner le serveur (ex. `http://192.168.1.20:3000`). Le port se change avec la variable `PORT`.

En local, `server.js` fait tout : il sert le jeu, le classement (fichier `data/leaderboard.json`) et le duel.

## Mettre en ligne : Vercel + serveur de duel

Vercel n'héberge que des fichiers statiques et des fonctions courtes. Il ne peut donc pas faire tourner le serveur de duel (WebSocket permanent), ni écrire le fichier du classement. Le déploiement se fait donc en deux parties :

| Partie | Hébergement | Rôle |
|---|---|---|
| Site + classement | **Vercel** | le jeu (`public/`), les fonctions `api/` (classement), le fichier JSON du classement dans **Vercel Blob** |
| Duel | **Railway** ou **Render** | `server.js` (WebSocket), qui envoie le résultat de chaque duel au classement Vercel |

### 1. Vercel (site + classement)

1. Importe le dépôt GitHub dans Vercel. Le fichier `vercel.json` règle tout : build `npm run build`, dossier `public`.
   `npm run build` copie Three.js et Lucide dans `public/vendor` (sans ça, le site reste bloqué sur « Préparation du temple… »).
2. Dans le projet Vercel, va dans **Storage → Create → Blob**, crée le store et connecte-le au projet. Vercel ajoute alors tout seul la variable `BLOB_READ_WRITE_TOKEN`. Le store peut être privé ou public, le code s'adapte.
3. Dans **Settings → Environment Variables**, ajoute :
   - `DUEL_SECRET` : une longue phrase secrète inventée, à mettre aussi sur le serveur de duel ;
   - `DUEL_SERVER_URL` : l'adresse du serveur de duel (étape 2), par ex. `wss://mahjong-duel.up.railway.app/ws`.
4. Redéploie : `DUEL_SERVER_URL` est lue au moment du build.

### 2. Railway ou Render (serveur de duel)

Crée un service web Node à partir du même dépôt, avec la commande de démarrage `npm start`. Ajoute ces variables :

| Variable | Exemple | Rôle |
|---|---|---|
| `LEADERBOARD_URL` | `https://mon-mahjong.vercel.app` | où envoyer les résultats de duel |
| `DUEL_SECRET` | la même phrase que sur Vercel | prouve que les résultats viennent bien de ton serveur |
| `ALLOWED_ORIGINS` | `https://mon-mahjong.vercel.app` | seul ton site peut se connecter au duel (plusieurs adresses : séparées par des virgules) |

`PORT` est fourni automatiquement par l'hébergeur. L'adresse `https://…/health` permet de vérifier que le serveur tourne.
Les offres gratuites de Render mettent le serveur en veille après 15 minutes d'inactivité : le premier duel peut alors attendre environ 30 secondes qu'il se réveille.

## Contenu

- **Solo** : 10 plateaux. Il y a les classiques (la Tortue, la Forteresse, la Pyramide) et des formes rigolotes : Chat, Papillon, Cœur, Fusée, Crabe, Smiley et Dragon. Chaque donne a toujours une solution.
- **Créer un plateau** : dans `public/js/layouts.js`, chaque forme est dessinée en ASCII, couche par couche (`#` = une tuile). Il faut un nombre pair de tuiles, 144 au maximum. Le plateau apparaît ensuite tout seul dans le menu, le classement et le duel.
- **HUD** : timer, coups, tuiles restantes, paires jouables, score et combo.
- **Outils** : indice (H), mélange garanti soluble (M), annulation (Z), caméra (C), pause (Échap).
- **Modes solo** (choix « Mode » dans le menu) :
  - **Classique** : le solitaire de toujours.
  - **Contre la montre** : le chrono descend (0,8 s par tuile au départ, 1 min minimum). Chaque paire rajoute 4 s, et 1 s de plus par niveau de combo. À zéro, la partie s'arrête et les points comptent quand même. Si le plateau est vidé, chaque seconde restante vaut 10 points.
  - **Aveugle** : les tuiles bloquées restent face cachée et se retournent quand elles se libèrent. Score ×1,25.
  - **Zen** : ni chrono ni score, indices et mélanges illimités, musique calme. Ce mode n'est pas classé.
  Contre la montre et Aveugle se combinent avec les difficultés et ont leurs propres classements. Le duel se joue toujours en Classique.
- **Défi du jour** : la même forme, la même donne et le même mode (Classique, Aveugle ou Contre la montre) pour tout le monde, changés chaque jour à minuit (heure de Paris). Il a son propre classement, et une série compte les jours joués d'affilée. Les réglages viennent de `dailyChallenge()` dans `public/js/rules.js`.
- **Classement vérifié par rejeu** : en fin de partie, le navigateur envoie la graine de la donne et la liste horodatée des coups. Le serveur rejoue la partie avec les mêmes règles (`public/js/rules.js`, partagé entre le navigateur et le serveur) et recalcule lui-même le score. Un coup impossible, une autre donne, un indice interdit ou des paires jouées à moins de 150 ms d'écart font refuser la partie. Les mélanges sont déterministes (graine de la donne + numéro du mélange) pour que le rejeu tombe juste.
- **Mode Samouraï** : ni indice ni mélange, score ×2 et classement à part (vérifié par le serveur). Il marche aussi en duel.
- **Mode Hardcore** : aucun indice et 2 mélanges maximum. Si le plateau reste bloqué, la partie est perdue. Le score final est multiplié par 1,5, et le mode a son propre classement (le serveur vérifie qu'aucun indice n'a été utilisé et qu'il n'y a pas eu plus de 2 mélanges). Il marche aussi en duel.
- **Transitions** : au lancement d'une partie, des panneaux de laque se ferment, avec un coup de katana, un cri de samouraï, un sceau et un gong. En duel, un écran « VS » rouge contre jade, avec un sabre dégainé et un grand gong au GO.
- **Classement sans base de données** (`data/leaderboard.json`) : il est organisé par catégorie, avec une vue d'ensemble (podium de chaque forme), un classement par forme en Normal et en Hardcore, et un classement des duels.
- **Duel en direct** (WebSocket) : on crée un salon et on partage son code ou son lien d'invitation, ou on lance une partie rapide. Les deux joueurs ont la même donne, voient la progression de l'adversaire en direct et peuvent s'envoyer des émotes. Le premier qui vide le plateau gagne, puis une revanche est possible.
- **Caméras du duel** (bouton Vue ou touche V) : « Mon jeu » centre ton plateau comme en solo, avec l'adversaire en incrustation ; « Adversaire » fait un gros plan sur lui ; « Ensemble » montre toute la table (vue du compte à rebours).
- **Sécurité du duel** : impossible de rejoindre son propre salon ou de s'affronter soi-même (même navigateur ou même pseudo).
- **Duel immersif** : l'adversaire est assis en face, de l'autre côté de la table (`public/js/opponent.js`). Son plateau est rejoué en direct : sélections, paires, annulations, mélanges. Ses bras vont chercher les tuiles, ses émotes s'affichent dans une bulle au-dessus de lui, et il réagit à la victoire ou à la défaite. À la fin, un écran montre les deux joueurs côte à côte avec les scores et le vainqueur couronné.
- **Entrée dans le temple** : la page attend que le décor 3D soit entièrement dessiné. Le bouton « Entrer » lance aussitôt la musique, déjà téléchargée en arrière-plan (les navigateurs interdisent le son avant un premier clic).

## Ambiance

- **Musiques libres de droits** (OpenGameArt, licences CC0, CC-BY et OGA-BY) au style chinois et asiatique. Chaque ambiance a sa playlist (menu, solo, duel), définie dans `public/music/playlist.json`. Les auteurs et licences sont dans `public/music/CREDITS.md` et dans le jeu (rubrique Règles).
- **Ajouter des morceaux** : voir `public/music/LISEZMOI.txt`.
- **Volume** : un curseur pour la musique et un pour les effets, dans le menu et dans le bouton Son en jeu. Les réglages sont mémorisés.
- **Bruitages** : cri, katana et gongs enregistrés (Freesound, CC0, voir `public/sfx/CREDITS.md`). Les autres effets sont synthétisés (`public/js/music.js`).
- **Décor** (`public/js/props.js`) : bambous, cerisiers en fleurs et pétales qui tombent, bannières calligraphiées, paravent peint, vases bleu et blanc, brûle-encens qui fume, service à thé, pagodes et lune au loin.
- **Icônes** : [Lucide](https://lucide.dev), servies en local.

Pour remettre le classement à zéro, arrête le serveur et supprime `data/leaderboard.json`.
# mahjong
