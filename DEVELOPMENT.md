# Développement

## Boucle de dev : HA charge la carte depuis Vite

Une ressource Lovelace peut pointer vers **n'importe quelle URL**. Plutôt que de
recopier un bundle dans `config/www` à chaque modification, on fait charger le
module par Home Assistant directement depuis le serveur Vite de la machine de dev.

```
[Vite 0.0.0.0:5173]  ◄── le navigateur (PC ou tablette) charge le module ici
        ▲
[Home Assistant]     ressource Lovelace → http://<ip-dev>:5173/src/dev-entry.ts
        ▲
[scripts/ha-dev.mjs] bascule la ressource via l'API WebSocket, une fois
```

Rien n'est copié, HA n'a pas besoin d'être redémarré, et chaque sauvegarde
recharge le dashboard automatiquement.

### Mise en place (une fois)

1. Créer un jeton dans HA : profil → **Sécurité** → **Jetons d'accès de longue
   durée**. Il ne s'affiche qu'une fois.
2. `cp .env.example .env` puis remplir `HA_URL` et `HA_TOKEN`.
   Utiliser l'**IP**, pas `homeassistant.local`.
3. `npm install`

`.env` est déjà dans `.gitignore`. Le jeton n'est jamais affiché en clair, même
dans les logs du script (`abcd…wxyz`).

### Au quotidien

```bash
npm run dev:ha
```

```bash
npm run dev
```

Puis `Ctrl+Shift+R` sur le dashboard. Ensuite chaque sauvegarde recharge la page
toute seule.

Pour revenir au bundle de production :

```bash
npm run dev:ha -- --restore
```

Et pour voir quelles ressources Lovelace sont déclarées :

```bash
npm run dev:ha -- --status
```

### Comment HA sait quel code utiliser

Une ressource Lovelace est simplement une balise injectée dans la page :

```html
<script type="module" src="/local/floorplan.js"></script>
```

Ce script appelle `customElements.define('ha-3d-floorplan', …)` : il **enregistre
un nom de balise**. La carte du dashboard, elle, ne cite aucun fichier — juste
`type: custom:ha-3d-floorplan`. C'est donc la ressource qui décide quel code se
cache derrière ce nom, **globalement** : toutes les cartes Owlnest, sur tous les
dashboards, pour tous les navigateurs.

D'où un piège : **si deux ressources enregistrent le même tag, la première
chargée gagne** et la seconde est ignorée sans erreur visible. C'est pour ça que
`dev:ha` détourne la ressource existante au lieu d'en ajouter une, en
l'identifiant par son *contenu* (le tag qu'elle enregistre) et non par son nom de
fichier — une installation manuelle peut très bien s'appeler `floorplan.js`.

L'URL d'origine est mémorisée dans `.ha-dev-state.json` (gitignoré) pour que
`--restore` soit exact. Si des ressources de dev en double traînent :

```bash
npm run dev:ha -- --clean
```

### Tester sur la tablette

C'est le principal intérêt du montage : la tablette charge le même dashboard HA,
donc elle charge le code de dev sans configuration supplémentaire. Les mesures de
performance se font enfin sur le matériel réel plutôt que sur un desktop.

### Limites connues

- **HTTPS.** Si HA est servi en HTTPS, le navigateur bloque le module HTTP
  (contenu mixte). Accéder à HA en HTTP pendant le dev.
- **Pare-feu Windows.** Le port 5173 doit accepter les connexions entrantes du
  réseau local, sinon la tablette et HA ne verront rien.
- **Serveur éteint = carte vide.** Tant que Vite ne tourne pas, le dashboard ne
  peut pas charger le module. D'où le `--restore`.
- **Lovelace en mode YAML.** L'API `lovelace/resources` exige le mode storage
  (interface graphique). En mode YAML, les ressources sont déclarées dans
  `configuration.yaml` et doivent être modifiées à la main.
- **Pas de HMR à chaud.** Un custom element ne peut pas être redéfini : on force
  un rechargement complet de la page. C'est un choix, pas une limitation Vite.

## Vérifications

```bash
npm run typecheck
```

Vite compile avec esbuild, qui *strippe* les types sans les vérifier : sans cette
commande, `strict: true` ne s'applique nulle part et une erreur de type part en
release sans bruit. La CI (`.github/workflows/validate.yml`) la lance à chaque
push, et `npm run release` refuse de publier si elle échoue.

## Release

```bash
npm run release            # patch
npm run release -- minor
npm run release -- 1.2.3
```

Le script type-check, bumpe `package.json` **et**
`custom_components/owlnest/manifest.json` (HACS lit le second pour l'intégration),
build, commit et pose le tag. Il refuse une version déjà taguée et repart
automatiquement du dernier tag si `package.json` a dérivé derrière.

Le `git push` reste manuel :

```bash
git push && git push origin v<version>
```
