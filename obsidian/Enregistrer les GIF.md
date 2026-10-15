---
tags: [outillage]
---

# Enregistrer les GIF et la vidéo de sortie

Mis en place le 14 octobre 2026 pour la 2.0. Tout ce qui est montré dans le README et la vidéo a été filmé dans un **vrai Home Assistant**, avec ses appareils de démonstration : rien qu'un utilisateur ne verrait pas.

## Le Home Assistant de test

Dans `dev/ha-test/` (ignoré par git : le motif `*test` du `.gitignore` l'attrape, les identifiants générés y restent).

- Docker : image officielle `ghcr.io/home-assistant/home-assistant:stable`, conteneur `owlnest-ha`, port **8124**. `config/` est monté, l'intégration `custom_components/owlnest` aussi (la carte de production reconstruite par `npm run build` est donc servie telle quelle).
- `config/configuration.yaml` : `demo:` (lampes, volets, météo factices), deux `input_boolean` (porte d'entrée, mouvement du couloir) et leurs `binary_sensor` modèles.
- `setup.mjs` : compte de test (mot de passe aléatoire dans `credentials.local.json`), fin de l'accueil, jeton longue durée (`token.local`), intégration Owlnest, pièces. `areas.mjs` range les entités de démo dans les pièces du modèle « House ». `dashboard.mjs` crée le tableau de bord « My home » (la carte + des tuiles).

## L'enregistreur

`node --experimental-websocket dev/ha-test/rec.mjs <scène> [--keep]` : Chromium sans interface, connecté d'avance par le jeton, capture continue (CDP screencast) avec l'heure de chaque image, puis MP4 à cadence fixe par le ffmpeg fourni avec Remotion. Un faux curseur et un cercle au clic rendent les gestes visibles. Les scènes sont dans `dev/ha-test/scenes/` (draw, devices, lights, look, floors, openings, rules, weather) ; `s.card(js)` exécute du code dans la page avec la carte sous la main, `s.tile(entity)` trouve une tuile de Home Assistant, `s.simulate(heure, météo)` pose l'heure et le temps.

`gifs.mjs` tire les GIF de `assets/` (coupes et accélérations par prise) ; `sheet.py` fait une planche contact pour vérifier une prise d'un coup d'œil.

## Pièges rencontrés

- Le frontend de Home Assistant **recharge la page** quand son service worker change de main : dans un navigateur automatisé, la page se rechargeait au milieu d'une prise. `serviceWorkers: 'block'` dans le contexte.
- Chromium bloque le websocket vers `localhost` (contrôle d'accès au réseau local) : drapeau `--disable-features=LocalNetworkAccessChecks,…`.
- patchright isole `page.evaluate` du monde de la page : pour toucher la carte, on injecte un `<script>` (voir `s.card`).
- Le ffmpeg de Remotion est minimal : ni `setpts` ni `fps`. Accélérer avec `-itsscale`, fixer la cadence avec `-r`.
- La capture n'émet une image que quand l'écran change : la durée de chaque image vient de l'heure de la suivante, et la dernière tient jusqu'à l'arrêt.

## La vidéo de sortie

`video/src/release/Release2.tsx` (composition `Release2`, 1920 × 1080, 30 i/s) : titre, huit chapitres (une fenêtre arrondie porte chaque prise, titre, compteur, fil de progression), chute « Available now ». Les prises sont copiées dans `video/public/v2/`. Rendu : `npx remotion render Release2 out/owlnest-2.0.mp4 --codec=h264 --crf=20` (1 min 29).
