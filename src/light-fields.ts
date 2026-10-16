/**
 * light-fields.ts — champs optionnels des ancres lumière, persistés hors défauts.
 *
 * Un hôte : `lightMesh` / `lightMeshIndex` / `lightTriangle` (rétrocompat).
 * Plusieurs : `lightMeshes[]` ; à la lecture, les deux formes se normalisent
 * en liste.
 */
import type {
  AnchorConfig, AnchorEntry, EditableAnchor, LightHostRef, LightStyle, OwlnestAnchor,
} from './types';

/** Tope d'émisivité par défaut lorsqu'un hôte GLB est désigné. */
export const DEFAULT_EMISSIVE_LEVEL = 0.8;

/** Ordre canonique des styles de cast (UI + persistance). */
export const LIGHT_STYLE_ORDER: LightStyle[] = ['point', 'spot', 'beam', 'mesh'];

export type LightHostFields = {
  castLight?: boolean;
  lightMesh?: string;
  lightMeshIndex?: number;
  lightTriangle?: number;
  lightMeshes?: LightHostRef[];
  emissiveLevel?: number;
  linkEmissiveBrightness?: boolean;
  attachLightToObject?: boolean;
  lightColor?: string;
  lightColorTemp?: number;
};

export type LightStyleFields = {
  lightStyle?: LightStyle;
  lightStyles?: LightStyle[];
};

function hostKey(h: LightHostRef): string {
  return `${h.meshIndex ?? ''}\0${h.mesh}\0${h.triangle ?? ''}`;
}

/** Liste runtime des hôtes (legacy mono → un élément). */
export function listLightHosts(a: LightHostFields): LightHostRef[] {
  if (a.lightMeshes?.length) {
    const seen = new Set<string>();
    const out: LightHostRef[] = [];
    for (const h of a.lightMeshes) {
      if (!h.mesh && h.meshIndex === undefined) continue;
      const ref: LightHostRef = {
        mesh: h.mesh ?? '',
        meshIndex: h.meshIndex,
        triangle: h.triangle,
      };
      const k = hostKey(ref);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(ref);
    }
    if (out.length) return out;
  }
  if (a.lightMesh || a.lightMeshIndex !== undefined) {
    return [{
      mesh: a.lightMesh ?? '',
      meshIndex: a.lightMeshIndex,
      triangle: a.lightTriangle,
    }];
  }
  return [];
}

/** L'ancre désigne-t-elle au moins un objet GLB ? */
export function hasLightHost(a: LightHostFields): boolean {
  return listLightHosts(a).length > 0;
}

/** Écrit la sélection d'hôtes sur l'ancre (mono vs multi). */
export function setLightHosts(a: LightHostFields, hosts: LightHostRef[]): void {
  const list = listLightHosts({ lightMeshes: hosts });
  if (list.length === 0) {
    a.lightMesh = undefined;
    a.lightMeshIndex = undefined;
    a.lightTriangle = undefined;
    a.lightMeshes = undefined;
  } else if (list.length === 1) {
    a.lightMesh = list[0].mesh || undefined;
    a.lightMeshIndex = list[0].meshIndex;
    a.lightTriangle = list[0].triangle;
    a.lightMeshes = undefined;
  } else {
    a.lightMeshes = list.map((h) => ({
      mesh: h.mesh,
      ...(h.meshIndex !== undefined ? { meshIndex: h.meshIndex } : {}),
      ...(h.triangle !== undefined ? { triangle: h.triangle } : {}),
    }));
    a.lightMesh = undefined;
    a.lightMeshIndex = undefined;
    a.lightTriangle = undefined;
  }
}

/** Même hôte ? (pour toggle Ctrl). */
export function sameLightHost(a: LightHostRef, b: LightHostRef): boolean {
  if (a.meshIndex !== undefined && b.meshIndex !== undefined) {
    return a.meshIndex === b.meshIndex;
  }
  return !!a.mesh && a.mesh === b.mesh;
}

/** Styles de cast actifs (legacy `lightStyle` → un élément ; défaut `point`). */
export function listLightStyles(a: LightStyleFields): LightStyle[] {
  if (a.lightStyles?.length) {
    const seen = new Set<LightStyle>();
    const out: LightStyle[] = [];
    for (const s of a.lightStyles) {
      if (!LIGHT_STYLE_ORDER.includes(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    if (out.length) {
      return LIGHT_STYLE_ORDER.filter((s) => seen.has(s));
    }
  }
  if (a.lightStyle && LIGHT_STYLE_ORDER.includes(a.lightStyle)) {
    return [a.lightStyle];
  }
  return ['point'];
}

/** Écrit la sélection de styles (mono → `lightStyle`, multi → `lightStyles`). */
export function setLightStyles(a: LightStyleFields, styles: LightStyle[]): void {
  const list = listLightStyles({ lightStyles: styles });
  if (list.length <= 1) {
    const s = list[0] ?? 'point';
    a.lightStyle = s === 'point' ? undefined : s;
    a.lightStyles = undefined;
  } else {
    a.lightStyles = list;
    a.lightStyle = undefined;
  }
}

export function hasDirectionalStyle(a: LightStyleFields): boolean {
  return listLightStyles(a).some((s) => s === 'spot' || s === 'beam');
}

export function hasMeshStyle(a: LightStyleFields): boolean {
  return listLightStyles(a).includes('mesh');
}

/** Persistance styles : un → `lightStyle`, plusieurs → `lightStyles` seul. */
export function persistLightStyles(a: LightStyleFields): LightStyleFields {
  const list = listLightStyles(a);
  if (list.length === 1) {
    return list[0] === 'point' ? {} : { lightStyle: list[0] };
  }
  return { lightStyles: list };
}

/**
 * Ne garde que les valeurs hors défaut, pour ne pas grossir les scènes anciennes.
 */
export function persistLightFields(a: LightHostFields & LightStyleFields): LightHostFields & LightStyleFields {
  const out: LightHostFields & LightStyleFields = {
    ...persistLightStyles(a),
  };
  if (a.castLight === false) out.castLight = false;
  const hosts = listLightHosts(a);
  if (hosts.length === 1) {
    if (hosts[0].mesh) out.lightMesh = hosts[0].mesh;
    if (hosts[0].meshIndex !== undefined) out.lightMeshIndex = hosts[0].meshIndex;
    if (hosts[0].triangle !== undefined) out.lightTriangle = hosts[0].triangle;
  } else if (hosts.length > 1) {
    out.lightMeshes = hosts.map((h) => ({
      mesh: h.mesh,
      ...(h.meshIndex !== undefined ? { meshIndex: h.meshIndex } : {}),
      ...(h.triangle !== undefined ? { triangle: h.triangle } : {}),
    }));
  }
  if (hosts.length > 0) {
    if (a.emissiveLevel !== undefined && a.emissiveLevel !== DEFAULT_EMISSIVE_LEVEL) {
      out.emissiveLevel = a.emissiveLevel;
    }
    if (a.linkEmissiveBrightness === false) out.linkEmissiveBrightness = false;
    if (a.attachLightToObject === true) out.attachLightToObject = true;
  }
  if (a.lightColor) out.lightColor = a.lightColor;
  if (a.lightColorTemp !== undefined) out.lightColorTemp = a.lightColorTemp;
  return out;
}

/** Recopie runtime (hôtes + styles). */
export function copyLightHostFields(src: LightHostFields & LightStyleFields): LightHostFields & LightStyleFields {
  return {
    castLight: src.castLight,
    lightMesh: src.lightMesh,
    lightMeshIndex: src.lightMeshIndex,
    lightTriangle: src.lightTriangle,
    lightMeshes: src.lightMeshes?.map((h) => ({ ...h })),
    emissiveLevel: src.emissiveLevel,
    linkEmissiveBrightness: src.linkEmissiveBrightness,
    attachLightToObject: src.attachLightToObject,
    lightColor: src.lightColor,
    lightColorTemp: src.lightColorTemp,
    lightStyle: src.lightStyle,
    lightStyles: src.lightStyles ? [...src.lightStyles] : undefined,
  };
}

export function lightFieldsFromAnchor(
  a: OwlnestAnchor | AnchorConfig | EditableAnchor | AnchorEntry,
): LightHostFields & LightStyleFields {
  return copyLightHostFields(a);
}
