# -*- coding: utf-8 -*-
"""Pose un GLB dans un autre, animations comprises.

La fusion se fait au niveau du format : les tableaux du second fichier sont
ajoutés au premier, et chaque référence est décalée d'autant. Rien n'est
réinterprété, donc rien n'est perdu — matériaux, textures et pistes NLA de
Blender arrivent intacts, et les animations retrouvent leurs nœuds par nom.

L'objet ajouté est enveloppé dans un nœud qui porte sa place dans la maison :
position, rotation autour de la verticale et échelle.

Usage :
  python scripts/merge-glb.py maison.glb objet.glb sortie.glb \
      --at X Y Z --yaw DEG --scale S [--name NOM] [--drop MAILLE:i,j,k]

`--drop` retire des primitives d'une maille de la maison : utile pour faire
la place, quand l'objet ajouté en remplace un. three.js nomme `MAILLE_k` la
k-ième primitive d'une maille, c'est ce nom qu'affiche Owlnest.

Les coordonnées sont celles du **monde** de la maison, telles qu'Owlnest les
affiche : le nœud enveloppe est placé à la racine de la scène, pas sous la
transformation de la maison.
"""
import argparse
import json
import math
import struct


def read(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67 and version == 2, f'{path} : pas un GLB 2.0'
    jlen, jtype = struct.unpack('<II', data[12:20])
    assert jtype == 0x4E4F534A
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack('<II', data[off:off + 8])
    assert btype == 0x004E4942
    return gltf, bytearray(data[off + 8:off + 8 + blen])


def write(path, gltf, binary):
    while len(binary) % 4:
        binary.append(0)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + bytes(binary))
    return total


def shift_texture_refs(material, tex_off):
    """Toutes les références de texture d'un matériau, extensions comprises."""
    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.endswith('Texture') and isinstance(value, dict) and 'index' in value:
                    value['index'] += tex_off
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
    walk(material)


def merge(base, base_bin, extra, extra_bin, at, yaw, scale, name):
    # Le second tampon suit le premier, aligné sur 4 octets.
    while len(base_bin) % 4:
        base_bin.append(0)
    byte_off = len(base_bin)
    base_bin += extra_bin

    off = {k: len(base.get(k, [])) for k in
           ('accessors', 'bufferViews', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes')}

    for view in extra.get('bufferViews', []):
        view['buffer'] = 0
        view['byteOffset'] = view.get('byteOffset', 0) + byte_off
    for acc in extra.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] += off['bufferViews']
        sparse = acc.get('sparse')
        if sparse:
            sparse['indices']['bufferView'] += off['bufferViews']
            sparse['values']['bufferView'] += off['bufferViews']
    for img in extra.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] += off['bufferViews']
    for tex in extra.get('textures', []):
        if 'source' in tex:
            tex['source'] += off['images']
        if 'sampler' in tex:
            tex['sampler'] += off['samplers']
    for mat in extra.get('materials', []):
        shift_texture_refs(mat, off['textures'])
    for mesh in extra.get('meshes', []):
        for prim in mesh['primitives']:
            prim['attributes'] = {k: v + off['accessors'] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] += off['accessors']
            if 'material' in prim:
                prim['material'] += off['materials']
            for target in prim.get('targets', []):
                for k in target:
                    target[k] += off['accessors']
    for node in extra.get('nodes', []):
        if 'mesh' in node:
            node['mesh'] += off['meshes']
        if 'children' in node:
            node['children'] = [c + off['nodes'] for c in node['children']]
    for anim in extra.get('animations', []):
        for sampler in anim['samplers']:
            sampler['input'] += off['accessors']
            sampler['output'] += off['accessors']
        for channel in anim['channels']:
            if 'node' in channel['target']:
                channel['target']['node'] += off['nodes']

    for key in off:
        base.setdefault(key, []).extend(extra.get(key, []))
    base.setdefault('animations', []).extend(extra.get('animations', []))
    used = set(base.get('extensionsUsed', [])) | set(extra.get('extensionsUsed', []))
    if used:
        base['extensionsUsed'] = sorted(used)

    # Le nœud qui porte la place de l'objet dans la maison.
    roots = extra['scenes'][extra.get('scene', 0)]['nodes']
    half = math.radians(yaw) / 2
    wrapper = {
        'name': name,
        'translation': list(at),
        'rotation': [0.0, math.sin(half), 0.0, math.cos(half)],
        'scale': [scale, scale, scale],
        'children': [r + off['nodes'] for r in roots],
    }
    base['nodes'].append(wrapper)
    base['scenes'][base.get('scene', 0)]['nodes'].append(len(base['nodes']) - 1)
    return base, base_bin


def drop_primitives(gltf, spec):
    """Retire des primitives d'une maille, désignée par son nom."""
    name, _, idx = spec.partition(':')
    drop = {int(i) for i in idx.split(',') if i}
    meshes = [m for m in gltf['meshes'] if m.get('name') == name]
    assert len(meshes) == 1, f'maille « {name} » introuvable ou ambiguë'
    prims = meshes[0]['primitives']
    meshes[0]['primitives'] = [p for i, p in enumerate(prims) if i not in drop]
    return len(prims) - len(meshes[0]['primitives'])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('base')
    ap.add_argument('extra')
    ap.add_argument('out')
    ap.add_argument('--at', nargs=3, type=float, default=(0, 0, 0))
    ap.add_argument('--yaw', type=float, default=0)
    ap.add_argument('--scale', type=float, default=1)
    ap.add_argument('--name', default='Objet_ajoute')
    ap.add_argument('--drop', action='append', default=[])
    a = ap.parse_args()

    base, base_bin = read(a.base)
    for spec in a.drop:
        print(f'{spec} : {drop_primitives(base, spec)} primitive(s) retirée(s)')
    extra, extra_bin = read(a.extra)
    n_anim = len(extra.get('animations', []))
    merged, binary = merge(base, base_bin, extra, extra_bin, a.at, a.yaw, a.scale, a.name)
    size = write(a.out, merged, binary)
    print(f'{a.out} : {size / 1024 / 1024:.1f} Mo, {len(merged["nodes"])} nœuds, '
          f'{len(merged.get("animations", []))} animations (dont {n_anim} ajoutées)')


if __name__ == '__main__':
    main()
