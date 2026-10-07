# -*- coding: utf-8 -*-
"""Assemble la maison de démonstration à partir du Furniture Kit de Kenney (CC0).

Le kit fournit des tuiles de sol, des murs et des meubles sur une grille d'une
unité. On les pose ici, pièce par pièce, et on les fusionne en un seul GLB
avec `merge-glb.py` : chaque pièce garde ses matériaux et ses nœuds, ce qui
laisse la porte et la fenêtre détachables comme ouvrants.

Usage :
  python scripts/build-demo-house.py <dossier des .glb Kenney> <sortie.glb>

Le kit se télécharge sur https://kenney.nl/assets/furniture-kit (CC0, mention
facultative) : on en extrait `Models/GLTF format/*.glb`.

Repère : x vers la droite, z vers l'arrière (négatif), y vers le haut. Une
cellule (i, j) occupe x de i à i+1 et z de -j à -j-1.
"""
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('merge_glb', os.path.join(HERE, 'merge-glb.py'))
merge_glb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge_glb)

W, D = 5, 4          # largeur et profondeur, en cellules


def footprint(src, model):
    """Boîte d'un modèle dans son repère : (xmin, zmin, xmax, zmax, hauteur)."""
    gltf, _ = merge_glb.read(os.path.join(src, model + '.glb'))
    lo, hi = [1e9] * 3, [-1e9] * 3
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            acc = gltf['accessors'][prim['attributes']['POSITION']]
            for k in range(3):
                lo[k] = min(lo[k], acc['min'][k])
                hi[k] = max(hi[k], acc['max'][k])
    return lo[0], lo[2], hi[0], hi[2], hi[1]


def turned(box, yaw):
    """Boîte au sol après rotation autour de la verticale (multiples de 90°)."""
    x0, z0, x1, z1, _ = box
    corners = [(x0, z0), (x1, z0), (x0, z1), (x1, z1)]
    c, sn = round(math.cos(math.radians(yaw))), round(math.sin(math.radians(yaw)))
    pts = [(x * c + z * sn, -x * sn + z * c) for x, z in corners]
    xs, zs = [q[0] for q in pts], [q[1] for q in pts]
    return min(xs), min(zs), max(xs), max(zs)


def put(src, model, px, pz, yaw, name):
    """Pose un meuble par son emprise au sol.

    `px` est le bord gauche, `pz` la profondeur du bord sud depuis le mur sud :
    on raisonne sur le plan, pas sur l'origine propre à chaque modèle du kit.
    Orientation : 0 regarde le sud, 90 l'est, 180 le nord, 270 l'ouest.
    """
    x0, z0, x1, z1 = turned(footprint(src, model), yaw)
    # Le bord sud du meuble est son z le plus grand (z décroît vers le nord).
    return (model, px - x0, -pz - z1, yaw, name)


def plan(src):
    """La liste des pièces à poser : (modèle, x, z, angle en degrés, nom)."""
    p = []

    # Sol : une tuile par cellule.
    for i in range(W):
        for j in range(D):
            p.append(('floorFull', i, -j, 0, f'Sol_{i}_{j}'))

    # Murs. Un mur part de son origine vers +x ; tourné de 90°, il part vers -z.
    south = ['wall', 'wallDoorway', 'wall', 'wallWindow', 'wall']
    for i, m in enumerate(south):
        p.append((m, i, 0.05, 0, f'Mur_sud_{i}'))
    north = ['wall', 'wallWindow', 'wall', 'wall', 'wallWindow']
    for i, m in enumerate(north):
        p.append((m, i, -D, 0, f'Mur_nord_{i}'))
    for j in range(D):
        p.append(('wallWindow' if j in (1, 2) else 'wall', 0, -j, 90, f'Mur_ouest_{j}'))
        p.append(('wallWindow' if j == 1 else 'wall', W + 0.05, -j, 90, f'Mur_est_{j}'))

    # Cloison séjour / chambres, avec deux passages ; cuisine ouverte sur le séjour.
    for i in range(W):
        p.append(('wallDoorway' if i in (1, 3) else 'wall', i, -2, 0, f'Cloison_{i}'))
    for j in (2, 3):
        p.append(('wall', 3, -j, 90, f'Cloison_sdb_{j}'))

    # Les portes, dans les ouvertures des murs à passage.
    p.append(('doorway', 1.257, 0.05, 0, 'Porte_entree'))
    p.append(('doorway', 1.257, -2, 0, 'Porte_chambre'))
    p.append(('doorway', 3.257, -2, 0, 'Porte_sdb'))

    furniture = [
        # Séjour : télévision contre le mur ouest, canapé en face.
        ('rugRectangle', 0.75, 0.55, 90, 'Tapis'),
        ('cabinetTelevision', 0.08, 0.55, 90, 'Meuble_tele'),
        ('televisionModern', 0.12, 0.75, 90, 'Television'),
        ('tableCoffee', 1.1, 0.75, 90, 'Table_basse'),
        ('loungeSofa', 1.95, 0.55, 270, 'Canape'),
        ('lampRoundFloor', 2.0, 1.6, 0, 'Lampadaire_sejour'),
        ('pottedPlant', 2.55, 0.1, 0, 'Plante'),
        # Cuisine : plan de travail contre le mur est, table au milieu.
        ('kitchenFridge', 4.45, 0.08, 270, 'Frigo'),
        ('kitchenCabinet', 4.5, 0.62, 270, 'Cuisine_1'),
        ('kitchenSink', 4.5, 1.02, 270, 'Evier'),
        ('kitchenStove', 4.5, 1.42, 270, 'Cuisiniere'),
        ('tableRound', 3.25, 0.7, 0, 'Table'),
        ('chair', 3.05, 1.25, 180, 'Chaise_1'),
        ('chair', 3.5, 0.3, 0, 'Chaise_2'),
        ('lampSquareTable', 3.45, 0.85, 0, 'Lampe_cuisine'),
        # Chambre : lit contre le mur nord.
        ('bedDouble', 0.7, 2.05, 0, 'Lit'),
        ('sideTable', 0.12, 3.45, 0, 'Chevet'),
        ('lampRoundTable', 0.2, 3.55, 0, 'Lampe_chevet'),
        ('bookcaseOpen', 2.35, 3.6, 180, 'Bibliotheque'),
        # Salle de bain.
        ('bathtub', 3.1, 3.2, 180, 'Baignoire'),
        ('toilet', 4.15, 2.6, 270, 'Toilettes'),
        ('bathroomSink', 4.2, 2.08, 180, 'Lavabo'),
    ]
    for model, px, pz, yaw, name in furniture:
        p.append(put(src, model, px, pz, yaw, name))
    return p


def check(src, pieces):
    """Signale tout meuble qui déborde de la maison."""
    for model, x, z, yaw, name in pieces:
        if model.startswith(('floor', 'wall', 'doorway')):
            continue
        x0, z0, x1, z1 = turned(footprint(src, model), yaw)
        x0, x1, z0, z1 = x0 + x, x1 + x, z0 + z, z1 + z
        if x0 < -0.01 or x1 > W + 0.01 or z1 > 0.01 or z0 < -D - 0.01:
            print(f'  ! {name} ({model}) déborde : x {x0:.2f}..{x1:.2f}, z {z0:.2f}..{z1:.2f}')


def build(src, out):
    gltf = {
        'asset': {'version': '2.0', 'generator': 'owlnest build-demo-house'},
        'scene': 0,
        'scenes': [{'name': 'Owlnest_demo', 'nodes': []}],
        'nodes': [],
    }
    binary = bytearray()
    pieces = plan(src)
    check(src, pieces)
    for model, x, z, yaw, name in pieces:
        extra, extra_bin = merge_glb.read(os.path.join(src, model + '.glb'))
        gltf, binary = merge_glb.merge(gltf, binary, extra, extra_bin, (x, 0.0, z), yaw, 1.0, name)
    size = merge_glb.write(out, gltf, binary)
    print(f'{out} : {size / 1024:.0f} Ko, {len(pieces)} pièces, {len(gltf["meshes"])} mailles')


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
