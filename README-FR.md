<p align="center">
  <img src="assets/logo.svg" alt="Owlnest" width="120" />
</p>

<h1 align="center">Owlnest</h1>

<p align="center">
  <strong>Un plan 3D pour Home Assistant.</strong><br />
  Vos lumières et vos appareils dans un modèle de votre maison, avec un éditeur pour les placer.
</p>

<p align="center">
  <a href="https://github.com/MestrieEsteban/ha-owlnest/releases/latest"><img src="https://img.shields.io/github/v/release/MestrieEsteban/ha-owlnest?style=flat-square&color=6C63FF" alt="Dernière version" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/HACS-Integration-41BDF5?style=flat-square" alt="Intégration HACS" /></a>
  <a href="https://github.com/MestrieEsteban/ha-owlnest/issues"><img src="https://img.shields.io/badge/statut-beta-orange?style=flat-square" alt="Bêta : vos retours sont les bienvenus" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MestrieEsteban/ha-owlnest?style=flat-square&color=22C55E" alt="Licence MIT" /></a>
</p>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=fr"><img src="https://img.shields.io/badge/%E2%96%B6%20Essayer%20la%20d%C3%A9mo%20en%20ligne-6C63FF?style=for-the-badge" alt="Essayer la démo en ligne" height="40" /></a>
</p>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=fr"><strong>▶ Démo en ligne</strong></a> ·
  <a href="#installation">Installer</a> ·
  <a href="#premiers-pas">Essayer</a> ·
  <a href="docs/guide-fr.md">Guide complet</a> ·
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">Démo vidéo</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">
    <img src="https://img.youtube.com/vi/_MbcDL5JaTE/maxresdefault.jpg" alt="Voir la démo vidéo d'Owlnest" width="700" />
  </a>
</p>

Owlnest est une carte Home Assistant qui affiche votre logement en 3D. Les lumières du modèle suivent vos vraies lampes : allumage, couleur et intensité. Vous pouvez aussi y placer vos capteurs et faire bouger les portes ou les volets selon leur état.

**Dessinez votre maison directement dans la carte :** pièces, portes et fenêtres, étages et escaliers, meubles, puis choisissez un style. Pas de Blender, aucun modèle à faire ailleurs. Vous avez déjà un fichier Sweet Home 3D ? Déposez-le sur la carte, il devient un plan modifiable.

<p align="center">
  <img src="assets/lights.gif" alt="Des lampes allumées depuis des tuiles de Home Assistant éclairent leurs pièces dans la maison 3D, au crépuscule" width="800" />
</p>

## Pourquoi Owlnest ?

Les solutions de plan 3D pour Home Assistant reposent sur des rendus Blender statiques : une image par état de lumière, un nouveau rendu à chaque couleur ou condition. Rien d'interactif, rien de vivant.

J'ai voulu autre chose : des lumières 3D temps réel, un éditeur visuel, de la météo, des animations. Tout ce que j'aurais aimé trouver. Et je me suis dit que d'autres étaient peut-être dans le même cas, alors j'ai partagé.

Une maison de démo est fournie pour essayer la carte avec vos propres lumières, même si vous n'avez pas encore de modèle.

> **Bêta :** le projet est encore en développement, il reste des bugs et des réglages peuvent changer. Si vous avez un souci, vous pouvez le signaler dans les [issues](https://github.com/MestrieEsteban/ha-owlnest/issues).

## Fonctionnalités

| Fonctionnalité | Détail |
|---|---|
| Dessin | Un éditeur de plan dans la carte : pièces, murs, portes, fenêtres, limites pour les pièces ouvertes, modèles de logement, une image à décalquer et plus de 200 meubles. |
| Étages et escaliers | Plusieurs étages empilés en 3D ; escaliers droits, en L, en U ou en colimaçon, avec la trémie et le garde-corps à l'étage. |
| Apparence | Des styles de maison tout faits, des façades (enduit, brique, bois, pierre), un toit en pente, un jardin et un ciel qui suit la météo et l'heure. |
| Import | Déposez un fichier Sweet Home 3D (`.sh3d`, ou son export OBJ) ou un `.glb` sur la carte. Portes et fenêtres sont trouvées et réglées pour vous. |
| Lumières | Allumage, intensité et couleur synchronisés avec les entités `light.*`. |
| Portes et fenêtres | Battant, coulissant, oscillo-battant, déroulant, ou lecture des animations du GLB. |
| Capteurs | Valeurs affichées à l'endroit où vous placez les ancres. |
| Commandes | Clic sur une ancre pour piloter l'appareil, appui long pour ouvrir ses détails. L'action dépend du type d'entité. |
| Règles | Déplacement de la caméra, mise en évidence d'une ancre ou message selon l'état d'une entité. |
| Météo et soleil | Éclairage lié à `sun.sun`, pluie, neige, brouillard et orages liés à votre entité météo. |
| Murs | Murs debout avec le toit, coupés, fantômes ou baissés. |
| Navigation | Souris, tactile, une barre des pièces pour aller dans une pièce, et des points de vue enregistrés. |

Les ancres prennent en charge `light`, `switch`, `sensor`, `binary_sensor`, `cover`, `climate` et `media_player`. L'interface est disponible en français et en anglais.

## En action

Chaque séquence ci-dessous a été enregistrée dans un vrai Home Assistant, avec ses appareils de démonstration.

<table>
  <tr>
    <th colspan="2">Dessiner sa maison</th>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/draw.gif" alt="Partir d'un modèle, ajouter une fenêtre et pousser un mur dans l'éditeur de plan pendant que la 3D suit" width="800" /></td>
  </tr>
  <tr>
    <td colspan="2">Partez d'un modèle ou d'une page blanche, ajoutez portes et fenêtres, poussez les murs, choisissez les sols. La 3D suit pendant que vous dessinez. <a href="docs/guide-fr.md#dessiner-sa-maison">Guide du plan →</a></td>
  </tr>
  <tr>
    <th>Étages et escaliers</th>
    <th>Un style d'un clic</th>
  </tr>
  <tr>
    <td><img src="assets/floors.gif" alt="Ajouter un étage et un escalier en L, puis passer d'un étage à l'autre sur la carte" width="400" /></td>
    <td><img src="assets/look.gif" alt="Essayer des styles de maison tout faits, puis voir la maison avec son toit sous un ciel nuageux" width="400" /></td>
  </tr>
  <tr>
    <td>Ajoutez un étage et posez un escalier : l'étage du dessus reçoit sa trémie. <a href="docs/guide-fr.md#étages-et-escaliers">Guide des étages →</a></td>
    <td>Brique, bois, pierre ou enduit, un toit et un jardin. <a href="docs/guide-fr.md#apparence">Guide de l'apparence →</a></td>
  </tr>
  <tr>
    <th>Vos appareils, pièce par pièce</th>
    <th>Portes et fenêtres</th>
  </tr>
  <tr>
    <td><img src="assets/devices.gif" alt="Poser d'un clic chaque appareil de Home Assistant dans la pièce du même nom" width="400" /></td>
    <td><img src="assets/openings.gif" alt="Une porte d'entrée qui s'ouvre et se referme en 3D quand son interrupteur change dans Home Assistant" width="400" /></td>
  </tr>
  <tr>
    <td>Un clic pose les appareils de chaque pièce de Home Assistant dans la pièce du plan du même nom. <a href="docs/guide-fr.md#ancres">Guide des appareils →</a></td>
    <td>Une porte, une fenêtre ou un volet bouge avec son entité. <a href="docs/guide-fr.md#ouvrants">Guide des ouvrants →</a></td>
  </tr>
  <tr>
    <th>Pièces, vues et règles</th>
    <th>Météo, ciel et nuit</th>
  </tr>
  <tr>
    <td><img src="assets/rules.gif" alt="Aller dans une pièce depuis la barre des pièces, puis une règle de mouvement qui amène la caméra à l'entrée" width="400" /></td>
    <td><img src="assets/weather.gif" alt="Nuages, pluie, crépuscule et nuit sur la maison 3D, fenêtres éclairées" width="400" /></td>
  </tr>
  <tr>
    <td>Allez dans une pièce d'un toucher. Une règle peut amener la caméra à l'entrée quand quelqu'un arrive. <a href="docs/guide-fr.md#moteur-de-règles">Guide des règles →</a></td>
    <td>Le ciel suit votre entité météo et le soleil. La nuit, les pièces éclairées brillent de dehors. <a href="docs/guide-fr.md#environnement">Guide de l'environnement →</a></td>
  </tr>
</table>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=fr"><img src="https://img.shields.io/badge/%E2%96%B6%20Essayer%20la%20d%C3%A9mo-6C63FF?style=for-the-badge" alt="Essayer la démo en ligne" height="40" /></a>
</p>

## Installation

**Home Assistant 2024.1 ou supérieur est requis.** Owlnest s'installe comme une intégration et embarque sa carte Lovelace. La carte est déclarée automatiquement.

### Avec HACS

Le plus rapide : ces deux boutons ouvrent votre propre Home Assistant à la bonne page. [▶ Voir la vidéo d'installation](https://www.youtube.com/watch?v=iBREyrejHSo) (1 min 30, en anglais).

[![Ouvrir le dépôt Owlnest dans le HACS de votre Home Assistant.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=MestrieEsteban&repository=ha-owlnest&category=integration)

[![Ajouter l’intégration Owlnest à votre Home Assistant.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=owlnest)

1. Cliquez sur le premier bouton, confirmez l'ajout du dépôt, puis **Télécharger**.
2. **Redémarrez Home Assistant**.
3. Cliquez sur le second bouton et validez.
4. Rechargez le navigateur en forçant le cache avec **Ctrl+Maj+R** (**Cmd+Maj+R** sur macOS).

<details>
<summary><strong>Sans les boutons</strong></summary>

1. Dans **HACS**, ouvrez **⋮ → Dépôts personnalisés**.
2. Ajoutez `https://github.com/MestrieEsteban/ha-owlnest` et choisissez la catégorie **Intégration**.
3. Cherchez **Owlnest** dans HACS et téléchargez-le.
4. **Redémarrez Home Assistant**.
5. Allez dans **Paramètres → Appareils et services → Ajouter une intégration**, cherchez **Owlnest** et validez.
6. Rechargez le navigateur en forçant le cache avec **Ctrl+Maj+R** (**Cmd+Maj+R** sur macOS).

</details>

> Choisissez la catégorie **Intégration** dans HACS. La carte est livrée à l'intérieur de l'intégration : aucun téléchargement séparé ni ressource Lovelace à ajouter.

<details>
<summary><strong>Installation manuelle</strong></summary>

1. Téléchargez l'archive des sources de la [dernière version](https://github.com/MestrieEsteban/ha-owlnest/releases/latest).
2. Copiez son dossier `custom_components/owlnest/` dans le répertoire `config/custom_components/` de Home Assistant, en incluant le dossier `frontend/`.
3. Redémarrez Home Assistant.
4. Ajoutez **Owlnest** depuis **Paramètres → Appareils et services → Ajouter une intégration**.
5. Rechargez le navigateur en forçant le cache.

La carte et le modèle de démonstration sont inclus dans le dossier de l'intégration.

</details>

## Premiers pas

### Essayez la maison de démonstration

Après l'installation, modifiez un tableau de bord et ajoutez une carte **Manuelle** :

```yaml
type: custom:ha-3d-floorplan
scene_id: owlnest_demo
```

Sans `model_url`, Owlnest charge la maison incluse. Cliquez sur un repère **+** d'une lampe ou de la télévision, puis choisissez une de vos entités Home Assistant. La liaison est sauvegardée automatiquement.

Essayez d'allumer une lumière reliée. Vous pouvez aussi glisser pour tourner autour de la maison, utiliser la molette pour zoomer ou naviguer avec les gestes tactiles.

### Dessiner votre maison

1. Sur la carte, cliquez sur **Dessiner mon logement** (ou le crayon, puis l'onglet **Plan**).
2. Partez d'un modèle, d'une page blanche ou d'une image de votre plan. Tracez les pièces d'un glissé, posez portes et fenêtres sur les murs, poussez les murs à la bonne taille.
3. Ajoutez un étage depuis la barre des niveaux, et un escalier avec l'outil **Escalier**.
4. Nommez les pièces comme vos pièces de Home Assistant, puis dans **Appareils**, choisissez **Poser les appareils de chaque pièce**.
5. Dans **Apparence**, choisissez un style. Tout est enregistré au fur et à mesure.

### Vous avez déjà un fichier Sweet Home 3D ?

[▶ Voir la vidéo d'import](https://www.youtube.com/watch?v=4hBuNCvALFA) (2 min). Déposez votre fichier `.sh3d` sur la carte : il devient un plan modifiable, avec ses murs, ses pièces, ses portes, ses fenêtres, ses meubles et tous ses niveaux. L'export OBJ (**Vue 3D → Exporter au format OBJ**, en dossier, fichiers ou zip) marche toujours et garde le modèle exactement tel que dessiné. L'import demande un compte administrateur. [Guide d'import →](docs/guide-fr.md#importer-votre-plan)

<details>
<summary><strong>Utiliser un GLB fait ailleurs (Blender…)</strong></summary>

Vous pouvez glisser un `.glb` sur la carte de la même façon. Pour le servir vous-même, placez-le dans `config/www/models/` et indiquez-le dans la carte :

```yaml
type: custom:ha-3d-floorplan
scene_id: ma_maison
model_url: /local/models/maison.glb
```

Un plan importé depuis la carte passe devant `model_url`.

</details>

**Astuce d'édition :** dans le plan, des lettres choisissent les outils (**R** pièce, **M** mur, **P** porte, **F** fenêtre, **H** escalier, **N** meubles). Dans l'éditeur 3D, appuyez sur **G** pour déplacer l'appareil choisi, puis sur **X**, **Y** ou **Z** pour limiter le mouvement à un axe.

## Documentation

| Sujet | Guide |
|---|---|
| Dessiner pièces, murs, portes et meubles | [Dessiner sa maison](docs/guide-fr.md#dessiner-sa-maison) |
| Ajouter des étages et des escaliers | [Étages et escaliers](docs/guide-fr.md#étages-et-escaliers) |
| Choisir un style, un toit, un jardin et un ciel | [Apparence](docs/guide-fr.md#apparence) |
| Importer un plan Sweet Home 3D ou un GLB | [Importer votre plan](docs/guide-fr.md#importer-votre-plan) |
| Naviguer à la souris ou au tactile | [Navigation dans la scène](docs/guide-fr.md#navigation-dans-la-scène) |
| Configurer les appareils, les étiquettes et leur visibilité | [Ancres](docs/guide-fr.md#ancres) |
| Animer les portes, les volets ou les animations du GLB | [Ouvrants](docs/guide-fr.md#ouvrants) |
| Teinter ou montrer / cacher des objets selon les entités | [Effets](docs/guide-fr.md#effets) |
| Enregistrer des points de vue et passer de l'un à l'autre | [Vues caméra](docs/guide-fr.md#vues-caméra) |
| Faire réagir la vue aux états des entités | [Moteur de règles](docs/guide-fr.md#moteur-de-règles) |
| Relier le soleil et la météo | [Environnement](docs/guide-fr.md#environnement) |
| Ajuster les ombres, l'exposition et l'apparence de la scène | [Rendu et apparence](docs/guide-fr.md#rendu-et-apparence) |
| Retrouver les raccourcis ou la configuration de la carte | [Raccourcis clavier](docs/guide-fr.md#raccourcis-clavier-mode-édition) · [Référence YAML](docs/guide-fr.md#configuration-yaml-complète) |

## Dépannage

<details>
<summary><strong>« Custom element doesn't exist: ha-3d-floorplan »</strong></summary>

Vérifiez qu'Owlnest a été téléchargé comme une **Intégration** dans HACS, puis redémarrez Home Assistant et ajoutez-le dans **Paramètres → Appareils et services**. Rechargez ensuite le navigateur en forçant le cache.

Si le dépôt a été ajouté dans une autre catégorie, retirez cette entrée de HACS et ajoutez-la à nouveau comme **Intégration**. Pour une installation manuelle, vérifiez la présence de `custom_components/owlnest/frontend/ha-3d-floorplan.js`.

</details>

<details>
<summary><strong>Mon modèle ne s'affiche pas</strong></summary>

Si vous avez glissé votre plan sur la carte et qu'elle indique que l'intégration n'accepte pas les imports, mettez Owlnest à jour dans HACS et redémarrez Home Assistant.

Si vous servez le modèle vous-même, vérifiez que `config/www/models/maison.glb` est accessible à l'adresse `/local/models/maison.glb` sur votre instance Home Assistant. Le nom du fichier et `model_url` doivent correspondre. Pour un GLTF, les textures et fichiers binaires référencés doivent aussi être accessibles à leurs chemins relatifs.

Si le fichier est accessible mais ne se charge toujours pas, consultez l'erreur dans la console du navigateur.

</details>

<details>
<summary><strong>Une lumière ne répond pas, ou les modifications ne se sauvegardent pas</strong></summary>

Pour les lumières, vérifiez que l'ancre est reliée à la bonne entité `light.*` et que celle-ci est disponible dans **Outils de développement → États**.

Pour la sauvegarde, vérifiez que l'intégration Owlnest est active et qu'une scène est sélectionnée avec un `scene_id`. L'indicateur de l'éditeur précise si les modifications sont sauvegardées. Consultez la console du navigateur pour repérer les erreurs WebSocket en cas d'échec.

</details>

<details>
<summary><strong>La scène est lente, ou l'échelle semble incorrecte</strong></summary>

Dans **Réglages → Performance**, baissez le niveau de qualité, et activez **Afficher les performances** pour voir si l'appareil suit. Pour un modèle importé, réduisez son nombre de polygones et la taille de ses textures.

Les modèles peuvent être en mètres, centimètres ou pouces : les effets qui dépendent des distances s'adaptent à la taille globale du modèle. Si les objets sont disproportionnés entre eux, corrigez-les dans votre logiciel 3D avant l'export.

</details>

## Contribuer

Pour signaler un bug ou proposer une fonctionnalité, [ouvrez une issue](https://github.com/MestrieEsteban/ha-owlnest/issues). En cas de bug, ajoutez vos versions de Home Assistant et d'Owlnest, les étapes pour le reproduire et les erreurs du navigateur s'il y en a.

Pour travailler sur le code, consultez [DEVELOPMENT.md](DEVELOPMENT.md) : installation locale, vérifications et développement avec Home Assistant.

## Licence et crédits

[MIT](LICENSE) · Esteban Mestrie.

La maison de démonstration et le catalogue de meubles utilisent le [Furniture Kit](https://kenney.nl/assets/furniture-kit) de [Kenney](https://kenney.nl) et le pack [Ultimate Home Interior](https://quaternius.com/packs/ultimatehomeinterior.html) de Quaternius, tous publiés sous CC0.
