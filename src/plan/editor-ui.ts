/**
 * plan/editor-ui.ts — l'éditeur de plan, en vue de dessus.
 *
 * Un panneau à gauche de la carte : le plan en 2D, une barre d'outils, et les
 * réglages de ce qui est sélectionné. La 3D reste visible à droite et suit
 * chaque retouche. Les décisions de position viennent de edit.ts et walls.ts ;
 * ici, on ne fait que traduire la souris et le clavier.
 */

import { t } from '../i18n';
import type { PlanDoc, PlanRoom, PlanOpening, OpeningKind } from './types';
import { OPENING_DEFAULTS } from './types';
import { wallsOf, wallFor, snapToWall, netArea, type Wall } from './walls';
import {
  roomFromDrag, moveRoom, resizeRoom, roomAt, calibrate, nextRoomName, clonePlan, newId,
  MIN_ROOM, type Handle,
} from './edit';

type Tool = 'select' | 'room' | 'door' | 'window' | 'slider' | 'calibrate' | 'image';
type Selection = { type: 'room' | 'opening' | 'wall'; id: string } | null;

const SVG = 'http://www.w3.org/2000/svg';
const FONT = 'var(--primary-font-family, Inter, sans-serif)';
const ACCENT = '#38bdf8';
const FLOORS = ['#c9b08a', '#b98b5e', '#d9d2c5', '#b7c4cf', '#9fb8a0', '#8e9aaf'];

export interface PlanEditorOptions {
  container: HTMLElement;
  plan: PlanDoc;
  /** Le plan a changé (fin d'un geste, saisie validée). */
  onChange: (plan: PlanDoc) => void;
  onClose: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
};

const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const m = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')} m`;

export class PlanEditor {
  private plan: PlanDoc;
  private history: PlanDoc[] = [];
  private future: PlanDoc[] = [];
  private tool: Tool = 'select';
  private sel: Selection = null;
  /** Vue : centre en mètres, et pixels par mètre. */
  private view = { cx: 0, cy: 0, scale: 60 };

  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private side: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private status: HTMLDivElement;

  /** Geste en cours. */
  private drag:
    | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
    | { kind: 'draw'; ax: number; ay: number; bx: number; by: number }
    | { kind: 'move'; id: string; ax: number; ay: number; ox: number; oy: number }
    | { kind: 'resize'; id: string; handle: Handle }
    | { kind: 'opening'; id: string }
    | { kind: 'image'; ax: number; ay: number; ox: number; oy: number }
    | null = null;
  private moved = false;
  private ghost: { x: number; y: number; wall: Wall } | null = null;
  private calib: { ax: number; ay: number } | null = null;

  constructor(private opts: PlanEditorOptions) {
    this.plan = clonePlan(opts.plan);
    this.root = el('div', [
      'position:absolute', 'left:0', 'top:0', 'bottom:0', 'width:min(64%,860px)', 'min-width:320px',
      'display:flex', 'flex-direction:column', 'background:#0a0f1c', 'border-right:1px solid rgba(255,255,255,0.08)',
      'box-shadow:8px 0 30px rgba(0,0,0,0.45)', 'z-index:120', 'pointer-events:auto', `font-family:${FONT}`, 'color:#e2e8f0',
    ].join(';'));

    // En-tête
    const head = el('div', 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);');
    head.append(el('div', 'font-weight:700;font-size:13px;color:#7dd3fc;flex:1;', t('planTitle')));
    const undo = this.button('↶', () => this.undo(), t('planUndo'));
    const redo = this.button('↷', () => this.redo(), t('planRedo'));
    const done = this.button(t('planDone'), () => this.close(), '', true);
    head.append(undo, redo, done);

    this.toolbar = el('div', 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.06);');

    const body = el('div', 'flex:1;display:flex;min-height:0;');
    const canvasWrap = el('div', 'flex:1;position:relative;min-width:0;background:#0f172a;');
    this.svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair;';
    canvasWrap.append(this.svg);
    this.status = el('div', 'position:absolute;left:10px;bottom:8px;font-size:11px;color:#94a3b8;pointer-events:none;');
    canvasWrap.append(this.status);
    this.side = el('div', 'width:230px;flex-shrink:0;overflow-y:auto;padding:12px;border-left:1px solid rgba(255,255,255,0.06);font-size:12px;');
    body.append(canvasWrap, this.side);

    this.root.append(head, this.toolbar, body);
    opts.container.append(this.root);

    this.buildToolbar();
    this.bindPointer();
    document.addEventListener('keydown', this.onKey);
    // La taille du dessin n'est connue qu'une fois le panneau affiché, et
    // change avec la carte : on recadre au premier vrai affichage, puis on
    // redessine à chaque changement.
    let fitted = false;
    this.resize = new ResizeObserver(() => {
      const r = this.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (!fitted) { fitted = true; this.fit(); }
      this.render();
    });
    this.resize.observe(this.svg);
    this.renderSide();
    this.hint();
  }

  private resize: ResizeObserver;

  // ── Cycle de vie ─────────────────────────────────────────────────────────

  /** Largeur du panneau, en pixels : la carte décale la 3D d'autant. */
  get width(): number {
    return this.root.getBoundingClientRect().width;
  }

  close() {
    document.removeEventListener('keydown', this.onKey);
    this.resize.disconnect();
    this.root.remove();
    this.opts.onClose();
  }

  /** Avant chaque modification : l'état courant part dans l'historique. */
  private commit() {
    this.history.push(clonePlan(this.plan));
    if (this.history.length > 80) this.history.shift();
    this.future = [];
  }

  private changed() {
    this.render();
    this.renderSide();
    this.opts.onChange(clonePlan(this.plan));
  }

  private undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(clonePlan(this.plan));
    this.plan = prev;
    this.sel = null;
    this.changed();
  }

  private redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(clonePlan(this.plan));
    this.plan = next;
    this.sel = null;
    this.changed();
  }

  private onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel) { e.preventDefault(); this.removeSelection(); } }
    else if (e.key === 'Escape') { this.setTool('select'); this.sel = null; this.render(); this.renderSide(); }
  };

  // ── Barre d'outils ───────────────────────────────────────────────────────

  private button(label: string, onClick: () => void, title = '', primary = false): HTMLButtonElement {
    const b = el('button', [
      'border-radius:8px', 'padding:6px 11px', 'font-size:12px', `font-family:${FONT}`, 'cursor:pointer',
      primary
        ? 'background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.55);color:#7dd3fc;font-weight:700'
        : 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:#cbd5e1',
    ].join(';'), label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  private buildToolbar() {
    this.toolbar.innerHTML = '';
    const tools: [Tool, string, string][] = [
      ['select', '⬚', t('planToolSelect')],
      ['room', '▭', t('planToolRoom')],
      ['door', '🚪', t('planToolDoor')],
      ['window', '🪟', t('planToolWindow')],
      ['slider', '⇆', t('planToolSlider')],
    ];
    for (const [tool, icon, label] of tools) {
      const b = this.button(`${icon} ${label}`, () => this.setTool(tool));
      if (this.tool === tool) {
        b.style.background = 'rgba(56,189,248,0.22)';
        b.style.borderColor = 'rgba(56,189,248,0.7)';
        b.style.color = '#e0f2fe';
      }
      this.toolbar.append(b);
    }
  }

  private setTool(tool: Tool) {
    this.tool = tool;
    this.ghost = null;
    this.calib = null;
    this.svg.style.cursor = tool === 'select' ? 'default' : tool === 'image' ? 'move' : 'crosshair';
    this.buildToolbar();
    this.render();
    this.hint();
  }

  private hint() {
    const hints: Record<Tool, string> = {
      select: t('planHintSelect'),
      room: t('planHintRoom'),
      door: t('planHintOpening'),
      window: t('planHintOpening'),
      slider: t('planHintOpening'),
      calibrate: this.calib ? t('planHintCalib2') : t('planHintCalib1'),
      image: t('planHintImage'),
    };
    this.status.textContent = hints[this.tool];
  }

  // ── Vue ──────────────────────────────────────────────────────────────────

  /** Cadre le dessin (ou une zone de 10 m s'il est vide). */
  private fit() {
    const r = this.svg.getBoundingClientRect();
    const w = r.width || 500, h = r.height || 400;
    let x0 = -5, x1 = 5, y0 = -4, y1 = 4;
    if (this.plan.rooms.length) {
      x0 = Math.min(...this.plan.rooms.map((q) => q.x)); x1 = Math.max(...this.plan.rooms.map((q) => q.x + q.w));
      y0 = Math.min(...this.plan.rooms.map((q) => q.y)); y1 = Math.max(...this.plan.rooms.map((q) => q.y + q.d));
    }
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
    this.view.scale = Math.max(15, Math.min(160, Math.min(w / (x1 - x0 + 3), h / (y1 - y0 + 3))));
  }

  /** Point de la souris, en mètres. */
  private toPlan(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return {
      x: this.view.cx + (e.clientX - r.left - r.width / 2) / this.view.scale,
      y: this.view.cy + (e.clientY - r.top - r.height / 2) / this.view.scale,
    };
  }

  // ── Souris ───────────────────────────────────────────────────────────────

  private bindPointer() {
    const svg = this.svg;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toPlan(e);
      this.view.scale = Math.max(10, Math.min(300, this.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toPlan(e);
      this.view.cx += before.x - after.x;
      this.view.cy += before.y - after.y;
      this.render();
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      this.moved = false;
      const p = this.toPlan(e);
      // Bouton du milieu ou droit : on déplace la vue, quel que soit l'outil.
      if (e.button === 1 || e.button === 2) {
        this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.view.cx, cy: this.view.cy };
        return;
      }
      if (this.tool === 'room') {
        this.drag = { kind: 'draw', ax: p.x, ay: p.y, bx: p.x, by: p.y };
      } else if (this.tool === 'door' || this.tool === 'window' || this.tool === 'slider') {
        this.placeOpening(this.tool, p.x, p.y);
      } else if (this.tool === 'calibrate') {
        this.calibrateClick(p.x, p.y);
      } else if (this.tool === 'image' && this.plan.background) {
        const bg = this.plan.background;
        this.commit();
        this.drag = { kind: 'image', ax: p.x, ay: p.y, ox: bg.x, oy: bg.y };
      } else {
        this.selectAt(e, p.x, p.y);
      }
    });

    svg.addEventListener('pointermove', (e) => {
      const p = this.toPlan(e);
      const d = this.drag;
      if (!d) {
        if (this.tool === 'door' || this.tool === 'window' || this.tool === 'slider') {
          const s = snapToWall(p.x, p.y, OPENING_DEFAULTS[this.tool].width, wallsOf(this.plan));
          this.ghost = s ? { x: s.x, y: s.y, wall: s.wall } : null;
          this.render();
        } else if (this.tool === 'calibrate' && this.calib) {
          this.render(p);
        }
        return;
      }
      this.moved = true;
      if (d.kind === 'pan') {
        this.view.cx = d.cx - (e.clientX - d.sx) / this.view.scale;
        this.view.cy = d.cy - (e.clientY - d.sy) / this.view.scale;
      } else if (d.kind === 'draw') {
        d.bx = p.x; d.by = p.y;
      } else if (d.kind === 'move') {
        const room = this.room(d.id);
        if (room) Object.assign(room, moveRoom({ ...room, x: d.ox, y: d.oy }, p.x - d.ax, p.y - d.ay, this.plan.rooms));
      } else if (d.kind === 'resize') {
        const room = this.room(d.id);
        if (room) Object.assign(room, resizeRoom(room, d.handle, p.x, p.y, this.plan.rooms));
      } else if (d.kind === 'opening') {
        const o = this.opening(d.id);
        if (o) {
          const s = snapToWall(p.x, p.y, o.width, wallsOf(this.plan));
          if (s) { o.x = s.x; o.y = s.y; }
        }
      } else if (d.kind === 'image' && this.plan.background) {
        this.plan.background.x = d.ox + p.x - d.ax;
        this.plan.background.y = d.oy + p.y - d.ay;
      }
      this.render();
      if (d.kind !== 'pan') this.renderSide();
    });

    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'draw') {
        const r = roomFromDrag(d.ax, d.ay, d.bx, d.by, this.plan.rooms);
        if (r.w >= MIN_ROOM && r.d >= MIN_ROOM) {
          this.commit();
          const room: PlanRoom = {
            id: newId('r'), name: nextRoomName(this.plan.rooms, t('planRoom')), ...r,
            floor: FLOORS[this.plan.rooms.length % FLOORS.length],
          };
          this.plan.rooms.push(room);
          this.sel = { type: 'room', id: room.id };
          this.changed();
        } else {
          this.render();
        }
        return;
      }
      if (d.kind === 'pan') return;
      // Un simple clic sur une pièce : l'historique n'a pas à garder ce non-geste.
      if (!this.moved && (d.kind === 'move' || d.kind === 'opening' || d.kind === 'resize' || d.kind === 'image')) {
        this.history.pop();
        return;
      }
      this.changed();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private room(id: string) { return this.plan.rooms.find((r) => r.id === id); }
  private opening(id: string) { return this.plan.openings.find((o) => o.id === id); }

  /** Sélection au clic : poignée, ouverture, pièce, sinon déplacement de la vue. */
  private selectAt(e: PointerEvent, x: number, y: number) {
    const tol = 10 / this.view.scale;
    // Poignées de la pièce sélectionnée.
    if (this.sel?.type === 'room') {
      const r = this.room(this.sel.id);
      if (r) {
        const h = this.handleAt(r, x, y, tol);
        if (h) { this.commit(); this.drag = { kind: 'resize', id: r.id, handle: h }; return; }
      }
    }
    // Ouvertures, au-dessus des pièces.
    const o = this.plan.openings.find((q) => {
      const along = Math.abs((Math.abs(q.y - y) < tol ? q.x - x : q.y - y));
      const across = Math.abs(Math.abs(q.y - y) < tol ? q.y - y : q.x - x);
      return across < tol * 1.5 && along < q.width / 2 + tol;
    });
    if (o) {
      this.sel = { type: 'opening', id: o.id };
      this.commit();
      this.drag = { kind: 'opening', id: o.id };
      this.render(); this.renderSide();
      return;
    }
    // Un mur, sur sa ligne : on le règle à part (hauteur, épaisseur).
    const wall = wallsOf(this.plan).find((w) => {
      const along = w.axis === 'x' ? x : y, across = w.axis === 'x' ? y : x;
      return Math.abs(across - w.at) < w.thickness / 2 + tol * 0.6 && along > w.from && along < w.to;
    });
    if (wall) {
      this.sel = { type: 'wall', id: wall.id };
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.view.cx, cy: this.view.cy };
      this.render(); this.renderSide();
      return;
    }
    const r = roomAt(this.plan.rooms, x, y);
    if (r) {
      this.sel = { type: 'room', id: r.id };
      this.commit();
      this.drag = { kind: 'move', id: r.id, ax: x, ay: y, ox: r.x, oy: r.y };
      this.render(); this.renderSide();
      return;
    }
    this.sel = null;
    this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.view.cx, cy: this.view.cy };
    this.render(); this.renderSide();
  }

  private handleAt(r: PlanRoom, x: number, y: number, tol: number): Handle | null {
    const nearX0 = Math.abs(x - r.x) < tol, nearX1 = Math.abs(x - (r.x + r.w)) < tol;
    const nearY0 = Math.abs(y - r.y) < tol, nearY1 = Math.abs(y - (r.y + r.d)) < tol;
    const inX = x > r.x - tol && x < r.x + r.w + tol, inY = y > r.y - tol && y < r.y + r.d + tol;
    if (nearY0 && nearX0) return 'nw';
    if (nearY0 && nearX1) return 'ne';
    if (nearY1 && nearX0) return 'sw';
    if (nearY1 && nearX1) return 'se';
    if (nearY0 && inX) return 'n';
    if (nearY1 && inX) return 's';
    if (nearX0 && inY) return 'w';
    if (nearX1 && inY) return 'e';
    return null;
  }

  private placeOpening(kind: OpeningKind, x: number, y: number) {
    const def = OPENING_DEFAULTS[kind];
    const s = snapToWall(x, y, def.width, wallsOf(this.plan));
    if (!s) { this.status.textContent = t('planNoWall'); return; }
    this.commit();
    const o: PlanOpening = {
      id: newId('o'), kind, x: s.x, y: s.y, ...def, hinge: 'start', swing: 'front',
      ...(kind === 'window' ? { double: def.width >= 1 } : {}),
    };
    this.plan.openings.push(o);
    this.sel = { type: 'opening', id: o.id };
    this.changed();
  }

  private calibrateClick(x: number, y: number) {
    if (!this.calib) { this.calib = { ax: x, ay: y }; this.hint(); this.render(); return; }
    const { ax, ay } = this.calib;
    this.calib = null;
    const measured = Math.hypot(x - ax, y - ay);
    const answer = window.prompt(t('planCalibAsk'), measured.toFixed(2));
    const real = answer ? parseFloat(answer.replace(',', '.')) : NaN;
    if (this.plan.background && real > 0) {
      this.commit();
      Object.assign(this.plan.background, calibrate(this.plan.background, ax, ay, measured, real));
      this.changed();
    }
    this.setTool('select');
  }

  private removeSelection() {
    if (!this.sel || this.sel.type === 'wall') return;
    this.commit();
    if (this.sel.type === 'room') this.plan.rooms = this.plan.rooms.filter((r) => r.id !== this.sel!.id);
    else this.plan.openings = this.plan.openings.filter((o) => o.id !== this.sel!.id);
    this.sel = null;
    this.changed();
  }

  // ── Dessin ───────────────────────────────────────────────────────────────

  private render(cursor?: { x: number; y: number }) {
    const svg = this.svg;
    const r = svg.getBoundingClientRect();
    const w = r.width || 500, h = r.height || 400;
    const s = this.view.scale;
    const vw = w / s, vh = h / s;
    const vx = this.view.cx - vw / 2, vy = this.view.cy - vh / 2;
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    svg.innerHTML = '';
    const px = (n: number) => n / s;   // pixels → mètres

    // Image de calque
    const bg = this.plan.background;
    if (bg) {
      svg.append(svgEl('image', {
        href: bg.src, x: bg.x, y: bg.y, width: bg.width, height: bg.width * bg.aspect,
        opacity: bg.opacity, preserveAspectRatio: 'none',
      }));
    }

    // Grille : 50 cm, et le mètre plus marqué.
    const grid = svgEl('g', { stroke: 'rgba(148,163,184,0.12)', 'stroke-width': px(1) });
    const step = s < 30 ? 1 : 0.5;
    for (let x = Math.floor(vx / step) * step; x < vx + vw; x += step) {
      grid.append(svgEl('line', { x1: x, y1: vy, x2: x, y2: vy + vh, 'stroke-opacity': Math.abs(x % 1) < 1e-6 ? 1.8 : 1 }));
    }
    for (let y = Math.floor(vy / step) * step; y < vy + vh; y += step) {
      grid.append(svgEl('line', { x1: vx, y1: y, x2: vx + vw, y2: y, 'stroke-opacity': Math.abs(y % 1) < 1e-6 ? 1.8 : 1 }));
    }
    svg.append(grid);

    // Sols
    for (const room of this.plan.rooms) {
      const selected = this.sel?.type === 'room' && this.sel.id === room.id;
      svg.append(svgEl('rect', {
        x: room.x, y: room.y, width: room.w, height: room.d,
        fill: room.floor ?? '#c9b08a', 'fill-opacity': bg ? 0.35 : 0.55,
        stroke: selected ? ACCENT : 'none', 'stroke-width': px(2),
      }));
    }

    // Murs
    const walls = wallsOf(this.plan);
    for (const wall of walls) {
      const x1 = wall.axis === 'x' ? wall.from : wall.at, x2 = wall.axis === 'x' ? wall.to : wall.at;
      const y1 = wall.axis === 'x' ? wall.at : wall.from, y2 = wall.axis === 'x' ? wall.at : wall.to;
      const picked = this.sel?.type === 'wall' && this.sel.id === wall.id;
      svg.append(svgEl('line', {
        x1, y1, x2, y2, stroke: picked ? ACCENT : '#e2e8f0', 'stroke-width': wall.thickness, 'stroke-linecap': 'square',
      }));
    }

    // Ouvertures
    for (const o of this.plan.openings) this.drawOpening(svg, o, walls, px);
    if (this.ghost) {
      const kind = this.tool as OpeningKind;
      const g: PlanOpening = { id: 'ghost', kind, x: this.ghost.x, y: this.ghost.y, ...OPENING_DEFAULTS[kind], hinge: 'start', swing: 'front' };
      const ghost = svgEl('g', { opacity: 0.55 });
      this.drawOpening(ghost, g, walls, px);
      svg.append(ghost);
    }

    // Noms, surfaces, et cotes de la pièce sélectionnée
    for (const room of this.plan.rooms) {
      const fs = Math.min(px(13), room.w / 6);
      const label = svgEl('text', {
        x: room.x + room.w / 2, y: room.y + room.d / 2, 'text-anchor': 'middle', 'font-size': fs,
        fill: '#f8fafc', 'font-family': 'Inter, sans-serif', 'font-weight': 700,
      });
      label.textContent = room.name;
      const area = svgEl('text', {
        x: room.x + room.w / 2, y: room.y + room.d / 2 + fs * 1.3, 'text-anchor': 'middle', 'font-size': fs * 0.8,
        fill: '#cbd5e1', 'font-family': 'Inter, sans-serif',
      });
      area.textContent = `${netArea(room, this.plan.wallThickness).toFixed(1)} m²`;
      svg.append(label, area);
    }

    const sel = this.sel?.type === 'room' ? this.room(this.sel.id) : null;
    if (sel) {
      this.dims(svg, sel.x, sel.y, sel.w, sel.d, px);
      for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
        svg.append(svgEl('rect', {
          x: sel.x + sel.w * hx - px(5), y: sel.y + sel.d * hy - px(5), width: px(10), height: px(10),
          fill: '#0f172a', stroke: ACCENT, 'stroke-width': px(2), rx: px(2),
        }));
      }
    }

    // Pièce en cours de tracé, avec ses cotes en direct.
    if (this.drag?.kind === 'draw') {
      const d = this.drag;
      const q = roomFromDrag(d.ax, d.ay, d.bx, d.by, this.plan.rooms);
      svg.append(svgEl('rect', {
        x: q.x, y: q.y, width: q.w, height: q.d, fill: 'rgba(56,189,248,0.15)',
        stroke: ACCENT, 'stroke-width': px(2), 'stroke-dasharray': `${px(6)} ${px(4)}`,
      }));
      this.dims(svg, q.x, q.y, q.w, q.d, px);
    }

    // Règle de mise à l'échelle
    if (this.calib) {
      const c = cursor ?? { x: this.calib.ax, y: this.calib.ay };
      svg.append(svgEl('line', { x1: this.calib.ax, y1: this.calib.ay, x2: c.x, y2: c.y, stroke: '#fbbf24', 'stroke-width': px(2) }));
      svg.append(svgEl('circle', { cx: this.calib.ax, cy: this.calib.ay, r: px(4), fill: '#fbbf24' }));
    }
  }

  /** Cotes d'un rectangle : largeur au-dessus, profondeur à droite. */
  private dims(svg: SVGElement, x: number, y: number, w: number, d: number, px: (n: number) => number) {
    const off = px(16), fs = px(12);
    const style = { fill: ACCENT, 'font-size': fs, 'font-family': 'Inter, sans-serif', 'font-weight': 700 };
    svg.append(svgEl('line', { x1: x, y1: y - off, x2: x + w, y2: y - off, stroke: ACCENT, 'stroke-width': px(1.5) }));
    const tw = svgEl('text', { x: x + w / 2, y: y - off - px(4), 'text-anchor': 'middle', ...style });
    tw.textContent = m(w);
    svg.append(svgEl('line', { x1: x + w + off, y1: y, x2: x + w + off, y2: y + d, stroke: ACCENT, 'stroke-width': px(1.5) }));
    const td = svgEl('text', { x: x + w + off + px(4), y: y + d / 2, 'dominant-baseline': 'middle', ...style });
    td.textContent = m(d);
    svg.append(tw, td);
  }

  /** Symbole d'une ouverture, comme sur un plan d'architecte. */
  private drawOpening(svg: SVGElement, o: PlanOpening, walls: Wall[], px: (n: number) => number) {
    const at = wallFor(o, walls);
    const wall = at?.wall;
    const horizontal = wall ? wall.axis === 'x' : true;
    const t = wall?.thickness ?? this.plan.wallThickness;
    const half = o.width / 2;
    const selected = this.sel?.type === 'opening' && this.sel.id === o.id;
    const color = !at ? '#f87171' : selected ? ACCENT : '#fbbf24';
    const g = svgEl('g', {});
    // On « ouvre » le mur : un rectangle couleur de fond.
    g.append(svgEl('rect', horizontal
      ? { x: o.x - half, y: o.y - t / 2 - px(1), width: o.width, height: t + px(2), fill: '#0f172a' }
      : { x: o.x - t / 2 - px(1), y: o.y - half, width: t + px(2), height: o.width, fill: '#0f172a' }));
    if (o.kind === 'window' || o.kind === 'slider') {
      for (const k of o.kind === 'slider' ? [-0.25, 0.25] : [-0.18, 0.18]) {
        g.append(svgEl('line', horizontal
          ? { x1: o.x - half, y1: o.y + k * t, x2: o.x + half, y2: o.y + k * t, stroke: color, 'stroke-width': px(2) }
          : { x1: o.x + k * t, y1: o.y - half, x2: o.x + k * t, y2: o.y + half, stroke: color, 'stroke-width': px(2) }));
      }
    } else {
      // Battant et arc d'ouverture, côté gonds et sens choisis.
      const dir = o.swing === 'front' ? 1 : -1;
      const hx = horizontal ? (o.hinge === 'start' ? o.x - half : o.x + half) : o.x;
      const hy = horizontal ? o.y : (o.hinge === 'start' ? o.y - half : o.y + half);
      const ex = horizontal ? hx : hx + dir * o.width;
      const ey = horizontal ? hy + dir * o.width : hy;
      const fx = horizontal ? (o.hinge === 'start' ? o.x + half : o.x - half) : o.x;
      const fy = horizontal ? o.y : (o.hinge === 'start' ? o.y + half : o.y - half);
      g.append(svgEl('line', { x1: hx, y1: hy, x2: ex, y2: ey, stroke: color, 'stroke-width': px(2.5) }));
      g.append(svgEl('path', {
        d: `M ${ex} ${ey} A ${o.width} ${o.width} 0 0 ${this.sweep(o, horizontal)} ${fx} ${fy}`,
        fill: 'none', stroke: color, 'stroke-width': px(1.2), 'stroke-dasharray': `${px(4)} ${px(3)}`,
      }));
    }
    svg.append(g);
  }

  private sweep(o: PlanOpening, horizontal: boolean): 0 | 1 {
    const a = o.hinge === 'start', b = o.swing === 'front';
    return (horizontal ? a === b : a !== b) ? 0 : 1;
  }

  // ── Réglages de la sélection ─────────────────────────────────────────────

  private section(title: string): HTMLDivElement {
    const box = el('div', 'margin-bottom:14px;');
    box.append(el('div', 'font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;', title));
    this.side.append(box);
    return box;
  }

  private field(parent: HTMLElement, label: string, input: HTMLElement) {
    const row = el('label', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;color:#cbd5e1;');
    row.append(el('span', '', label), input);
    parent.append(row);
  }

  private num(value: number, onCommit: (v: number) => void, step = 0.05, min = 0): HTMLInputElement {
    const i = el('input', 'width:78px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:6px;color:#e2e8f0;padding:4px 6px;font-size:12px;font-family:inherit;');
    i.type = 'number'; i.step = String(step); i.min = String(min);
    i.value = String(Math.round(value * 100) / 100);
    i.addEventListener('change', () => {
      const v = parseFloat(i.value);
      if (!(v >= min)) return;
      this.commit();
      onCommit(v);
      this.changed();
    });
    return i;
  }

  private toggle(options: [string, string][], value: string, onPick: (v: string) => void): HTMLDivElement {
    const wrap = el('div', 'display:flex;gap:4px;');
    for (const [v, label] of options) {
      const b = el('button', [
        'padding:4px 8px', 'border-radius:6px', 'font-size:11px', 'cursor:pointer', `font-family:${FONT}`,
        v === value ? `background:rgba(56,189,248,0.22);border:1px solid ${ACCENT};color:#e0f2fe` : 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:#94a3b8',
      ].join(';'), label);
      b.addEventListener('click', () => { if (v === value) return; this.commit(); onPick(v); this.changed(); });
      wrap.append(b);
    }
    return wrap;
  }

  private renderSide() {
    this.side.innerHTML = '';
    const room = this.sel?.type === 'room' ? this.room(this.sel.id) : null;
    const opening = this.sel?.type === 'opening' ? this.opening(this.sel.id) : null;

    if (room) {
      const box = this.section(t('planRoomTitle'));
      const name = el('input', 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:6px;color:#e2e8f0;padding:6px 8px;font-size:12px;font-family:inherit;margin-bottom:8px;');
      name.value = room.name;
      name.addEventListener('change', () => { this.commit(); room.name = name.value.trim() || room.name; this.changed(); });
      box.append(name);
      this.field(box, t('planWidth'), this.num(room.w, (v) => { room.w = Math.max(MIN_ROOM, v); }));
      this.field(box, t('planDepth'), this.num(room.d, (v) => { room.d = Math.max(MIN_ROOM, v); }));
      box.append(el('div', 'color:#94a3b8;margin:4px 0 10px;', `${t('planArea')} : ${netArea(room, this.plan.wallThickness).toFixed(1)} m²`));
      const swatches = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;');
      for (const c of FLOORS) {
        const sw = el('button', `width:24px;height:24px;border-radius:6px;cursor:pointer;background:${c};border:2px solid ${room.floor === c ? '#fff' : 'transparent'};`);
        sw.title = t('planFloor');
        sw.addEventListener('click', () => { this.commit(); room.floor = c; this.changed(); });
        swatches.append(sw);
      }
      box.append(el('div', 'color:#94a3b8;margin-bottom:6px;', t('planFloor')), swatches);
      box.append(this.button(`✕ ${t('planDelete')}`, () => this.removeSelection()));
      return;
    }

    const wall = this.sel?.type === 'wall' ? wallsOf(this.plan).find((w) => w.id === this.sel!.id) : null;
    if (wall) {
      const box = this.section(t('planWallTitle'));
      box.append(el('div', 'color:#94a3b8;margin-bottom:8px;', `${t('planLength')} : ${m(wall.to - wall.from)}`));
      const set = (patch: { height?: number; thickness?: number }) => {
        this.plan.walls = { ...this.plan.walls, [wall.id]: { ...this.plan.walls?.[wall.id], ...patch } };
      };
      this.field(box, t('planWallHeight'), this.num(wall.height, (v) => set({ height: Math.max(0.3, v) })));
      this.field(box, t('planWallThickness'), this.num(wall.thickness, (v) => set({ thickness: Math.max(0.05, v) }), 0.01, 0.05));
      box.append(el('div', 'color:#64748b;font-size:11px;line-height:1.45;margin:6px 0 10px;', t('planWallHelp')));
      if (this.plan.walls?.[wall.id]) {
        box.append(this.button(t('planWallReset'), () => {
          this.commit();
          const { [wall.id]: _, ...rest } = this.plan.walls ?? {};
          this.plan.walls = rest;
          this.changed();
        }));
      }
      return;
    }

    if (opening) {
      const kinds: Record<OpeningKind, string> = { door: t('planToolDoor'), window: t('planToolWindow'), slider: t('planToolSlider') };
      const box = this.section(kinds[opening.kind]);
      if (!wallFor(opening, wallsOf(this.plan))) box.append(el('div', 'color:#f87171;margin-bottom:8px;', t('planOrphan')));
      this.field(box, t('planWidth'), this.num(opening.width, (v) => { opening.width = v; }));
      this.field(box, t('planHeight'), this.num(opening.height, (v) => { opening.height = v; }));
      if (opening.kind === 'window') this.field(box, t('planSill'), this.num(opening.sill, (v) => { opening.sill = v; }));
      this.field(box, opening.kind === 'slider' ? t('planOpensTo') : t('planHinges'),
        this.toggle([['start', t('planStart')], ['end', t('planEnd')]], opening.hinge, (v) => { opening.hinge = v as 'start' | 'end'; }));
      if (opening.kind !== 'slider') {
        this.field(box, t('planSwing'),
          this.toggle([['front', t('planSideA')], ['back', t('planSideB')]], opening.swing, (v) => { opening.swing = v as 'front' | 'back'; }));
      }
      if (opening.kind === 'window') {
        this.field(box, t('planDouble'),
          this.toggle([['1', t('planYes')], ['0', t('planNo')]], opening.double ? '1' : '0', (v) => { opening.double = v === '1'; }));
      }
      box.append(el('div', 'color:#64748b;font-size:11px;line-height:1.45;margin:6px 0 10px;', t('planOpeningHelp')));
      box.append(this.button(`✕ ${t('planDelete')}`, () => this.removeSelection()));
      return;
    }

    // Rien de sélectionné : réglages du plan et calque.
    const walls = this.section(t('planWalls'));
    this.field(walls, t('planWallHeight'), this.num(this.plan.wallHeight, (v) => { this.plan.wallHeight = Math.max(0.5, v); }));
    this.field(walls, t('planWallThickness'), this.num(this.plan.wallThickness, (v) => { this.plan.wallThickness = Math.max(0.05, v); }, 0.01, 0.05));

    const img = this.section(t('planImage'));
    img.append(el('div', 'color:#64748b;font-size:11px;line-height:1.45;margin-bottom:8px;', t('planImageHelp')));
    const bg = this.plan.background;
    if (!bg) {
      img.append(this.button(`🖼 ${t('planImageLoad')}`, () => this.loadImage()));
    } else {
      const op = el('input');
      op.type = 'range'; op.min = '0.1'; op.max = '1'; op.step = '0.05'; op.value = String(bg.opacity);
      op.style.width = '110px';
      op.addEventListener('input', () => { bg.opacity = parseFloat(op.value); this.render(); });
      op.addEventListener('change', () => this.opts.onChange(clonePlan(this.plan)));
      this.field(img, t('planImageOpacity'), op);
      const row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
      row.append(
        this.button(`📏 ${t('planImageScale')}`, () => this.setTool('calibrate')),
        this.button(`✥ ${t('planImageMove')}`, () => this.setTool('image')),
        this.button(`✕ ${t('planImageRemove')}`, () => { this.commit(); this.plan.background = undefined; this.changed(); }),
      );
      img.append(row);
    }

    const help = this.section(t('planHowTo'));
    help.append(el('div', 'color:#94a3b8;font-size:11.5px;line-height:1.55;', t('planHowToText')));
  }

  /** Charge une image de plan, réduite pour voyager avec la scène. */
  private loadImage() {
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * k);
      canvas.height = Math.round(bmp.height * k);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/jpeg', 0.8);
      this.commit();
      // Dix mètres de large par défaut, posée au milieu de la vue : on la met
      // ensuite à l'échelle avec la règle.
      const width = 10;
      this.plan.background = {
        src, width, aspect: bmp.height / bmp.width, opacity: 0.5,
        x: this.view.cx - width / 2, y: this.view.cy - (width * bmp.height / bmp.width) / 2,
      };
      bmp.close();
      this.changed();
      this.setTool('calibrate');
    });
    input.click();
  }
}
