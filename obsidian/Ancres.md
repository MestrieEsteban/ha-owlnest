---
tags: [fonctionnalite]
---

# Ancres

Pastilles posées dans l'espace 3D, liées à une entité. Le cœur de la carte.

## Natures

Orthogonales au domaine de l'entité — voir [[Descripteurs]] pour la distinction *quoi* / *comment*.

| nature | rôle |
|---|---|
| `entity` | pastille d'état classique (défaut) |
| `label` | texte ancré, sans entité |
| `menu` | roue d'actions : entités, services, vues |
| `nav` | vol vers une vue caméra enregistrée |

Seule `entity` exige un `entity` renseigné. Le champ reste de type `string` et vaut `''` pour les autres : le rendre optionnel ferait remonter `string | undefined` dans une trentaine de sites sans rien apporter.

## Présentations

`overlay: 'icon' | 'badge' | 'thumbnail'`, décidé par le descripteur, avec surcharge possible (`display: 'auto' | 'icon' | 'thumbnail'`).

Une caméra s'affiche en **vignette du flux** par défaut, ramenable à une simple pastille.

## Ancres caméra

Le point de vue de la caméra est projeté dans la scène. Deux corrections nécessaires :

> [!warning] Le modèle est en centimètres
> Une largeur demandée en mètres était toujours écrêtée. Les tailles sont **relatives à l'envergure du modèle** (`size`, 1 = référence), jamais en unités absolues — l'utilisateur n'a pas à connaître l'unité de son GLB. Voir [[Modele 3D]].

Rafraîchissement du flux cadencé par le profil de qualité (`cameraRefreshMs`), voir [[Performance]].

Sur l'instance de test : 5 caméras, dont **2 répondent HTTP 500** et une pèse 177 Ko par image.

## Le sélecteur d'entités

`src/entities/picker.ts` — construit sur les registres HA (`src/entities/registry.ts`).

- Groupé **Étage · Pièce**, puis Appareil, puis Type.
- Recherche sur nom, `entity_id`, pièce et appareil.
- État en direct par ligne, marqueurs « déjà placée », multi-sélection, navigation clavier.
- **« Sans pièce » toujours en bas** : les pièces d'abord.
- `areaOf` hérite de la pièce de l'appareil quand l'entité n'en déclare pas.
- `isTechnical` écarte `config` et `diagnostic`.

`registry.ts` détecte `hass.areas/devices/entities/floors` et retombe sur les commandes WebSocket `config/*_registry/list` sur les frontends plus anciens.

Mesuré sur l'instance réelle : **469 états, 809 entrées de registre, 97 appareils, 13 pièces, 3 étages**.

C'est une **modale `<dialog>`**, pour pouvoir s'ouvrir par-dessus la fenêtre de [[Regles]]. Voir [[Pieges]].

## Décidé de ne pas faire

Le **glisser-déposer** dans le sélecteur. La pose se fait déjà au clic dans la scène ; le gain était nul pour une complexité réelle.

## Ouvert

- Les badges **traversent les murs** (pas d'occlusion des overlays).
- Les étiquettes sont **invisibles au toucher** — l'infobulle est au survol, et une tablette murale n'a pas de survol. Approche non tranchée.
- Mise à l'échelle selon la distance.
- Regroupement par pièce, qui permettrait de retirer `cluster_threshold`.

Voir [[Chantiers ouverts]].
