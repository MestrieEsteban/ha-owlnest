---
tags: [atelier]
---

# Boucle de dev

Objectif : modifier un fichier et voir le résultat sur le dashboard, sans build ni copie manuelle.

## Le principe

`scripts/ha-dev.mjs` **repointe la ressource Lovelace** vers le serveur Vite, par WebSocket (`lovelace/resources`). Le dashboard charge alors les modules en direct depuis la machine de dev.

```bash
npm run dev:ha
```

Puis `npm run dev` pour le serveur Vite. Rien d'autre à faire côté HA.

Pour revenir à la production :

```bash
npm run dev:ha:restore
```

> [!warning] Pas de `--` sous PowerShell
> `npm run dev:ha -- --restore` **ne marche pas** : PowerShell consomme le `--`. D'où les scripts npm dédiés. Voir [[Pieges]].

## Ce que le script fait de non évident

**Il identifie le bundle de production par son contenu**, pas par son nom. Le fichier s'appelait `floorplan.js` et un autre ancien bundle définissait le même nom d'élément. Le script télécharge donc le candidat et y cherche `customElements.define("ha-3d-floorplan"`.

**Il persiste `{ resource_id, prod_url }`** dans `.ha-dev-state.json` (non versionné), pour que la restauration soit exacte et non devinée.

**Il relit après écriture** — principe repris de la doc HA : ne jamais supposer qu'une écriture a pris.

**Il masque le jeton** dans ses sorties (`abcd…wxyz`).

## Configuration

`.env`, non versionné, modèle dans `.env.example` :

```
HA_URL=http://192.168.1.135:8123
HA_TOKEN=…            # profil → Sécurité → jetons de longue durée
DEV_HOST=             # vide = première IPv4 non-loopback
DEV_PORT=5173
PROD_RESOURCE_URL=/hacsfiles/ha-owlnest/ha-3d-floorplan.js
```

## Réglages Vite qui comptent

```js
server: {
  host: true, port: 5173, strictPort: true, cors: true,
  watch: { usePolling: true, interval: 300 },
}
```

- `host: true` — la tablette et HA doivent joindre le serveur, pas seulement `localhost`.
- `cors: true` — le dashboard est sur une autre origine.
- `strictPort` — mieux vaut échouer que servir sur un port que la ressource ne pointe pas.
- **`usePolling`** — sans lui, l'observateur rate des écritures sous Windows et Vite sert une transformation périmée. Coûteux à diagnostiquer, voir [[Pieges]].

> [!important] `usePolling` ne prend effet qu'au **redémarrage** de `npm run dev`.

## Vérifier qu'on exécute bien le code écrit

Dans la console du dashboard :

```js
document.querySelector('ha-3d-floorplan').constructor.OWLNEST_BUILD
```

`undefined` → la page est périmée, et c'est toute l'explication.

## WebSocket depuis Node

Node 20 n'expose pas `WebSocket` par défaut :

```bash
node --experimental-websocket script.mjs
```

## Limite : CORS sur le modèle

Un GLB servi par HA (`/local/…`) est **refusé** depuis l'origine du serveur de dev : pas d'en-tête `Access-Control-Allow-Origin`. En production le problème n'existe pas, la carte étant servie par HA.

Pour les [[Bancs de test]] : copier le GLB dans `dev/model.local.glb` (non versionné).
