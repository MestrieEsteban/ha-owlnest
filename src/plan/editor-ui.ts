/**
 * plan/editor-ui.ts — l'éditeur de plan, en plein écran.
 *
 * Pensé pour qu'on s'en serve sans mode d'emploi : de gros outils à gauche, le
 * plan au milieu, et les réglages de ce qu'on touche dans une bulle à droite.
 * Tout se manipule directement : on tire un mur et les deux pièces suivent, on
 * tire un coin, on fait glisser une porte le long de son mur. Chaque mur porte
 * sa cote, et les traits s'alignent tout seuls sur ce qui est déjà dessiné.
 *
 * La 3D est à côté (« Plan + 3D ») ou en grand (« 3D »), et suit chaque
 * retouche. Les règles du dessin (couper, fusionner, trouver les pièces)
 * vivent dans graph.ts ; ici, on ne fait que traduire la souris et le doigt.
 */

import { t, getLang, type StringKey } from '../i18n';
import { icon } from '../ui/icons';
import { Tour, type TourStep } from '../ui/tour';
import type { PlanDoc, PlanOpening, OpeningKind, PlanWall, FloorMaterial, FacadeMaterial, DoorStyle, WindowStyle, PlanItem, PlanStair, StairShape } from './types';
import { OPENING_DEFAULTS, PLAN_COLORS } from './types';
import { inStair, stairRise, layout as stairLayout, toPlan as stairToPlan, wellCorners, STAIR_WIDTH } from './stairs';
import {
  type Pt, sub, add, mul, dot, dist, norm, perp, project, insidePoint, pointInPolygon, clipAlong, round3,
} from './geometry';
import {
  type Face, newId, wallEnds, wallLength, thicknessOf, heightOf, isBoundary, openingFits, wallAt, nodeAt, nodeOf,
  addWall, addRect, removeWall, cleanup, moveNode, splitWall, faces, reconcileRooms, roomAtPoint,
  polygonArea, settle, roomShapes, reseedRooms,
} from './graph';
import { wallFootprints } from './footprint';
import { TEMPLATES, templatePlan, templateModels, type TemplateId } from './templates';
import { CATALOG, CATEGORIES, catalogItem, itemLabel, thumbUrl, hasThumb, type ItemCategory } from './catalog';
import {
  loadFurniture, itemSize, topView, isoView, furnitureTints, tintKind, overItem, baseSize, itemElevation, supportOf, isFlat,
} from './furniture';
import {
  ROOM_TYPES, FLOOR_COLORS, WALL_COLORS, DOOR_COLORS, FRAME_COLORS, FLOOR_MATERIALS, type RoomType,
} from './rooms';

type Tool = 'select' | 'room' | 'wall' | 'boundary' | OpeningKind | 'stairs' | 'furniture' | 'erase' | 'calibrate' | 'image';
type ViewMode = 'plan' | 'split' | '3d';
type Hit =
  | { type: 'node'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'room'; id: string }
  | { type: 'item'; id: string }
  | { type: 'stair'; id: string };
type Guide = { x?: number; y?: number };

const SVG = 'http://www.w3.org/2000/svg';
const FONT = 'var(--primary-font-family, Inter, system-ui, sans-serif)';

// Le plan se lit comme un plan sur papier ; l'habillage autour reste sombre,
// comme le reste de la carte.
const C = {
  chrome: '#0b1220',
  chrome2: '#111a2e',
  line: 'rgba(255,255,255,0.08)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#38bdf8',
  paper: '#f6f4ef',
  grid: '#e4e0d6',
  gridStrong: '#d4cfc2',
  wall: '#2f343b',
  dim: '#2563eb',
  select: '#0ea5e9',
  hover: '#f59e0b',
  danger: '#ef4444',
  opening: '#2f343b',
};

/** Distances de prise, en pixels à l'écran. */
const GRAB = 12;
/** Pas de la grille d'accroche, en mètres. */
const STEP = 0.05;
/** Plus petite pièce qu'on accepte de tracer. */
const MIN_SIDE = 0.4;
/** Écart minimal entre deux mises à jour de la 3D pendant un glisser, en ms. */
const PREVIEW_MS = 60;
/** Largeur du tiroir des meubles, en pixels. */
const DRAWER_W = 236;

export interface PlanEditorOptions {
  container: HTMLElement;
  plan: PlanDoc;
  /** Le plan a changé (fin d'un geste, saisie validée). */
  onChange: (plan: PlanDoc) => void;
  /** Pendant un geste : la 3D suit, sans rien enregistrer. */
  onPreview?: (plan: PlanDoc) => void;
  /** Largeur couverte à gauche, en pixels : la 3D occupe le reste. */
  onLayout: (covered: number) => void;
  /**
   * Ouvre le sélecteur d'entités d'Owlnest (groupé par étage et par pièce,
   * avec recherche) pour relier une lampe posée à une entité.
   */
  pickEntity?: (current: string | undefined, done: (entityId: string) => void) => void;
  /** Le nom d'une entité tel que l'utilisateur le connaît, avec sa pièce. */
  entityLabel?: (entityId: string) => string;
  /** Ouvre le choix d'un fichier Sweet Home 3D, qui remplacera le plan. */
  importSh3d?: () => void;
  /** Envoie un meuble importé (GLB, ou OBJ et ses fichiers) et rend son adresse. */
  importFurniture?: (files: File[]) => Promise<string>;
  /**
   * Les onglets de l'éditeur de la maison : le plan en est un. Toucher un autre
   * onglet le quitte pour l'éditeur, sans repasser par la carte.
   */
  navTabs?: { id: string; label: string; icon: string }[];
  onNavTab?: (id: string) => void;
  /**
   * Les niveaux du logement. L'éditeur ne dessine qu'un niveau à la fois : en
   * changer lui rend le plan de l'autre (`null` : rien n'a changé).
   */
  floors?: PlanFloorsApi;
  onClose: () => void;
}

export interface PlanFloorsApi {
  list: () => { name: string }[];
  active: () => number;
  switchTo: (index: number) => PlanDoc | null;
  add: () => PlanDoc | null;
  rename: (index: number, name: string) => void;
  remove: (index: number) => PlanDoc | null;
  /** Le niveau du dessous, montré en filigrane pour dessiner pile au-dessus. */
  under: () => PlanDoc | null;
}

// ── Petits outils DOM ─────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
};

const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const poly = (pts: readonly Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

const clone = (p: PlanDoc): PlanDoc => JSON.parse(JSON.stringify(p));

/** Une longueur à la française ou à l'anglaise : « 3,45 m ». */
function meters(v: number): string {
  const s = (Math.round(v * 100) / 100).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });
  return `${s} m`;
}

const parseNum = (s: string) => parseFloat(s.replace(',', '.').replace(/[^\d.\-]/g, ''));

/** Icônes au trait, dessinées sur 24 × 24. */
const TOOLS: { tool: Tool; icon: string; label: StringKey; key: string }[] = [
  { tool: 'select', icon: 'select', label: 'planToolSelect', key: 'v' },
  { tool: 'room', icon: 'room', label: 'planToolRoom', key: 'r' },
  { tool: 'wall', icon: 'wall', label: 'planToolWall', key: 'm' },
  { tool: 'boundary', icon: 'boundary', label: 'planToolBoundary', key: 'l' },
  { tool: 'door', icon: 'door', label: 'planToolDoor', key: 'p' },
  { tool: 'window', icon: 'window', label: 'planToolWindow', key: 'f' },
  { tool: 'slider', icon: 'slider', label: 'planToolSlider', key: 'b' },
  { tool: 'passage', icon: 'passage', label: 'planToolPassage', key: 'o' },
  { tool: 'stairs', icon: 'stairs', label: 'planToolStairs', key: 'h' },
  { tool: 'furniture', icon: 'sofa', label: 'planToolFurniture', key: 'n' },
  { tool: 'erase', icon: 'erase', label: 'planToolErase', key: 'e' },
];

const MATERIAL_LABEL: Record<FloorMaterial, StringKey> = {
  plain: 'planMatPlain', wood: 'planMatWood', tiles: 'planMatTiles', concrete: 'planMatConcrete', carpet: 'planMatCarpet',
};

const DOOR_STYLES: DoorStyle[] = ['plain', 'panels', 'glazed', 'entry'];
const DOOR_STYLE_LABEL: Record<DoorStyle, StringKey> = {
  plain: 'planStylePlain', panels: 'planStylePanels', glazed: 'planStyleGlazed', entry: 'planStyleEntry',
};

const KIND_LABEL: Record<OpeningKind, StringKey> = {
  door: 'planToolDoor', window: 'planToolWindow', slider: 'planToolSlider', passage: 'planToolPassage',
};

// ── L'éditeur ─────────────────────────────────────────────────────────────

export class PlanEditor {
  private plan: PlanDoc;
  private history: PlanDoc[] = [];
  private future: PlanDoc[] = [];
  private tool: Tool = 'select';
  private mode: ViewMode = 'split';
  private sel: Hit | null = null;
  private hover: Hit | null = null;
  /** Vue : centre en mètres, et pixels par mètre. */
  private view = { cx: 0, cy: 0, scale: 50 };
  /** Les pièces du dessin courant, recalculées à chaque rendu. */
  private all: Face[] = [];

  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private rail: HTMLDivElement;
  private stage: HTMLDivElement;
  private svg: SVGSVGElement;
  private bubble: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private modeBar: HTMLDivElement;
  private floating: HTMLDivElement;
  private emptyState: HTMLDivElement | null = null;
  private popup: HTMLElement | null = null;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private resize: ResizeObserver;

  /** Geste en cours. */
  private drag:
    | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
    | { kind: 'node'; id: string; shapes: Map<string, string[]> }
    | { kind: 'wall'; id: string; from: Pt; normal: Pt; orig: Map<string, Pt>; shapes: Map<string, string[]>; detached: boolean }
    | { kind: 'room'; id: string; from: Pt; orig: Map<string, Pt>; shapes: Map<string, string[]> }
    | { kind: 'opening'; id: string; grab: number }
    | { kind: 'item'; id: string; grab: Pt }
    | { kind: 'stair'; id: string; grab: Pt }
    | { kind: 'rect'; a: Pt; b: Pt }
    | { kind: 'image'; from: Pt; ox: number; oy: number }
    | null = null;
  private moved = false;
  private downAt: { x: number; y: number } = { x: 0, y: 0 };
  /** Mur en cours de tracé : les points posés, et le curseur. */
  private chain: { pts: Pt[]; cursor: Pt; typed: string } | null = null;
  private cursor: Pt | null = null;
  private guides: Guide[] = [];
  private calib: Pt | null = null;
  /** Doigts posés, pour le pincement. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; scale: number; mid: Pt } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewAt = 0;
  /** Le mur contre lequel le meuble qu'on déplace est collé. */
  private stuck: string | null = null;
  private roomCounter = 0;
  /** Le catalogue de meubles : sa catégorie ouverte et la recherche. */
  private drawer: HTMLDivElement | null = null;
  private shelf: ItemCategory | 'all' | 'mine' = 'all';
  private search = '';
  /** Les meubles s'aimantent aux murs ; Alt (ou ce réglage) les laisse libres. */
  private magnet = true;
  /** Vues de dessus déjà rendues, par meuble. */
  private tops = new Map<string, string>();
  /** Les réglages généraux restent repliés tant qu'on ne les demande pas. */
  private showSettings = false;
  private doneBtn: HTMLButtonElement | null = null;
  private tour: Tour | null = null;
  private floorBar: HTMLDivElement | null = null;

  /**
   * La barre des niveaux, en haut à gauche du dessin. Toucher le niveau
   * actif le renomme ; le « + » en ajoute un au-dessus du dernier.
   */
  private renderFloorBar() {
    const api = this.opts.floors;
    if (!api) return;
    if (!this.floorBar) {
      this.floorBar = el('div', [
        'position:absolute', 'left:12px', 'top:12px', 'display:flex', 'gap:2px', 'align-items:center', 'padding:3px',
        `background:${C.chrome}`, `border:1px solid ${C.line}`, 'border-radius:11px', 'box-shadow:0 6px 18px rgba(0,0,0,0.25)',
        'overflow-x:auto', 'scrollbar-width:none', 'z-index:2',
      ].join(';'));
      this.floorBar.setAttribute('role', 'tablist');
      this.floorBar.setAttribute('aria-label', t('uiFloors'));
      this.floorBar.dataset.owFloors = '';
      this.stage.append(this.floorBar);
    }
    const bar = this.floorBar;
    this.placeFloorBar();
    bar.innerHTML = '';
    const active = api.active();
    const chip = (label: string, on: boolean, title: string, onClick: (b: HTMLButtonElement) => void) => {
      const b = el('button', [
        'display:flex', 'align-items:center', 'gap:5px', 'padding:6px 11px', 'border-radius:8px', 'border:none', 'cursor:pointer',
        `font-family:${FONT}`, 'font-size:12.5px', 'font-weight:600', 'white-space:nowrap', 'flex-shrink:0',
        on ? 'background:#0ea5e9;color:#fff' : `background:transparent;color:${C.muted}`,
      ].join(';'), label);
      b.title = title;
      b.addEventListener('click', () => onClick(b));
      bar.append(b);
      return b;
    };
    api.list().forEach((f, k) => {
      const b = chip(f.name, k === active, k === active ? t('planFloorRename') : f.name, (btn) => {
        if (k !== api.active()) { const doc = api.switchTo(k); if (doc) this.loadFloor(doc); return; }
        const r = btn.getBoundingClientRect(), s = this.stage.getBoundingClientRect();
        this.ask({ x: r.left - s.left, y: r.bottom - s.top + 6 }, f.name, 'text', (v) => {
          const name = v.trim();
          if (name && name !== f.name) { api.rename(k, name); this.renderFloorBar(); }
        }, t('planFloorName'));
      });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k === active));
      b.dataset.floor = String(k);
    });
    const add = chip('', false, t('planFloorAdd'), () => { const doc = api.add(); if (doc) this.loadFloor(doc); });
    add.append(icon('plus', 15));
    add.dataset.floorAdd = '';
    if (active > 0) {
      const del = chip('', false, t('planFloorRemove'), () => {
        const name = api.list()[api.active()]?.name ?? '';
        this.confirmBox(t('planFloorRemoveConfirm').replace('{name}', name), t('planFloorRemove'), () => {
          const doc = api.remove(api.active());
          if (doc) this.loadFloor(doc);
        });
      });
      del.append(icon('trash', 14));
      del.style.color = C.danger;
    }
  }

  /**
   * À côté des réglages sur un écran large ; dessous, sur toute la largeur,
   * sur un téléphone (sinon elle serait écrasée par eux).
   */
  private placeFloorBar() {
    const bar = this.floorBar;
    if (!bar) return;
    const narrow = this.stage.getBoundingClientRect().width < 560;
    bar.style.top = narrow ? '62px' : '12px';
    bar.style.maxWidth = narrow ? 'calc(100% - 24px)' : 'calc(100% - 290px)';
  }

  /** Un autre niveau à dessiner : son plan, et un historique neuf (annuler ne traverse pas les étages). */
  private loadFloor(doc: PlanDoc) {
    this.stopPreview();
    this.closePopup();
    this.plan = clone(doc);
    this.history = [];
    this.future = [];
    this.sel = null;
    this.hover = null;
    this.chain = null;
    this.roomCounter = this.plan.rooms.length;
    this.renderFloorBar();
    this.refresh();
  }

  /** La visite de l'éditeur de plan : les outils, les vues, les réglages, la fin. */
  startTour() {
    this.tour ??= new Tour(this.root);
    const steps: TourStep[] = [
      { target: () => this.rail, title: 'tourPlanToolsTitle', text: 'tourPlanToolsText', anim: 'plan' },
      { target: () => this.rail.querySelector<HTMLElement>('[data-tool="furniture"]'), title: 'tourPlanFurnTitle', text: 'tourPlanFurnText', anim: 'add' },
      { target: () => this.modeBar, title: 'tourPlanModesTitle', text: 'tourPlanModesText', anim: 'views' },
      { target: () => this.bubble, title: 'tourPlanSettingsTitle', text: 'tourPlanSettingsText', anim: 'gear' },
      { target: () => this.doneBtn, title: 'tourEdDoneTitle', text: 'tourPlanDoneText', anim: 'full' },
    ];
    this.tour.start(steps);
  }

  constructor(private opts: PlanEditorOptions) {
    this.plan = clone(opts.plan);
    this.roomCounter = this.plan.rooms.length;

    this.root = el('div', `position:absolute;inset:0;z-index:120;pointer-events:none;font-family:${FONT};color:${C.text};`);

    // Panneau du plan : barre du haut, outils, dessin.
    this.panel = el('div', [
      'position:absolute', 'left:0', 'top:0', 'bottom:0', 'display:flex', 'flex-direction:column',
      `background:${C.chrome}`, 'pointer-events:auto', 'box-shadow:6px 0 28px rgba(0,0,0,0.35)',
      'transition:width .25s ease',
    ].join(';'));

    const top = el('div', `display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid ${C.line};min-height:52px;box-sizing:border-box;container-type:inline-size;`);
    top.className = 'owp-top';
    const title = el('div', 'font-weight:700;font-size:14px;color:#7dd3fc;display:flex;align-items:center;gap:8px;white-space:nowrap;');
    title.append(icon('pencil', 18), document.createTextNode(t('planTitle')));
    // Ouvert depuis l'éditeur de la maison : ses onglets remplacent le titre.
    if (opts.navTabs?.length) {
      title.innerHTML = '';
      title.style.cssText = `display:flex;gap:2px;padding:3px;border-radius:11px;background:${C.chrome2};border:1px solid ${C.line};min-width:0;overflow-x:auto;scrollbar-width:none;`;
      title.setAttribute('role', 'tablist');
      for (const tab of opts.navTabs) {
        const on = tab.id === 'plan';
        const b = el('button', [
          'display:flex', 'align-items:center', 'gap:6px', 'padding:6px 10px', 'border-radius:8px', 'border:none', 'cursor:pointer',
          `font-family:${FONT}`, 'font-size:12.5px', 'font-weight:600', 'white-space:nowrap', 'flex-shrink:0',
          on ? 'background:#0ea5e9;color:#fff' : `background:transparent;color:${C.muted}`,
        ].join(';'));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(on));
        b.title = tab.label;
        b.append(icon(tab.icon, 16), el('span', '', tab.label));
        if (!on) b.addEventListener('click', () => opts.onNavTab?.(tab.id));
        title.append(b);
      }
      const st = document.createElement('style');
      st.textContent = '@container (max-width: 980px) { .owp-top [role=tablist] span { display: none; } } @container (max-width: 640px) { .owp-top .owp-modes span { display: none; } }'
        // Sur un téléphone, les onglets prennent toute une ligne au-dessus des actions.
        + ' @container (max-width: 560px) { .owp-top { flex-wrap: wrap; row-gap: 8px; } .owp-top [role=tablist] { order: -1; flex: 1 0 100%; justify-content: space-between; } }';
      top.append(st);
    }
    this.modeBar = el('div', `display:flex;background:${C.chrome2};border:1px solid ${C.line};border-radius:10px;padding:3px;gap:2px;flex-shrink:0;`);
    this.modeBar.className = 'owp-modes';
    this.undoBtn = this.iconButton('undo', t('planUndo'), () => this.undo());
    this.redoBtn = this.iconButton('redo', t('planRedo'), () => this.redo());
    const done = this.pill(t('planDone'), () => this.close(), true, 'check');
    this.doneBtn = done;
    const help = this.iconButton('help', t('edHelp'), () => this.startTour());
    top.append(title, el('div', 'flex:1;'), this.modeBar, el('div', 'flex:1;'), help, this.undoBtn, this.redoBtn, done);

    const body = el('div', 'flex:1;display:flex;min-height:0;');
    this.rail = el('div', `width:78px;flex-shrink:0;display:flex;flex-direction:column;gap:4px;padding:8px 6px;border-right:1px solid ${C.line};overflow-y:auto;`);
    this.stage = el('div', `flex:1;position:relative;min-width:0;background:${C.paper};overflow:hidden;`);
    this.svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;';
    this.stage.append(this.svg);

    this.hintEl = el('div', [
      'position:absolute', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)', 'max-width:calc(100% - 140px)',
      'background:rgba(15,23,42,0.86)', 'color:#e2e8f0', 'font-size:12.5px', 'line-height:1.4', 'padding:7px 14px',
      'border-radius:999px', 'pointer-events:none', 'text-align:center', 'box-shadow:0 4px 14px rgba(0,0,0,0.18)',
    ].join(';'));
    const zoom = el('div', 'position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;');
    zoom.append(
      this.stageButton('plus', () => this.zoomBy(1.25)),
      this.stageButton('minus', () => this.zoomBy(0.8)),
      this.stageButton('fit', () => { this.fit(); this.render(); }),
    );
    this.bubble = el('div', [
      'position:absolute', 'top:12px', 'right:12px', 'width:250px', 'max-height:calc(100% - 24px)', 'overflow-y:auto',
      `background:${C.chrome}`, 'border-radius:14px', 'box-shadow:0 10px 30px rgba(0,0,0,0.28)', 'padding:14px',
      'font-size:12.5px', 'box-sizing:border-box',
    ].join(';'));
    this.stage.append(this.hintEl, zoom, this.bubble);
    body.append(this.rail, this.stage);
    this.panel.append(top, body);

    // En mode 3D, le plan s'efface : une petite barre permet d'y revenir.
    this.floating = el('div', [
      'position:absolute', 'left:12px', 'top:12px', 'display:none', 'gap:8px', 'align-items:center', 'pointer-events:auto',
      `background:${C.chrome}`, 'padding:6px', 'border-radius:12px', 'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
    ].join(';'));

    this.root.append(this.panel, this.floating);
    opts.container.append(this.root);

    this.buildModeBar();
    this.buildRail();
    this.bindPointer();
    // En capture sur la fenêtre : les raccourcis de Home Assistant (« e »,
    // « m »…) ne doivent pas se déclencher pendant qu'on dessine.
    window.addEventListener('keydown', this.onKey, true);
    let fitted = false;
    this.resize = new ResizeObserver(() => {
      const r = this.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (!fitted) { fitted = true; this.fit(); }
      this.render();
      this.layout();
      this.placeFloorBar();
    });
    this.resize.observe(this.root);
    this.setMode(this.plan.walls.length ? 'split' : 'plan');
    this.renderFloorBar();
    this.refresh();
  }

  // ── Cycle de vie ─────────────────────────────────────────────────────────

  close() {
    this.stopPreview();
    window.removeEventListener('keydown', this.onKey, true);
    this.resize.disconnect();
    this.closePopup();
    this.tour?.end();
    this.root.remove();
    this.opts.onClose();
  }

  private layout() {
    const total = this.root.getBoundingClientRect().width;
    // Sur un téléphone, plan et 3D côte à côte seraient trop étroits.
    if (this.mode === 'split' && total < 700) { this.mode = 'plan'; this.buildModeBar(); }
    const w = this.mode === 'plan' ? total : this.mode === 'split' ? Math.round(total * (total < 900 ? 0.6 : 0.55)) : 0;
    this.panel.style.width = `${w}px`;
    this.panel.style.display = this.mode === '3d' ? 'none' : 'flex';
    this.floating.style.display = this.mode === '3d' ? 'flex' : 'none';
    this.opts.onLayout(this.mode === 'plan' ? total : w);
  }

  private setMode(mode: ViewMode) {
    this.mode = mode;
    this.buildModeBar();
    this.layout();
    // Le panneau change de largeur : le plan se recadre une fois installé.
    setTimeout(() => { this.fit(); this.render(); }, 260);
  }

  /** Avant chaque modification : l'état courant part dans l'historique. */
  private commit() {
    this.history.push(clone(this.plan));
    if (this.history.length > 100) this.history.shift();
    this.future = [];
  }

  /**
   * Pendant un glisser, la 3D suit le geste. Une reconstruction coûte
   * quelques millisecondes : on en fait au plus une toutes les 60 ms, et la
   * dernière position part toujours, même si le geste s'arrête net.
   */
  private preview() {
    if (!this.opts.onPreview || this.previewTimer) return;
    const wait = Math.max(0, this.previewAt + PREVIEW_MS - performance.now());
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.previewAt = performance.now();
      if (this.drag) this.opts.onPreview?.(clone(this.plan));
    }, wait);
  }

  private stopPreview() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  /** Le plan a changé : pièces remises d'accord, rendu, et la 3D suit. */
  private changed() {
    this.stopPreview();
    reconcileRooms(this.plan, () => `${t('planRoom')} ${++this.roomCounter}`, () => FLOOR_COLORS[this.roomCounter % FLOOR_COLORS.length]);
    if (this.sel && !this.exists(this.sel)) this.sel = null;
    this.refresh();
    this.opts.onChange(clone(this.plan));
  }

  private refresh() {
    this.render();
    this.renderBubble();
    this.renderEmpty();
    this.hint();
    this.undoBtn.style.opacity = this.history.length ? '1' : '0.35';
    this.redoBtn.style.opacity = this.future.length ? '1' : '0.35';
  }

  private undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(clone(this.plan));
    this.plan = prev;
    this.sel = null;
    this.chain = null;
    this.changed();
  }

  private redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(clone(this.plan));
    this.plan = next;
    this.sel = null;
    this.changed();
  }

  private exists(h: Hit): boolean {
    if (h.type === 'node') return !!nodeOf(this.plan, h.id);
    if (h.type === 'wall') return this.plan.walls.some((w) => w.id === h.id);
    if (h.type === 'opening') return this.plan.openings.some((o) => o.id === h.id);
    if (h.type === 'item') return (this.plan.items ?? []).some((i) => i.id === h.id);
    if (h.type === 'stair') return (this.plan.stairs ?? []).some((i) => i.id === h.id);
    return this.plan.rooms.some((r) => r.id === h.id);
  }

  private onKey = (e: KeyboardEvent) => {
    const target = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    if (this.mode === '3d') return;
    e.stopPropagation();
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Pendant le tracé d'un mur, les chiffres donnent sa longueur.
    if (this.chain && this.chain.pts.length) {
      if (/^[0-9.,]$/.test(e.key)) { e.preventDefault(); this.chain.typed += e.key; this.render(); return; }
      if (e.key === 'Backspace' && this.chain.typed) { e.preventDefault(); this.chain.typed = this.chain.typed.slice(0, -1); this.render(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.chain.typed) this.typedLength();
        else this.endChain();
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); this.chain.pts.pop(); if (!this.chain.pts.length) this.chain = null; this.render(); return; }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.popup) this.closePopup();
      else if (this.chain) { this.endChain(); }
      else if (this.tool !== 'select' && this.tool !== 'furniture') this.setTool('select');
      else { this.sel = null; this.refresh(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.remove(this.sel); return; }
    const tool = TOOLS.find((x) => x.key === k);
    if (tool) { e.preventDefault(); this.setTool(tool.tool); }
  };

  // ── Habillage ────────────────────────────────────────────────────────────

  private iconButton(name: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', `display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid ${C.line};background:${C.chrome2};color:${C.text};cursor:pointer;`);
    b.title = title;
    b.append(icon(name, 18));
    b.addEventListener('click', onClick);
    return b;
  }

  private pill(label: string, onClick: () => void, primary = false, iconName?: string, danger = false): HTMLButtonElement {
    const b = el('button', [
      'display:inline-flex', 'align-items:center', 'gap:6px', 'border-radius:10px', 'padding:7px 13px', 'font-size:12.5px',
      `font-family:${FONT}`, 'cursor:pointer', 'font-weight:600', 'white-space:nowrap',
      primary ? 'background:#0ea5e9;border:1px solid #38bdf8;color:#fff'
        : danger ? 'background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.45);color:#fca5a5'
          : `background:${C.chrome2};border:1px solid rgba(255,255,255,0.12);color:#cbd5e1`,
    ].join(';'));
    if (iconName) b.append(icon(iconName, 16));
    b.append(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  }

  private stageButton(name: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'width:38px;height:38px;border-radius:11px;border:none;background:#fff;color:#334155;box-shadow:0 2px 10px rgba(0,0,0,0.15);cursor:pointer;display:flex;align-items:center;justify-content:center;');
    b.append(icon(name, 18));
    b.addEventListener('click', onClick);
    return b;
  }

  private buildModeBar() {
    this.modeBar.innerHTML = '';
    const modes: [ViewMode, string, StringKey][] = [['plan', 'plan', 'planViewPlan'], ['split', 'split', 'planViewSplit'], ['3d', 'cube', 'planView3d']];
    for (const [mode, ic, label] of modes) {
      const on = this.mode === mode;
      const b = el('button', [
        'display:flex', 'align-items:center', 'gap:6px', 'padding:5px 10px', 'border-radius:8px', 'border:none', 'cursor:pointer',
        `font-family:${FONT}`, 'font-size:12px', 'font-weight:600',
        on ? 'background:#0ea5e9;color:#fff' : `background:transparent;color:${C.muted}`,
      ].join(';'));
      b.title = t(label);
      b.append(icon(ic, 16), el('span', '', t(label)));
      b.addEventListener('click', () => this.setMode(mode));
      this.modeBar.append(b);
    }
    // Barre flottante du mode 3D.
    this.floating.innerHTML = '';
    this.floating.append(
      this.pill(t('planBackToPlan'), () => this.setMode('split'), false, 'pencil'),
      this.pill(t('planDone'), () => this.close(), true, 'check'),
    );
  }

  private buildRail() {
    this.rail.innerHTML = '';
    for (const { tool, icon: ic, label, key } of TOOLS) {
      const on = this.tool === tool;
      const b = el('button', [
        'display:flex', 'flex-direction:column', 'align-items:center', 'gap:4px', 'padding:9px 2px 7px', 'border-radius:12px',
        'cursor:pointer', `font-family:${FONT}`, 'font-size:10.5px', 'font-weight:600', 'line-height:1.15', 'text-align:center',
        on ? 'background:#0ea5e9;color:#fff;border:1px solid #38bdf8'
          : `background:transparent;color:${tool === 'erase' ? '#fca5a5' : '#cbd5e1'};border:1px solid transparent`,
      ].join(';'));
      b.title = `${t(label)} (${key.toUpperCase()})`;
      b.dataset.tool = tool;
      b.append(icon(ic, 24), el('span', '', t(label)));
      b.addEventListener('click', () => this.setTool(tool));
      if (tool === 'door' || tool === 'furniture' || tool === 'erase') this.rail.append(el('div', `height:1px;background:${C.line};margin:4px 6px;`));
      this.rail.append(b);
    }
  }

  private setTool(tool: Tool) {
    if (this.chain) this.endChain();
    this.tool = tool;
    this.calib = null;
    this.hover = null;
    this.guides = [];
    this.svg.style.cursor = tool === 'select' ? 'default' : tool === 'image' ? 'move' : tool === 'erase' ? 'pointer' : 'crosshair';
    this.buildRail();
    this.renderDrawer();
    this.refresh();
  }

  /** Outils où l'on attrape et tire ce qui est dessiné. */
  private get picking() {
    return this.tool === 'select' || this.tool === 'furniture';
  }

  private hint() {
    let key: StringKey;
    switch (this.tool) {
      case 'select': key = this.sel ? 'planHintSelected' : 'planHintSelect'; break;
      case 'furniture': key = 'planHintFurniture'; break;
      case 'stairs': key = 'planHintStairs'; break;
      case 'room': key = 'planHintRoom'; break;
      case 'wall': key = this.chain?.pts.length ? 'planHintWall2' : 'planHintWall'; break;
      case 'boundary': key = this.chain?.pts.length ? 'planHintWall2' : 'planHintBoundary'; break;
      case 'erase': key = 'planHintErase'; break;
      case 'calibrate': key = this.calib ? 'planHintCalib2' : 'planHintCalib1'; break;
      case 'image': key = 'planHintImage'; break;
      default: key = this.plan.walls.length ? 'planHintOpening' : 'planHintNoWalls';
    }
    this.hintEl.textContent = t(key);
  }

  // ── Vue ──────────────────────────────────────────────────────────────────

  private box() {
    const r = this.svg.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width || 600, h: r.height || 400 };
  }

  /** Cadre le dessin (ou une zone de 12 m s'il est vide). */
  private fit() {
    const { w, h } = this.box();
    let x0 = -6, x1 = 6, y0 = -4, y1 = 4;
    if (this.plan.nodes.length) {
      x0 = Math.min(...this.plan.nodes.map((n) => n.x)); x1 = Math.max(...this.plan.nodes.map((n) => n.x));
      y0 = Math.min(...this.plan.nodes.map((n) => n.y)); y1 = Math.max(...this.plan.nodes.map((n) => n.y));
    }
    // La bulle de réglages couvre la droite, le tiroir des meubles la gauche :
    // on cadre dans ce qui reste.
    const left = this.drawer ? DRAWER_W : 0;
    const usable = Math.max(w - left - 280, (w - left) * 0.55);
    this.view.scale = Math.max(12, Math.min(140, Math.min(usable / (x1 - x0 + 2.5), (h - 80) / (y1 - y0 + 2.5))));
    this.view.cx = (x0 + x1) / 2 - (left + usable / 2 - w / 2) / this.view.scale;
    this.view.cy = (y0 + y1) / 2;
  }

  private zoomBy(k: number, at?: { clientX: number; clientY: number }) {
    const b = this.box();
    const anchor = at ?? { clientX: b.left + b.w / 2, clientY: b.top + b.h / 2 };
    const before = this.toPlan(anchor);
    this.view.scale = Math.max(8, Math.min(400, this.view.scale * k));
    const after = this.toPlan(anchor);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;
    this.render();
  }

  /** Point de l'écran, en mètres. */
  private toPlan(e: { clientX: number; clientY: number }): Pt {
    const b = this.box();
    return {
      x: this.view.cx + (e.clientX - b.left - b.w / 2) / this.view.scale,
      y: this.view.cy + (e.clientY - b.top - b.h / 2) / this.view.scale,
    };
  }

  /** Point du plan, en pixels dans la scène. */
  private toStage(p: Pt): { x: number; y: number } {
    const b = this.box();
    return { x: (p.x - this.view.cx) * this.view.scale + b.w / 2, y: (p.y - this.view.cy) * this.view.scale + b.h / 2 };
  }

  private px(n: number) { return n / this.view.scale; }

  // ── Accroche ─────────────────────────────────────────────────────────────

  /**
   * Où tombe un point qu'on pose : sur un coin proche, sur un mur proche, ou
   * sur la grille ; et aligné sur les coins existants quand il passe à leur
   * hauteur (les guides en pointillés le montrent).
   */
  private snap(p: Pt, skip: ReadonlySet<string> = new Set(), from?: Pt): { p: Pt; guides: Guide[]; on: 'node' | 'wall' | 'free' } {
    const tol = this.px(GRAB);
    const nodes = this.plan.nodes.filter((n) => !skip.has(n.id));
    let best: Pt | null = null, bd = tol;
    for (const n of nodes) { const d = dist(n, p); if (d < bd) { bd = d; best = n; } }
    if (best) return { p: { x: best.x, y: best.y }, guides: [], on: 'node' };

    let q = { ...p };
    // Depuis le point précédent, les directions franches attirent.
    if (from) {
      const v = sub(q, from), l = Math.hypot(v.x, v.y);
      if (l > 1e-6) {
        const ang = Math.atan2(v.y, v.x), step = Math.PI / 4;
        const k = Math.round(ang / step) * step;
        if (Math.abs(ang - k) < 0.07) {
          const len = Math.round(l / STEP) * STEP;
          q = add(from, { x: Math.cos(k) * len, y: Math.sin(k) * len });
          q = { x: round3(q.x), y: round3(q.y) };
        }
      }
    }
    for (const w of this.plan.walls) {
      if (skip.has(w.a) || skip.has(w.b)) continue;
      const [a, b] = wallEnds(this.plan, w);
      const pr = project(q, a, b);
      if (pr.d < tol * 0.8 && pr.t > 0 && pr.t < 1) {
        // Sur le mur, au pas de la grille le long de lui.
        const L = dist(a, b), u = Math.round((pr.t * L) / STEP) * STEP;
        return { p: add(a, mul(norm(sub(b, a)), Math.min(Math.max(u, 0), L))), guides: [], on: 'wall' };
      }
    }
    const guides: Guide[] = [];
    let gx: number | null = null, gy: number | null = null, dx = tol * 0.7, dy = tol * 0.7;
    for (const n of nodes) {
      if (Math.abs(n.x - q.x) < dx) { dx = Math.abs(n.x - q.x); gx = n.x; }
      if (Math.abs(n.y - q.y) < dy) { dy = Math.abs(n.y - q.y); gy = n.y; }
    }
    const out = {
      x: gx ?? (from && Math.abs(q.x - from.x) < 1e-6 ? q.x : Math.round(q.x / STEP) * STEP),
      y: gy ?? (from && Math.abs(q.y - from.y) < 1e-6 ? q.y : Math.round(q.y / STEP) * STEP),
    };
    if (gx !== null) guides.push({ x: gx });
    if (gy !== null) guides.push({ y: gy });
    return { p: { x: round3(out.x), y: round3(out.y) }, guides, on: 'free' };
  }

  // ── Ce qu'il y a sous le doigt ───────────────────────────────────────────

  private hitAt(p: Pt, opts: { nodes?: boolean } = {}): Hit | null {
    const tol = this.px(GRAB);
    // Ouvertures d'abord : elles sont posées sur les murs.
    for (const o of this.plan.openings) {
      const w = this.plan.walls.find((q) => q.id === o.wall);
      if (!w) continue;
      const [a, b] = wallEnds(this.plan, w);
      const d = norm(sub(b, a)), v = sub(p, a);
      const u = dot(v, d) - o.offset, across = Math.abs(dot(v, perp(d)));
      if (Math.abs(u) <= o.width / 2 + tol * 0.3 && across <= thicknessOf(this.plan, w) / 2 + tol * 0.6) return { type: 'opening', id: o.id };
    }
    if (opts.nodes !== false) {
      const n = nodeAt(this.plan, p, tol);
      if (n) return { type: 'node', id: n.id };
    }
    // Les meubles, du plus petit au plus grand : on attrape la lampe posée sur la table.
    const items = [...(this.plan.items ?? [])].sort((a, b) => { const sa = itemSize(a), sb = itemSize(b); return sa.w * sa.d - sb.w * sb.d; });
    for (const it of items) if (this.inItem(it, p, tol * 0.3)) return { type: 'item', id: it.id };
    for (const st of this.plan.stairs ?? []) if (inStair(st, stairRise(this.plan), p, tol * 0.3)) return { type: 'stair', id: st.id };
    const w = wallAt(this.plan, p, tol * 0.8);
    if (w) return { type: 'wall', id: w.wall.id };
    const r = roomAtPoint(this.plan, p, this.all);
    if (r) return { type: 'room', id: r.roomId };
    return null;
  }

  private same(a: Hit | null, b: Hit | null) { return !!a && !!b && a.type === b.type && a.id === b.id; }

  // ── Souris et doigts ─────────────────────────────────────────────────────

  private bindPointer() {
    const svg = this.svg;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Pavé tactile : deux doigts déplacent, pincer (ctrl) zoome.
      if (!e.ctrlKey && Math.abs(e.deltaX) > 0 && e.deltaMode === 0 && Math.abs(e.deltaY) < 40) {
        this.view.cx += e.deltaX / this.view.scale;
        this.view.cy += e.deltaY / this.view.scale;
        this.render();
        return;
      }
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e);
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.onUp(e);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.cursor = null; this.render(); } });
    svg.addEventListener('dblclick', (e) => this.onDouble(e));
    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.contextMenu(e.clientX, e.clientY);
    });
  }

  private onDown(e: PointerEvent) {
    this.closePopup();
    this.svg.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // Deux doigts : on oublie le geste commencé, c'est un pincement.
        this.cancelGesture();
        const [a, b] = [...this.touches.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale, mid: this.toPlan({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
        return;
      }
      this.longPress = setTimeout(() => { this.longPress = null; this.cancelGesture(); this.contextMenu(e.clientX, e.clientY); }, 550);
    }
    if (e.button === 2) return;
    this.moved = false;
    this.downAt = { x: e.clientX, y: e.clientY };
    const p = this.toPlan(e);
    const pan = () => { this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.view.cx, cy: this.view.cy }; };
    if (e.button === 1) { pan(); return; }

    switch (this.tool) {
      case 'room': {
        const s = this.snap(p);
        this.drag = { kind: 'rect', a: s.p, b: s.p };
        return;
      }
      case 'wall': case 'boundary': this.chainClick(p); return;
      case 'door': case 'window': case 'slider': case 'passage': this.placeOpening(this.tool, p); return;
      case 'stairs': this.placeStair(p); return;
      case 'erase': {
        const h = this.hitAt(p);
        if (h) this.remove(h); else pan();
        return;
      }
      case 'calibrate': this.calibrateClick(p); return;
      case 'image':
        if (this.plan.background) {
          this.commit();
          this.drag = { kind: 'image', from: p, ox: this.plan.background.x, oy: this.plan.background.y };
        }
        return;
    }

    // Sélection : on prend ce qui est sous le doigt, et on peut le tirer.
    const h = this.hitAt(p);
    this.sel = h;
    if (!h) { pan(); this.refresh(); return; }
    this.commit();
    if (h.type === 'node') {
      this.drag = { kind: 'node', id: h.id, shapes: roomShapes(this.plan, this.all) };
    } else if (h.type === 'wall') {
      const w = this.plan.walls.find((q) => q.id === h.id)!;
      const [a, b] = wallEnds(this.plan, w);
      const orig = new Map([[w.a, { ...a }], [w.b, { ...b }]]);
      this.drag = { kind: 'wall', id: h.id, from: p, normal: perp(norm(sub(b, a))), orig, shapes: roomShapes(this.plan, this.all), detached: false };
    } else if (h.type === 'opening') {
      const o = this.plan.openings.find((q) => q.id === h.id)!;
      const w = this.plan.walls.find((q) => q.id === o.wall)!;
      const [a, b] = wallEnds(this.plan, w);
      this.drag = { kind: 'opening', id: h.id, grab: dot(sub(p, a), norm(sub(b, a))) - o.offset };
    } else if (h.type === 'item') {
      const it = this.item(h.id)!;
      this.drag = { kind: 'item', id: h.id, grab: sub(p, it) };
      this.stuck = null;
    } else if (h.type === 'stair') {
      const st = this.stair(h.id)!;
      this.drag = { kind: 'stair', id: h.id, grab: sub(p, st) };
    } else {
      const face = this.all.find((f) => f.nodes.length && pointInPolygon(this.plan.rooms.find((r) => r.id === h.id)!.seed, f.poly));
      // Une pièce seule (aucun mur partagé) se déplace d'un bloc ; une pièce
      // collée aux autres ne bouge pas : on tire plutôt ses murs.
      if (face && this.isLoose(face)) {
        const orig = new Map(face.nodes.map((id) => [id, { ...nodeOf(this.plan, id)! }]));
        this.drag = { kind: 'room', id: h.id, from: p, orig, shapes: roomShapes(this.plan, this.all) };
      } else {
        this.history.pop();
        pan();
      }
    }
    this.refresh();
  }

  /** Une pièce dont les coins ne servent à aucun autre mur. */
  private isLoose(face: Face): boolean {
    const set = new Set(face.nodes);
    return this.plan.walls.every((w) => set.has(w.a) === set.has(w.b));
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.view.scale = Math.max(8, Math.min(400, this.pinch.scale * (d / this.pinch.d)));
        const now = this.toPlan({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        this.view.cx += this.pinch.mid.x - now.x;
        this.view.cy += this.pinch.mid.y - now.y;
        this.render();
        return;
      }
    }
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4 && this.longPress) {
      clearTimeout(this.longPress); this.longPress = null;
    }
    const p = this.toPlan(e);
    this.cursor = p;
    const d = this.drag;

    if (!d) {
      this.guides = [];
      if (this.picking || this.tool === 'erase') {
        const h = this.hitAt(p);
        if (!this.same(h, this.hover)) { this.hover = h; this.render(); }
        this.svg.style.cursor = this.tool === 'erase' ? (h ? 'pointer' : 'default')
          : h?.type === 'node' || h?.type === 'opening' || h?.type === 'item' ? 'grab'
            : h?.type === 'wall' ? this.wallCursor(h.id) : 'default';
        return;
      }
      if (this.tool === 'wall' || this.tool === 'boundary' || this.tool === 'room') {
        const last = this.chain?.pts[this.chain.pts.length - 1];
        const s = this.snap(p, new Set(), last);
        this.guides = s.guides;
        if (this.chain) this.chain.cursor = s.p;
        this.cursor = s.p;
      }
      this.render();
      return;
    }

    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 3) this.moved = true;
    if (!this.moved) return;
    switch (d.kind) {
      case 'pan':
        this.view.cx = d.cx - (e.clientX - d.sx) / this.view.scale;
        this.view.cy = d.cy - (e.clientY - d.sy) / this.view.scale;
        break;
      case 'rect': {
        const s = this.snap(p);
        d.b = s.p; this.guides = s.guides;
        break;
      }
      case 'node': {
        const s = this.snap(p, new Set([d.id]));
        moveNode(this.plan, d.id, s.p);
        this.guides = s.guides;
        this.live(d.shapes);
        break;
      }
      case 'wall': {
        // Le mur glisse parallèlement à lui-même, au centimètre près, et
        // s'aligne sur les coins qu'il croise.
        let k = dot(sub(p, d.from), d.normal);
        k = Math.round(k / 0.01) * 0.01;
        const [a0] = [...d.orig.values()];
        const tol = this.px(GRAB) * 0.7;
        let guide: Guide | null = null;
        for (const n of this.plan.nodes) {
          if (d.orig.has(n.id)) continue;
          const off = dot(sub(n, a0), d.normal);
          if (Math.abs(off - k) < tol) {
            k = off;
            guide = Math.abs(d.normal.x) > 0.99 ? { x: n.x } : Math.abs(d.normal.y) > 0.99 ? { y: n.y } : null;
            break;
          }
        }
        if (!d.detached && Math.abs(k) > 1e-6) { d.detached = true; this.detachWall(d.id, d.orig); }
        for (const [id, o] of d.orig) moveNode(this.plan, id, add(o, mul(d.normal, k)));
        this.guides = guide ? [guide] : [];
        this.live(d.shapes);
        break;
      }
      case 'room': {
        let delta = sub(p, d.from);
        delta = { x: Math.round(delta.x / STEP) * STEP, y: Math.round(delta.y / STEP) * STEP };
        // Un coin de la pièce qui passe près d'un autre coin s'y colle.
        const tol = this.px(GRAB);
        outer: for (const o of d.orig.values()) {
          for (const n of this.plan.nodes) {
            if (d.orig.has(n.id)) continue;
            const q = add(o, delta);
            if (dist(q, n) < tol) { delta = sub(n, o); break outer; }
          }
        }
        for (const [id, o] of d.orig) moveNode(this.plan, id, add(o, delta));
        this.live(d.shapes);
        break;
      }
      case 'opening': {
        const o = this.plan.openings.find((q) => q.id === d.id);
        if (!o) break;
        // Elle glisse sur son mur, ou saute sur un autre si on l'y emmène.
        const hit = wallAt(this.plan, p, this.px(GRAB * 2));
        if (hit && hit.wall.id !== o.wall && wallLength(this.plan, hit.wall) >= o.width + 0.05) {
          o.wall = hit.wall.id;
          d.grab = 0;
        }
        const w = this.plan.walls.find((q) => q.id === o.wall)!;
        const [a, b] = wallEnds(this.plan, w);
        const L = dist(a, b);
        const u = Math.round((dot(sub(p, a), norm(sub(b, a))) - d.grab) / 0.01) * 0.01;
        o.offset = round3(Math.min(Math.max(u, o.width / 2), L - o.width / 2));
        break;
      }
      case 'image':
        if (this.plan.background) {
          this.plan.background.x = d.ox + p.x - d.from.x;
          this.plan.background.y = d.oy + p.y - d.from.y;
        }
        break;
      case 'item': {
        const it = this.item(d.id);
        if (it) this.moveItem(it, sub(p, d.grab), e.altKey || !this.magnet);
        break;
      }
      case 'stair': {
        const st = this.stair(d.id);
        if (st) {
          const to = sub(p, d.grab);
          st.x = Math.round(to.x / STEP) * STEP;
          st.y = Math.round(to.y / STEP) * STEP;
        }
        break;
      }
    }
    if (d.kind !== 'pan' && d.kind !== 'rect' && d.kind !== 'image') this.preview();
    this.render();
  }

  /**
   * Avant de pousser un mur : là où il se prolonge par un autre mur aligné
   * (le mur du salon qui continue le long de la chambre), il s'en détache et
   * un petit mur de raccord les relie. Seule la pièce qu'on pousse change ;
   * la voisine garde sa forme.
   */
  private detachWall(id: string, orig: Map<string, Pt>) {
    const w = this.plan.walls.find((q) => q.id === id);
    if (!w) return;
    const [a, b] = wallEnds(this.plan, w);
    const dir = norm(sub(b, a));
    for (const end of ['a', 'b'] as const) {
      const nodeId = w[end];
      const n = nodeOf(this.plan, nodeId)!;
      const continued = this.plan.walls.some((q) => {
        if (q === w || (q.a !== nodeId && q.b !== nodeId)) return false;
        const [p, r] = wallEnds(this.plan, q);
        return Math.abs(dir.x * (r.y - p.y) - dir.y * (r.x - p.x)) / dist(p, r) < 1e-3;
      });
      if (!continued) continue;
      const m = { id: newId('n'), x: n.x, y: n.y };
      this.plan.nodes.push(m);
      w[end] = m.id;
      this.plan.walls.push({ id: newId('w'), a: nodeId, b: m.id, ...(w.thickness !== undefined ? { thickness: w.thickness } : {}), ...(w.height !== undefined ? { height: w.height } : {}) });
      const o = orig.get(nodeId)!;
      orig.delete(nodeId);
      orig.set(m.id, o);
    }
  }

  private wallCursor(id: string): string {
    const w = this.plan.walls.find((q) => q.id === id);
    if (!w) return 'default';
    const [a, b] = wallEnds(this.plan, w);
    const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) % Math.PI;
    return ang < Math.PI / 8 || ang > (7 * Math.PI) / 8 ? 'ns-resize' : Math.abs(ang - Math.PI / 2) < Math.PI / 8 ? 'ew-resize' : 'move';
  }

  /** Pendant un geste : les pièces gardent leur nom, la vue suit. */
  private live(shapes: Map<string, string[]>) {
    this.all = faces(this.plan);
    reseedRooms(this.plan, shapes, this.all);
  }

  private onUp(e: PointerEvent) {
    if (this.longPress) { clearTimeout(this.longPress); this.longPress = null; }
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    }
    const d = this.drag;
    this.drag = null;
    this.guides = [];
    if (!d) return;
    switch (d.kind) {
      case 'pan': this.render(); return;
      case 'rect': {
        const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x);
        const y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
        if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) { this.render(); return; }
        this.commit();
        addRect(this.plan, x0, y0, x1, y1);
        this.changed();
        // La pièce tracée est sélectionnée : on peut tout de suite la nommer.
        const r = roomAtPoint(this.plan, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, this.all);
        if (r) { this.sel = { type: 'room', id: r.roomId }; this.refresh(); }
        return;
      }
      case 'node': case 'wall': case 'room': case 'opening': case 'image': case 'item': case 'stair':
        if (!this.moved) { this.history.pop(); this.refresh(); return; }
        if (d.kind !== 'opening' && d.kind !== 'image' && d.kind !== 'item' && d.kind !== 'stair') {
          settle(this.plan);
          this.all = faces(this.plan);
          reseedRooms(this.plan, d.shapes, this.all);
          if (d.kind === 'node' && !nodeOf(this.plan, d.id)) this.sel = null;
        }
        this.changed();
        return;
    }
  }

  private cancelGesture() {
    this.stopPreview();
    if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'rect' && this.moved) {
      const prev = this.history.pop();
      if (prev) {
        this.plan = prev;
        // La 3D a suivi le geste : elle revient avec le plan.
        this.opts.onPreview?.(clone(this.plan));
      }
    }
    this.drag = null;
    this.render();
  }

  private onDouble(e: MouseEvent) {
    if (this.tool === 'wall' || this.tool === 'boundary') { this.endChain(); return; }
    if (!this.picking) return;
    const p = this.toPlan(e);
    const h = this.hitAt(p);
    if (h?.type === 'room') this.rename(h.id);
    else if (h?.type === 'wall') this.addCorner(h.id, p);
    else if (h?.type === 'opening') this.flipOpening(h.id, 'swing');
    else if (h?.type === 'item') this.rotateItem(h.id, 90);
    else if (h?.type === 'stair') this.turnStair(h.id, 90);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Un clic de l'outil Mur : pose un point, et ferme le tracé sur un coin existant. */
  private chainClick(p: Pt) {
    const last = this.chain?.pts[this.chain.pts.length - 1];
    const s = this.snap(p, new Set(), last);
    if (!this.chain || !this.chain.pts.length) {
      this.chain = { pts: [s.p], cursor: s.p, typed: '' };
      this.refresh();
      return;
    }
    this.pushChainPoint(s.p, s.on !== 'free');
  }

  private pushChainPoint(q: Pt, landed: boolean) {
    const chain = this.chain!;
    const last = chain.pts[chain.pts.length - 1];
    if (dist(last, q) < MIN_SIDE / 4) { this.endChain(); return; }
    this.commit();
    // Une limite de pièce est un mur de hauteur nulle : invisible en 3D, elle ferme la pièce.
    addWall(this.plan, last, q, this.tool === 'boundary' ? { height: 0 } : {});
    chain.pts.push(q);
    chain.typed = '';
    this.changed();
    // Retour sur le point de départ, ou sur un mur déjà là : le tracé est fini.
    if (landed || dist(q, chain.pts[0]) < 1e-3) this.chain = null;
    this.hint();
    this.render();
  }

  /** Longueur tapée au clavier : le mur part dans la direction du curseur. */
  private typedLength() {
    const chain = this.chain!;
    const L = parseNum(chain.typed);
    if (!(L > 0.05)) { chain.typed = ''; this.render(); return; }
    const last = chain.pts[chain.pts.length - 1];
    let dir = sub(chain.cursor, last);
    if (Math.hypot(dir.x, dir.y) < 1e-6) dir = { x: 1, y: 0 };
    const q = add(last, mul(norm(dir), L));
    this.pushChainPoint({ x: round3(q.x), y: round3(q.y) }, false);
  }

  private endChain() {
    this.chain = null;
    this.refresh();
  }

  private placeOpening(kind: OpeningKind, p: Pt) {
    const hit = wallAt(this.plan, p, this.px(GRAB * 2));
    if (!hit) { this.flash(t('planNoWall')); return; }
    const def = OPENING_DEFAULTS[kind];
    const L = wallLength(this.plan, hit.wall);
    const width = Math.min(def.width, L - 0.1);
    if (width < 0.4) { this.flash(t('planNoWall')); return; }
    this.commit();
    const o: PlanOpening = {
      id: newId('o'), kind, wall: hit.wall.id,
      offset: round3(Math.min(Math.max(hit.offset, width / 2), L - width / 2)),
      ...def, width, hinge: 'start', swing: 'front',
      ...(kind === 'window' && width >= 1 ? { double: true } : {}),
    };
    this.plan.openings.push(o);
    this.sel = { type: 'opening', id: o.id };
    this.changed();
  }

  private addCorner(wallId: string, p: Pt) {
    this.commit();
    const n = splitWall(this.plan, wallId, p);
    this.sel = { type: 'node', id: n.id };
    this.changed();
  }

  private flipOpening(id: string, what: 'hinge' | 'swing') {
    const o = this.plan.openings.find((q) => q.id === id);
    if (!o) return;
    this.commit();
    if (what === 'hinge') o.hinge = o.hinge === 'start' ? 'end' : 'start';
    else o.swing = o.swing === 'front' ? 'back' : 'front';
    this.changed();
  }

  /** Supprime ce qu'on montre : une pièce emporte les murs qu'elle ne partage pas. */
  private remove(h: Hit) {
    this.commit();
    if (h.type === 'opening') {
      this.plan.openings = this.plan.openings.filter((o) => o.id !== h.id);
    } else if (h.type === 'item') {
      this.plan.items = (this.plan.items ?? []).filter((i) => i.id !== h.id);
    } else if (h.type === 'stair') {
      this.plan.stairs = (this.plan.stairs ?? []).filter((i) => i.id !== h.id);
    } else if (h.type === 'wall') {
      removeWall(this.plan, h.id);
    } else if (h.type === 'node') {
      for (const w of this.plan.walls.filter((q) => q.a === h.id || q.b === h.id)) removeWall(this.plan, w.id);
    } else {
      const room = this.plan.rooms.find((r) => r.id === h.id);
      const f = room && this.all.filter((g) => pointInPolygon(room.seed, g.poly)).sort((a, b) => a.area - b.area)[0];
      if (f) {
        const others = this.all.filter((g) => g !== f);
        const edge = (u: string, v: string) => (g: Face) =>
          g.nodes.some((n, i) => { const m = g.nodes[(i + 1) % g.nodes.length]; return (n === u && m === v) || (n === v && m === u); });
        for (let i = 0; i < f.nodes.length; i++) {
          const u = f.nodes[i], v = f.nodes[(i + 1) % f.nodes.length];
          if (others.some(edge(u, v))) continue;
          const w = this.plan.walls.find((q) => (q.a === u && q.b === v) || (q.a === v && q.b === u));
          if (w) this.plan.walls = this.plan.walls.filter((q) => q !== w);
        }
        this.plan.openings = this.plan.openings.filter((o) => this.plan.walls.some((w) => w.id === o.wall));
        this.plan.rooms = this.plan.rooms.filter((r) => r.id !== h.id);
        cleanup(this.plan);
      }
    }
    if (this.same(this.sel, h)) this.sel = null;
    this.hover = null;
    this.changed();
  }

  private rename(roomId: string) {
    const room = this.plan.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const at = this.toStage(room.seed);
    this.ask(at, room.name, 'text', (v) => {
      if (!v.trim() || v.trim() === room.name) return;
      this.commit();
      room.name = v.trim();
      this.changed();
    });
  }

  private calibrateClick(p: Pt) {
    if (!this.calib) { this.calib = p; this.hint(); this.render(); return; }
    const a = this.calib;
    this.calib = null;
    const measured = dist(a, p);
    const at = this.toStage({ x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 });
    this.render(p, a);
    this.ask(at, measured.toFixed(2), 'number', (v) => {
      const real = parseNum(v);
      const bg = this.plan.background;
      if (bg && real > 0 && measured > 1e-3) {
        this.commit();
        // L'image grandit autour du premier point mesuré.
        const k = real / measured;
        bg.x = a.x + (bg.x - a.x) * k;
        bg.y = a.y + (bg.y - a.y) * k;
        bg.width *= k;
        this.changed();
        this.fit();
      }
      this.setTool('select');
    }, t('planCalibAsk'));
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

  private async useTemplate(id: TemplateId) {
    // Les meubles du modèle se posent d'après leurs vraies dimensions : on les
    // charge d'abord (une fraction de seconde, puis ils sont en cache).
    this.hintEl.textContent = t('planTemplateLoading');
    await Promise.all(templateModels(id).map((m) => loadFurniture(m).catch(() => null)));
    this.commit();
    const bg = this.plan.background;
    this.plan = templatePlan(id, this.plan, baseSize);
    this.plan.background = bg;
    this.roomCounter = this.plan.rooms.length;
    this.sel = null;
    this.fit();
    this.changed();
    if (this.mode === 'plan') this.setMode('split');
  }

  // ── Bulles ───────────────────────────────────────────────────────────────

  private closePopup() {
    this.popup?.remove();
    this.popup = null;
  }

  private placePopup(box: HTMLElement, at: { x: number; y: number }) {
    this.closePopup();
    this.stage.append(box);
    this.popup = box;
    const r = box.getBoundingClientRect(), s = this.box();
    box.style.left = `${Math.max(8, Math.min(at.x, s.w - r.width - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(at.y, s.h - r.height - 8))}px`;
  }

  /**
   * Une question à valider, au milieu du plan : un clic à côté ou Échap
   * l'écarte. Remplace `window.confirm`, qui fige la page et ne suit ni le
   * thème ni la langue de l'éditeur.
   */
  private confirmBox(text: string, yes: string, onYes: () => void) {
    const box = el('div', `position:absolute;background:${C.chrome};border:1px solid ${C.line};border-radius:14px;padding:16px;box-shadow:0 16px 40px rgba(0,0,0,0.35);display:flex;flex-direction:column;gap:14px;z-index:6;max-width:300px;`);
    box.setAttribute('role', 'alertdialog');
    box.append(el('div', 'font-size:14px;line-height:1.45;color:#e2e8f0;', text));
    const cancel = this.pill(t('btnCancel'), () => this.closePopup());
    const ok = this.pill(yes, () => { this.closePopup(); onYes(); }, false, 'trash', true);
    const row = el('div', 'display:flex;gap:8px;justify-content:flex-end;');
    row.append(cancel, ok);
    box.append(row);
    const s = this.box();
    this.placePopup(box, { x: 0, y: 0 });
    const r = box.getBoundingClientRect();
    box.style.left = `${Math.max(8, (s.w - r.width) / 2)}px`;
    box.style.top = `${Math.max(8, (s.h - r.height) / 2)}px`;
    setTimeout(() => cancel.focus(), 0);
  }

  /** Une petite question posée sur le plan (un nom, une longueur). */
  private ask(at: { x: number; y: number }, value: string, type: 'text' | 'number', done: (v: string) => void, label?: string) {
    const box = el('div', `position:absolute;background:${C.chrome};border-radius:12px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:8px;z-index:5;`);
    if (label) box.append(el('div', 'font-size:12px;color:#cbd5e1;max-width:220px;', label));
    const row = el('div', 'display:flex;gap:6px;align-items:center;');
    const input = el('input', `width:${type === 'number' ? 90 : 180}px;background:${C.chrome2};border:1px solid #38bdf8;border-radius:8px;color:#fff;padding:7px 9px;font-size:14px;font-family:${FONT};outline:none;`);
    input.value = value;
    input.inputMode = type === 'number' ? 'decimal' : 'text';
    const ok = this.iconButton('check', 'OK', () => { this.closePopup(); done(input.value); });
    row.append(input);
    if (type === 'number') row.append(el('span', 'color:#94a3b8;', 'm'));
    row.append(ok);
    box.append(row);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.closePopup(); done(input.value); }
      if (e.key === 'Escape') this.closePopup();
    });
    this.placePopup(box, { x: at.x - 60, y: at.y - 20 });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  private flash(text: string) {
    this.hintEl.textContent = text;
    this.hintEl.style.background = 'rgba(239,68,68,0.92)';
    setTimeout(() => { this.hintEl.style.background = 'rgba(15,23,42,0.86)'; this.hint(); }, 1800);
  }

  /** Menu du clic droit (ou d'un appui long) : ce qu'on peut faire ici. */
  private contextMenu(clientX: number, clientY: number) {
    const p = this.toPlan({ clientX, clientY });
    const h = this.hitAt(p);
    const items: [string, string, () => void, boolean?][] = [];
    if (h?.type === 'room') {
      this.sel = h;
      items.push(['pencil', t('planRename'), () => this.rename(h.id)]);
      items.push(['trash', t('planDeleteRoom'), () => this.remove(h), true]);
    } else if (h?.type === 'wall') {
      this.sel = h;
      items.push(['corner', t('planAddCorner'), () => this.addCorner(h.id, p)]);
      items.push(['door', t('planAddDoorHere'), () => this.placeOpening('door', p)]);
      items.push(['window', t('planAddWindowHere'), () => this.placeOpening('window', p)]);
      items.push(['trash', t('planDeleteWall'), () => this.remove(h), true]);
    } else if (h?.type === 'opening') {
      this.sel = h;
      items.push(['flip', t('planFlipHinge'), () => this.flipOpening(h.id, 'hinge')]);
      items.push(['swap', t('planFlipSide'), () => this.flipOpening(h.id, 'swing')]);
      items.push(['trash', t('planDelete'), () => this.remove(h), true]);
    } else if (h?.type === 'node') {
      this.sel = h;
      items.push(['trash', t('planDeleteCorner'), () => this.remove(h), true]);
    } else if (h?.type === 'item') {
      this.sel = h;
      items.push(['rotr', t('planRotate'), () => this.rotateItem(h.id, 90)]);
      items.push(['copy', t('planDuplicate'), () => this.duplicateItem(h.id)]);
      items.push(['trash', t('planDelete'), () => this.remove(h), true]);
    } else if (h?.type === 'stair') {
      this.sel = h;
      items.push(['rotr', t('planRotate'), () => this.turnStair(h.id, 90)]);
      items.push(['swap', t('planStairFlip'), () => this.turnStair(h.id, 180)]);
      items.push(['trash', t('planDelete'), () => this.remove(h), true]);
    } else {
      items.push(['room', t('planToolRoom'), () => this.setTool('room')]);
      items.push(['wall', t('planToolWall'), () => this.setTool('wall')]);
      items.push(['fit', t('planFit'), () => { this.fit(); this.render(); }]);
    }
    this.refresh();
    const box = el('div', `position:absolute;background:${C.chrome};border-radius:12px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,0.3);min-width:190px;z-index:5;`);
    for (const [ic, label, run, danger] of items) {
      const b = el('button', `display:flex;width:100%;align-items:center;gap:10px;padding:9px 10px;border:none;border-radius:8px;background:transparent;color:${danger ? '#fca5a5' : C.text};font-size:13px;font-family:${FONT};cursor:pointer;text-align:left;`);
      b.append(icon(ic, 18), document.createTextNode(label));
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,0.07)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      b.addEventListener('click', () => { this.closePopup(); run(); });
      box.append(b);
    }
    const s = this.box();
    this.placePopup(box, { x: clientX - s.left, y: clientY - s.top });
  }

  // ── Dessin ───────────────────────────────────────────────────────────────

  private render(cursor?: Pt, calibFrom?: Pt) {
    const svg = this.svg;
    const { w, h } = this.box();
    const s = this.view.scale;
    const vw = w / s, vh = h / s;
    const vx = this.view.cx - vw / 2, vy = this.view.cy - vh / 2;
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    svg.innerHTML = '';
    const px = (n: number) => n / s;
    if (!this.drag || this.drag.kind === 'pan' || this.drag.kind === 'rect' || this.drag.kind === 'image' || this.drag.kind === 'opening') {
      this.all = faces(this.plan);
    }
    const plan = this.plan;

    // Image de calque
    const bg = plan.background;
    if (bg) {
      svg.append(svgEl('image', {
        href: bg.src, x: bg.x, y: bg.y, width: bg.width, height: bg.width * bg.aspect,
        opacity: bg.opacity, preserveAspectRatio: 'none',
      }));
    }

    // Grille : 10 cm de près, 50 cm, et le mètre plus marqué.
    const grid = svgEl('g', { 'stroke-width': px(1) });
    const step = s > 120 ? 0.1 : s > 30 ? 0.5 : 1;
    for (let x = Math.floor(vx / step) * step; x < vx + vw; x += step) {
      const major = Math.abs(x - Math.round(x)) < 1e-6;
      grid.append(svgEl('line', { x1: x, y1: vy, x2: x, y2: vy + vh, stroke: major ? C.gridStrong : C.grid }));
    }
    for (let y = Math.floor(vy / step) * step; y < vy + vh; y += step) {
      const major = Math.abs(y - Math.round(y)) < 1e-6;
      grid.append(svgEl('line', { x1: vx, y1: y, x2: vx + vw, y2: y, stroke: major ? C.gridStrong : C.grid }));
    }
    svg.append(grid);

    // Le niveau du dessous, en filigrane : on dessine l'étage pile au-dessus.
    const under = this.opts.floors?.under();
    if (under?.walls.length) {
      const ghost = svgEl('g', { opacity: 0.35, 'pointer-events': 'none' });
      for (const foot of wallFootprints(under).values()) {
        if (foot.length >= 3) ghost.append(svgEl('polygon', { points: poly(foot), fill: 'none', stroke: C.wall, 'stroke-width': px(1.5), 'stroke-dasharray': `${px(5)} ${px(4)}` }));
      }
      svg.append(ghost);
    }

    // Sols
    const erasing = this.tool === 'erase';
    for (const room of plan.rooms) {
      const f = this.faceOf(room.seed);
      if (!f) continue;
      const hov = this.same(this.hover, { type: 'room', id: room.id });
      const sel = this.same(this.sel, { type: 'room', id: room.id });
      svg.append(svgEl('polygon', {
        points: poly(f.poly), fill: hov && erasing ? '#fecaca' : room.floor ?? '#d8c3a5',
        'fill-opacity': bg ? 0.45 : hov && !erasing ? 0.75 : 0.6,
        stroke: sel ? C.select : 'none', 'stroke-width': px(3),
      }));
      // La matière du sol, en traits légers par-dessus la couleur.
      const pattern = this.floorPattern(svg, room.floorMaterial, px);
      if (pattern && !bg) svg.append(svgEl('polygon', { points: poly(f.poly), fill: `url(#${pattern})`, 'pointer-events': 'none' }));
    }

    // Murs, découpés autour des ouvertures.
    const feet = wallFootprints(plan);
    for (const wall of plan.walls) {
      const hit = { type: 'wall' as const, id: wall.id };
      if (isBoundary(plan, wall)) {
        // Limite de pièce : un pointillé, rien en 3D.
        const [a, b] = wallEnds(plan, wall);
        const on = this.same(this.sel, hit) ? C.select : this.same(this.hover, hit) ? (erasing ? C.danger : C.hover) : '#8a8f98';
        svg.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: on, 'stroke-width': px(2.5), 'stroke-dasharray': `${px(7)} ${px(5)}`, 'stroke-linecap': 'round' }));
        continue;
      }
      const foot = feet.get(wall.id);
      if (!foot) continue;
      const color = this.same(this.sel, hit) ? C.select
        : this.same(this.hover, hit) ? (erasing ? C.danger : C.hover)
          : (wall.height ?? plan.wallHeight) < plan.wallHeight - 0.5 ? '#7c838c' : C.wall;
      const [a, b] = wallEnds(plan, wall);
      const dir = norm(sub(b, a));
      const holes = plan.openings.filter((o) => o.wall === wall.id && openingFits(plan, o))
        .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((p, q) => p[0] - q[0]);
      let from = -1e3;
      for (const [u0, u1] of [...holes, [1e3, 1e3]]) {
        const piece = clipAlong(foot, a, dir, from, u0);
        if (piece.length >= 3) svg.append(svgEl('polygon', { points: poly(piece), fill: color }));
        from = u1;
      }
    }

    // Ouvertures
    for (const o of plan.openings) this.drawOpening(svg, o, px);
    if ((this.tool === 'door' || this.tool === 'window' || this.tool === 'slider' || this.tool === 'passage') && this.cursor) {
      const hit = wallAt(plan, this.cursor, px(GRAB * 2));
      if (hit) {
        const def = OPENING_DEFAULTS[this.tool];
        const L = wallLength(plan, hit.wall), width = Math.min(def.width, L - 0.1);
        if (width >= 0.4) {
          const ghost = svgEl('g', { opacity: 0.6 });
          this.drawOpening(ghost, {
            id: 'ghost', kind: this.tool, wall: hit.wall.id, ...def, width,
            offset: Math.min(Math.max(hit.offset, width / 2), L - width / 2), hinge: 'start', swing: 'front',
          }, px, true);
          svg.append(ghost);
        }
      }
    }

    // Escaliers, et la trémie de ceux du niveau du dessous.
    if (under?.stairs?.length) for (const st of under.stairs) this.drawStairWell(svg, st, stairRise(under), px);
    for (const st of plan.stairs ?? []) this.drawStair(svg, st, px);

    // Meubles, vus de dessus.
    for (const it of plan.items ?? []) this.drawItem(svg, it, px);

    // Cotes de chaque mur, côté extérieur.
    const showDims = plan.walls.length < 400;
    if (showDims) for (const wall of plan.walls) if (!isBoundary(plan, wall)) this.drawDim(svg, wall, px);

    // Noms et surfaces
    for (const room of plan.rooms) {
      const f = this.faceOf(room.seed);
      if (!f) continue;
      const c = insidePoint(f.poly);
      const xs = f.poly.map((q) => q.x), span = Math.max(...xs) - Math.min(...xs);
      const fs = Math.min(px(14), span / Math.max(room.name.length * 0.62, 4));
      if (fs * s < 7) continue;
      const name = svgEl('text', {
        x: c.x, y: c.y, 'text-anchor': 'middle', 'font-size': fs, fill: '#1f2937',
        'font-family': 'Inter, system-ui, sans-serif', 'font-weight': 700,
      });
      name.textContent = room.name;
      const area = svgEl('text', {
        x: c.x, y: c.y + fs * 1.25, 'text-anchor': 'middle', 'font-size': fs * 0.82, fill: '#4b5563',
        'font-family': 'Inter, system-ui, sans-serif',
      });
      area.textContent = `${(Math.round(polygonArea(f.poly) * 10) / 10).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB')} m²`;
      svg.append(name, area);
    }

    // Coins : visibles en sélection, pour qu'on sache qu'on peut les tirer.
    if (this.picking || this.tool === 'wall' || this.tool === 'boundary' || this.tool === 'erase') {
      for (const n of plan.nodes) {
        const hit = { type: 'node' as const, id: n.id };
        const on = this.same(this.sel, hit), hov = this.same(this.hover, hit);
        if ((this.tool === 'wall' || this.tool === 'boundary') && !hov) continue;
        svg.append(svgEl('circle', {
          cx: n.x, cy: n.y, r: px(on || hov ? 7 : 4.5),
          fill: on ? C.select : hov ? (erasing ? C.danger : C.hover) : '#fff',
          stroke: on ? '#fff' : C.wall, 'stroke-width': px(1.5),
        }));
      }
    }

    // Guides d'alignement
    for (const g of this.guides) {
      svg.append(svgEl('line', g.x !== undefined
        ? { x1: g.x, y1: vy, x2: g.x, y2: vy + vh }
        : { x1: vx, y1: g.y!, x2: vx + vw, y2: g.y! }));
      (svg.lastChild as SVGElement).setAttribute('stroke', '#ec4899');
      (svg.lastChild as SVGElement).setAttribute('stroke-width', String(px(1)));
      (svg.lastChild as SVGElement).setAttribute('stroke-dasharray', `${px(5)} ${px(4)}`);
    }

    // Pièce en cours de tracé, avec ses cotes en direct.
    if (this.drag?.kind === 'rect') {
      const { a, b } = this.drag;
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), rw = Math.abs(b.x - a.x), rd = Math.abs(b.y - a.y);
      const t2 = plan.wallThickness;
      svg.append(svgEl('rect', { x: x0 - t2 / 2, y: y0 - t2 / 2, width: rw + t2, height: rd + t2, fill: 'none', stroke: C.wall, 'stroke-width': t2, opacity: 0.55 }));
      svg.append(svgEl('rect', { x: x0, y: y0, width: rw, height: rd, fill: 'rgba(14,165,233,0.12)' }));
      this.label(svg, { x: x0 + rw / 2, y: y0 - t2 / 2 - px(14) }, meters(rw), 0, px, C.dim, true);
      this.label(svg, { x: x0 + rw + t2 / 2 + px(14), y: y0 + rd / 2 }, meters(rd), 90, px, C.dim, true);
      if (rw > 0.5 && rd > 0.5) this.label(svg, { x: x0 + rw / 2, y: y0 + rd / 2 }, `${(Math.round(rw * rd * 10) / 10).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB')} m²`, 0, px, '#0369a1', false);
    }

    // Mur en cours de tracé
    if (this.tool === 'wall' || this.tool === 'boundary') {
      const c = this.chain;
      const at = c?.cursor ?? this.cursor;
      if (c && c.pts.length && at) {
        const last = c.pts[c.pts.length - 1];
        let end = at;
        const typed = parseNum(c.typed);
        if (c.typed && typed > 0) {
          let dir = sub(at, last);
          if (Math.hypot(dir.x, dir.y) < 1e-6) dir = { x: 1, y: 0 };
          end = add(last, mul(norm(dir), typed));
        }
        svg.append(svgEl('line', {
          x1: last.x, y1: last.y, x2: end.x, y2: end.y, stroke: C.wall, 'stroke-width': plan.wallThickness,
          'stroke-linecap': 'square', opacity: 0.55,
        }));
        const mid = { x: (last.x + end.x) / 2, y: (last.y + end.y) / 2 };
        const ang = (Math.atan2(end.y - last.y, end.x - last.x) * 180) / Math.PI;
        const n = perp(norm(sub(end, last)));
        const off = plan.wallThickness / 2 + px(14);
        const text = c.typed ? `${c.typed.replace('.', ',')}▏ m` : meters(dist(last, end));
        this.label(svg, add(mid, mul(n, -off)), text, ang, px, c.typed ? '#db2777' : C.dim, true);
        for (const q of c.pts) svg.append(svgEl('circle', { cx: q.x, cy: q.y, r: px(4), fill: C.select }));
      }
      if (at) {
        svg.append(svgEl('circle', { cx: at.x, cy: at.y, r: px(5), fill: 'none', stroke: C.select, 'stroke-width': px(2) }));
      }
    }
    if (this.tool === 'room' && !this.drag && this.cursor) {
      svg.append(svgEl('circle', { cx: this.cursor.x, cy: this.cursor.y, r: px(5), fill: 'none', stroke: C.select, 'stroke-width': px(2) }));
    }

    // Règle de mise à l'échelle
    const ca = calibFrom ?? this.calib;
    if (ca) {
      const c = cursor ?? this.cursor ?? ca;
      svg.append(svgEl('line', { x1: ca.x, y1: ca.y, x2: c.x, y2: c.y, stroke: '#f59e0b', 'stroke-width': px(3) }));
      svg.append(svgEl('circle', { cx: ca.x, cy: ca.y, r: px(5), fill: '#f59e0b' }));
      svg.append(svgEl('circle', { cx: c.x, cy: c.y, r: px(5), fill: '#f59e0b' }));
    }
  }

  /** Motif d'un sol sur le plan : lames de parquet, joints de carrelage. */
  private floorPattern(svg: SVGElement, kind: FloorMaterial | undefined, px: (n: number) => number): string | null {
    if (kind !== 'wood' && kind !== 'tiles') return null;
    const id = `owlnest-floor-${kind}`;
    if (svg.querySelector(`#${id}`)) return id;
    let defs = svg.querySelector('defs');
    if (!defs) { defs = svgEl('defs') as SVGDefsElement; svg.prepend(defs); }
    const line = { stroke: 'rgba(60,40,20,0.18)', 'stroke-width': px(1) };
    const p = svgEl('pattern', { id, patternUnits: 'userSpaceOnUse', width: kind === 'wood' ? 1.2 : 0.6, height: kind === 'wood' ? 0.4 : 0.6 });
    if (kind === 'wood') {
      // Deux rangées de lames de 20 cm, joints décalés.
      p.append(svgEl('line', { x1: 0, y1: 0.2, x2: 1.2, y2: 0.2, ...line }), svgEl('line', { x1: 0, y1: 0.4, x2: 1.2, y2: 0.4, ...line }));
      p.append(svgEl('line', { x1: 0.3, y1: 0, x2: 0.3, y2: 0.2, ...line }), svgEl('line', { x1: 0.9, y1: 0.2, x2: 0.9, y2: 0.4, ...line }));
    } else {
      p.append(svgEl('line', { x1: 0, y1: 0, x2: 0.6, y2: 0, ...line }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 0.6, ...line }));
    }
    defs.append(p);
    return id;
  }

  private faceOf(seed: Pt): Face | undefined {
    return this.all.filter((f) => pointInPolygon(seed, f.poly)).sort((a, b) => a.area - b.area)[0];
  }

  /** Un texte lisible sur le plan, tourné le long d'un mur mais jamais à l'envers. */
  private label(svg: SVGElement, at: Pt, text: string, angle: number, px: (n: number) => number, color: string, halo: boolean) {
    let a = angle;
    if (a > 90) a -= 180;
    if (a <= -90) a += 180;
    const tx = svgEl('text', {
      x: at.x, y: at.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': px(11.5),
      'font-family': 'Inter, system-ui, sans-serif', 'font-weight': 600, fill: color,
      transform: `rotate(${a} ${at.x} ${at.y})`,
      ...(halo ? { stroke: C.paper, 'stroke-width': px(4), 'paint-order': 'stroke', 'stroke-linejoin': 'round' } : {}),
    });
    tx.textContent = text;
    svg.append(tx);
  }

  /** La cote d'un mur, posée du côté où il n'y a pas de pièce. */
  private drawDim(svg: SVGElement, wall: PlanWall, px: (n: number) => number) {
    const [a, b] = wallEnds(this.plan, wall);
    const L = dist(a, b);
    if (L * this.view.scale < 38) return;
    const d = norm(sub(b, a)), n = perp(d);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const probe = 0.25;
    const left = this.all.some((f) => pointInPolygon(add(mid, mul(n, probe)), f.poly));
    const right = this.all.some((f) => pointInPolygon(add(mid, mul(n, -probe)), f.poly));
    const side = left && !right ? -1 : 1;
    const off = thicknessOf(this.plan, wall) / 2 + px(left && right ? 0 : 12);
    const pos = add(mid, mul(n, side * off));
    const sel = this.same(this.sel, { type: 'wall', id: wall.id }) || (this.drag?.kind === 'wall' && this.drag.id === wall.id);
    // Une cloison entre deux pièces : la cote est écrite dans le mur, discrète.
    if (left && right && !sel) {
      if (L * this.view.scale < 70) return;
      this.label(svg, add(mid, mul(n, thicknessOf(this.plan, wall) / 2 + px(9))), meters(L), (Math.atan2(d.y, d.x) * 180) / Math.PI, px, '#6b7280', true);
      return;
    }
    this.label(svg, pos, meters(L), (Math.atan2(d.y, d.x) * 180) / Math.PI, px, sel ? C.select : C.dim, true);
  }

  /** Symbole d'une ouverture, comme sur un plan d'architecte, dans le repère du mur. */
  private drawOpening(svg: SVGElement, o: PlanOpening, px: (n: number) => number, ghost = false) {
    const w = this.plan.walls.find((q) => q.id === o.wall);
    if (!w) return;
    const [a, b] = wallEnds(this.plan, w);
    const d = norm(sub(b, a));
    const c = add(a, mul(d, o.offset));
    const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    const th = thicknessOf(this.plan, w);
    const hit = { type: 'opening' as const, id: o.id };
    const color = ghost ? C.select : this.same(this.sel, hit) ? C.select
      : this.same(this.hover, hit) ? (this.tool === 'erase' ? C.danger : C.hover)
        : !openingFits(this.plan, o) ? C.danger : C.opening;
    const g = svgEl('g', { transform: `translate(${c.x} ${c.y}) rotate(${ang})` });
    const half = o.width / 2;
    const line = (x1: number, y1: number, x2: number, y2: number, wpx: number, dash?: string) => g.append(svgEl('line', {
      x1, y1, x2, y2, stroke: color, 'stroke-width': px(wpx), 'stroke-linecap': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}),
    }));
    // Tableaux de part et d'autre.
    line(-half, -th / 2, -half, th / 2, 2);
    line(half, -th / 2, half, th / 2, 2);
    if (o.kind === 'window') {
      g.append(svgEl('rect', { x: -half, y: -th / 2, width: o.width, height: th, fill: '#e0f2fe', stroke: color, 'stroke-width': px(1.5) }));
      line(-half, 0, half, 0, 1.5);
    } else if (o.kind === 'slider') {
      g.append(svgEl('rect', { x: -half, y: -th / 2, width: o.width, height: th, fill: '#e0f2fe', 'fill-opacity': 0.6 }));
      const k = th / 5;
      const toward = o.hinge === 'end' ? 1 : -1;
      line(-half, -k, toward > 0 ? half * 0.15 : half, -k, 3);
      line(toward > 0 ? -half : -half * 0.15, k, half, k, 3);
    } else if (o.kind === 'passage') {
      line(-half, -th / 2, half, -th / 2, 1, `${px(4)} ${px(3)}`);
      line(-half, th / 2, half, th / 2, 1, `${px(4)} ${px(3)}`);
    } else {
      // Battant et arc, côté gonds et sens choisis.
      const sy = o.swing === 'front' ? 1 : -1;
      const leaves = o.double ? 2 : 1;
      const lw = o.width / leaves;
      for (let i = 0; i < leaves; i++) {
        const hingeAtStart = leaves === 2 ? i === 0 : o.hinge === 'start';
        const hx = hingeAtStart ? -half : half;
        const fx = hingeAtStart ? hx + lw : hx - lw;
        const ey = sy * (th / 2 + lw);
        const y0 = sy * th / 2;
        line(hx, y0, hx, ey, 2.5);
        const sweep = (hingeAtStart ? 1 : 0) ^ (sy > 0 ? 0 : 1);
        g.append(svgEl('path', {
          d: `M ${hx} ${ey} A ${lw} ${lw} 0 0 ${sweep} ${fx} ${y0}`,
          fill: 'none', stroke: color, 'stroke-width': px(1.2), 'stroke-dasharray': `${px(4)} ${px(3)}`,
        }));
      }
    }
    svg.append(g);
  }

  // ── Meubles ──────────────────────────────────────────────────────────────

  // ── Escaliers ────────────────────────────────────────────────────────────

  private stair(id: string): PlanStair | undefined {
    return (this.plan.stairs ?? []).find((x) => x.id === id);
  }

  /** Pose un escalier là où l'on clique ; il monte vers le haut de l'écran. */
  private placeStair(p: Pt) {
    this.commit();
    const st: PlanStair = {
      id: newId('st'),
      x: Math.round(p.x / STEP) * STEP,
      y: Math.round(p.y / STEP) * STEP,
      rotation: -90,
      width: STAIR_WIDTH,
    };
    this.plan.stairs = [...(this.plan.stairs ?? []), st];
    this.sel = { type: 'stair', id: st.id };
    this.setTool('select');
    this.changed();
  }

  private turnStair(id: string, deg: number) {
    const st = this.stair(id);
    if (!st) return;
    this.commit();
    st.rotation = (((st.rotation + deg) % 360) + 360) % 360;
    this.changed();
  }

  /** Vu de dessus : les marches, et une flèche qui monte en suivant l'escalier. */
  private drawStair(svg: SVGElement, st: PlanStair, px: (n: number) => number) {
    const rise = stairRise(this.plan);
    const hit = { type: 'stair' as const, id: st.id };
    const sel = this.same(this.sel, hit), hov = this.same(this.hover, hit);
    const { steps } = stairLayout(st, rise);
    const g = svgEl('g', {});
    const stroke = sel ? C.select : hov ? C.hover : '#a8957a';
    for (const step of steps) {
      g.append(svgEl('polygon', {
        points: poly(step.poly.map((p) => stairToPlan(st, p))),
        fill: step.landing ? '#e6d8c2' : '#efe4d2', stroke, 'stroke-width': px(sel ? 1.6 : 1), 'stroke-linejoin': 'round',
      }));
    }
    // Le chemin de montée : du milieu de la première marche au milieu de la dernière.
    const mid = (pts: Pt[]) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
    const path = steps.map((step) => stairToPlan(st, mid(step.poly)));
    g.append(svgEl('polyline', { points: poly(path), fill: 'none', stroke: C.wall, 'stroke-width': px(1.6), 'stroke-linejoin': 'round' }));
    const a = path[path.length - 2], b = path[path.length - 1];
    const d = norm(sub(b, a)), n = perp(d);
    const tip = add(b, mul(d, px(4)));
    const base = sub(tip, mul(d, px(10)));
    g.append(svgEl('polygon', { points: poly([tip, add(base, mul(n, px(5))), sub(base, mul(n, px(5)))]), fill: C.wall }));
    g.append(svgEl('circle', { cx: path[0].x, cy: path[0].y, r: px(3), fill: C.wall }));
    svg.append(g);
  }

  /** L'escalier du niveau du dessous arrive ici : son trou, barré comme sur un plan d'architecte. */
  private drawStairWell(svg: SVGElement, st: PlanStair, rise: number, px: (n: number) => number) {
    const c = wellCorners(st, rise);
    const g = svgEl('g', { 'pointer-events': 'none' });
    const line = { stroke: C.wall, 'stroke-width': px(1.2), 'stroke-dasharray': `${px(5)} ${px(4)}` };
    g.append(svgEl('polygon', { points: poly(c), fill: 'rgba(47,52,59,0.06)', ...line }));
    g.append(svgEl('line', { x1: c[0].x, y1: c[0].y, x2: c[2].x, y2: c[2].y, ...line }));
    g.append(svgEl('line', { x1: c[1].x, y1: c[1].y, x2: c[3].x, y2: c[3].y, ...line }));
    svg.append(g);
  }

  private stairBubble(id: string) {
    const st = this.stair(id);
    if (!st) return;
    this.heading(t('planStairTitle'), 'stairs');
    const shape = st.shape ?? 'straight';
    this.chips(t('planStairShape'), [
      ['straight', t('planStairStraight')], ['l', t('planStairL')], ['u', t('planStairU')], ['spiral', t('planStairSpiral')],
    ] as [StairShape, string][], shape, (v) => {
      st.shape = v === 'straight' ? undefined : v;
      // Un colimaçon se règle par son rayon : on repart d'une taille qui lui va.
      if (v === 'spiral' && st.width < 0.7) st.width = 0.8;
    });
    if (shape !== 'straight') {
      this.chips(t('planStairTurn'), [['left', t('planStairLeft')], ['right', t('planStairRight')]] as ['left' | 'right', string][],
        st.turn ?? 'right', (v) => { st.turn = v === 'right' ? undefined : v; });
    }
    this.stepper(shape === 'spiral' ? t('planStairRadius') : t('planWidth'), st.width, 0.05, 0.6, 2, (v) => { st.width = v; });
    if (shape !== 'spiral') {
      this.chips(t('planStairSlope'), [['gentle', t('planStairGentle')], ['normal', t('planStairNormal')], ['steep', t('planStairSteep')]] as ['gentle' | 'normal' | 'steep', string][],
        st.slope ?? 'normal', (v) => { st.slope = v === 'normal' ? undefined : v; });
    }
    this.small(t('planStairHelp'));
    this.actions(
      this.pill(t('planRotate'), () => this.turnStair(id, 90), false, 'rotr'),
      this.pill(t('planStairFlip'), () => this.turnStair(id, 180), false, 'swap'),
    );
    this.actions(this.pill(t('planDelete'), () => this.remove({ type: 'stair', id }), false, 'trash', true));
  }

  private item(id: string): PlanItem | undefined {
    return (this.plan.items ?? []).find((i) => i.id === id);
  }

  /** Le point est-il sur ce meuble (rectangle tourné) ? */
  private inItem(it: PlanItem, p: Pt, margin = 0): boolean {
    return overItem(it, p, margin);
  }

  /**
   * Déplace un meuble. Près d'un mur, il s'y adosse : il se tourne dos au mur
   * et s'y colle. Ailleurs, il suit le doigt au pas de 5 cm.
   */
  private moveItem(it: PlanItem, to: Pt, free = false) {
    // Placement libre (touche Alt, ou aimant coupé) : au centimètre, sans mur.
    if (free) {
      it.x = round3(Math.round(to.x * 100) / 100);
      it.y = round3(Math.round(to.y * 100) / 100);
      this.guides = [];
      return;
    }
    // Un objet posé sur un meuble (pas sur un tapis) le suit sans s'adosser aux murs.
    const under = supportOf(this.plan, { ...it, x: to.x, y: to.y });
    if (under && !isFlat(under)) {
      it.x = round3(Math.round(to.x / 0.01) * 0.01);
      it.y = round3(Math.round(to.y / 0.01) * 0.01);
      return;
    }
    const { w: width, d } = itemSize(it);
    // Portée de l'aimant : 25 cm, ou 24 pixels quand on a dézoomé. Un meuble
    // déjà collé ne décroche qu'en tirant franchement.
    const reach = Math.min(0.5, Math.max(0.25, this.px(24)));
    let best: { w: PlanWall; pr: ReturnType<typeof project>; a: Pt; b: Pt; gap: number } | null = null;
    for (const w of this.plan.walls) {
      const [a, b] = wallEnds(this.plan, w);
      const pr = project(to, a, b);
      if (pr.t <= 0 || pr.t >= 1) continue;
      const gap = Math.abs(pr.d - thicknessOf(this.plan, w) / 2 - d / 2);
      const limit = w.id === this.stuck ? reach + 0.2 : reach;
      if (gap < limit && (!best || gap < best.gap)) best = { w, pr, a, b, gap };
    }
    this.stuck = best?.w.id ?? null;
    if (best) {
      const dir = norm(sub(best.b, best.a));
      let n = perp(dir);
      if (dot(sub(to, best.pr.p), n) < 0) n = mul(n, -1);
      // L'avant du meuble regarde la pièce : l'arrière touche le mur.
      it.rotation = Math.round((Math.atan2(-n.x, n.y) * 180) / Math.PI);
      const c = add(best.pr.p, mul(n, thicknessOf(this.plan, best.w) / 2 + d / 2 + 0.005));
      let along = dot(sub(to, best.pr.p), dir);
      // Dans un angle : le côté du meuble se cale aussi contre le mur voisin.
      const q0 = add(c, mul(dir, along));
      let side: { shift: number; gap: number } | null = null;
      for (const w of this.plan.walls) {
        if (w === best.w) continue;
        const [a, b] = wallEnds(this.plan, w);
        const wd = norm(sub(b, a));
        if (Math.abs(dot(wd, dir)) > 0.1) continue;
        // Le meuble doit être en face de ce mur, pas au-delà de ses bouts
        // (`project` borne sa position au segment : on la calcule ici sans borne).
        const len = dist(a, b);
        const u = dot(sub(q0, a), wd);
        if (u < -0.02 * len || u > 1.02 * len) continue;
        const s = dot(sub(q0, a), dir);
        const gap = Math.abs(s) - thicknessOf(this.plan, w) / 2 - width / 2;
        if (Math.abs(gap) < reach && (!side || Math.abs(gap) < side.gap)) side = { shift: -Math.sign(s) * gap, gap: Math.abs(gap) };
      }
      if (side) along += side.shift;
      const q = add(c, mul(dir, along));
      it.x = round3(q.x); it.y = round3(q.y);
      this.guides = [];
      return;
    }
    it.x = round3(Math.round(to.x / STEP) * STEP);
    it.y = round3(Math.round(to.y / STEP) * STEP);
  }

  private rotateItem(id: string, deg: number) {
    const it = this.item(id);
    if (!it) return;
    this.commit();
    it.rotation = (((it.rotation + deg) % 360) + 360) % 360;
    this.changed();
  }

  private duplicateItem(id: string) {
    const it = this.item(id);
    if (!it) return;
    this.commit();
    const { w } = itemSize(it);
    const a = (it.rotation * Math.PI) / 180;
    const copy: PlanItem = { ...JSON.parse(JSON.stringify(it)), id: newId('i'), x: round3(it.x + Math.cos(a) * (w + 0.05)), y: round3(it.y + Math.sin(a) * (w + 0.05)) };
    delete copy.entity;
    this.plan.items = [...(this.plan.items ?? []), copy];
    this.sel = { type: 'item', id: copy.id };
    this.changed();
  }

  /** Pose un meuble du catalogue au milieu de la vue, dans la pièce qui s'y trouve. */
  /** Importe un meuble : il rejoint « Mes meubles » et se pose aussitôt. */
  private importFurniture() {
    const input = el('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.glb,.obj,.mtl,.png,.jpg,.jpeg';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length || !this.opts.importFurniture) return;
      const main = files.find((f) => /\.(glb|obj)$/i.test(f.name));
      const name = (main?.name ?? files[0].name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      this.hintEl.textContent = t('planFurnitureImporting');
      let url: string;
      try {
        url = await this.opts.importFurniture(files);
      } catch (err) {
        console.warn('[Owlnest] furniture import failed:', err);
        this.flash(t('planFurnitureImportError'));
        return;
      }
      this.plan.library = [...(this.plan.library ?? []).filter((m) => m.url !== url), { url, name }];
      this.shelf = 'mine';
      this.renderDrawer();
      await this.addItem(url, name);
    });
    input.click();
  }

  private async addItem(model: string, name?: string) {
    try {
      await loadFurniture(model);
    } catch {
      this.flash(t('planFurnitureError'));
      return;
    }
    this.commit();
    const { w, h } = this.box();
    // Le milieu de ce qui est visible, entre le tiroir et la bulle de réglages.
    const left = this.drawer ? DRAWER_W : 0;
    const at = this.toPlan({ clientX: this.box().left + left + (w - left - 270) / 2, clientY: this.box().top + h / 2 });
    const it: PlanItem = { id: newId('i'), model, x: round3(at.x), y: round3(at.y), rotation: 0, ...(name ? { name } : {}) };
    this.plan.items = [...(this.plan.items ?? []), it];
    this.sel = { type: 'item', id: it.id };
    this.changed();
  }

  private drawItem(svg: SVGElement, it: PlanItem, px: (n: number) => number) {
    const { w, d } = itemSize(it);
    const hit = { type: 'item' as const, id: it.id };
    const sel = this.same(this.sel, hit), hov = this.same(this.hover, hit);
    const g = svgEl('g', { transform: `translate(${it.x} ${it.y}) rotate(${it.rotation})` });
    const key = `${it.model}|${JSON.stringify(it.colors ?? {})}`;
    const url = this.tops.get(key);
    if (url) {
      g.append(svgEl('image', { href: url, x: -w / 2, y: -d / 2, width: w, height: d, preserveAspectRatio: 'none' }));
    } else {
      g.append(svgEl('rect', { x: -w / 2, y: -d / 2, width: w, height: d, rx: px(3), fill: '#e5e7eb', stroke: '#9ca3af', 'stroke-width': px(1) }));
      if (!this.tops.has(key)) {
        this.tops.set(key, '');
        void topView(it).then((u) => { if (u) { this.tops.set(key, u); this.render(); } });
      }
    }
    if (sel || hov) {
      const color = this.tool === 'erase' ? C.danger : sel ? C.select : C.hover;
      g.append(svgEl('rect', {
        x: -w / 2 - px(3), y: -d / 2 - px(3), width: w + px(6), height: d + px(6), rx: px(4), fill: 'none',
        stroke: color, 'stroke-width': px(2), 'stroke-dasharray': sel ? 'none' : `${px(5)} ${px(3)}`,
      }));
      // L'avant du meuble : une petite flèche.
      if (sel) g.append(svgEl('path', { d: `M ${-px(6)} ${d / 2 + px(6)} L 0 ${d / 2 + px(12)} L ${px(6)} ${d / 2 + px(6)}`, fill: 'none', stroke: color, 'stroke-width': px(2) }));
    }
    if (it.entity) g.append(svgEl('circle', { cx: 0, cy: 0, r: px(5), fill: '#facc15', stroke: '#fff', 'stroke-width': px(1.5) }));
    svg.append(g);
  }

  /** Le tiroir du catalogue, à gauche du plan, quand l'outil Meubles est pris. */
  private renderDrawer() {
    if (this.tool !== 'furniture') {
      // Le tiroir se referme : le plan reprend la place qu'il avait.
      if (this.drawer) { this.view.cx += DRAWER_W / 2 / this.view.scale; this.render(); }
      this.drawer?.remove(); this.drawer = null; return;
    }
    if (!this.drawer) {
      // Le tiroir couvre la gauche : le plan glisse d'autant vers la droite.
      this.view.cx -= DRAWER_W / 2 / this.view.scale;
      this.drawer = el('div', [
        'position:absolute', 'left:0', 'top:0', 'bottom:0', `width:${DRAWER_W}px`, `background:${C.chrome}`,
        `border-right:1px solid ${C.line}`, 'display:flex', 'flex-direction:column', 'z-index:3', 'box-shadow:6px 0 18px rgba(0,0,0,0.18)',
      ].join(';'));
      this.stage.append(this.drawer);
    }
    const box = this.drawer;
    box.innerHTML = '';
    const head = el('div', 'padding:10px 10px 6px;');
    const search = el('div', `display:flex;align-items:center;gap:6px;background:${C.chrome2};border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:0 8px;color:${C.muted};`);
    const input = el('input', `flex:1;min-width:0;background:transparent;border:none;color:#fff;padding:8px 0;font-size:13px;font-family:${FONT};outline:none;`);
    input.placeholder = t('planFurnitureSearch');
    input.value = this.search;
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('input', () => { this.search = input.value; this.renderShelf(list); });
    search.append(icon('search', 16), input);
    const cats = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;');
    const CAT: Record<ItemCategory | 'all' | 'mine', StringKey> = {
      mine: 'planCatMine', all: 'planCatAll', living: 'planCatLiving', bedroom: 'planCatBedroom', kitchen: 'planCatKitchen',
      bathroom: 'planCatBathroom', office: 'planCatOffice', lights: 'planCatLights', decor: 'planCatDecor',
    };
    for (const c of ['all', ...CATEGORIES, 'mine'] as (ItemCategory | 'all' | 'mine')[]) {
      const on = c === this.shelf;
      const b = el('button', `padding:4px 8px;border-radius:999px;cursor:pointer;font-size:11px;font-family:${FONT};font-weight:600;border:1px solid ${on ? '#38bdf8' : 'rgba(255,255,255,0.1)'};background:${on ? '#0ea5e9' : 'transparent'};color:${on ? '#fff' : '#cbd5e1'};`, t(CAT[c]));
      b.addEventListener('click', () => { this.shelf = c; this.renderDrawer(); });
      cats.append(b);
    }
    head.append(search, cats);
    if (this.opts.importFurniture) {
      const imp = this.pill(t('planFurnitureImport'), () => this.importFurniture(), false, 'plus');
      imp.style.cssText += ';width:100%;justify-content:center;margin-top:8px;';
      head.append(imp);
    }
    const list = el('div', 'flex:1;overflow-y:auto;padding:6px 10px 10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start;');
    this.renderShelf(list);
    const foot = el('div', `padding:8px 12px;border-top:1px solid ${C.line};font-size:10.5px;color:#64748b;line-height:1.4;`, t('planFurnitureCredit'));
    box.append(head, list, foot);
  }

  private renderShelf(list: HTMLElement) {
    list.innerHTML = '';
    const q = this.search.trim().toLowerCase();
    // Mes meubles d'abord : ceux qu'on a importés soi-même.
    const mine = (this.plan.library ?? []).filter((m) => (q ? m.name.toLowerCase().includes(q) : this.shelf === 'mine' || this.shelf === 'all'));
    for (const m of mine) {
      const b = el('button', `display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;border:1px solid transparent;background:${C.chrome2};cursor:pointer;color:#e2e8f0;font-family:${FONT};font-size:11px;line-height:1.2;text-align:center;`);
      const img = el('img', 'width:64px;height:64px;object-fit:contain;pointer-events:none;');
      img.alt = '';
      void topView({ id: 'thumb', model: m.url, x: 0, y: 0, rotation: 0 }).then((u) => { if (u) img.src = u; });
      b.append(img, el('span', '', m.name));
      this.shelfTile(b, img, m.url, m.name);
      list.append(b);
    }
    if (this.shelf === 'mine' && !q) {
      if (!mine.length) list.append(el('div', `grid-column:1/-1;color:${C.muted};font-size:12px;line-height:1.5;padding:8px 2px;`, t('planFurnitureMineEmpty')));
      return;
    }
    const shown = CATALOG.filter((c) => (q ? `${c.en} ${c.fr}`.toLowerCase().includes(q) : this.shelf === 'all' || c.category === this.shelf));
    for (const c of shown) {
      const b = el('button', `display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;border:1px solid transparent;background:${C.chrome2};cursor:pointer;color:#e2e8f0;font-family:${FONT};font-size:11px;line-height:1.2;text-align:center;`);
      b.addEventListener('mouseenter', () => { b.style.borderColor = '#38bdf8'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = 'transparent'; });
      const img = el('img', 'width:64px;height:64px;object-fit:contain;pointer-events:none;');
      if (hasThumb(c)) img.src = thumbUrl(c.id);
      else void isoView(c.id).then((u) => { if (u) img.src = u; });
      img.alt = '';
      img.loading = 'lazy';
      b.append(img, el('span', '', itemLabel(c)));
      if (c.light) {
        const tag = el('span', 'display:inline-flex;align-items:center;gap:3px;color:#facc15;font-size:10px;');
        tag.append(icon('bulb', 12), document.createTextNode('HA'));
        b.append(tag);
      }
      this.shelfTile(b, img, c.id);
      list.append(b);
    }
    if (!shown.length && !mine.length) list.append(el('div', `grid-column:1/-1;color:${C.muted};font-size:12px;padding:12px 4px;`, t('planFurnitureNone')));
  }

  /**
   * Une vignette du tiroir : un appui pose le meuble au milieu de la vue, et
   * on peut aussi le tirer jusqu'au plan. Il y apparaît sous le doigt,
   * s'aimante aux murs comme un meuble qu'on déplace, et se pose au
   * relâchement ; relâché ailleurs, il n'est pas posé. Au doigt, un geste
   * vertical fait défiler la liste au lieu de tirer.
   */
  private shelfTile(b: HTMLButtonElement, img: HTMLImageElement, model: string, name?: string) {
    b.style.touchAction = 'pan-y';
    let dragged = false;
    b.addEventListener('click', () => {
      if (dragged) { dragged = false; return; }
      void this.addItem(model, name);
    });
    b.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      dragged = false;
      // Le geste reste à la vignette : le plan ne doit pas le prendre pour un
      // des siens (il annulerait l'étape au relâchement).
      try { b.setPointerCapture(down.pointerId); } catch { /* pointeur déjà relâché */ }
      const sx = down.clientX, sy = down.clientY;
      let ready = false;
      void loadFurniture(model).then(() => { ready = true; }, () => {});
      let ghost: HTMLImageElement | null = null;
      let placed: PlanItem | null = null;
      let active = false;
      const overPlan = (e: PointerEvent) => {
        const r = this.svg.getBoundingClientRect();
        const left = r.left + (this.drawer ? DRAWER_W : 0);
        return e.clientX > left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
      };
      const move = (e: PointerEvent) => {
        if (!active) {
          const dx = e.clientX - sx, dy = e.clientY - sy;
          if (Math.hypot(dx, dy) < 6) return;
          if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) { stop(); return; }
          active = true;
          dragged = true;
          ghost = img.cloneNode() as HTMLImageElement;
          ghost.style.cssText = 'position:fixed;width:64px;height:64px;object-fit:contain;pointer-events:none;opacity:0.85;z-index:200;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.35));';
          this.root.append(ghost);
        }
        e.preventDefault();
        const over = overPlan(e) && ready;
        if (ghost) {
          ghost.style.display = over ? 'none' : '';
          ghost.style.left = `${e.clientX - 32}px`;
          ghost.style.top = `${e.clientY - 32}px`;
        }
        if (over) {
          if (!placed) {
            this.commit();
            placed = { id: newId('i'), model, x: 0, y: 0, rotation: 0, ...(name ? { name } : {}) };
            this.plan.items = [...(this.plan.items ?? []), placed];
            this.sel = { type: 'item', id: placed.id };
            this.stuck = null;
            // Le geste en cours : la 3D suit, comme pour un meuble qu'on déplace.
            this.drag = { kind: 'item', id: placed.id, grab: { x: 0, y: 0 } };
          }
          this.moveItem(placed, this.toPlan(e), e.altKey || !this.magnet);
          this.preview();
          this.render();
        } else if (placed) {
          // Revenu sur le tiroir : le meuble repart.
          const gone = placed;
          this.plan.items = (this.plan.items ?? []).filter((i) => i !== gone);
          this.history.pop();
          placed = null;
          this.drag = null;
          this.sel = null;
          this.render();
        }
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        ghost?.remove();
        ghost = null;
      };
      const up = () => {
        stop();
        if (!placed) return;
        this.drag = null;
        this.sel = { type: 'item', id: placed.id };
        this.changed();
      };
      const cancel = () => {
        stop();
        if (placed) {
          const gone = placed;
          this.plan.items = (this.plan.items ?? []).filter((i) => i !== gone);
          this.history.pop();
          this.drag = null;
          this.sel = null;
          this.render();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
  }

  private itemBubble(id: string) {
    const it = this.item(id);
    if (!it) return;
    const c = catalogItem(it.model);
    this.heading(it.name || (c ? itemLabel(c) : t('planToolFurniture')), c?.light ? 'bulb' : 'sofa');
    this.actions(
      this.pill(t('planRotateLeft'), () => this.rotateItem(id, -90), false, 'rotl'),
      this.pill(t('planRotateRight'), () => this.rotateItem(id, 90), false, 'rotr'),
    );
    this.stepper(t('planItemRotation'), it.rotation, 15, -360, 720, (v) => { it.rotation = ((Math.round(v) % 360) + 360) % 360; });
    this.bubble.append(el('div', `height:1px;background:${C.line};margin:8px 0 10px;`));

    // Taille au centimètre, axe par axe.
    const size = itemSize(it);
    const setSize = (k: 0 | 1 | 2, cm: number) => {
      const cur = itemSize(it);
      const next: [number, number, number] = [cur.w, cur.d, cur.h];
      next[k] = cm / 100;
      it.size = next;
      delete it.scale;
    };
    this.stepper(t('planItemWidth'), Math.round(size.w * 100), 1, 2, 1000, (v) => setSize(0, v));
    this.stepper(t('planItemDepth'), Math.round(size.d * 100), 1, 2, 1000, (v) => setSize(1, v));
    this.stepper(t('planItemHeight'), Math.round(size.h * 100), 1, 1, 500, (v) => setSize(2, v));
    const base = baseSize(it.model);
    if (base && (it.size || it.scale)) {
      this.actions(this.pill(t('planItemOriginal'), () => { this.commit(); delete it.size; delete it.scale; this.changed(); }));
    }

    // Hauteur : automatique (au sol, sur le meuble du dessous, au mur) ou choisie.
    const elev = itemElevation(this.plan, it);
    this.stepper(t('planItemElevation'), Math.round(elev * 100), 1, 0, 500, (v) => { it.elevation = v / 100; });
    const under = supportOf(this.plan, it);
    if (it.elevation === undefined) {
      const on = under ? catalogItem(under.model) : null;
      this.small(on ? t('planItemOnTop').replace('{name}', itemLabel(on).toLowerCase()) : t('planItemAuto'));
    } else {
      this.actions(this.pill(t('planItemAutoBtn'), () => { this.commit(); delete it.elevation; this.changed(); }, false, 'sparkle'));
    }
    this.chips('', [['on', t('planMagnetOn')], ['off', t('planMagnetOff')]], this.magnet ? 'on' : 'off', (v) => { this.magnet = v === 'on'; this.history.pop(); });
    this.bubble.append(el('div', `height:1px;background:${C.line};margin:6px 0 4px;`));
    const tints = furnitureTints(it.model);
    const FABRIC = ['#c9c2b8', '#8a8f98', '#3e4a5c', '#5b7083', '#7a9a7e', '#b5655b', '#d9a441', '#2f343b', '#e8e4dc', '#9b7bb0', '#c97b8a', '#4f6d5a'];
    const WOOD = ['#e0c49a', '#c8a77e', '#a97c55', '#7a5a3f', '#4a3626', '#f4f4f2', '#d6d3cd', '#2f343b'];
    // Un tissu ou un bois par matière du modèle : « Tissu », « Tissu 2 »…
    const seen = { fabric: 0, wood: 0 };
    for (const tint of tints) {
      const kind = tintKind(tint)!;
      const n = ++seen[kind];
      const label = `${t(kind === 'wood' ? 'planTintWood' : 'planTintFabric')}${n > 1 ? ` ${n}` : ''}`;
      this.swatches(label, kind === 'wood' ? WOOD : FABRIC, it.colors?.[tint], (col) => { it.colors = { ...it.colors, [tint]: col }; });
    }
    if (c?.light) {
      this.bubble.append(el('div', 'color:#cbd5e1;margin:8px 0 6px;', t('planLampEntity')));
      const row = el('div', 'display:flex;gap:6px;align-items:center;margin-bottom:6px;');
      const label = it.entity ? (this.opts.entityLabel?.(it.entity) ?? it.entity) : t('planLampNone');
      const pick = el('button', `flex:1;min-width:0;display:flex;align-items:center;gap:8px;text-align:left;background:${C.chrome2};border:1px solid rgba(255,255,255,0.14);border-radius:9px;color:${it.entity ? '#fff' : C.muted};padding:8px 10px;font-size:13px;font-family:${FONT};cursor:pointer;`);
      const text = el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', label);
      pick.title = it.entity ?? '';
      pick.append(icon('bulb', 16), text);
      pick.addEventListener('click', () => this.opts.pickEntity?.(it.entity, (entity) => {
        this.commit(); it.entity = entity; this.changed();
      }));
      row.append(pick);
      if (it.entity) row.append(this.iconButton('close', t('planLampUnlink'), () => { this.commit(); it.entity = undefined; this.changed(); }));
      this.bubble.append(row);
      this.small(t('planLampHelp'));
    }
    this.actions(
      this.pill(t('planDuplicate'), () => this.duplicateItem(id), false, 'copy'),
      this.pill(t('planDelete'), () => this.remove({ type: 'item', id }), false, 'trash', true),
    );
  }

  // ── Écran d'accueil ──────────────────────────────────────────────────────

  private renderEmpty() {
    const empty = !this.plan.walls.length && !(this.plan.items ?? []).length && this.tool === 'select';
    if (!empty) { this.emptyState?.remove(); this.emptyState = null; this.bubble.style.display = ''; this.hintEl.style.display = ''; return; }
    this.bubble.style.display = 'none';
    this.hintEl.style.display = 'none';
    if (this.emptyState) return;
    const box = el('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow:auto;');
    const card = el('div', 'max-width:720px;width:100%;text-align:center;');
    card.append(
      el('div', 'font-size:22px;font-weight:800;color:#1f2937;margin-bottom:6px;', t('planStartTitle')),
      el('div', 'font-size:14px;color:#6b7280;margin-bottom:22px;', t('planStartText')),
    );
    const grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;');
    const tile = (title: string, sub: string, art: Element, run: () => void) => {
      const b = el('button', `display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 10px;border-radius:16px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;font-family:${FONT};transition:transform .12s,border-color .12s;`);
      b.addEventListener('mouseenter', () => { b.style.borderColor = '#38bdf8'; b.style.transform = 'translateY(-2px)'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = '#e5e7eb'; b.style.transform = ''; });
      b.append(art, el('div', 'font-size:14px;font-weight:700;color:#111827;', title), el('div', 'font-size:11.5px;color:#6b7280;', sub));
      b.addEventListener('click', run);
      grid.append(b);
    };
    const blank = el('div', 'width:120px;height:80px;border-radius:10px;border:2px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#64748b;');
    blank.append(icon('pencil', 30));
    tile(t('planStartBlank'), t('planStartBlankSub'), blank, () => this.setTool('room'));
    const names: Record<TemplateId, [StringKey, StringKey]> = {
      studio: ['planTplStudio', 'planTplStudioSub'], t2: ['planTplT2', 'planTplT2Sub'],
      t3: ['planTplT3', 'planTplT3Sub'], house: ['planTplHouse', 'planTplHouseSub'],
    };
    for (const id of TEMPLATES) tile(t(names[id][0]), t(names[id][1]), this.thumbnail(templatePlan(id)), () => this.useTemplate(id));
    const img = el('div', 'width:120px;height:80px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#64748b;');
    img.append(icon('image', 30));
    tile(t('planStartImage'), t('planStartImageSub'), img, () => this.loadImage());
    card.append(grid, this.sweetHome(true));
    box.append(card);
    this.stage.append(box);
    this.emptyState = box;
  }

  /** La miniature d'un plan : ses pièces en couleur, ses murs en noir. */
  private thumbnail(plan: PlanDoc): SVGSVGElement {
    const s = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    const xs = plan.nodes.map((n) => n.x), ys = plan.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 0.3, y0 = Math.min(...ys) - 0.3;
    const w = Math.max(...xs) - x0 + 0.3, h = Math.max(...ys) - y0 + 0.3;
    s.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    s.setAttribute('width', '120');
    s.setAttribute('height', '80');
    const all = faces(plan);
    for (const r of plan.rooms) {
      const f = all.filter((g) => pointInPolygon(r.seed, g.poly)).sort((a, b) => a.area - b.area)[0];
      if (f) s.append(svgEl('polygon', { points: poly(f.poly), fill: r.floor ?? '#d8c3a5' }));
    }
    for (const wall of plan.walls) {
      const [a, b] = wallEnds(plan, wall);
      s.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: C.wall, 'stroke-width': 0.22, 'stroke-linecap': 'square' }));
    }
    return s;
  }

  // ── Réglages de ce qui est sélectionné ───────────────────────────────────

  private heading(text: string, iconName?: string) {
    const h = el('div', 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#fff;margin-bottom:12px;');
    if (iconName) h.append(icon(iconName, 20));
    h.append(document.createTextNode(text));
    this.bubble.append(h);
  }

  private small(text: string, parent: HTMLElement = this.bubble) {
    parent.append(el('div', `color:${C.muted};font-size:11.5px;line-height:1.5;margin:4px 0 10px;`, text));
  }

  /** Une ligne « libellé ... valeur », avec − et + pour les doigts. */
  private stepper(label: string, value: number, step: number, min: number, max: number, apply: (v: number) => void) {
    const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;');
    row.append(el('span', 'color:#cbd5e1;', label));
    const ctl = el('div', `display:flex;align-items:center;background:${C.chrome2};border:1px solid rgba(255,255,255,0.1);border-radius:9px;overflow:hidden;`);
    const btn = (txt: string, dv: number) => {
      const b = el('button', `width:28px;height:30px;border:none;background:transparent;color:#e2e8f0;font-size:16px;cursor:pointer;font-family:${FONT};`, txt);
      b.addEventListener('click', () => set(Math.round((value + dv) * 1000) / 1000));
      return b;
    };
    const input = el('input', `width:56px;text-align:center;background:transparent;border:none;color:#fff;font-size:13px;font-family:${FONT};outline:none;`);
    input.inputMode = 'decimal';
    input.value = (Math.round(value * 100) / 100).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB');
    const set = (v: number) => {
      if (!(v >= min) || v > max) { input.value = String(value); return; }
      this.commit();
      apply(v);
      this.changed();
    };
    input.addEventListener('change', () => set(parseNum(input.value)));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    ctl.append(btn('−', -step), input, btn('+', step));
    row.append(ctl);
    this.bubble.append(row);
  }

  private choice<T extends string>(label: string, options: [T, string][], value: T, apply: (v: T) => void) {
    const row = el('div', 'margin-bottom:10px;');
    row.append(el('div', 'color:#cbd5e1;margin-bottom:6px;', label));
    const wrap = el('div', `display:flex;background:${C.chrome2};border-radius:9px;padding:3px;gap:2px;`);
    for (const [v, text] of options) {
      const on = v === value;
      const b = el('button', `flex:1;padding:6px 4px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-family:${FONT};font-weight:600;${on ? 'background:#0ea5e9;color:#fff' : `background:transparent;color:${C.muted}`}`, text);
      b.addEventListener('click', () => { if (on) return; this.commit(); apply(v); this.changed(); });
      wrap.append(b);
    }
    row.append(wrap);
    this.bubble.append(row);
  }

  private actions(...buttons: HTMLButtonElement[]) {
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;');
    row.append(...buttons);
    this.bubble.append(row);
  }

  private renderBubble() {
    this.bubble.innerHTML = '';
    this.bubble.style.width = '250px';
    this.bubble.style.padding = '14px';
    const sel = this.sel;
    if (sel?.type === 'room') return this.roomBubble(sel.id);
    if (sel?.type === 'wall') return this.wallBubble(sel.id);
    if (sel?.type === 'opening') return this.openingBubble(sel.id);
    if (sel?.type === 'item') return this.itemBubble(sel.id);
    if (sel?.type === 'stair') return this.stairBubble(sel.id);
    if (sel?.type === 'node') {
      this.heading(t('planCorner'), 'corner');
      this.small(t('planCornerHelp'));
      this.actions(this.pill(t('planDeleteCorner'), () => this.remove(sel), false, 'trash', true));
      return;
    }
    this.generalBubble();
  }

  private roomBubble(id: string) {
    const room = this.plan.rooms.find((r) => r.id === id);
    if (!room) return;
    const f = this.faceOf(room.seed);
    this.heading(t('planRoomTitle'), 'room');
    const name = el('input', `width:100%;box-sizing:border-box;background:${C.chrome2};border:1px solid rgba(255,255,255,0.14);border-radius:9px;color:#fff;padding:8px 10px;font-size:14px;font-weight:600;font-family:${FONT};margin-bottom:8px;outline:none;`);
    name.value = room.name;
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => { if (!name.value.trim()) return; this.commit(); room.name = name.value.trim(); this.changed(); });
    this.bubble.append(name);

    // Noms tout prêts : un clic nomme la pièce et lui donne un sol qui va.
    const chips = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;');
    for (const type of Object.keys(ROOM_TYPES) as RoomType[]) {
      const label = t(ROOM_TYPES[type].label);
      const b = el('button', `padding:4px 9px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:${label === room.name ? '#0ea5e9' : 'transparent'};color:#cbd5e1;font-size:11.5px;cursor:pointer;font-family:${FONT};`, label);
      b.addEventListener('click', () => {
        this.commit();
        room.name = label; room.floor = ROOM_TYPES[type].floor; room.floorMaterial = ROOM_TYPES[type].material;
        this.changed();
      });
      chips.append(b);
    }
    this.bubble.append(chips);

    if (f) {
      this.bubble.append(el('div', 'display:flex;justify-content:space-between;color:#cbd5e1;margin-bottom:10px;', ''));
      const row = this.bubble.lastChild as HTMLElement;
      row.append(el('span', '', t('planArea')), el('b', 'color:#fff;', `${(Math.round(polygonArea(f.poly) * 10) / 10).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB')} m²`));
      // Une pièce rectangulaire se règle aussi au clavier.
      const rect = this.rectOf(f);
      if (rect) {
        this.stepper(t('planWidth'), rect.x1 - rect.x0, 0.05, MIN_SIDE, 100, (v) => this.resizeRect(rect, 'x', v));
        this.stepper(t('planDepth'), rect.y1 - rect.y0, 0.05, MIN_SIDE, 100, (v) => this.resizeRect(rect, 'y', v));
      }
    }

    this.chips(t('planFloor'), FLOOR_MATERIALS.map((m) => [m, t(MATERIAL_LABEL[m])] as [FloorMaterial, string]), room.floorMaterial ?? 'plain',
      (m) => { room.floorMaterial = m === 'plain' ? undefined : m; });
    this.swatches('', FLOOR_COLORS, room.floor, (c) => { room.floor = c; });
    this.swatches(t('planWallColor'), WALL_COLORS, room.wall ?? PLAN_COLORS.wall, (c) => { room.wall = c === PLAN_COLORS.wall ? undefined : c; });
    this.actions(this.pill(t('planDeleteRoom'), () => this.remove({ type: 'room', id }), false, 'trash', true));
  }

  /** Les bornes d'une pièce si elle est un rectangle droit (4 coins alignés sur les axes). */
  private rectOf(f: Face): { x0: number; x1: number; y0: number; y1: number; ids: string[] } | null {
    if (f.poly.length !== 4) return null;
    const xs = [...new Set(f.poly.map((p) => p.x))], ys = [...new Set(f.poly.map((p) => p.y))];
    if (xs.length !== 2 || ys.length !== 2) return null;
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), ids: f.nodes };
  }

  /** Change la largeur (ou la profondeur) : le mur de droite (ou du bas) recule, avec tout ce qui est aligné dessus. */
  private resizeRect(r: { x0: number; x1: number; y0: number; y1: number }, axis: 'x' | 'y', size: number) {
    const shapes = roomShapes(this.plan, this.all);
    const edge = axis === 'x' ? r.x1 : r.y1;
    const delta = (axis === 'x' ? r.x0 : r.y0) + size - edge;
    const lo = axis === 'x' ? r.y0 : r.x0, hi = axis === 'x' ? r.y1 : r.x1;
    for (const n of this.plan.nodes) {
      const along = axis === 'x' ? n.x : n.y, across = axis === 'x' ? n.y : n.x;
      if (Math.abs(along - edge) > 1e-6 || across < lo - 1e-6 || across > hi + 1e-6) continue;
      if (axis === 'x') n.x = round3(n.x + delta); else n.y = round3(n.y + delta);
    }
    settle(this.plan);
    this.all = faces(this.plan);
    reseedRooms(this.plan, shapes, this.all);
  }

  private wallBubble(id: string) {
    const w = this.plan.walls.find((q) => q.id === id);
    if (!w) return;
    if (isBoundary(this.plan, w)) {
      this.heading(t('planBoundaryTitle'), 'wall');
      this.small(t('planBoundaryHelp'));
      this.actions(
        this.pill(t('planBoundaryToWall'), () => { this.commit(); delete w.height; cleanup(this.plan); this.changed(); }, true, 'wall'),
        this.pill(t('planDeleteWall'), () => this.remove({ type: 'wall', id }), false, 'trash', true),
      );
      return;
    }
    this.heading(t('planWallTitle'), 'wall');
    this.stepper(t('planLength'), wallLength(this.plan, w), 0.05, 0.1, 100, (v) => {
      // Le coin d'arrivée avance ou recule le long du mur.
      const [a, b] = wallEnds(this.plan, w);
      const shapes = roomShapes(this.plan, this.all);
      moveNode(this.plan, w.b, add(a, mul(norm(sub(b, a)), v)));
      settle(this.plan);
      this.all = faces(this.plan);
      reseedRooms(this.plan, shapes, this.all);
    });
    this.stepper(t('planWallHeight'), heightOf(this.plan, w), 0.1, 0.3, 10, (v) => { w.height = v; });
    this.stepper(t('planWallThickness'), thicknessOf(this.plan, w), 0.01, 0.03, 1, (v) => { w.thickness = v; });
    this.small(t('planWallHelp'));
    const buttons = [
      this.pill(t('planWallToBoundary'), () => { this.commit(); w.height = 0; this.plan.openings = this.plan.openings.filter((o) => o.wall !== w.id); this.changed(); }, false, 'boundary'),
      this.pill(t('planDeleteWall'), () => this.remove({ type: 'wall', id }), false, 'trash', true),
    ];
    if (w.height !== undefined || w.thickness !== undefined) {
      buttons.unshift(this.pill(t('planWallReset'), () => { this.commit(); delete w.height; delete w.thickness; cleanup(this.plan); this.changed(); }));
    }
    this.actions(...buttons);
  }

  private openingBubble(id: string) {
    const o = this.plan.openings.find((q) => q.id === id);
    if (!o) return;
    this.heading(t(KIND_LABEL[o.kind]), o.kind);
    if (!openingFits(this.plan, o)) this.small(t('planOrphan'));
    // Une porte peut devenir une fenêtre sans être redessinée.
    this.choice('', (['door', 'window', 'slider', 'passage'] as OpeningKind[]).map((k) => [k, t(KIND_LABEL[k])] as [OpeningKind, string]), o.kind, (k) => {
      const def = OPENING_DEFAULTS[k];
      o.kind = k; o.height = def.height; o.sill = def.sill; o.style = undefined; o.color = undefined;
    });
    this.stepper(t('planWidth'), o.width, 0.05, 0.3, 10, (v) => { o.width = v; });
    this.stepper(t('planHeight'), o.height, 0.05, 0.3, 4, (v) => { o.height = v; });
    if (o.kind === 'window') this.stepper(t('planSill'), o.sill, 0.05, 0, 3, (v) => { o.sill = v; });
    if (o.kind === 'door' || o.kind === 'window') {
      this.choice(t('planLeaves'), [['1', '1'], ['2', '2']], o.double ? '2' : '1', (v) => { o.double = v === '2'; });
    }
    if (o.kind === 'door') {
      this.chips(t('planStyle'), DOOR_STYLES.map((v) => [v, t(DOOR_STYLE_LABEL[v])] as [DoorStyle, string]), (o.style as DoorStyle) ?? 'plain',
        (v) => { o.style = v === 'plain' ? undefined : v; });
      this.swatches(t('planColor'), DOOR_COLORS, o.color ?? (o.style === 'entry' ? '#5b4636' : PLAN_COLORS.door), (c) => { o.color = c; });
    } else if (o.kind === 'window' || o.kind === 'slider') {
      this.chips(t('planStyle'), (['plain', 'grid'] as WindowStyle[]).map((v) => [v, t(v === 'plain' ? 'planStylePlain' : 'planStyleGrid')] as [WindowStyle, string]),
        (o.style as WindowStyle) ?? 'plain', (v) => { o.style = v === 'plain' ? undefined : v; });
      this.swatches(t('planFrameColor'), FRAME_COLORS, o.color ?? PLAN_COLORS.frame, (c) => { o.color = c === PLAN_COLORS.frame ? undefined : c; });
    }
    if (o.kind !== 'passage') {
      const buttons = [this.pill(o.kind === 'slider' ? t('planFlipSlide') : t('planFlipHinge'), () => this.flipOpening(id, 'hinge'), false, 'flip')];
      if (o.kind !== 'slider') buttons.push(this.pill(t('planFlipSide'), () => this.flipOpening(id, 'swing'), false, 'swap'));
      this.actions(...buttons);
      this.small(t('planOpeningHelp'));
    }
    this.actions(this.pill(t('planDelete'), () => this.remove({ type: 'opening', id }), false, 'trash', true));
  }

  private generalBubble() {
    if (!this.showSettings) {
      // Replié : un simple bouton, pour laisser tout le plan visible.
      this.bubble.style.width = 'auto';
      this.bubble.style.padding = '4px';
      const b = this.pill(t('planSettings'), () => { this.showSettings = true; this.renderBubble(); }, false, 'sparkle');
      b.style.border = 'none';
      this.bubble.append(b);
      return;
    }
    this.heading(t('planSettings'), 'sparkle');
    const close = this.iconButton('close', '', () => { this.showSettings = false; this.renderBubble(); });
    close.style.cssText += ';position:absolute;top:10px;right:10px;width:28px;height:28px;';
    this.bubble.append(close);
    this.stepper(t('planWallHeight'), this.plan.wallHeight, 0.1, 1, 10, (v) => { this.plan.wallHeight = v; });
    this.stepper(t('planWallThickness'), this.plan.wallThickness, 0.01, 0.03, 1, (v) => { this.plan.wallThickness = v; });

    this.bubble.append(el('div', `height:1px;background:${C.line};margin:12px 0;`));
    this.heading(t('planImage'), 'image');
    const bg = this.plan.background;
    if (!bg) {
      this.small(t('planImageHelp'));
      this.actions(this.pill(t('planImageLoad'), () => this.loadImage(), false, 'image'));
    } else {
      const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;color:#cbd5e1;');
      const op = el('input');
      op.type = 'range'; op.min = '0.1'; op.max = '1'; op.step = '0.05'; op.value = String(bg.opacity);
      op.style.width = '120px';
      op.addEventListener('input', () => { bg.opacity = parseFloat(op.value); this.render(); });
      op.addEventListener('change', () => this.opts.onChange(clone(this.plan)));
      row.append(el('span', '', t('planImageOpacity')), op);
      this.bubble.append(row);
      this.actions(
        this.pill(t('planImageScale'), () => this.setTool('calibrate'), false, 'ruler'),
        this.pill(t('planImageMove'), () => this.setTool('image'), false, 'move'),
        this.pill(t('planImageRemove'), () => { this.commit(); this.plan.background = undefined; this.changed(); }, false, 'trash', true),
      );
    }
    if (this.plan.walls.length) {
      this.bubble.append(el('div', `height:1px;background:${C.line};margin:12px 0;`));
      this.actions(this.pill(t('planClear'), () => this.confirmBox(t('planClearConfirm'), t('planClear'), () => {
        this.commit();
        // Les meubles partent avec la maison ; « Mes meubles » reste.
        this.plan = { ...this.plan, nodes: [], walls: [], rooms: [], openings: [], items: [] };
        this.sel = null;
        this.changed();
      }), false, 'trash', true));
    }
    this.bubble.append(el('div', `height:1px;background:${C.line};margin:12px 0;`));
    this.bubble.append(this.sweetHome());
  }

  /**
   * Le relais vers Sweet Home 3D : l'éditeur reste simple exprès, et ceux qui
   * veulent aller plus loin ont un outil gratuit dont l'import est compatible.
   */
  private sweetHome(light = false): HTMLElement {
    const box = el('div', light
      ? 'margin-top:22px;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid #e5e7eb;text-align:left;display:flex;gap:12px;align-items:flex-start;'
      : 'display:flex;gap:10px;align-items:flex-start;');
    const ic = el('div', `flex-shrink:0;color:${light ? '#0284c7' : '#7dd3fc'};padding-top:2px;`);
    ic.append(icon('cube', 22));
    const text = el('div', `font-size:12px;line-height:1.5;color:${light ? '#4b5563' : C.muted};`);
    text.append(el('div', `font-weight:700;font-size:13px;color:${light ? '#111827' : '#fff'};margin-bottom:2px;`, t('planSh3dTitle')));
    text.append(document.createTextNode(t('planSh3dText') + ' '));
    const a = el('a', `color:${light ? '#0284c7' : '#7dd3fc'};font-weight:600;text-decoration:none;white-space:nowrap;`, t('planSh3dLink'));
    a.href = 'https://www.sweethome3d.com/';
    a.target = '_blank';
    a.rel = 'noopener';
    text.append(a);
    if (this.opts.importSh3d) {
      const imp = this.pill(t('planSh3dImport'), () => this.opts.importSh3d?.(), !light, 'plus');
      imp.style.cssText += ';margin-top:8px;';
      text.append(el('div', ''), imp);
    }
    box.append(ic, text);
    return box;
  }

  /** Pastilles de couleur. */
  private swatches(label: string, colors: readonly string[], value: string | undefined, apply: (c: string) => void, direct = false) {
    if (label) this.bubble.append(el('div', 'color:#cbd5e1;margin:8px 0 6px;', label));
    const grid = el('div', 'display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px;');
    for (const c of colors) {
      const on = value?.toLowerCase() === c.toLowerCase();
      const b = el('button', `aspect-ratio:1;border-radius:8px;cursor:pointer;background:${c};border:2px solid ${on ? '#38bdf8' : 'rgba(255,255,255,0.12)'};box-shadow:${on ? '0 0 0 2px #0b1220 inset' : 'none'};`);
      b.addEventListener('click', () => { if (on) return; if (direct) { apply(c); return; } this.commit(); apply(c); this.changed(); });
      grid.append(b);
    }
    this.bubble.append(grid);
  }

  /** Une rangée de choix en pastilles, qui passe à la ligne. */
  private chips<T extends string>(label: string, options: [T, string][], value: T, apply: (v: T) => void, direct = false) {
    if (label) this.bubble.append(el('div', 'color:#cbd5e1;margin:8px 0 6px;', label));
    const wrap = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;');
    for (const [v, text] of options) {
      const on = v === value;
      const b = el('button', `padding:5px 10px;border-radius:999px;cursor:pointer;font-size:12px;font-family:${FONT};font-weight:600;border:1px solid ${on ? '#38bdf8' : 'rgba(255,255,255,0.12)'};background:${on ? '#0ea5e9' : 'transparent'};color:${on ? '#fff' : '#cbd5e1'};`, text);
      b.addEventListener('click', () => { if (on) return; if (direct) { apply(v); return; } this.commit(); apply(v); this.changed(); });
      wrap.append(b);
    }
    this.bubble.append(wrap);
  }
}
