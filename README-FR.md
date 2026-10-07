<p align="center">
  <img src="assets/logo.svg" alt="Owlnest" width="200" />
</p>

<h1 align="center">Owlnest</h1>

<p align="center">
  <strong>Votre maison en 3D, directement dans Home Assistant.</strong><br/>
  Chargez un modèle 3D, placez vos appareils, contrôlez tout en temps réel.
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/Home%20Assistant-2024.1%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white" alt="Home Assistant" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/HACS-Custom-FF6F00?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white" alt="HACS" /></a>
  <a href="https://github.com/MestrieEsteban/ha-owlnest/releases/latest"><img src="https://img.shields.io/github/v/release/MestrieEsteban/ha-owlnest?style=for-the-badge&color=6C63FF" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MestrieEsteban/ha-owlnest?style=for-the-badge&color=22C55E" alt="License" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/statut-beta-orange?style=for-the-badge" alt="Beta" />
</p>

<p align="center">
  <a href="#-fonctionnalités">Fonctionnalités</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-démarrage-rapide">Démarrage rapide</a> •
  <a href="#-guide-complet">Guide complet</a> •
  <a href="#-faq">FAQ</a>
</p>

<p align="center">
  🌐 <a href="README.md"><strong>English version available here</strong></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">
    <img src="https://img.youtube.com/vi/_MbcDL5JaTE/maxresdefault.jpg" alt="Voir la démo" width="700" />
  </a>
</p>

---

> **⚠️ Beta** — Owlnest est en développement actif. Des fonctionnalités peuvent changer et des bugs peuvent apparaître. Vos retours et signalements sont les bienvenus via les [Issues](https://github.com/MestrieEsteban/ha-owlnest/issues).

## 💬 Pourquoi Owlnest ?

Les solutions de plan 3D pour Home Assistant reposent sur des rendus Blender statiques une image par état de lumière, un nouveau rendu à chaque couleur ou condition. Rien d'interactif, rien de vivant.

J'ai voulu autre chose des lumières 3D temps réel, un éditeur visuel, de la météo, des animations. Tout ce que j'aurais aimé trouver. Et je me suis dit que d'autres étaient peut-être dans le même cas, alors j'ai partagé.

<p align="center">
  <img src="assets/OnOffLight.gif" alt="Démo contrôle des lumières en temps réel" width="700" />
</p>

---

## ✨ Fonctionnalités

| | Fonctionnalité | Description |
|---|---|---|
| 🏠 | **Scène 3D interactive** | Chargez n'importe quel modèle GLB/GLTF et naviguez librement avec la souris ou le tactile |
| 💡 | **Lumières synchronisées** | Vos entités `light.*` pilotent de vraies lumières 3D — couleur, intensité, transitions fluides |
| 📍 | **Ancres interactives** | Tap pour allumer/éteindre, appui long pour les détails. Compatible : lumières, capteurs, volets, climat, media players |
| 🚪 | **Ouvrants animés** | Portes, fenêtres, volets et portes d'électroménager pivotent ou coulissent, stores et rideaux se déroulent, et les animations du GLB (NLA de Blender) se jouent, selon l'état de leur entité |
| 👁️ | **Voir à travers les murs** | Le mur qui bouche la vue s'efface pendant que vous tournez autour, et se reforme derrière |
| 📐 | **N'importe quelle unité** | Mètres, centimètres, pouces : distances, lumières et météo se déduisent de la taille du modèle |
| 🎥 | **Vues caméra** | Sauvegardez des points de vue nommés et naviguez entre eux avec une transition animée |
| ⚡ | **Moteur de règles** | *Mouvement détecté → voler vers la pièce*, *Porte ouverte → afficher un panneau* |
| 🌦️ | **Météo dynamique** | Soleil réaliste depuis `sun.sun`, pluie/neige/brouillard/éclairs depuis votre entité météo |
| 🎨 | **Éditeur visuel** | Tout se configure dans la scène, sans écrire de YAML |
| 🌍 | **Multilingue** | Français et anglais inclus |

---

## 📦 Installation

Owlnest est une intégration Home Assistant qui embarque sa propre carte Lovelace.
Vous installez une seule chose ; la carte est servie et déclarée pour vous.

### Via HACS (recommandé)

[HACS](https://hacs.xyz) doit être installé au préalable. Owlnest n'est pas encore
dans le magasin par défaut : on l'ajoute comme dépôt personnalisé.

> **1. Ouvrir la fenêtre des dépôts personnalisés**
>
> Cliquez sur **HACS** dans la barre latérale, puis sur le menu **⋮** en haut à
> droite de la page, et choisissez **Dépôts personnalisés**.
>
> **2. Ajouter ce dépôt**
>
> Collez `https://github.com/MestrieEsteban/ha-owlnest` dans le champ du dépôt.
>
> Dans le champ type/catégorie, choisissez **Intégration** — ni Tableau de bord,
> ni Plugin. C'est déterminant : HACS n'installe qu'une catégorie par dépôt, et
> Owlnest livre sa carte *à l'intérieur* de l'intégration. Tout autre choix n'en
> installe que la moitié.
>
> Cliquez sur **Ajouter**. La fenêtre se ferme et Owlnest apparaît dans la liste.
>
> **3. Le télécharger**
>
> Cherchez **Owlnest** dans HACS, ouvrez-le, puis cliquez sur **Télécharger**.
> HACS copie les fichiers dans `config/custom_components/owlnest/`, carte comprise.
>
> **4. Redémarrer Home Assistant**
>
> **Paramètres → Système**, puis l'icône d'alimentation en haut à droite →
> **Redémarrer Home Assistant**. Une intégration fraîchement téléchargée n'est
> prise en compte qu'au redémarrage.
>
> **5. Ajouter l'intégration**
>
> **Paramètres → Appareils et services → Ajouter une intégration**, cherchez
> **Owlnest** et validez. Il n'y a rien à configurer.
>
> **6. Recharger le navigateur en forçant le cache**
>
> **Ctrl+Maj+R** (**Cmd+Maj+R** sur macOS). Le navigateur garde encore la page
> d'avant l'installation, et afficherait sinon
> `Custom element doesn't exist: ha-3d-floorplan`.

Aucune ressource Lovelace à déclarer. L'intégration sert elle-même la carte, qui
est donc toujours à la version du backend.

> **Déjà ajouté avec la mauvaise catégorie ?** Retirez le dépôt de HACS,
> supprimez `config/custom_components/owlnest/` s'il subsiste, puis reprenez à
> l'étape 1 en choisissant **Intégration**.

### Installation manuelle

> 1. Téléchargez les sources de la [dernière version](https://github.com/MestrieEsteban/ha-owlnest/releases/latest)
> 2. Copiez `custom_components/owlnest/` dans `config/custom_components/owlnest/`
> 3. **Redémarrez** Home Assistant
> 4. Ajoutez l'intégration : **Paramètres → Appareils & Services → Ajouter → Owlnest**
>
> La carte est livrée dans ce dossier : aucun fichier JavaScript à placer, aucune
> ressource Lovelace à déclarer.
>
> Puis **rechargez le navigateur en forçant le cache** (Ctrl+Maj+R), même raison.

### Prérequis

- Home Assistant **2024.1** ou supérieur
- Un modèle 3D au format **GLB** ou **GLTF** (exporté depuis Blender, Sweet Home 3D, SketchUp, etc.)

---

## 🚀 Démarrage rapide

### 1. Préparer votre modèle 3D

Placez votre fichier `.glb` dans le dossier `config/www/models/` de votre instance HA.

### 2. Ajouter la carte

Dans n'importe quel tableau de bord, ajoutez une carte manuelle :

```yaml
type: custom:ha-3d-floorplan
scene_id: ma_maison
model_url: /local/models/maison.glb
```

### 3. Placer vos appareils

1. Cliquez sur l'icône **✏️ crayon** pour entrer en mode édition
2. Dans l'onglet **Anchors**, cliquez **+ Ajouter**
3. Choisissez une entité (ex: `light.salon`)
4. Cliquez dans la scène pour placer l'ancre
5. Cliquez **💾 Sauvegarder**

> **Astuce** : Utilisez la touche **G** pour déplacer une ancre librement (style Blender), puis **X**, **Y** ou **Z** pour contraindre le mouvement à un axe.

---

## 📖 Guide complet

Tout sur l'éditeur, les ouvrants, les vues caméra, les règles et le rendu se trouve dans le **[guide complet](docs/guide-fr.md)** :

- [Navigation dans la scène](docs/guide-fr.md#navigation-dans-la-scène)
- [Ancres](docs/guide-fr.md#ancres)
- [Ouvrants](docs/guide-fr.md#ouvrants)
- [Vues caméra](docs/guide-fr.md#vues-caméra)
- [Moteur de règles](docs/guide-fr.md#moteur-de-règles)
- [Environnement](docs/guide-fr.md#environnement)
- [Rendu et apparence](docs/guide-fr.md#rendu-et-apparence)
- [Raccourcis clavier (mode édition)](docs/guide-fr.md#raccourcis-clavier-mode-édition)
- [Configuration YAML complète](docs/guide-fr.md#configuration-yaml-complète)

---

## ❓ FAQ

<details>
<summary><strong>Où trouver un modèle 3D de ma maison ?</strong></summary>

Vous pouvez créer votre modèle avec :
- **Sweet Home 3D** (gratuit, simple) → exporter en OBJ puis convertir en GLB avec Blender
- **Blender** (gratuit, avancé) → exporter directement en GLB
- **SketchUp** (freemium) → exporter via plugin GLTF
- **Floorplanner.com** (en ligne) → exporter et convertir

Le format recommandé est **GLB** (GLTF binaire) pour des performances optimales.
</details>

<details>
<summary><strong>Mon modèle ne s'affiche pas</strong></summary>

- Vérifiez que le fichier est bien dans `config/www/` et accessible via `/local/...`
- Vérifiez l'URL dans la config (pas d'espace, bonne extension)
- Ouvrez la console du navigateur (F12) pour voir les erreurs
- Testez votre fichier GLB sur [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/) pour vérifier qu'il est valide
</details>

<details>
<summary><strong>Les lumières ne répondent pas</strong></summary>

- L'ancre doit être liée à une entité de domaine `light.*`
- Vérifiez que l'entité existe dans Home Assistant (**Outils de développement → États**)
- Assurez-vous que l'intégration Owlnest est bien installée et active
</details>

<details>
<summary><strong>La scène ne se sauvegarde pas</strong></summary>

- L'intégration backend doit être installée : **Paramètres → Appareils & Services** → vérifiez que **Owlnest** apparaît
- Un `scene_id` doit être défini dans la configuration de la carte
- Vérifiez la console du navigateur pour d'éventuelles erreurs WebSocket
</details>

<details>
<summary><strong>Puis-je avoir plusieurs scènes ?</strong></summary>

Oui ! Chaque carte peut avoir un `scene_id` différent. Vous pouvez avoir une scène par étage, par pièce, ou par bâtiment.
</details>

<details>
<summary><strong>Le modèle est trop gros / trop petit</strong></summary>

Owlnest utilise les unités du modèle 3D telles quelles. Si votre modèle est à l'échelle dans Blender (1 unité = 1 mètre), il sera à la bonne taille. Sinon, redimensionnez-le dans votre logiciel 3D avant export.
</details>

<details>
<summary><strong>Puis-je utiliser des icônes MDI personnalisées ?</strong></summary>

Oui ! Dans les propriétés d'une ancre, renseignez le champ `icon` avec n'importe quelle icône MDI (ex: `mdi:thermometer`, `mdi:door-open`). La liste complète est sur [pictogrammers.com/library/mdi](https://pictogrammers.com/library/mdi/).
</details>

<details>
<summary><strong>La performance est mauvaise</strong></summary>

- Réduisez la complexité de votre modèle 3D (nombre de polygones)
- Désactivez les ombres (`shadows: false`)
- Désactivez le ciel atmosphérique (`sky: false`)
- Fermez les effets météo si inutilisés
</details>

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une [issue](https://github.com/MestrieEsteban/ha-owlnest/issues) pour signaler un bug ou proposer une fonctionnalité.

---

## 📄 Licence

[MIT](LICENSE) — Esteban Mestrie
