---
tags: [fonctionnalite, rendu]
---

# Vues des murs

Bouton 🏠/🧱/👻/⬇️ de la carte, plans seulement : un petit menu propose **murs debout, murs coupés, murs fantômes, murs bas**. Code : `src/plan/low-walls.ts`, morceaux d'angle dans `build.ts` (`cornerStops` de `footprint.ts`). Choix retenu par appareil (`owlnest_low_walls`, 0 à 3).

## Ce qu'on sait des Sims (recherche du 9 octobre 2026)

Aucune explication officielle de l'algorithme. Ce qui se recoupe dans les sources publiques (forums EA, Steam, SimsVIP, fils de modding) :

- trois vues dans les Sims 3 et 4 : murs debout, coupés, bas ;
- la vue coupée « cache tous les murs entre le point de vue et le mur du fond » (SimsVIP) : le fond et les côtés restent ;
- là où un mur coupé rejoint un mur debout, **un bout de mur entier reste visible** à la jonction ; aucune source ne parle de pente ;
- les petites pièces et les dispositions inhabituelles donnent des résultats moins prévisibles, même dans le jeu ;
- les objets muraux disparaissent avec les murs coupés.

Dans la capture de référence d'Esteban, le **dessus** d'un mur coupé est blanc, pas foncé.

## Les règles retenues

**Quels murs.** Un mur descend s'il **fait face à la caméra** (moins de ~70° de sa normale, remonte au-delà de ~75°) **et cache une pièce** (une pièce derrière lui, cherchée jusqu'à 1 m pour passer un mur doublé). Vu d'en haut, rien ne descend.

**Petits murs** (moins de 60 cm) :
- un segment court suit les segments alignés qui le prolongent ;
- un petit mur dont tous les voisins sont coupés (ou libre d'un côté) est coupé avec eux. Relié à un mur debout, il reste : on ne perce jamais l'enveloppe qui reste.

**Jonctions.** Le morceau d'onglet au bout d'un mur appartient à l'angle. Il est construit à part et marqué (fraction 0,25 ou 0,5 du code `owlnestWall`). Quand le mur est coupé mais qu'un voisin à ce bout reste debout, ce morceau reste entier : le mur debout garde un angle complet, le mur coupé s'arrête net contre lui.

**Objets.** Partent avec leur mur : ce qui est accroché au-dessus de la coupe et posé sur rien, ce qui est posé dessus, et les objets **fins et hauts posés au sol** contre le mur (profondeur ≤ 35 cm : rideaux, étagère murale, radiateur). Un meuble profond (armoire, buffet) et ce qui est posé sur un meuble restent toujours.

**Fantôme.** Mêmes murs ; le mur n'est pas dessiné, un voile translucide (seconde passe, sans écriture de profondeur) le remplace. Portes, fenêtres et angles gardés restent entiers ; l'ombre du mur reste.

## Essais écartés

> [!danger] La pente aux jonctions
> Trois versions, toutes rejetées par Esteban (« catastrophique ») : pente sur le mur debout (pointes triangulaires sur les murs courts), pente jusqu'en haut sur le mur coupé (des « ailes »), chanfrein à 45°. En plus, le dessus d'un mur d'un seul tenant était triangulé d'un bout à l'autre : la pente s'étalait en biais sur toute la longueur. Les Sims n'ont pas de pente : un angle net suffit.

> [!warning] Décider au point visé
> La première règle abaissait les murs « devant le point visé ». Elle laissait debout les cloisons face à la caméra derrière ce point et abaissait des murs de côté dont le milieu tombait à peine devant. La règle « fait face et cache une pièce » ne dépend plus du point visé.

> [!warning] Le poché foncé sur le dessus
> Ajouté puis retiré : sous le soleil du dessus, un gris moyen paraît presque aussi clair que les côtés, et les Sims ont un dessus clair.

> [!note] Le côté du mur pour les rideaux
> Cacher un objet fin seulement « du côté de la caméra » était faux : les rideaux d'une façade sont à l'intérieur, donc de l'autre côté, et ce sont eux qui bouchent la vue. Un objet mural contre un mur coupé est au bord de la pièce qu'on regarde, quelle que soit la face.

## Vérifier

Planches contact : 8 angles (tous les 45°) par plan et par vue, MaisonHA, modèle T3, cuisine1. Script de banc dans le dossier temporaire de session (`views.mjs` + `sheet.py`), à recréer si besoin : importer, `card._setWallView(vue)`, caméra en orbite à `1,25 × envergure`, élévation 0,62 rad.

Coût : 2 à 3 appels de dessin de plus selon la vue (MaisonHA, 97 de base). Voir [[Performance]].
