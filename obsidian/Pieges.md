---
tags: [journal, debug]
---

# Pièges

Journal des bugs et de leurs **causes réelles**. La note la plus rentable du coffre : plusieurs de ces erreurs sont revenues sous un autre déguisement.

## Familles récurrentes

### Le module périmé

Un symptôme « la fonctionnalité ne marche pas » alors que le code est bon.

Deux occurrences distinctes :

1. `/local/floorplan.js` — un ancien bundle Owlnest définissait **le même nom d'élément**. Un garde `customElements.get` transformait le conflit en **silence total**. Corrigé en détectant le bundle de production **par son contenu** (on le télécharge et on y cherche `customElements.define("ha-3d-floorplan"`), et non par son nom de fichier.
2. Vite servait une **transformation périmée** sous Windows : l'observateur de fichiers ratait des écritures. Prouvé en lisant `card._createOverlays.toString()` dans la console. Corrigé par `watch: { usePolling: true }` — **qui ne prend effet qu'au redémarrage du serveur**.

> [!tip] Réflexe
> Avant de chercher un bug logique, vérifier que la page exécute bien le code écrit. `constructor.OWLNEST_BUILD` est là pour ça.

### Le cache qui ment

Home Assistant sert ses **404** avec `Cache-Control: public, max-age=2678400` — trente et un jours.

Conséquence : qui se trompe une fois de chemin de modèle voit la carte échouer **pendant un mois après avoir corrigé**. Le navigateur répond depuis son cache sans jamais redemander au serveur. Rien ne le laisse deviner : le fichier est bien là, `curl` renvoie 200, et la carte affiche 404.

Diagnostic : `curl` réussit là où le navigateur échoue. Cet écart **est** la signature — il ne reste alors plus qu'à lire les en-têtes de la réponse 404.

Deux corrections, ensemble :

1. **Le message porte le code HTTP.** « Échec du chargement » ne distinguait pas chemin faux, accès refusé et serveur en panne, alors que la marche à suivre diffère à chaque fois.
2. **Une seconde tentative sur 404 seulement**, avec un paramètre que le cache ne connaît pas. Si elle réussit, le fichier existait et c'est le cache qui mentait. Si elle échoue, c'est l'erreur d'origine qui remonte : parler de cache égarerait.

Voir `src/model-errors.ts`. Le `Ctrl+Maj+R` **ne suffit pas** ici : le rechargement forcé couvre la page et ses ressources de chargement, pas un `fetch()` déclenché plus tard.

> [!warning] Le piège du piège
> Le même mécanisme frappe ailleurs : la carte elle-même reste en cache après une mise à jour HACS, d'où l'étape de rafraîchissement forcé du README. Voir [[Chantiers ouverts]].

### La donnée perdue en silence

Trois fois le même schéma : une liste blanche de champs qui n'a pas suivi l'ajout de nouveaux champs.

- `AnchorSnap` (annulation) était une liste blanche → **8 champs effacés** par un Ctrl+Z. Remplacé par une copie structurelle.
- `_enterEditMode` en oubliait **5** → perte à l'entrée en édition, puis écrasement à l'enregistrement.
- Corrigé et **vérifié par `audit_fields.py`**, qui contrôle les 5 sites de conversion.

### L'enregistrement avalé

```ts
if (this._savePending) return;   // ← perd la modification
```

Deux sauvegardes rapprochées et la seconde disparaissait. Remplacé par une **boucle de coalescence** qui reconstruit la scène à chaque passe.

### Le retour anticipé qui casse la suite

Un `return` dans la boucle de `TAB_DEFS` sautait la création d'un volet ; `tabPanes.get('cards')!` levait, et **tous les onglets suivants disparaissaient**. Le volet est désormais toujours créé, même masqué.

> [!warning] Toujours revérifier les six onglets après avoir touché à `TAB_DEFS`.

## Bugs de géométrie

### La hauteur sur le mauvais axe

Filtre de détection écrit avec la hauteur sur Y. Le modèle est en **Z-up** → **zéro** porte trouvée. Voir [[Modele 3D]].

### La hauteur absolue au lieu de relative

Filtre de fenêtres testant `z > 60` alors que le sol du modèle est à `z ≈ -216` → **zéro** fenêtre. Une hauteur d'appui se mesure toujours **par rapport au point le plus bas**.

### La vignette qui rétrécissait au zoom

Deux causes cumulées : le modèle est en **centimètres** (une largeur « 1,1 m » était toujours écrêtée), et le ratio choisi était trop petit. Les tailles sont maintenant **relatives à l'envergure du modèle**.

### Le réglage qui n'apparaissait qu'après enregistrement

L'axe, le sens et l'amplitude étaient calculés **au moment du découpage**. Corrigé par le **nœud pivot** : voir [[Ouvrants]].

### La remise à zéro accrochée au mauvais objet

`removeWeatherParticles()` réinitialisait aussi le brouillard et l'éclairage. Or
elle sort immédiatement quand il n'y a pas de particules — et `fog`, `cloudy`,
`exceptional` et `lightning-only` n'en créent aucune. **On ne pouvait jamais
sortir de ces quatre météos** : le brouillard gardait leur densité, et la scène
restait sombre.

> [!note] Leçon
> Une remise à zéro appartient à l'état qu'elle restaure, jamais à la fonction
> qui se trouvait passer par là. `_resetAtmosphere()` vit maintenant avec
> l'atmosphère.

### Les facteurs qui se cumulent

`hemiLight.intensity *= 0.6` à chaque changement de météo, sans jamais repartir
de la valeur de base. Passer de la pluie au beau temps puis à la pluie
assombrissait la scène un peu plus à chaque cycle.

Les facteurs sont désormais des **assignations** depuis la configuration relue.
Vérifié sur douze changements consécutifs : six retours au repos, tous identiques.

## Bugs de sémantique

### Le capteur qui laissait la porte béante

`describeEntity('sensor.x').isOn` répond `() => true`. Correct pour un badge, désastreux pour un ouvrant. Voir [[Descripteurs]].

### Le déclencheur numérique sur attribut qui ne partait jamais

L'instantané ne gardait que la **chaîne d'état**, pas les attributs. Un seuil sur attribut ne pouvait donc jamais détecter de franchissement. Corrigé par `_prevNum` indexé par `entité|attribut`. **Attrapé par les tests avant livraison** — le seul de la liste.

## Bugs d'interface

### Le sélecteur derrière la fenêtre modale

Un `<dialog>` ouvert avec `showModal()` vit dans le **top layer** du navigateur : aucun `z-index` ne passe devant, et le reste de la page devient inerte. Le sélecteur d'entités est donc devenu lui-même une modale — deux modales s'empilent correctement.

### Les listes déroulantes illisibles

Une popup `<select>` native se dessine avec les couleurs du **système**, pas celles du `<select>`. Texte clair sur fond blanc. Corrigé par `color-scheme: dark` **plus** des styles sur chaque `<option>`, pour les navigateurs qui ignorent le premier.

## Outillage

### `npm run dev:ha -- --restore` lançait le mode dev

**PowerShell consomme le `--`.** Preuve : `npm warn Unknown cli config "--restore"`. Corrigé par des scripts npm dédiés.

### Rien n'était typé

`npm run dev` ne faisait rien (pas d'`index.html`) et **rien ne vérifiait les types** — esbuild les supprime sans les lire. `tsc --noEmit` a trouvé 3 erreurs dans 10 735 lignes au premier passage. Voir [[Tests]].

## Mes propres erreurs de méthode

À relire avant d'accuser le code.

- Dispatcher `mousedown`/`mouseup` là où le code écoute `click`.
- Placer une ancre **derrière la caméra** dans un banc, puis conclure à un bug de rendu.
- Lire `leaf.parent` en croyant tenir le nœud pivot, alors que `leaf` **était** le pivot → un test rouge sur du code juste.
- Conclure « modèle fusionné inexploitable » sur la foi d'**un nom de nœud unique**, sans regarder le contenu. La plus coûteuse : elle a failli faire renoncer aux [[Ouvrants]].
- Tester avec le banc **resté en mode édition**, où `set hass` saute volontairement l'évaluation des [[Regles]] — et en déduire que le moteur ne fonctionnait pas.

> [!note] Règle tirée de tout ça
> Quand un test échoue, suspecter le test avant le code. Quand l'utilisateur signale un bug, **mesurer** avant de supposer : lire la scène du backend en WebSocket a résolu trois signalements distincts en distinguant un bug d'enregistrement d'un bug de rendu.
