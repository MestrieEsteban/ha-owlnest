---
tags: [architecture]
---

# Descripteurs

`src/entities/descriptors.ts` — **source de vérité unique** sur la sémantique d'une entité Home Assistant.

Couvre **32 domaines** et **24 `device_class` de `binary_sensor`**.

## Le contrat

```ts
interface EntityDescriptor {
  overlay: 'icon' | 'badge' | 'thumbnail';
  tap: TapAction;
  isOn(s?: HassState): boolean;
  level(s?: HassState): number;      // 0..1
  color(s?: HassState): number;
  icon(s?: HassState): string | undefined;
  stateText(s?: HassState): string;
}
```

Le principe : les descripteurs disent **quoi** affiche une entité ; les natures d'[[Ancres]] disent **comment** elle se présente.

## Pourquoi cette centralisation

Avant, chaque site de rendu devinait. 33 domaines testés dans une roue d'actions : **19 s'affichaient mal, 0 après**.

Et c'est le seul endroit qui sait qu'un `binary_sensor` répondant `on` signifie « ouvert » pour un `device_class: door` mais « détecté » pour un détecteur de fumée. Une table d'états écrite ailleurs ignorerait fatalement ces 24 cas.

## Le piège

> [!danger] `isOn` ne veut pas dire « ouvert »
> ```ts
> const sensor: EntityDescriptor = {
>   isOn: () => true,   // ← src/entities/descriptors.ts
>   level: () => 1,
> };
> ```

C'est **juste** pour l'usage d'origine : un badge de capteur est toujours affiché, un capteur est toujours « actif ».

Lu comme une ouverture, c'est désastreux — une porte liée à `sensor.temperature` reste **béante et insensible à tout**. C'est exactement le symptôme qu'a signalé l'utilisateur.

D'où, dans [[Ouvrants]], une liste **fermée** de domaines qui ont une notion d'ouverture :

```
cover · valve · lock · binary_sensor · switch · light · input_boolean · fan · group
```

Hors de cette liste : l'ouvrant reste **fermé** et l'éditeur réclame un choix explicite d'états.

> [!note] Leçon générale
> Un prédicat commode se fait réutiliser dans un contexte où son nom ment. Avant de brancher `isOn` sur un nouvel usage, se demander ce qu'il signifie **pour chacun des 32 domaines**, pas seulement pour celui qu'on a sous les yeux.

## Fonctions utilitaires

- `describeEntity(entityId)` — le descripteur, avec repli.
- `fallbackIcon(domain)`
- `knownStates(entityId, currentState?)` — alimente les sélecteurs d'états de l'éditeur.
- `stateLabel(entityId, state, attributes)` — « Ouverte » et non « on ». **Les attributs réels sont nécessaires** : c'est `device_class` qui distingue une porte d'un détecteur.

## Extension

Ajouter un domaine se fait à la main dans ce fichier. L'utilisateur ne peut pas définir ses propres comportements — limite connue et assumée pour l'instant.
