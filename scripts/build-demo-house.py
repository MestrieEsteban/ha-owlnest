# -*- coding: utf-8 -*-
"""Assemble la maison de démonstration à partir du Furniture Kit de Kenney (CC0).

Le kit fournit des tuiles de sol, des murs et des meubles sur une grille d'une
unité. On les pose ici, pièce par pièce, et on les fusionne en un seul GLB
avec `merge-glb.py` : chaque pièce garde ses matériaux et ses nœuds, ce qui
laisse la porte et la fenêtre détachables comme ouvrants.

Usage :
  python scripts/build-demo-house.py <dossier des .glb Kenney> [sortie.glb] [ancres.json]

Par défaut, le modèle est écrit dans l'intégration, qui le sert à
`/owlnest_frontend/demo.glb`, et les ancres de démonstration dans
`src/demo-anchors.json`, que la carte importe.

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

W, D = 4, 3          # largeur et profondeur, en cellules

# Le sol du kit est du même bois que les meubles : vus de haut, la table et
# les chaises s'y fondaient. Un parquet clair et grisé les détache.
FLOOR_COLOR = [0.80, 0.78, 0.74, 1.0]


def _matrix(node):
    """Matrice 4×4 d'un nœud glTF, depuis sa matrice ou ses TRS."""
    if 'matrix' in node:
        m = node['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    tx, ty, tz = node.get('translation', [0, 0, 0])
    qx, qy, qz, qw = node.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = node.get('scale', [1, 1, 1])
    r = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ]
    return [
        [r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, tx],
        [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, ty],
        [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, tz],
        [0, 0, 0, 1],
    ]


def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


_BOXES = {}


def footprint(src, model):
    """Boîte d'un modèle dans son repère : (xmin, zmin, xmax, zmax, hauteur).

    Les transformations des nœuds sont appliquées : le kit place parfois une
    pièce sous un nœud tourné ou réduit de moitié, et la boîte brute des
    sommets donnerait alors une taille fausse — un lit trop grand, une table
    de dix centimètres.
    """
    if model in _BOXES:
        return _BOXES[model]
    gltf, _ = merge_glb.read(os.path.join(src, model + '.glb'))
    lo, hi = [1e9] * 3, [-1e9] * 3

    def visit(index, parent):
        node = gltf['nodes'][index]
        world = _mul(parent, _matrix(node))
        if 'mesh' in node:
            for prim in gltf['meshes'][node['mesh']]['primitives']:
                acc = gltf['accessors'][prim['attributes']['POSITION']]
                for cx in (acc['min'][0], acc['max'][0]):
                    for cy in (acc['min'][1], acc['max'][1]):
                        for cz in (acc['min'][2], acc['max'][2]):
                            v = [sum(world[r][k] * (cx, cy, cz, 1)[k] for k in range(4)) for r in range(3)]
                            for k in range(3):
                                lo[k] = min(lo[k], v[k])
                                hi[k] = max(hi[k], v[k])
        for child in node.get('children', []):
            visit(child, world)

    identity = [[1 if r == c else 0 for c in range(4)] for r in range(4)]
    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        visit(root, identity)
    _BOXES[model] = (lo[0], lo[2], hi[0], hi[2], hi[1])
    return _BOXES[model]


def turned(box, yaw):
    """Boîte au sol après rotation autour de la verticale (multiples de 90°)."""
    x0, z0, x1, z1, _ = box
    corners = [(x0, z0), (x1, z0), (x0, z1), (x1, z1)]
    c, sn = round(math.cos(math.radians(yaw))), round(math.sin(math.radians(yaw)))
    pts = [(x * c + z * sn, -x * sn + z * c) for x, z in corners]
    xs, zs = [q[0] for q in pts], [q[1] for q in pts]
    return min(xs), min(zs), max(xs), max(zs)


def put(src, model, px, pz, yaw, name, on=None):
    """Pose un meuble par son emprise au sol.

    `px` est le bord gauche, `pz` la profondeur du bord sud depuis le mur sud :
    on raisonne sur le plan, pas sur l'origine propre à chaque modèle du kit.
    Orientation : 0 regarde le sud, 90 l'est, 180 le nord, 270 l'ouest.
    """
    x0, z0, x1, z1 = turned(footprint(src, model), yaw)
    # `on` : le meuble sur lequel il repose, une télévision sur son meuble, une
    # lampe sur un chevet. Sans lui, tout se pose au sol.
    y = footprint(src, on)[4] if on else 0.0
    # Le bord sud du meuble est son z le plus grand (z décroît vers le nord).
    return (model, px - x0, y, -pz - z1, yaw, name)


def wall_door(i_or_x, z, yaw, name):
    """Un mur à passage et sa porte, posée dans l'ouverture.

    La porte du kit se décale de 0,257 le long du mur, dans le repère du mur :
    tourné de 90°, ce décalage part vers -z.
    """
    if yaw == 0:
        x, door = i_or_x, (i_or_x + 0.257, z)
    else:
        x, door = i_or_x, (i_or_x, z - 0.257)
    return [('wallDoorway', x, 0.0, z, yaw, f'Mur_{name}'), ('doorway', door[0], 0.0, door[1], yaw, f'Porte_{name}')]


def plan(src):
    """La liste des pièces à poser : (modèle, x, z, angle en degrés, nom).

    Plan, vu du sud :

        +-----------+-----------+
        |           |  chambre  |
        |   séjour  |           |
        |           +-----------+
        |           |  cuisine  |
        +--porte----+-----------+
    """
    p = []

    for i in range(W):
        for j in range(D):
            p.append(('floorFull', i, 0.0, -j, 0, f'Sol_{i}_{j}'))

    # Façades. Un mur part de son origine vers +x ; tourné de 90°, vers -z.
    p.append(('wall', 0, 0.0, 0.05, 0, 'Mur_sud_0'))
    p += wall_door(1, 0.05, 0, 'entree')
    p.append(('wallWindow', 2, 0.0, 0.05, 0, 'Mur_sud_2'))
    p.append(('wall', 3, 0.0, 0.05, 0, 'Mur_sud_3'))
    for i, m in enumerate(['wall', 'wallWindow', 'wall', 'wallWindow']):
        p.append((m, i, 0.0, -D, 0, f'Mur_nord_{i}'))
    for j, m in enumerate(['wall', 'wallWindow', 'wall']):
        p.append((m, 0, 0.0, -j, 90, f'Mur_ouest_{j}'))
    for j, m in enumerate(['wallWindow', 'wall', 'wallWindow']):
        p.append((m, W + 0.05, 0.0, -j, 90, f'Mur_est_{j}'))

    # Cloisons : la chambre est fermée, la cuisine ouverte sur le séjour.
    p.append(('wall', 2, 0.0, -1, 0, 'Cloison_cuisine_0'))
    p.append(('wall', 3, 0.0, -1, 0, 'Cloison_cuisine_1'))
    # La porte de la chambre est sur la moitié nord de la cloison : sur la
    # moitié sud, elle s'ouvrait dans le dos du canapé.
    p.append(('wall', 2, 0.0, -1, 90, 'Cloison_chambre'))
    p += wall_door(2, -2, 90, 'chambre')

    furniture = [
        # Séjour : télévision contre le mur ouest, canapé en face.
        ('rugRectangle', 0.6, 0.9, 90, 'Tapis'),
        ('cabinetTelevision', 0.08, 1.0, 90, 'Meuble_tele'),
        ('televisionModern', 0.12, 1.2, 90, 'Television', 'cabinetTelevision'),
        ('tableCoffee', 0.85, 1.2, 90, 'Table_basse'),
        ('loungeSofa', 1.45, 1.0, 270, 'Canape'),
        ('lampRoundFloor', 0.78, 2.65, 0, 'Lampadaire'),
        ('bookcaseOpen', 0.3, 2.6, 180, 'Bibliotheque'),
        ('pottedPlant', 0.1, 0.1, 0, 'Plante'),
        # Cuisine : plan de travail contre la cloison, table devant.
        ('kitchenFridge', 3.4, 0.45, 0, 'Frigo'),
        ('kitchenCabinet', 2.1, 0.55, 0, 'Cuisine_1'),
        ('kitchenSink', 2.5, 0.55, 0, 'Evier'),
        ('kitchenStove', 2.9, 0.55, 0, 'Cuisiniere'),
        ('tableRound', 2.55, 0.08, 0, 'Table'),
        ('lampSquareTable', 2.75, 0.2, 0, 'Lampe_cuisine', 'tableRound'),
        # Chambre : lit double tête contre le mur nord, chevet et lampe à côté.
        ('bedDouble', 2.75, 1.85, 0, 'Lit'),
        ('sideTable', 3.75, 2.4, 90, 'Chevet'),
        ('lampRoundTable', 3.77, 2.55, 0, 'Lampe_chevet', 'sideTable'),
    ]
    for entry in furniture:
        p.append(put(src, *entry))
    return p


def check(src, pieces):
    """Signale tout meuble qui déborde de la maison."""
    for model, x, _y, z, yaw, name in pieces:
        if model.startswith(('floor', 'wall', 'doorway')):
            continue
        x0, z0, x1, z1 = turned(footprint(src, model), yaw)
        x0, x1, z0, z1 = x0 + x, x1 + x, z0 + z, z1 + z
        if x0 < -0.01 or x1 > W + 0.01 or z1 > 0.01 or z0 < -D - 0.01:
            print(f'  ! {name} ({model}) déborde : x {x0:.2f}..{x1:.2f}, z {z0:.2f}..{z1:.2f}')


# Les ancres de démonstration : une par objet que l'utilisateur a toutes les
# chances de posséder. Elles naissent sans entité ; la carte propose de les
# relier aux siennes. `at` est la hauteur du point, en fraction de l'objet.
DEMO_ANCHORS = [
    ('Lampadaire', 'floorLamp', 'mdi:floor-lamp', 0.9),
    ('Lampe_chevet', 'bedsideLamp', 'mdi:lamp', 0.8),
    ('Lampe_cuisine', 'kitchenLamp', 'mdi:ceiling-light', 0.8),
    ('Television', 'television', 'mdi:television', 0.5),
]


def world_boxes(src, pieces):
    """Boîte de chaque pièce posée, dans le repère du modèle."""
    boxes = {}
    for model, x, y, z, yaw, name in pieces:
        x0, z0, x1, z1 = turned(footprint(src, model), yaw)
        h = footprint(src, model)[4]
        boxes[name] = (x0 + x, y, z0 + z, x1 + x, y + h, z1 + z)
    return boxes


def demo_anchors(src, pieces):
    """Positions des ancres, dans le repère recentré qu'utilise la carte.

    La carte recentre tout modèle sur le centre de sa boîte englobante : une
    position écrite dans le repère du fichier tomberait à côté de l'objet.
    """
    boxes = world_boxes(src, pieces)
    lo = [min(b[k] for b in boxes.values()) for k in range(3)]
    hi = [max(b[k + 3] for b in boxes.values()) for k in range(3)]
    centre = [(lo[k] + hi[k]) / 2 for k in range(3)]
    out = []
    for name, key, icon, at in DEMO_ANCHORS:
        x0, y0, z0, x1, y1, z1 = boxes[name]
        point = [(x0 + x1) / 2, y0 + (y1 - y0) * at, (z0 + z1) / 2]
        out.append({
            'id': key,
            'icon': icon,
            'position': [round(point[k] - centre[k], 4) for k in range(3)],
        })
    return out


def build(src, out, anchors_out):
    gltf = {
        'asset': {'version': '2.0', 'generator': 'owlnest build-demo-house'},
        'scene': 0,
        'scenes': [{'name': 'Owlnest_demo', 'nodes': []}],
        'nodes': [],
    }
    binary = bytearray()
    pieces = plan(src)
    check(src, pieces)
    for model, x, y, z, yaw, name in pieces:
        extra, extra_bin = merge_glb.read(os.path.join(src, model + '.glb'))
        if model.startswith('floor'):
            for mat in extra.get('materials', []):
                mat.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = FLOOR_COLOR
        gltf, binary = merge_glb.merge(gltf, binary, extra, extra_bin, (x, y, z), yaw, 1.0, name)
    size = merge_glb.write(out, gltf, binary)
    print(f'{out} : {size / 1024:.0f} Ko, {len(pieces)} pièces, {len(gltf["meshes"])} mailles')

    import json
    with open(anchors_out, 'w', encoding='utf-8') as f:
        json.dump(demo_anchors(src, pieces), f, indent=2)
        f.write(chr(10))
    print(f'{anchors_out} : {len(DEMO_ANCHORS)} ancres')


if __name__ == '__main__':
    root = os.path.dirname(HERE)
    build(
        sys.argv[1],
        sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, 'custom_components', 'owlnest', 'frontend', 'demo.glb'),
        sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, 'src', 'demo-anchors.json'),
    )
