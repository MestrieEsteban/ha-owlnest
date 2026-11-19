/**
 * Texture des pastilles. Redessinée quand l'état change, pas à chaque image.
 *
 * L'icône est peinte opaque. Seul le disque (et son cadre) prend l'alpha
 * déjà résolu par `resolvePinLook` : l'opacité du matériau resterait à 1,
 * sinon l'icône s'effacerait avec le modèle.
 */

export interface PinFace {
  shape: 'disc' | 'badge' | 'label' | 'thumb';
  opacity: number;
  disc: string;
  line: string;
  icon?: string;
  domain?: string;
  iconColor: string;
  glyph?: string;
  text?: string;
  textColor?: string;
  caption?: string;
  glow?: string;
  badge?: string;
  dashed?: boolean;
  picture?: string;
  offline?: string;
  active?: boolean;
}

export interface PaintedPin {
  width: number;
  height: number;
  /** Point de l'ancre dans le sprite : 0 en bas, 1 en haut. */
  anchorY: number;
}

const DPR = 2;

const DOMAIN_SVG: Record<string, string> = {
  light: '<path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-1 17h2v1h-2v-1z"/>',
  switch: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="17" cy="12" r="3" fill="#0d1117"/>',
  cover: '<path d="M3 3h18v2H3V3zm0 4h18v2l-9 6-9-6V7zm0 10h18v2H3z"/>',
  climate: '<path d="M12 2a4 4 0 0 0-4 4v7.27A6 6 0 1 0 16 13.27V6a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v1h-4V6a2 2 0 0 1 2-2zm0 16a4 4 0 0 1-2.45-7.18L11 12V9h2v3l1.45.82A4 4 0 0 1 12 20z"/>',
  media_player: '<path d="M12 3a9 9 0 1 0 .001 18.001A9 9 0 0 0 12 3zm-2 13V8l7 4z"/>',
  sensor: '<path d="M3 3v18h18V3H3zm16 16H5V5h14zM7 17l3-4 2 2.5 3-4 3 5.5z"/>',
  binary_sensor: '<circle cx="12" cy="12" r="7"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2" fill="#0d1117"/>',
  default: '<path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
};

interface IconSlot {
  canvas?: HTMLCanvasElement;
  pending?: boolean;
  failed?: boolean;
}

const icons = new Map<string, IconSlot>();

interface ShotSlot {
  img: HTMLImageElement;
  ok: boolean;
  failed: boolean;
  pending: boolean;
}

const shots = new Map<string, ShotSlot>();
const shotForce = new Set<string>();

function iconCacheKey(icon: string | undefined, domain: string | undefined, color: string): string {
  return `${icon ?? ''}|${domain ?? ''}|${color}`;
}

function shotPath(url: string | undefined): string {
  return url ? url.split('?')[0] : '';
}

/** Vrai quand le bitmap d'icône est déjà en cache (ou qu'il n'y a rien à dessiner). */
export function iconReady(face: PinFace): boolean {
  if (face.glyph || face.shape === 'badge' || face.shape === 'label' && !face.icon) return true;
  if (face.shape === 'thumb') return true;
  const slot = icons.get(iconCacheKey(face.icon, face.domain, face.iconColor));
  return !!(slot?.canvas || slot?.failed);
}

/** Vrai quand la vignette a fini de charger, ou qu'il n'y a pas d'image. */
export function shotReady(url: string | undefined): boolean {
  if (!url) return true;
  const slot = shots.get(shotPath(url));
  return !!(slot && !slot.pending);
}

/** Prochaine peinture : recharger l'image, le jeton Home Assistant a tourné. */
export function refreshPinPicture(url: string | undefined) {
  const path = shotPath(url);
  if (path) shotForce.add(path);
}

/** Ce qui change vraiment le dessin. `pictureForce` n'en fait pas partie. */
export function pinFaceKey(face: PinFace): string {
  return JSON.stringify({
    shape: face.shape,
    opacity: face.opacity,
    disc: face.disc,
    line: face.line,
    icon: face.icon ?? '',
    domain: face.domain ?? '',
    iconColor: face.iconColor,
    glyph: face.glyph ?? '',
    text: face.text ?? '',
    textColor: face.textColor ?? '',
    caption: face.caption ?? '',
    glow: face.glow ?? '',
    badge: face.badge ?? '',
    dashed: !!face.dashed,
    picture: shotPath(face.picture),
    offline: face.offline ?? '',
    active: !!face.active,
    iconReady: iconReady(face),
    shotReady: shotReady(face.picture),
  });
}

function parseColor(color: string): [number, number, number, number] | null {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] !== undefined ? Number(rgb[4]) : 1];
}

/** Alpha du disque : on multiplie celui que la couleur portait déjà. */
export function colorAlpha(color: string, alpha: number): string {
  const p = parseColor(color);
  const a = Math.min(1, Math.max(0, alpha));
  if (!p) return a >= 0.999 ? color : `rgba(15,15,25,${a})`;
  return `rgba(${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])},${+(p[3] * a).toFixed(3)})`;
}

function mixColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  const m = (i: number) => Math.round(pa[i] * t + pb[i] * (1 - t));
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function prepare(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));
  const bw = Math.ceil(width * DPR);
  const bh = Math.ceil(height * DPR);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function svgImage(markup: string, color: string, done: (img: HTMLImageElement | null) => void) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="${color}">${markup}</svg>`;
  const img = new Image();
  img.onload = () => done(img);
  img.onerror = () => done(null);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function drawToSlot(slot: IconSlot, img: HTMLImageElement | null) {
  if (!img) { slot.failed = true; slot.pending = false; return; }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  canvas.getContext('2d')?.drawImage(img, 0, 0, 64, 64);
  slot.canvas = canvas;
  slot.pending = false;
}

/** Au-delà, le fragment ne viendra plus : on lâche le nœud sans graver un autre glyphe. */
const ICON_WAIT_MS = 12000;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

interface HaSvgIconEl extends HTMLElement {
  path?: string;
  secondaryPath?: string;
  viewBox?: string;
}

const STROKE_SELECTOR = 'path,circle,rect,polygon,polyline,ellipse,line';

function shapeHasStroke(el: Element): boolean {
  if (el.localName === 'path') return !!el.getAttribute('d')?.trim();
  return el.localName === 'circle' || el.localName === 'rect' || el.localName === 'polygon'
    || el.localName === 'polyline' || el.localName === 'ellipse' || el.localName === 'line';
}

function svgHasStroke(svg: Element): boolean {
  if (shapeHasStroke(svg)) return true;
  let found = false;
  svg.querySelectorAll(STROKE_SELECTOR).forEach((node) => {
    if (shapeHasStroke(node)) found = true;
  });
  return found;
}

function markupForPath(path: string, secondary?: string, viewBox?: string): string {
  if (path.startsWith('<')) return path;
  let body = `<path d="${escapeAttr(path)}"/>`;
  const extra = secondary?.trim();
  if (extra) body += `<path d="${escapeAttr(extra)}" opacity="0.5"/>`;
  const box = viewBox?.trim();
  if (box && box !== '0 0 24 24') {
    return `<svg viewBox="${escapeAttr(box)}" width="24" height="24">${body}</svg>`;
  }
  return body;
}

/** L'image n'a pas le CSS de HA : `currentColor` y deviendrait noir. */
function markupFromSvg(svg: Element): string | null {
  if (!svgHasStroke(svg)) return null;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.querySelectorAll(STROKE_SELECTOR).forEach((node) => {
    const fill = node.getAttribute('fill');
    if (!fill || fill === 'currentColor' || fill === 'currentcolor') node.removeAttribute('fill');
    const cls = node.getAttribute('class')?.split(/\s+/) ?? [];
    if (cls.includes('secondary-path') && !node.getAttribute('opacity')) node.setAttribute('opacity', '0.5');
  });
  const inner = clone.innerHTML;
  const box = svg.getAttribute('viewBox')?.trim();
  if (box && box !== '0 0 24 24') {
    return `<svg viewBox="${escapeAttr(box)}" width="24" height="24">${inner}</svg>`;
  }
  return inner;
}

function collectIcons(node: ParentNode, iconsFound: HaSvgIconEl[], svgs: Element[]) {
  node.querySelectorAll('*').forEach((el) => {
    if (el.localName === 'ha-svg-icon') iconsFound.push(el as HaSvgIconEl);
    else if (el.localName === 'svg') svgs.push(el);
    if (el.shadowRoot) collectIcons(el.shadowRoot, iconsFound, svgs);
  });
}

/**
 * Le tracé choisi n'est pas un enfant de `ha-icon`. Il arrive plus tard sur
 * `ha-svg-icon` (propriété `path`, ou `<path>` dans l'ombre imbriquée).
 * Tant qu'il n'est pas là, ce n'est pas encore l'icône.
 */
function iconMarkup(root: Element): string | null {
  const iconsFound: HaSvgIconEl[] = [];
  const svgs: Element[] = [];
  collectIcons(root, iconsFound, svgs);
  if (root.shadowRoot) collectIcons(root.shadowRoot, iconsFound, svgs);
  for (const icon of iconsFound) {
    const path = (typeof icon.path === 'string' ? icon.path : icon.getAttribute('path') || '').trim();
    const secondary = typeof icon.secondaryPath === 'string' ? icon.secondaryPath : undefined;
    const viewBox = typeof icon.viewBox === 'string' ? icon.viewBox : icon.getAttribute('viewBox') || undefined;
    if (path) return markupForPath(path, secondary, viewBox);
    const nested = icon.shadowRoot?.querySelector('svg');
    if (nested) {
      const markup = markupFromSvg(nested);
      if (markup) return markup;
    }
  }
  for (const svg of svgs) {
    const markup = markupFromSvg(svg);
    if (markup) return markup;
  }
  return null;
}

/**
 * `ha-icon` n'existe que dans Home Assistant. Sans l'élément, on rend la main
 * tout de suite : les tests n'ont pas de DOM. Avec, on attend le vrai tracé
 * puis on le passe à `svgImage` — deux images ne suffisent pas, le fragment
 * MDI est souvent encore en route.
 */
function rasterHaIcon(icon: string, color: string, done: (img: HTMLImageElement | null) => void) {
  if (typeof customElements === 'undefined' || !customElements.get('ha-icon') || typeof document === 'undefined' || !document.body) {
    done(null);
    return;
  }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-999px;top:0;width:64px;height:64px;overflow:hidden;pointer-events:none;color:${color}`;
  const el = document.createElement('ha-icon');
  el.setAttribute('icon', icon);
  el.style.cssText = 'width:64px;height:64px;display:block;color:inherit';
  host.appendChild(el);
  document.body.appendChild(host);
  const box = el as HTMLElement & { icon?: string };
  if (box.icon !== icon) box.icon = icon;

  const started = Date.now();
  let frames = 0;
  let closed = false;
  const finish = (markup: string | null) => {
    if (closed) return;
    closed = true;
    host.remove();
    if (!markup) { done(null); return; }
    svgImage(markup, color, done);
  };
  const tick = () => {
    if (closed) return;
    if (!host.isConnected) { finish(null); return; }
    let markup: string | null = null;
    try { markup = iconMarkup(el); } catch { markup = null; }
    if (markup) { finish(markup); return; }
    if (Date.now() - started >= ICON_WAIT_MS) { finish(null); return; }
    frames += 1;
    // `requestAnimationFrame` peut ne jamais partir (onglet en arrière-plan) :
    // le tracé est déjà là, et la pastille resterait sans icône.
    setTimeout(tick, frames < 180 ? 32 : 200);
  };
  setTimeout(tick, 32);
}

function ensureIcon(face: PinFace, ready: () => void): HTMLCanvasElement | null {
  if (face.glyph) return null;
  const key = iconCacheKey(face.icon, face.domain, face.iconColor);
  let slot = icons.get(key);
  if (slot?.canvas) return slot.canvas;
  if (slot?.failed || slot?.pending) return null;
  slot = { pending: true };
  icons.set(key, slot);
  const icon = face.icon ?? '';
  const finish = (img: HTMLImageElement | null) => {
    if (img) {
      drawToSlot(slot!, img);
      ready();
      return;
    }
    // Un nom sans tracé ne prend pas le glyphe du domaine : ce bitmap resterait
    // en cache et l'icône choisie ne serait plus jamais dessinée.
    if (icon.includes(':')) {
      icons.delete(key);
      return;
    }
    const markup = DOMAIN_SVG[face.domain ?? ''] ?? DOMAIN_SVG.default;
    svgImage(markup, face.iconColor, (fallback) => {
      drawToSlot(slot!, fallback);
      ready();
    });
  };
  if (icon.includes(':')) rasterHaIcon(icon, face.iconColor, finish);
  else {
    const markup = DOMAIN_SVG[face.domain ?? ''] ?? (icon ? null : DOMAIN_SVG.default);
    if (!markup) { slot.failed = true; slot.pending = false; return null; }
    svgImage(markup, face.iconColor, (img) => { drawToSlot(slot, img); ready(); });
  }
  return null;
}

function ensureShot(url: string | undefined, ready: () => void): { img: HTMLImageElement | null; failed: boolean } {
  if (!url || typeof Image === 'undefined') return { img: null, failed: !url };
  const path = shotPath(url);
  let slot = shots.get(path);
  const force = shotForce.has(path);
  if (force) shotForce.delete(path);
  if (!slot) {
    const img = new Image();
    slot = { img, ok: false, failed: false, pending: false };
    shots.set(path, slot);
  }
  if (force || !slot.img.getAttribute('src')) {
    slot.failed = false;
    slot.pending = true;
    const current = slot;
    current.img.onload = () => { current.ok = true; current.failed = false; current.pending = false; ready(); };
    current.img.onerror = () => { current.ok = false; current.failed = true; current.pending = false; ready(); };
    const sep = url.includes('?') ? '&' : '?';
    current.img.src = `${url}${sep}_owl=${Date.now()}`;
  }
  // Tant que la suivante charge, on garde la précédente : pas d'éclair vide.
  return { img: slot.img.naturalWidth ? slot.img : null, failed: slot.failed && !slot.img.naturalWidth };
}

function fillCaption(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  const x = cx - w / 2;
  roundRect(ctx, x, y, w, 16, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + 8);
}

function paintDisc(ctx: CanvasRenderingContext2D, face: PinFace, icon: HTMLCanvasElement | null, width: number, discCx: number, discCy: number) {
  const r = 19;
  if (face.glow) {
    const g = ctx.createRadialGradient(discCx, discCy, r * 0.7, discCx, discCy, r + 12);
    g.addColorStop(0, colorAlpha(face.glow, 0.45));
    g.addColorStop(1, colorAlpha(face.glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(discCx, discCy, r + 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(discCx, discCy, r, 0, Math.PI * 2);
  ctx.fillStyle = colorAlpha(face.disc, face.opacity);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = face.glow ? colorAlpha(face.glow, 0.33 * face.opacity) : colorAlpha(face.line, face.opacity);
  if (face.dashed) ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (face.glyph) {
    ctx.fillStyle = face.iconColor;
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face.glyph, discCx, discCy + 1);
  } else if (icon) {
    ctx.drawImage(icon, discCx - 9, discCy - 9, 18, 18);
  }
  if (face.badge) {
    ctx.beginPath();
    ctx.arc(discCx + 12, discCy - 12, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#1a6bff';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face.badge, discCx + 12, discCy - 12);
  }
  void width;
}

/**
 * Dessine la pastille. `ready` est appelé une fois quand une icône ou une
 * vignette arrive après coup — pas si tout est déjà en cache.
 */
export function paintPin(canvas: HTMLCanvasElement, face: PinFace, ready: () => void): PaintedPin {
  if (face.shape === 'thumb') return paintThumb(canvas, face, ready);
  if (face.shape === 'badge') return paintBadge(canvas, face);
  if (face.shape === 'label') return paintLabel(canvas, face, ready);
  return paintDiscFace(canvas, face, ready);
}

function paintDiscFace(canvas: HTMLCanvasElement, face: PinFace, ready: () => void): PaintedPin {
  const icon = ensureIcon(face, ready);
  const cap = face.caption ?? '';
  const measure = document.createElement('canvas').getContext('2d');
  measure!.font = '600 11px system-ui, sans-serif';
  const capW = cap ? Math.ceil(measure!.measureText(cap).width) + 16 : 0;
  const disc = 38;
  const glow = 14;
  const capH = cap ? 20 : 0;
  const gap = cap ? 4 : 0;
  const width = Math.max(disc + glow * 2, capW);
  const height = capH + gap + disc + glow * 2;
  const ctx = prepare(canvas, width, height);
  const discCx = width / 2;
  const discCy = capH + gap + glow + disc / 2;
  if (ctx) {
    if (cap) fillCaption(ctx, cap, discCx, 0);
    paintDisc(ctx, face, icon, width, discCx, discCy);
  }
  return { width, height, anchorY: (height - discCy) / height };
}

function paintBadge(canvas: HTMLCanvasElement, face: PinFace): PaintedPin {
  const text = face.text || '—';
  const cap = face.caption ?? '';
  const scratch = document.createElement('canvas').getContext('2d')!;
  scratch.font = '600 12px system-ui, sans-serif';
  const textW = Math.ceil(scratch.measureText(text).width);
  scratch.font = '600 11px system-ui, sans-serif';
  const capW = cap ? Math.ceil(scratch.measureText(cap).width) + 16 : 0;
  const width = Math.max(textW + 20, capW, 36);
  const badgeH = 22;
  const height = badgeH + (cap ? 24 : 0);
  const ctx = prepare(canvas, width, height);
  if (ctx) {
    roundRect(ctx, 0, 0, width, badgeH, 11);
    ctx.fillStyle = colorAlpha(face.disc, face.opacity);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colorAlpha(face.line, face.opacity);
    ctx.stroke();
    ctx.fillStyle = face.textColor || '#00cc88';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, badgeH / 2);
    if (cap) fillCaption(ctx, cap, width / 2, badgeH + 6);
  }
  return { width, height, anchorY: (height - badgeH / 2) / height };
}

function paintLabel(canvas: HTMLCanvasElement, face: PinFace, ready: () => void): PaintedPin {
  const icon = face.icon ? ensureIcon(face, ready) : null;
  const text = face.text || '';
  const scratch = document.createElement('canvas').getContext('2d')!;
  scratch.font = '600 11px system-ui, sans-serif';
  const textW = Math.ceil(scratch.measureText(text).width);
  const iconW = face.icon ? 16 : 0;
  const width = textW + iconW + (iconW ? 8 : 0) + 18;
  const height = 22;
  const ctx = prepare(canvas, width, height);
  if (ctx) {
    roundRect(ctx, 0, 0, width, height, 11);
    ctx.fillStyle = colorAlpha(face.disc, face.opacity);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colorAlpha(face.line, face.opacity);
    ctx.stroke();
    let x = 9;
    if (icon) { ctx.drawImage(icon, x, 3, 16, 16); x += 18; }
    ctx.fillStyle = face.textColor || 'rgba(255,255,255,0.82)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, height / 2);
  }
  return { width, height, anchorY: 0.5 };
}

function paintThumb(canvas: HTMLCanvasElement, face: PinFace, ready: () => void): PaintedPin {
  const width = 256;
  const height = 144;
  const shot = ensureShot(face.picture, ready);
  const ctx = prepare(canvas, width, height);
  if (ctx) {
    roundRect(ctx, 0, 0, width, height, 12);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = colorAlpha(face.disc, face.opacity);
    ctx.fillRect(0, 0, width, height);
    if (shot.img) ctx.drawImage(shot.img, 0, 0, width, height);
    else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(face.offline || '', width / 2, height / 2);
    }
    const bar = ctx.createLinearGradient(0, height - 36, 0, height);
    bar.addColorStop(0, 'rgba(0,0,0,0)');
    bar.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = bar;
    ctx.fillRect(0, height - 36, width, 36);
    ctx.beginPath();
    ctx.arc(16, height - 16, 4, 0, Math.PI * 2);
    ctx.fillStyle = face.active ? '#4ade80' : '#555';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = face.text || '';
    ctx.fillText(label, 26, height - 16, width - 40);
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorAlpha(face.line, face.opacity);
    roundRect(ctx, 1, 1, width - 2, height - 2, 12);
    ctx.stroke();
  }
  return { width, height, anchorY: 0.5 };
}

/** Teinte d'une icône éteinte : la couleur de l'appareil, adoucie. */
export function iconOffColor(tint: string | undefined): string {
  return tint ? mixColor(tint, '#555555', 0.75) : '#555555';
}
