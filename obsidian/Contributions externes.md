# Contributions externes

Octobre 2026 : neuf PR de Roberto (cacharritos), écrites sur la 1.5.4, intégrées en local dans la 2.0 par des fusions `--no-ff` (une par PR, `merge: #N ...`).

## Ce qui a demandé un arbitrage

- **Survol pendant un choix d'objet** : trois systèmes coexistaient (v2 `_queuePickHover`, lumières `_handlePartPickHover`, effets `_updatePickHover`). On garde celui de la v2 pour les ouvrants et les effets, celui des lumières en mode `lightHost`. Celui des effets a été retiré.
- **Arbre des objets** (`_partObjectSection`) : la multi-sélection des lumières (`multiSelect`) et les cibles en plus des effets (`extraFollowers`, `onModClick`, `hint`) vivent ensemble.
- **Lumières** : `animateLights` boucle sur toutes les lumières d'une ancre, en gardant les deux règles de la v2 (étage masqué éteint, `owlnestReal` pour ne pas recompiler les shaders).
- **Reflets** : rangés dans Look, Ciel et lumière, un interrupteur et les réglages fins seulement quand il est allumé (voir [[Interface]]).
- **Effets** : un onglet à part, après Ouvrants.
- **Chargement du modèle** : la garde `try/catch` de #18 est reposée sur le `_loadModel` de la v2, pas sur celui de la PR.

## Restes à reprendre

- Les fenêtres des effets et des lumières flottent au milieu, dans l'ancien style ; la v2 met tout dans le panneau de droite.
- La fenêtre des lumières répète l'intensité et le style déjà présents dans la fiche de l'appareil.
- Les PR visant `hotfix-1.5.4` (et #14, #15, qui ne sont pas des ancêtres de #16) ne se fermeront pas seules en poussant `main`.
