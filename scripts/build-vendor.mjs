// Copie dans public/vendor les bibliothèques dont le navigateur a besoin (Three.js, Lucide).
// Nécessaire pour les hébergements statiques comme Vercel, où server.js ne tourne pas.
// On ne copie que les fichiers réellement importés (suivi récursif des imports relatifs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(root, 'node_modules');
const OUT = path.join(root, 'public', 'vendor');

fs.rmSync(OUT, { recursive: true, force: true });

let count = 0, bytes = 0;
function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  count++;
  bytes += fs.statSync(src).size;
}

// --- Three.js : cœur + modules complémentaires utilisés par le jeu
const THREE = path.join(NM, 'three');
copy(path.join(THREE, 'build/three.module.js'), path.join(OUT, 'three/build/three.module.js'));
copy(path.join(THREE, 'build/three.core.js'), path.join(OUT, 'three/build/three.core.js'));

// Repère les modules 'three/addons/...' importés par le code du jeu
const jsDir = path.join(root, 'public', 'js');
const addons = new Set();
for (const f of fs.readdirSync(jsDir)) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) addons.add(m[1]);
}

const JSM = path.join(THREE, 'examples/jsm');
const seen = new Set();
function copyAddon(rel) {
  const norm = path.posix.normalize(rel);
  if (seen.has(norm)) return;
  seen.add(norm);
  const src = path.join(JSM, norm);
  if (!fs.existsSync(src)) throw new Error('Module Three.js introuvable : ' + norm);
  copy(src, path.join(OUT, 'three/examples/jsm', norm));
  const code = fs.readFileSync(src, 'utf8');
  for (const m of code.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.startsWith('.')) copyAddon(path.posix.join(path.posix.dirname(norm), spec));
    else if (spec.startsWith('three/addons/')) copyAddon(spec.slice('three/addons/'.length));
  }
}
for (const a of addons) copyAddon(a);

// --- Lucide (icônes)
copy(path.join(NM, 'lucide/dist/umd/lucide.min.js'), path.join(OUT, 'lucide/lucide.min.js'));

console.log(`vendor : ${count} fichiers copiés (${(bytes / 1024 / 1024).toFixed(2)} Mo) dans public/vendor`);

// --- Configuration du client : adresse du serveur de duel (variable d'environnement Vercel)
// Exemple : DUEL_SERVER_URL=wss://mahjong-duel.up.railway.app/ws  (vide = même site, ex. en local)
const duelServer = (process.env.DUEL_SERVER_URL || '').trim();
fs.writeFileSync(path.join(root, 'public', 'config.js'), `window.MJ_CONFIG = ${JSON.stringify({ duelServer })};\n`);
console.log(`config.js : serveur de duel = ${duelServer || '(même site)'}`);
