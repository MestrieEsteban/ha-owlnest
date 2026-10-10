import type { Hass, CardConfig, EditableAnchor, CameraView, SceneSettings } from '../types';
import type { SceneCard, SceneCardType } from '../cards/types';
import { CARD_DEFAULT_ACCENT, CARD_TYPE_LABELS, CARDS_ENABLED } from '../cards/types';
import type { AnchorEditor, EditorTool } from '../editor';
import type { OwlnestRule } from '../rules/types';
import { normalizeRule } from '../rules/types';
import { t, tn, setLang, type StringKey } from '../i18n';
import { icon } from '../ui/icons';
import { entityIconName } from '../ui/entity-icon';
import { Tour, type TourStep } from '../ui/tour';
import { EDITOR_STYLES, BAR_H, BAR_H_PHONE, PANEL_W } from '../ui/editor-styles';
import { loadRegistry, cachedRegistry, areaOf } from '../entities/registry';
import { onHass } from '../entities/live';
import { openEntityPicker } from '../entities/picker';
import { deleteScene, summarizeScenes } from '../scene';
import { PARTS_ENABLED } from '../parts';
import type { SceneSummary } from '../scene';
import { describeEntity, knownStates, stateLabel } from '../entities/descriptors';
import { stateText } from '../entities/format';
import { FACADE_COLORS, GROUND_COLORS } from '../plan/rooms';
import type { FacadeMaterial } from '../plan/types';
import { openFraction, hasOpenSemantics, type ExtendInfo } from '../parts-runtime';
import type { ClipInfo } from '../parts-clips';
import { detectionLabel, resolveLevel } from '../quality';
import type { TapAction } from '../entities/descriptors';
import type { QualityLevel } from '../quality';
import type { AnchorKind, OwlnestPart, ExtendAxis } from '../types';
import {
  filterOutline, ancestorsOf, locatePart, revealRanks, outlineRows, centredScrollTop, PIECE_ROW,
  type ModelOutline, type OutlineRow,
} from '../model-outline';

/** Ce que la carte renvoie quand l'utilisateur clique une pièce du modèle. */
export interface PickedPart {
  mesh: string;
  meshIndex: number;
  triangle: number;
  /** Dimensions en centimètres, du plus grand axe au plus petit. */
  size: [number, number, number];
  guess: 'door' | 'window' | 'other';
  triangles: number;
  /** Renseigné quand le clic tombe sur la pièce détachée d'un ouvrant existant. */
  partId?: string;
}

/**
 * Ce qu'il faut surligner dans la vue. Les champs sont essayés dans l'ordre :
 * l'ouvrant monté, le nœud par son rang, la pièce d'une maille.
 */
export interface PartHighlightTarget {
  part?: string;
  node?: number;
  mesh?: number;
  triangle?: number;
  /** Rangs des suiveurs d'un déroulant, surlignés à part. */
  followers?: number[];
}

export interface PartHighlightRequest {
  hover: PartHighlightTarget | null;
  selected: PartHighlightTarget | null;
}

const MOTION_LABEL: Record<string, () => string> = {
  swing: () => t('partSwing'),
  slide: () => t('partSlide'),
  extend: () => t('partExtend'),
  animation: () => t('partAnimation'),
};

/**
 * Une liste déroulante native se dessine avec les couleurs du système, pas
 * celles du <select> : un texte clair posé sur le fond blanc de la popup
 * devenait illisible. `color-scheme:dark` fait rendre la popup en sombre, et
 * les styles appliqués à chaque <option> couvrent les navigateurs qui
 * l'ignorent.
 */
const SELECT_STYLE = ';cursor:pointer;color-scheme:dark;';

function styleOption(o: HTMLOptionElement): HTMLOptionElement {
  o.style.backgroundColor = '#1a1f2e';
  o.style.color = '#e2e8f0';
  return o;
}

/** Libelle d'une ancre pour les listes — une nature sans entite n'en a pas. */
function anchorTitle(a: { label?: string; entity: string; kind?: AnchorKind }): string {
  if (a.label) return a.label;
  const name = a.entity.split('.')[1];
  if (name) return name;
  return KIND_LABEL[a.kind ?? 'entity']();
}

/** Seconde ligne : l'entity_id, ou la nature quand il n'y en a pas. */
function anchorSubtitle(a: { entity: string; kind?: AnchorKind }): string {
  if (a.entity) return a.entity;
  if ((a.kind ?? 'entity') === 'entity') return t('edNotLinked');
  return KIND_LABEL[a.kind ?? 'entity']();
}

/** Une étape des premiers pas. `go` : l'onglet où la faire, ou une action propre. */
export interface SetupStep {
  id: 'plan' | 'device' | 'opening' | 'view' | 'custom';
  done: boolean;
}

/** Les onglets de l'éditeur de la maison, dans l'ordre. Le plan ouvre son propre éditeur. */
export function editorTabs(withPlan: boolean): { id: string; icon: string; label: string }[] {
  return [
    ...(withPlan ? [{ id: 'plan', icon: 'plan', label: t('tabPlan') }] : []),
    { id: 'anchors', icon: 'bulb', label: t('tabDevices') },
    ...(CARDS_ENABLED ? [{ id: 'cards', icon: 'layout', label: t('tabCards') }] : []),
    ...(PARTS_ENABLED ? [{ id: 'parts', icon: 'door', label: t('tabParts') }] : []),
    { id: 'rules', icon: 'bolt', label: t('tabRules') },
    { id: 'camera', icon: 'camera', label: t('tabCamera') },
    { id: 'weather', icon: 'sun', label: t('tabAmbiance') },
    { id: 'settings', icon: 'gear', label: t('tabSettings') },
  ];
}

/** Largeur du panneau pendant l'édition d'une règle : une phrase a besoin de place. */
const RULE_PANEL_W = 470;

/** La visite de l'éditeur a déjà été proposée sur cet appareil. */
const EDITOR_TOUR_KEY = 'owlnest_tour_editor_seen';

/** Le dessin d'un appareil dans la liste, d'après sa nature et son domaine. */
const anchorIcon = (a: { entity: string; kind?: AnchorKind }) => entityIconName(a.entity, a.kind);

/** Le dessin d'un ouvrant, d'après son mouvement. */
const PART_ICON: Record<string, string> = { swing: 'door', slide: 'slider', extend: 'awning', animation: 'play' };

const KIND_LABEL: Record<AnchorKind, () => string> = {
  entity: () => t('anchorKindEntity'),
  label:  () => t('anchorKindLabel'),
  menu:   () => t('anchorKindMenu'),
  nav:    () => t('anchorKindNav'),
};

/**
 * Résumé d'une règle en une ligne, pour que la liste soit lisible sans ouvrir
 * chaque entrée. Les libellés d'états passent par les descripteurs, donc on lit
 * « Ouverte » et non « on ».
 */
function ruleSummary(
  rule: OwlnestRule,
  hass: Hass | null,
  views: CameraView[],
): string {
  const r = normalizeRule(rule);

  const nameOf = (id: string) => {
    const fn = hass?.states[id]?.attributes?.friendly_name;
    return (typeof fn === 'string' && fn) ? fn : (id.split('.')[1] ?? id);
  };
  const stOf = (id: string, v?: string) =>
    v ? stateLabel(id, v, hass?.states[id]?.attributes ?? {}) : null;

  const triggers = (r.triggers ?? []).map((tr) => {
    if (tr.type === 'time') return `${t('ruleSummaryAt')} ${tr.at}`;
    if (tr.type === 'numeric_state') {
      const parts: string[] = [];
      if (tr.above !== undefined) return `${nameOf(tr.entity_id)} > ${tr.above}`;
      if (tr.below !== undefined) return `${nameOf(tr.entity_id)} < ${tr.below}`;
      return parts.join(' ') || nameOf(tr.entity_id);
    }
    const to = stOf(tr.entity_id, tr.to);
    const held = tr.for ? ` ${Math.round(tr.for / 60) || 1}′` : '';
    return `${nameOf(tr.entity_id)}${to ? ` → ${to}` : ''}${held}`;
  });

  const actions = (r.actions ?? []).map((a) => {
    if (a.type === 'go_to_view') {
      return `${t('ruleSummaryGo')} ${views.find((v) => v.id === a.view_id)?.label ?? '?'}`;
    }
    if (a.type === 'highlight_anchor') return `${t('ruleSummaryHighlight')} ${nameOf(a.anchor)}`;
    if (a.type === 'toast') return `« ${a.message || '…'} »`;
    return `${a.domain}.${a.service}`;
  });

  const left = triggers.length ? triggers.join(' | ') : t('ruleSummaryNoTrigger');
  const right = actions.length ? actions.join(' · ') : t('ruleSummaryNoAction');
  return `${left}  →  ${right}`;
}

/**
 * La regle est-elle assez complete pour que son resume soit lisible ?
 *
 * Un resume a trous (« → on → ▶ ? ») est pire qu'aucune suggestion : il donne
 * l'impression d'un bug alors que la regle est simplement en cours d'ecriture.
 */
function ruleIsComplete(rule: OwlnestRule): boolean {
  const r = normalizeRule(rule);
  if (!(r.triggers ?? []).length || !(r.actions ?? []).length) return false;
  for (const tr of r.triggers ?? []) {
    if (tr.type === 'time') { if (!tr.at) return false; continue; }
    if (!tr.entity_id) return false;
  }
  for (const a of r.actions ?? []) {
    if (a.type === 'go_to_view' && !a.view_id) return false;
    if (a.type === 'highlight_anchor' && !a.anchor) return false;
    if (a.type === 'toast' && !a.message.trim()) return false;
    if (a.type === 'call_service' && (!a.domain || !a.service)) return false;
  }
  return true;
}

/** Create a "?" tooltip badge with a fixed-position popup that escapes overflow containers. */
function createHelpBadge(text: string): HTMLElement {
  const badge = document.createElement('span');
  badge.textContent = '?';
  badge.style.cssText = [
    'display:inline-flex', 'align-items:center', 'justify-content:center',
    'width:14px', 'height:14px', 'border-radius:50%',
    'font-size:9px', 'font-weight:700', 'cursor:help',
    'background:rgba(255,255,255,0.08)', 'color:#64748b',
    'border:1px solid rgba(255,255,255,0.1)',
    'transition:background .15s,color .15s',
    // Ni étiré ni écrasé, même dans une ligne où les textes prennent la place.
    'flex:0 0 14px', 'margin-left:4px',
  ].join(';');

  let popup: HTMLDivElement | null = null;

  const showPopup = () => {
    if (popup) return;
    popup = document.createElement('div');
    popup.textContent = text;
    popup.style.cssText = [
      'position:fixed',
      'background:rgba(15,23,42,0.96)',
      'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:8px', 'padding:8px 10px',
      'font-size:11px', 'font-weight:400', 'line-height:1.4',
      'color:#e2e8f0', 'white-space:normal',
      'width:220px', 'max-width:260px',
      'pointer-events:none',
      'z-index:99999',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
      'opacity:0', 'transition:opacity .12s',
    ].join(';');

    const arrow = document.createElement('div');
    arrow.style.cssText = [
      'position:absolute', 'top:100%', 'left:50%', 'transform:translateX(-50%)',
      'width:0', 'height:0',
      'border-left:5px solid transparent', 'border-right:5px solid transparent',
      'border-top:5px solid rgba(15,23,42,0.96)',
    ].join(';');
    popup.appendChild(arrow);

    const attachTarget = badge.getRootNode() as Document | ShadowRoot;
    if (attachTarget instanceof ShadowRoot) {
      attachTarget.appendChild(popup);
    } else {
      document.body.appendChild(popup);
    }

    const rect = badge.getBoundingClientRect();
    const popupWidth = 220;
    let left = rect.left + rect.width / 2 - popupWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${rect.top - 6}px`;
    popup.style.transform = 'translateY(-100%)';

    requestAnimationFrame(() => { if (popup) popup.style.opacity = '1'; });
    badge.style.background = 'rgba(125,209,252,0.2)';
    badge.style.color = '#7dd3fc';
  };

  const hidePopup = () => {
    if (popup) { popup.remove(); popup = null; }
    badge.style.background = 'rgba(255,255,255,0.08)';
    badge.style.color = '#64748b';
  };

  badge.addEventListener('mouseenter', showPopup);
  badge.addEventListener('mouseleave', hidePopup);
  let touchOpen = false;
  badge.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    touchOpen = !touchOpen;
    if (touchOpen) showPopup(); else hidePopup();
  });

  return badge;
}

export class EditPanel {
  private _panel: HTMLDivElement | null = null;
  private _saveStatus: 'saved' | 'unsaved' | 'saving' = 'saved';
  private _editorDragging = false;
  private _gizmoDragging = false;
  private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _activeInspectorTab: string | null = null;

  // ── Card / Rule undo-redo stacks ──────────────────────────────────────────
  private _cardUndoStack: SceneCard[][] = [];
  private _cardRedoStack: SceneCard[][] = [];
  /**
   * Exécute une règle immédiatement, pour le bouton « Tester ». Fourni par la
   * carte, qui seule sait appliquer les actions sur la scène.
   */
  onTestRule?: (rule: OwlnestRule) => void;
  /** Ouvrants Sweet Home 3D reconnus dans le modèle et pas encore ajoutés. */
  countDetectedOpenings?: () => number;
  /** Ajoute ces ouvrants à la scène. */
  onAddDetectedOpenings?: () => Promise<void>;
  /** Tous les vantaux reconnus, y compris ceux déjà dans la scène. */
  countAllDetectedOpenings?: () => number;
  /** Remplace les ouvrants par ceux reconnus, capteurs gardés. */
  onReplaceDetectedOpenings?: () => Promise<void>;
  /** Ouvre l'éditeur de plan, pour dessiner son logement dans la carte. */
  onDrawPlan?: () => void;
  /**
   * Les premiers pas : ce qui est déjà fait, et où aller pour la suite. Fourni
   * par la carte, qui seule voit le plan, les vues et la personnalisation.
   */
  getSetupSteps?: () => SetupStep[];
  /** Quitter l'éditeur et ouvrir « Personnaliser » sur la carte. */
  onCustomize?: () => void;
  /** Pose les appareils des pièces de Home Assistant dans les pièces du même nom. */
  onAutoPlace?: () => Promise<void>;
  /**
   * Le nom de l'étage d'un ouvrant quand il n'est pas celui qu'on regarde
   * (`null` sinon), et l'étage à montrer avant d'ouvrir sa fiche.
   */
  partFloor?: (part: OwlnestPart) => string | null;
  /** L'apparence de la maison dessinée (façade), lue et changée sur le plan ; `null` sans plan. */
  getPlanLook?: () => { outside?: string; facade?: FacadeMaterial; plinth?: boolean } | null;
  setPlanLook?: (patch: { outside?: string; facade?: FacadeMaterial; plinth?: boolean }) => void;

  /** Les niveaux du logement, l'étage regardé, et en changer (vide : pas d'étages). */
  floors?: { list: () => string[]; active: () => number; set: (k: number) => void };
  private _floorsEl: HTMLDivElement | null = null;

  /**
   * Le choix d'étage pendant l'édition, en haut à gauche de la 3D : la barre
   * des pièces de la carte est cachée, et l'on doit pouvoir poser un
   * appareil à l'étage sans passer par la liste.
   */
  refreshFloors() {
    const names = this.floors?.list() ?? [];
    if (names.length < 2 || !this._bar) { this._floorsEl?.remove(); this._floorsEl = null; return; }
    if (!this._floorsEl) {
      const el = document.createElement('div');
      el.className = 'ow-ed ow-ed-floors';
      el.setAttribute('role', 'tablist');
      el.setAttribute('aria-label', t('uiFloors'));
      this.overlayContainer.appendChild(el);
      this._floorsEl = el;
    }
    const el = this._floorsEl;
    el.innerHTML = '';
    const active = this.floors!.active();
    names.forEach((name, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ow-tab${k === active ? ' ow-on' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k === active));
      b.dataset.floor = String(k);
      b.textContent = name;
      b.addEventListener('click', () => { if (k !== this.floors!.active()) this.floors!.set(k); });
      el.appendChild(b);
    });
  }

  /** Le nom de l'étage d'un appareil quand il n'est pas celui qu'on regarde. */
  anchorFloor?: (a: EditableAnchor) => string | null;
  showPartFloor?: (part: OwlnestPart) => void;
  /** Ouvre le sélecteur de fichiers pour importer un plan (admin seulement). */
  onImportModel?: () => void;

  private _ruleUndoStack: OwlnestRule[][] = [];
  private _ruleRedoStack: OwlnestRule[][] = [];

  get panel() { return this._panel; }
  get editorDragging() { return this._editorDragging; }
  get gizmoDragging() { return this._gizmoDragging; }
  set editorDragging(v: boolean) { this._editorDragging = v; }
  set gizmoDragging(v: boolean) { this._gizmoDragging = v; }
  get saveStatus() { return this._saveStatus; }

  constructor(
    private overlayContainer: HTMLElement,
    private hud: HTMLDivElement,
    private hudLeft: HTMLDivElement,
    private hudRight: HTMLDivElement,
    private hudSep: HTMLDivElement,
    private cardContainer: HTMLElement,
    private getEditor: () => AnchorEditor | null,
    private getHass: () => Hass | null,
    private getConfig: () => CardConfig | null,
    private getSceneId: () => string | undefined,
    private onSave: () => Promise<void>,
    private onClose: () => void,
    private syncLightsToScene: () => void,
    private requestRender: () => void,
    private rebuildNormalHUD: () => void,
    private getCards?: () => SceneCard[],
    private saveCards?: (cards: SceneCard[]) => Promise<void>,
    private getSelectedCardId?: () => string | null,
    private onSelectCard?: (id: string | null) => void,
    private onStartCardPlacement?: (type: SceneCardType) => void,
    private getRules?: () => OwlnestRule[],
    private saveRules?: (rules: OwlnestRule[]) => Promise<void>,
    private getViews?: () => CameraView[],
    private getSim?: () => { buildContentInto: (c: HTMLElement) => void } | null,
    private getViewMgr?: () => import('./view-manager').ViewManager | null,
    private getSceneSettings?: () => SceneSettings,
    private onSceneSettingsChange?: (s: SceneSettings, reloadScene?: boolean) => void,
    private listScenesFn?: () => Promise<string[]>,
    private getParts?: () => OwlnestPart[],
    private saveParts?: (parts: OwlnestPart[]) => Promise<void>,
    /** Passe la carte en mode « clique une pièce du modèle ». */
    private onStartPartPicking?: (onPicked: (hit: PickedPart) => void) => void,
    /** Entrouvre un ouvrant pour vérifier son sens sans toucher à la maison. */
    private onPreviewPart?: (id: string, fraction: number) => void,
    /**
     * Applique un réglage immédiatement. Retourne `false` si l'ouvrant n'est
     * pas encore monté dans la scène, auquel cas il faut passer par un
     * enregistrement.
     */
    private onConfigurePart?: (cfg: OwlnestPart) => boolean,
    /** Envergure du modèle : les distances d'orbite s'y expriment. */
    private getModelSpan?: () => number,
    /** Arborescence du modèle chargé, pour choisir l'objet d'un ouvrant. */
    private getModelOutline?: () => ModelOutline | null,
    /** Surligne dans la vue ce que l'arborescence survole et sélectionne. */
    private onHighlightPart?: (req: PartHighlightRequest) => void,
    /** Nombre de pièces que l'ouvrant emmène, au dernier montage. */
    private getCarriedCount?: (id: string) => number,
    /** Valeurs détectées d'un déroulant monté, et ses suiveurs possibles. */
    private getExtendInfo?: (id: string) => ExtendInfo | null,
    /** Animations enregistrées dans le modèle (pistes NLA de Blender). */
    private getClips?: () => ClipInfo[],
  ) {}

  // ── Card undo/redo ────────────────────────────────────────────────────────
  private _snapCards(): SceneCard[] { return JSON.parse(JSON.stringify(this.getCards?.() ?? [])); }
  private _snapRules(): OwlnestRule[] { return JSON.parse(JSON.stringify(this.getRules?.() ?? [])); }

  private _pushCardSnap() {
    this._cardUndoStack.push(this._snapCards());
    if (this._cardUndoStack.length > 50) this._cardUndoStack.shift();
    this._cardRedoStack = [];
  }
  /** Public — called from ha-3d-floorplan before a 3D card move or placement commit. */
  pushCardSnapshot() { this._pushCardSnap(); }

  private _pushRuleSnap() {
    this._ruleUndoStack.push(this._snapRules());
    if (this._ruleUndoStack.length > 50) this._ruleUndoStack.shift();
    this._ruleRedoStack = [];
  }

  private _undoCards(): boolean {
    if (!this._cardUndoStack.length) return false;
    this._cardRedoStack.push(this._snapCards());
    this.saveCards?.(this._cardUndoStack.pop()!).then(() => this.updateAnchorList());
    return true;
  }
  private _redoCards(): boolean {
    if (!this._cardRedoStack.length) return false;
    this._cardUndoStack.push(this._snapCards());
    this.saveCards?.(this._cardRedoStack.pop()!).then(() => this.updateAnchorList());
    return true;
  }
  private _undoRules(): boolean {
    if (!this._ruleUndoStack.length) return false;
    this._ruleRedoStack.push(this._snapRules());
    this.saveRules?.(this._ruleUndoStack.pop()!).then(() => this.updateAnchorList());
    return true;
  }
  private _redoRules(): boolean {
    if (!this._ruleRedoStack.length) return false;
    this._ruleUndoStack.push(this._snapRules());
    this.saveRules?.(this._ruleRedoStack.pop()!).then(() => this.updateAnchorList());
    return true;
  }

  // ── La coquille de l'éditeur : barre d'onglets en haut, panneau à droite ──

  private _bar: HTMLDivElement | null = null;
  private _tour: Tour | null = null;
  private _switchTab: ((id: string) => void) | null = null;
  private _anchorQuery = '';
  private _narrow = false;
  private _panelOpen = false;
  private _widthObs: ResizeObserver | null = null;
  private _popmenu: HTMLElement | null = null;
  private _helloEl: HTMLElement | null = null;
  private _registryAsked = false;
  /**
   * Ce qui suit l'état de Home Assistant pendant l'édition : les lignes des
   * listes (mises à jour sur place, sans tout reconstruire) et la fiche ouverte.
   */
  private _liveRows = new Map<string, () => void>();
  private _livePartRows = new Map<string, () => void>();
  private _liveForm: (() => void) | null = null;
  private _stopLive: (() => void) | null = null;
  /** La 3D se décale de la largeur du panneau ancré à droite (0 : rien ne la couvre). */
  onDock?: (px: number) => void;

  /** L'onglet à ouvrir en entrant, par exemple en revenant de l'éditeur de plan. */
  setInitialTab(id?: string) {
    if (!id || id === 'plan') return;
    this._activeInspectorTab = id === 'config' ? 'settings' : id;
  }

  private _tabs() { return editorTabs(!!this.onDrawPlan); }

  showToolbar() {
    // L'ancienne barre du bas n'a plus de rôle en édition.
    this.hud.style.display = 'none';
    if (!this.overlayContainer.querySelector('#ow-editor-styles')) {
      const st = document.createElement('style');
      st.id = 'ow-editor-styles';
      st.textContent = EDITOR_STYLES;
      this.overlayContainer.appendChild(st);
    }
    this._buildBar();
    this.refreshFloors();

    const editor = this.getEditor();
    if (editor) {
      const prevOnToolChange = editor.onToolChange;
      editor.onToolChange = (tool) => {
        this._paintModes();
        prevOnToolChange?.(tool);
      };
      // Chain card/rule undo into anchor editor fallback so Ctrl+Z and buttons both work
      editor.onUndoFallback = () => { if (!this._undoCards()) this._undoRules(); };
      editor.onRedoFallback = () => { if (!this._redoCards()) this._redoRules(); };
    }

    this._saveStatus = 'saved';
    this.buildAnchorList();
    this._stopLive?.();
    this._stopLive = onHass(() => {
      for (const update of this._liveRows.values()) update();
      for (const update of this._livePartRows.values()) update();
      this._liveForm?.();
    }, 400);
    this._tour = new Tour(this.overlayContainer);
    this._widthObs = new ResizeObserver(() => this._applyWidth());
    this._widthObs.observe(this.cardContainer);
    this._applyWidth();
    this._offerTour();
  }

  private _buildBar() {
    this._bar?.remove();
    const bar = document.createElement('div');
    bar.className = 'ow-ed ow-edbar';
    bar.setAttribute('role', 'toolbar');

    const title = document.createElement('div');
    title.className = 'ow-edtitle';
    const titleText = document.createElement('span');
    titleText.textContent = t('editTitle');
    title.append(icon('pencil', 18), titleText);

    const tabs = document.createElement('div');
    tabs.className = 'ow-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const tab of this._tabs()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ow-tab';
      b.dataset.tab = tab.id;
      b.setAttribute('role', 'tab');
      b.title = tab.label;
      const label = document.createElement('span');
      label.textContent = tab.label;
      b.append(icon(tab.icon, 16), label);
      b.addEventListener('click', () => {
        this._closePopmenu();
        if (tab.id === 'plan') { this.onDrawPlan?.(); return; }
        this._switchTab?.(tab.id);
        if (this._narrow) this._setPanelOpen(true);
      });
      tabs.appendChild(b);
    }

    const act = document.createElement('div');
    act.className = 'ow-edact';
    const iconBtn = (name: string, label: string, onClick: (b: HTMLButtonElement) => void, extra = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ow-ib ${extra}`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.append(icon(name, 18));
      b.addEventListener('click', () => onClick(b));
      return b;
    };
    const panelBtn = iconBtn('layout', t('edPanel'), () => this._setPanelOpen(!this._panelOpen), 'ow-only-narrow');
    panelBtn.dataset.act = 'panel';
    const undo = iconBtn('undo', t('undoTitle'), () => this.getEditor()?.undo());
    const redo = iconBtn('redo', t('redoTitle'), () => this.getEditor()?.redo());
    const help = iconBtn('help', t('edHelp'), (b) => this._openHelpMenu(b));
    help.dataset.act = 'help';
    const save = document.createElement('span');
    save.id = 'save-indicator';
    save.className = 'ow-save';
    if (!this.getSceneId()) save.style.display = 'none';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'ow-btn ow-primary';
    done.dataset.act = 'done';
    done.title = t('doneBtnTitle');
    done.append(icon('check', 16), document.createTextNode(t('doneBtn')));
    done.addEventListener('click', () => this.onClose());
    const steps = document.createElement('button');
    steps.type = 'button';
    steps.className = 'ow-steps';
    steps.dataset.act = 'steps';
    steps.addEventListener('click', () => this._openSetupMenu(steps));
    act.append(save, steps, panelBtn, undo, redo, help, done);

    bar.append(title, tabs, act);
    this.overlayContainer.appendChild(bar);
    this._bar = bar;
    this._paintTabs();
    this._updateSaveIndicator();
    this._paintSteps();
  }

  /** La pastille « Premiers pas » : la progression, cachée une fois tout fait. */
  private _paintSteps() {
    const btn = this._bar?.querySelector<HTMLButtonElement>('[data-act="steps"]');
    if (!btn) return;
    const steps = this.getSetupSteps?.() ?? [];
    const done = steps.filter((s) => s.done).length;
    // `hidden` ne suffit pas : la classe impose un `display`.
    btn.style.display = !steps.length || done === steps.length ? 'none' : '';
    btn.innerHTML = '';
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 20 20');
    ring.setAttribute('width', '18');
    ring.setAttribute('height', '18');
    const frac = steps.length ? done / steps.length : 0;
    ring.innerHTML = `<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.5"/>`
      + `<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(frac * 50.3).toFixed(1)} 50.3" transform="rotate(-90 10 10)"/>`;
    const label = document.createElement('span');
    label.textContent = `${t('setupTitle')} ${done}/${steps.length}`;
    btn.append(ring, label);
    btn.title = t('setupTitle');
  }

  /** La liste des premiers pas : chaque étape cochée ou à faire, et où la faire. */
  private _openSetupMenu(btn: HTMLElement) {
    const steps = this.getSetupSteps?.() ?? [];
    const LABEL: Record<SetupStep['id'], [StringKey, StringKey, string]> = {
      plan: ['setupPlan', 'setupPlanHint', 'plan'],
      device: ['setupDevice', 'setupDeviceHint', 'bulb'],
      opening: ['setupOpening', 'setupOpeningHint', 'door'],
      view: ['setupView', 'setupViewHint', 'camera'],
      custom: ['setupCustom', 'setupCustomHint', 'brush'],
    };
    const go = (id: SetupStep['id']) => {
      if (id === 'plan') { this.onDrawPlan?.(); return; }
      if (id === 'custom') { this.onCustomize?.(); return; }
      const tab = id === 'device' ? 'anchors' : id === 'opening' ? 'parts' : 'camera';
      this._switchTab?.(tab);
      if (this._narrow) this._setPanelOpen(true);
      if (id === 'device') this.getEditor()?.setTool('add');
    };
    this._openPopmenu(btn, (menu) => {
      menu.classList.add('ow-setup');
      const title = document.createElement('div');
      title.className = 'ow-setup-t';
      title.textContent = t('setupTitle');
      const intro = document.createElement('div');
      intro.className = 'ow-setup-i';
      intro.textContent = t('setupIntro');
      menu.append(title, intro);
      for (const step of steps) {
        const [label, hint, ic] = LABEL[step.id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ow-setup-row${step.done ? ' ow-done' : ''}`;
        const mark = document.createElement('span');
        mark.className = 'ow-setup-mark';
        mark.append(icon(step.done ? 'check' : ic, 15));
        const col = document.createElement('span');
        col.className = 'ow-setup-nm';
        const nm = document.createElement('b');
        nm.textContent = t(label);
        const sub = document.createElement('span');
        sub.textContent = t(hint);
        col.append(nm, sub);
        b.append(mark, col);
        if (!step.done) b.append(icon('chevron', 15));
        b.addEventListener('click', () => { this._closePopmenu(); go(step.id); });
        menu.appendChild(b);
      }
    });
  }

  private _paintTabs() {
    const active = this._activeInspectorTab ?? 'anchors';
    this._bar?.querySelectorAll<HTMLButtonElement>('.ow-tab').forEach((b) => {
      const on = b.dataset.tab === active;
      b.classList.toggle('ow-on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  /** Largeur du panneau ancré : élargi pendant l'édition d'une règle. */
  private _panelW = PANEL_W;
  private _setPanelWidth(px: number) {
    this._panelW = px;
    if (this._panel) this._panel.style.width = this._narrow ? '' : `${px}px`;
    this._applyWidth();
  }

  /** Sur une carte étroite, le panneau passe par-dessus la 3D et s'ouvre à la demande. */
  private _applyWidth() {
    const narrow = this.cardContainer.clientWidth < 760;
    if (narrow !== this._narrow) {
      this._narrow = narrow;
      if (!narrow) this._panelOpen = false;
    }
    // Un téléphone : les onglets prennent toute une ligne, la barre double de hauteur.
    const phone = this.cardContainer.clientWidth < 560;
    this._bar?.classList.toggle('ow-narrow', narrow);
    this._bar?.classList.toggle('ow-phone', phone);
    this._panel?.classList.toggle('ow-narrow', narrow);
    this._panel?.classList.toggle('ow-phone', phone);
    this.cardContainer.style.setProperty('--ow-bar-h', `${phone ? BAR_H_PHONE : BAR_H}px`);
    this._panel?.classList.toggle('ow-panel-open', this._panelOpen);
    if (this._panel) this._panel.style.width = narrow ? '' : `${this._panelW}px`;
    this.cardContainer.style.setProperty('--ow-dock', `${narrow ? 0 : this._panelW}px`);
    this.onDock?.(narrow ? 0 : this._panelW);
  }

  private _setPanelOpen(on: boolean) {
    this._panelOpen = on;
    this._panel?.classList.toggle('ow-panel-open', on);
  }

  private _closePopmenu() {
    this._popmenu?.remove();
    this._popmenu = null;
    document.removeEventListener('pointerdown', this._onPopOutside, true);
  }

  private _onPopOutside = (e: PointerEvent) => {
    if (this._popmenu && !e.composedPath().includes(this._popmenu)) this._closePopmenu();
  };

  /** Un petit menu sous un bouton de la barre ou du panneau. */
  private _openPopmenu(anchor: HTMLElement, fill: (menu: HTMLDivElement) => void) {
    if (this._popmenu) { this._closePopmenu(); return; }
    const menu = document.createElement('div');
    menu.className = 'ow-ed ow-popmenu';
    menu.setAttribute('role', 'menu');
    fill(menu);
    this.overlayContainer.appendChild(menu);
    const hr = this.overlayContainer.getBoundingClientRect(), br = anchor.getBoundingClientRect();
    menu.style.top = `${br.bottom - hr.top + 6}px`;
    menu.style.right = `${Math.max(8, hr.right - br.right)}px`;
    this._popmenu = menu;
    setTimeout(() => document.addEventListener('pointerdown', this._onPopOutside, true), 0);
  }

  private _menuItem(menu: HTMLElement, iconName: string, label: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(icon(iconName, 18), document.createTextNode(label));
    b.addEventListener('click', () => { this._closePopmenu(); onClick(); });
    menu.appendChild(b);
  }

  /** L'aide : la visite de l'onglet courant, et les raccourcis clavier. */
  private _openHelpMenu(btn: HTMLElement) {
    this._openPopmenu(btn, (menu) => {
      this._menuItem(menu, 'play', t('edTourThisTab'), () => this.startTabTour());
      this._menuItem(menu, 'more', t('edShortcuts'), () => this._showShortcuts(btn));
    });
  }

  private _showShortcuts(btn: HTMLElement) {
    this._openPopmenu(btn, (menu) => {
      const title = document.createElement('div');
      title.className = 'ow-menu-title';
      title.style.cssText = 'font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ow-muted);padding:4px 10px 0;';
      title.textContent = t('edShortcuts');
      const keys = document.createElement('div');
      keys.className = 'ow-keys';
      const rows: [string, string][] = [
        ['S', t('hintSelect')], ['A', t('hintAdd')], ['G', t('hintGrab')], ['G → X/Y/Z', t('hintAxis')], ['R', t('hintRotate')],
        ['X', t('hintDelete')], ['H', t('hintHide')], ['Ctrl+D', t('hintDup')], ['Ctrl+Z', t('hintUndo')], ['Esc', t('hintEsc')],
        [t('hintRClickKey'), t('hintRClick')],
      ];
      for (const [k, v] of rows) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        const span = document.createElement('span');
        span.textContent = v;
        keys.append(kbd, span);
      }
      menu.append(title, keys);
    });
  }

  /** La première fois dans l'éditeur, une invitation discrète à la visite. */
  private _offerTour() {
    let seen = true;
    try { seen = localStorage.getItem(EDITOR_TOUR_KEY) === '1'; } catch { /* stockage bloqué */ }
    if (seen) return;
    const pill = document.createElement('div');
    pill.className = 'ow-ui ow-surface ow-pill ow-ed';
    // En bas de la 3D : le haut accueille le choix d'étage, et sur une carte
    // étroite le panneau le recouvre.
    pill.style.cssText = this._narrow
      ? 'bottom:16px;left:12px;right:12px;transform:none;justify-content:space-between;z-index:30;'
      : 'bottom:16px;left:calc(50% - var(--ow-dock, 0px) / 2);z-index:30;';
    const text = document.createElement('span');
    text.textContent = t('edHello');
    if (this._narrow) text.style.cssText = 'white-space:normal;line-height:1.3;';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'ow-btn ow-primary ow-small';
    go.style.borderRadius = '999px';
    go.textContent = t('uiHelloGo');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ow-ib';
    x.style.cssText = 'width:28px;height:28px;';
    x.setAttribute('aria-label', t('tourClose'));
    x.append(icon('close', 15));
    const close = () => {
      pill.remove();
      this._helloEl = null;
      try { localStorage.setItem(EDITOR_TOUR_KEY, '1'); } catch { /* stockage bloqué */ }
    };
    go.addEventListener('click', () => { close(); this.startTabTour(); });
    x.addEventListener('click', close);
    pill.append(text, go, x);
    this.overlayContainer.appendChild(pill);
    this._helloEl = pill;
  }

  /** La visite de l'onglet ouvert. */
  startTabTour() {
    if (!this._tour) return;
    this._helloEl?.remove();
    this._helloEl = null;
    try { localStorage.setItem(EDITOR_TOUR_KEY, '1'); } catch { /* stockage bloqué */ }
    const tab = this._activeInspectorTab ?? 'anchors';
    const pane = () => this._panel?.querySelector<HTMLElement>(`[data-pane="${tab}"]`);
    const inPane = (sel: string) => () => pane()?.querySelector<HTMLElement>(sel) ?? pane();
    if (this._narrow) this._setPanelOpen(true);
    const steps: TourStep[] = [];
    if (tab === 'anchors') {
      steps.push(
        { target: () => this._bar?.querySelector('.ow-tabs'), title: 'tourEdTabsTitle', text: 'tourEdTabsText', anim: 'gear' },
        { target: inPane('.ow-acts'), title: 'tourEdAddTitle', text: 'tourEdAddText', anim: 'add' },
        { target: inPane('.ow-list'), title: 'tourEdListTitle', text: 'tourEdListText', anim: 'tap' },
        { target: () => this._bar?.querySelector('[data-act="help"]'), title: 'tourEdHelpTitle', text: 'tourEdHelpText', anim: 'gear' },
        { target: () => this._bar?.querySelector('[data-act="done"]'), title: 'tourEdDoneTitle', text: 'tourEdDoneText', anim: 'full' },
      );
    } else if (tab === 'parts') {
      steps.push({ target: inPane('.ow-ph'), title: 'tourEdPartsTitle', text: 'tourEdPartsText', anim: 'door' });
    } else if (tab === 'rules') {
      steps.push({ target: inPane('.ow-ph'), title: 'tourEdRulesTitle', text: 'tourEdRulesText', anim: 'rule' });
    } else if (tab === 'weather') {
      steps.push({ target: pane, title: 'tourEdMoodTitle', text: 'tourEdMoodText', anim: 'sun' });
    } else if (tab === 'camera') {
      steps.push({ target: inPane('.ow-ph'), title: 'tourEdViewsTitle', text: 'tourEdViewsText', anim: 'views' });
    } else if (tab === 'settings') {
      steps.push({ target: pane, title: 'tourEdSettingsTitle', text: 'tourEdSettingsText', anim: 'gear' });
    } else {
      steps.push({ target: pane, title: 'tourEdTabsTitle', text: 'tourEdTabsText', anim: 'gear' });
    }
    if (this.onDrawPlan && tab === 'anchors') {
      steps.splice(1, 0, { target: () => this._bar?.querySelector('[data-tab="plan"]'), title: 'tourEdPlanTitle', text: 'tourEdPlanText', anim: 'plan' });
    }
    this._tour.start(steps);
  }

  hideToolbar() {
    this._panel?.querySelector('#owlnest-rule-modal')?.remove();
    this._panelW = PANEL_W;
    this._stopLive?.();
    this._stopLive = null;
    this._liveRows.clear();
    this._livePartRows.clear();
    this._liveForm = null;
    this._closePartModal?.();
    this._closePopmenu();
    this._tour?.end();
    this._tour = null;
    this._helloEl?.remove();
    this._helloEl = null;
    this._widthObs?.disconnect();
    this._widthObs = null;
    this._panel?.remove();
    this._panel = null;
    this._bar?.remove();
    this._bar = null;
    this._floorsEl?.remove();
    this._floorsEl = null;
    this.cardContainer.style.removeProperty('--ow-dock');
    this.cardContainer.style.removeProperty('--ow-bar-h');
    this.onDock?.(0);
    this.hud.querySelector('#editor-hint-bar')?.remove();
    // Restore HUD to normal camera view + action buttons
    this.rebuildNormalHUD();
  }

  buildAnchorList() {
    this._panel?.remove();
    if (!this.overlayContainer || !this.getEditor()) return;

    const panel = document.createElement('div');
    panel.className = `ow-ed ow-edpanel${this._narrow ? ' ow-narrow' : ''}${this._panelOpen ? ' ow-panel-open' : ''}`;

    // Stop key events bubbling to HA shortcuts
    panel.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        e.stopPropagation();
      }
    });

    // Warning banner if no scene_id — modifications not persisted
    if (!this.getSceneId()) {
      const warn = document.createElement('div');
      warn.className = 'ow-warn';
      warn.textContent = t('warnNoSceneId');
      panel.appendChild(warn);
    }

    // ── Body: list view ↔ detail view ─────────────────────────────────
    const listView = document.createElement('div');
    listView.id = 'inspector-list';
    listView.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

    const detailView = document.createElement('div');
    detailView.id = 'inspector-detail';
    detailView.className = 'ow-legacy';
    detailView.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:12px 12px 10px;display:none;';

    const showDetail = () => { listView.style.display = 'none'; detailView.style.display = 'block'; };
    const showList   = () => { listView.style.display = 'flex';  detailView.style.display = 'none'; };

    panel.appendChild(listView);
    panel.appendChild(detailView);
    this._panel = panel;
    this.overlayContainer.appendChild(panel);

    this._fillListView(listView, detailView, showDetail, showList);

    // If something is already selected, open detail immediately
    const editor = this.getEditor();
    const selKey = editor?.selectedKey;
    const selCardId = this.getSelectedCardId?.();
    if (selKey && editor?.anchors.has(selKey)) {
      this._buildPropsSection(detailView, selKey, editor.anchors.get(selKey)!, showList);
      showDetail();
    } else if (selCardId) {
      const selCard = (this.getCards?.() ?? []).find((c) => c.id === selCardId);
      if (selCard) { this._buildCardPropsSection(detailView, selCard, showList); showDetail(); }
    }
    if (this._narrow && (selKey || selCardId)) this._setPanelOpen(true);
  }

  /** L'outil de l'éditeur d'ancres se lit sur les boutons du haut de la liste. */
  private _paintModes() {
    const tool = this.getEditor()?.tool;
    this._panel?.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === tool;
      b.classList.toggle('ow-on', on);
      if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', String(on));
    });
  }

  private _fillListView(
    listView: HTMLDivElement,
    detailView: HTMLDivElement,
    showDetail: () => void,
    showList: () => void,
  ) {
    listView.innerHTML = '';
    const editor = this.getEditor();
    if (!editor) return;
    const anchors = editor.anchors;
    const selectedKey = editor.selectedKey;
    const hass = this.getHass();

    const cards = this.getCards ? this.getCards() : [];
    const rulesCount = (this.getRules?.() ?? []).length;
    const partsCount = (this.getParts?.() ?? []).length;

    const TAB_IDS = ['anchors', 'cards', 'parts', 'rules', 'camera', 'weather', 'settings'] as const;
    type TabId = typeof TAB_IDS[number];
    // Un onglet masqué mémorisé d'un précédent rendu ne doit pas être restauré :
    // aucun bouton ne permettrait d'en sortir.
    const tabVisible = (id: string) =>
      (id !== 'cards' || CARDS_ENABLED) && (id !== 'parts' || PARTS_ENABLED);
    const defaultTab: TabId = CARDS_ENABLED && this.getSelectedCardId?.() ? 'cards' : 'anchors';
    const remembered = this._activeInspectorTab;
    let activeTab: TabId =
      (remembered && (TAB_IDS as readonly string[]).includes(remembered) && tabVisible(remembered)
        ? remembered as TabId
        : null) ?? defaultTab;

    const tabPanes = new Map<TabId, HTMLDivElement>();
    for (const id of TAB_IDS) {
      const pane = document.createElement('div');
      pane.dataset.pane = id;
      pane.style.cssText = 'flex-direction:column;flex:1;min-height:0;overflow:hidden;display:none;';
      tabPanes.set(id, pane);
      listView.appendChild(pane);
    }
    const applyTab = (id: TabId) => {
      activeTab = id;
      this._activeInspectorTab = id;
      tabPanes.forEach((p, k) => { p.style.display = k === id ? 'flex' : 'none'; });
      this._paintTabs();
    };
    this._switchTab = (id: string) => {
      if (!(TAB_IDS as readonly string[]).includes(id) || !tabVisible(id)) return;
      this._tour?.end();
      showList();
      applyTab(id as TabId);
    };

    /** L'en-tête commun : titre, nombre, une ligne d'explication, l'action principale. */
    const buildTabHeader = (
      pane: HTMLElement,
      title: string,
      desc: string,
      action?: { label: string; onClick: () => void; badge?: string },
      count?: number,
    ): void => {
      const hdr = document.createElement('div');
      hdr.className = 'ow-ph';
      const row = document.createElement('div');
      row.className = 'ow-ph-t';
      const b = document.createElement('b');
      b.textContent = title;
      row.appendChild(b);
      if (count) {
        const n = document.createElement('span');
        n.className = 'ow-n';
        n.textContent = String(count);
        row.appendChild(n);
      }
      if (action?.badge) {
        const badge = document.createElement('span');
        badge.className = 'ow-beta';
        badge.textContent = action.badge;
        row.appendChild(badge);
      }
      hdr.appendChild(row);
      const d = document.createElement('div');
      d.className = 'ow-ph-d';
      d.textContent = desc;
      hdr.appendChild(d);
      if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ow-btn ow-primary';
        btn.append(icon('plus', 16), document.createTextNode(action.label.replace(/^[+＋]\s*/, '')));
        btn.addEventListener('click', action.onClick);
        hdr.appendChild(btn);
      }
      pane.appendChild(hdr);
    };

    // ── Appareils (les ancres) ───────────────────────────────────────
    const anchorsPane = tabPanes.get('anchors')!;
    {
      const hdr = document.createElement('div');
      hdr.className = 'ow-ph';
      const row = document.createElement('div');
      row.className = 'ow-ph-t';
      const b = document.createElement('b');
      b.textContent = t('tabDevices');
      row.appendChild(b);
      if (anchors.size) {
        const n = document.createElement('span');
        n.className = 'ow-n';
        n.textContent = String(anchors.size);
        row.appendChild(n);
      }
      hdr.appendChild(row);

      // Les actions, juste au-dessus de la liste : le mode, et « Ajouter » mis en avant.
      const acts = document.createElement('div');
      acts.className = 'ow-acts';
      const modes = document.createElement('div');
      modes.className = 'ow-modes';
      modes.setAttribute('role', 'radiogroup');
      modes.setAttribute('aria-label', t('edMode'));
      const MODES: [EditorTool, string, string][] = [
        ['select', 'select', t('edModeSelect')],
        ['rotate', 'rotl', t('edModeRotate')],
        ['delete', 'trash', t('edModeRemove')],
      ];
      for (const [tool, ic, label] of MODES) {
        const m = document.createElement('button');
        m.type = 'button';
        m.className = `ow-mode${tool === 'delete' ? ' ow-danger' : ''}`;
        m.dataset.tool = tool;
        m.setAttribute('role', 'radio');
        m.title = label;
        m.append(icon(ic, 17), document.createTextNode(label));
        m.addEventListener('click', () => this.getEditor()?.setTool(tool));
        modes.appendChild(m);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ow-btn ow-primary ow-big';
      add.dataset.tool = 'add';
      add.title = t('hintBarPlaceAnchor');
      add.append(icon('plus', 17), document.createTextNode(t('edModeAdd')));
      add.addEventListener('click', () => {
        const ed = this.getEditor();
        ed?.setTool(ed.tool === 'add' ? 'select' : 'add');
        if (this._narrow) this._setPanelOpen(false);
      });
      acts.append(modes, add);
      hdr.appendChild(acts);

      // Recherche, et le menu « Tout afficher / tout masquer ».
      const search = document.createElement('label');
      search.className = 'ow-search';
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = t('edSearch');
      input.setAttribute('aria-label', t('edSearch'));
      input.value = this._anchorQuery;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ow-ib';
      more.title = t('edMore');
      more.setAttribute('aria-label', t('edMore'));
      more.append(icon('more', 18));
      more.addEventListener('click', (e) => {
        e.preventDefault();
        this._openPopmenu(more, (menu) => {
          if (this.onAutoPlace) this._menuItem(menu, 'sparkle', t('autoPlace'), () => void this.onAutoPlace?.());
          this._menuItem(menu, 'eye', t('edShowAll'), () => this.getEditor()?.updateAll({ hidden: false }));
          this._menuItem(menu, 'eyeOff', t('edHideAll'), () => this.getEditor()?.updateAll({ hidden: true }));
        });
      });
      search.append(icon('search', 16), input, more);
      hdr.appendChild(search);
      anchorsPane.appendChild(hdr);

      const list = document.createElement('div');
      list.id = 'anchor-list-body';
      list.className = 'ow-list';
      anchorsPane.appendChild(list);

      // Les pièces viennent du registre de Home Assistant : chargé une fois.
      if (hass && !this._registryAsked) {
        this._registryAsked = true;
        void loadRegistry(hass).then(() => this.updateAnchorList()).catch(() => {});
      }

      const renderRows = () => {
        list.innerHTML = '';
        this._liveRows.clear();
        if (anchors.size === 0) {
          const empty = document.createElement('div');
          empty.className = 'ow-empty';
          const strong = document.createElement('b');
          strong.textContent = t('anchorEmpty');
          empty.append(strong, document.createTextNode(t('edEmptyHint')));
          // Le raccourci : les appareils des pièces de Home Assistant, d'un coup.
          if (this.onAutoPlace) {
            const auto = document.createElement('button');
            auto.type = 'button';
            auto.className = 'ow-btn ow-primary';
            auto.style.marginTop = '14px';
            auto.append(icon('sparkle', 16), document.createTextNode(t('autoPlace')));
            auto.addEventListener('click', () => void this.onAutoPlace?.());
            const hint = document.createElement('div');
            hint.className = 'ow-hint-line';
            hint.style.marginTop = '8px';
            hint.textContent = t('autoPlaceHint');
            empty.append(document.createElement('br'), auto, hint);
          }
          list.appendChild(empty);
          return;
        }
        const reg = cachedRegistry();
        const q = this._anchorQuery.trim().toLowerCase();
        const groups = new Map<string, [string, EditableAnchor][]>();
        anchors.forEach((a, key) => {
          const area = a.entity ? areaOf(reg, a.entity)?.name : undefined;
          const name = anchorTitle(a);
          if (q && !`${name} ${a.entity} ${area ?? ''}`.toLowerCase().includes(q)) return;
          const g = area ?? '';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g)!.push([key, a]);
        });
        if (!groups.size) {
          const empty = document.createElement('div');
          empty.className = 'ow-empty';
          empty.textContent = t('edNoMatch');
          list.appendChild(empty);
          return;
        }
        const names = [...groups.keys()].sort((x, y) => (x ? (y ? x.localeCompare(y) : -1) : 1));
        for (const g of names) {
          const items = groups.get(g)!;
          const head = document.createElement('div');
          head.className = 'ow-room';
          const hb = document.createElement('b');
          hb.textContent = g || t('edNoRoom');
          const hn = document.createElement('span');
          hn.textContent = String(items.length);
          head.append(hb, hn);
          list.appendChild(head);
          for (const [key, a] of items) list.appendChild(this._anchorRow(key, a, key === selectedKey, detailView, showDetail, showList));
        }
      };
      input.addEventListener('input', () => { this._anchorQuery = input.value; renderRows(); });
      renderRows();
    }

    // ── Cards pane ───────────────────────────────────────────────────
    const cardsPane = tabPanes.get('cards')!;
    cardsPane.style.cssText += ';overflow:hidden;';

    buildTabHeader(cardsPane, t('tabCards'), t('tabCardsDesc'), {
      label: t('addCard'),
      badge: 'BETA',
      onClick: () => this._showCardTemplatePicker(cardsScroll),
    }, cards.length);

    const cardsScroll = document.createElement('div');
    cardsScroll.className = 'ow-list';
    cardsPane.appendChild(cardsScroll);

    const CARD_ICONS: Record<SceneCardType, string> = { room: 'room', entity: 'sensor', info: 'tag' };

    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ow-empty';
      const strong = document.createElement('b');
      strong.textContent = t('cardEmptyList');
      empty.append(strong, document.createTextNode(t('cardEmptyListHint')));
      cardsScroll.appendChild(empty);
    } else {
      cards.forEach((c) => {
        const isSelected = this.getSelectedCardId ? this.getSelectedCardId() === c.id : false;
        const row = document.createElement('div');
        row.className = `ow-dev${isSelected ? ' ow-on' : ''}`;
        const tile = document.createElement('span');
        tile.className = 'ow-tile';
        tile.append(icon(CARD_ICONS[c.type] ?? 'layout', 18));
        const col = document.createElement('span');
        col.className = 'ow-nm';
        const nameEl = document.createElement('b');
        nameEl.textContent = c.name;
        const subEl = document.createElement('span');
        subEl.textContent = `${(CARD_TYPE_LABELS[c.type] ?? (() => c.type))()} · ${c.size ?? 'medium'}`;
        col.append(nameEl, subEl);
        row.append(tile, col);
        row.addEventListener('click', () => {
          if (this.onSelectCard) this.onSelectCard(c.id);
          this._buildCardPropsSection(detailView, c, showList);
          showDetail();
        });
        cardsScroll.appendChild(row);
      });
    }

    // ── Rules pane ───────────────────────────────────────────────────
    const rulesPane = tabPanes.get('rules')!;
    rulesPane.style.cssText += ';overflow:hidden;';

    buildTabHeader(rulesPane, t('tabRules'), t('tabRulesDesc'), {
      label: t('addRule'),
      badge: 'BETA',
      onClick: () => this._openRuleModal(null, () => this._fillRulesList(rulesBody)),
    }, rulesCount);

    const rulesBody = document.createElement('div');
    rulesBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    rulesPane.appendChild(rulesBody);
    this._fillRulesList(rulesBody);

    // ── Ouvrants ──────────────────────────────────────────────────────
    const partsPane = tabPanes.get('parts')!;
    partsPane.style.cssText += ';overflow:hidden;';
    buildTabHeader(partsPane, t('tabParts'), t('tabPartsDesc'), {
      label: t('addPart'),
      badge: 'BETA',
      onClick: () => this._startPartPick(),
    }, partsCount);
    const partsBody = document.createElement('div');
    partsBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    partsPane.appendChild(partsBody);
    this._partsBody = partsBody;
    this._fillPartsList(partsBody);

    // ── Ambiance (lumière du jour, météo, simulation) ─────────────────
    const weatherPane = tabPanes.get('weather')!;
    weatherPane.style.cssText += ';overflow-y:auto;';
    buildTabHeader(weatherPane, t('tabAmbiance'), t('tabWeatherDesc'));
    const weatherBody = document.createElement('div');
    weatherPane.appendChild(weatherBody);
    this._buildWeatherTab(weatherBody);

    // ── Caméra : les vues enregistrées ─────────────────────────────────
    const cameraPane = tabPanes.get('camera')!;
    const viewMgr = this.getViewMgr?.();
    const viewCount = viewMgr ? (this.getViews?.() ?? []).length : 0;
    const camList = document.createElement('div');
    camList.className = 'ow-list';
    const capture = document.createElement('div');
    capture.style.cssText = 'display:none;gap:6px;padding:10px 14px;border-bottom:1px solid var(--ow-line);';
    const capInput = document.createElement('input');
    capInput.placeholder = t('viewNamePh');
    capInput.setAttribute('aria-label', t('viewNamePh'));
    capInput.style.cssText = 'flex:1;min-width:0;background:var(--ow-chrome2);border:1px solid var(--ow-acc);border-radius:9px;color:var(--ow-text);padding:7px 10px;font:13px inherit;outline:none;';
    const capOk = document.createElement('button');
    capOk.type = 'button';
    capOk.className = 'ow-btn ow-primary ow-small';
    capOk.textContent = t('camSave');
    const capCancel = document.createElement('button');
    capCancel.type = 'button';
    capCancel.className = 'ow-btn ow-ghost ow-small';
    capCancel.textContent = t('cancel');
    capture.append(capInput, capOk, capCancel);
    const closeCapture = () => { capture.style.display = 'none'; capInput.value = ''; };
    const doCapture = async () => {
      const ok = await viewMgr?.captureView(capInput.value);
      closeCapture();
      if (ok) { viewMgr?.buildViewsTab(camList); this.showStatusBar(t('camSaved')); setTimeout(() => this.hideStatusBar(), 1500); }
    };
    capOk.addEventListener('click', () => void doCapture());
    capCancel.addEventListener('click', closeCapture);
    capInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void doCapture();
      if (e.key === 'Escape') closeCapture();
    });
    buildTabHeader(cameraPane, t('tabCamera'), t('tabCameraDesc'), {
      label: t('cfgSaveView'),
      onClick: () => { capture.style.display = 'flex'; capInput.focus(); },
    }, viewCount);
    cameraPane.append(capture, camList);
    viewMgr?.buildViewsTab(camList);

    // ── Réglages : la configuration ──────────────────────────────────
    const settingsPane = tabPanes.get('settings')!;
    settingsPane.style.cssText += ';overflow-y:auto;';
    buildTabHeader(settingsPane, t('tabSettings'), t('tabSettingsDesc'));
    const configBody = document.createElement('div');
    settingsPane.appendChild(configBody);
    this._buildConfigTab(configBody);

    applyTab(activeTab);
    this._paintModes();
  }

  /** Une ligne de la liste des appareils. */
  private _anchorRow(
    key: string,
    a: EditableAnchor,
    selected: boolean,
    detailView: HTMLDivElement,
    showDetail: () => void,
    showList: () => void,
  ): HTMLElement {
    const hass = this.getHass();
    const st = a.entity ? hass?.states[a.entity] : undefined;
    const domain = a.entity.split('.')[0];
    const row = document.createElement('div');
    row.className = `ow-dev${selected ? ' ow-on' : ''}${a.hidden ? ' ow-off' : ''}`;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const tile = document.createElement('span');
    tile.className = `ow-tile${domain === 'light' && st?.state === 'on' ? ' ow-lit' : ''}`;
    tile.append(icon(anchorIcon(a), 18));
    const col = document.createElement('span');
    col.className = 'ow-nm';
    const name = document.createElement('b');
    name.textContent = anchorTitle(a);
    const floorName = this.anchorFloor?.(a);
    if (floorName) {
      const tag = document.createElement('span');
      tag.className = 'ow-floor-tag';
      tag.textContent = floorName;
      name.append(tag);
    }
    const sub = document.createElement('span');
    sub.textContent = st ? stateText(this.getHass(), a.entity, st.state, st.attributes ?? {}, a.precision) : anchorSubtitle(a);
    sub.title = a.entity;
    col.append(name, sub);
    if (a.entity) {
      this._liveRows.set(key, () => {
        const s2 = this.getHass()?.states[a.entity];
        tile.classList.toggle('ow-lit', domain === 'light' && s2?.state === 'on');
        sub.textContent = s2 ? stateText(this.getHass(), a.entity, s2.state, s2.attributes ?? {}, a.precision) : anchorSubtitle(a);
      });
    }
    const btns = document.createElement('span');
    btns.className = 'ow-rowbtns';
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'ow-ib';
    eye.title = a.hidden ? t('anchorShow') : t('anchorHide');
    eye.setAttribute('aria-label', eye.title);
    eye.append(icon(a.hidden ? 'eyeOff' : 'eye', 16));
    eye.addEventListener('click', (e) => { e.stopPropagation(); this.getEditor()?.updateAnchor(key, { hidden: !a.hidden }); this.scheduleAutoSave(); });
    const dup = document.createElement('button');
    dup.type = 'button';
    dup.className = 'ow-ib';
    dup.title = t('anchorDup');
    dup.setAttribute('aria-label', dup.title);
    dup.append(icon('copy', 16));
    dup.addEventListener('click', (e) => { e.stopPropagation(); this.getEditor()?.selectAnchor(key); this.getEditor()?.duplicate(); });
    btns.append(eye, dup);
    row.append(tile, col, btns);
    const open = () => {
      this.getEditor()?.selectAnchor(key);
      this._buildPropsSection(detailView, key, this.getEditor()!.anchors.get(key)!, showList);
      showDetail();
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return row;
  }

  private _buildConfigTab(container: HTMLElement) {
    const settings = this.getSceneSettings?.() ?? {};
    const rendering = settings.rendering ?? {};

    const inputStyle = [
      'width:100%', 'box-sizing:border-box',
      'background:var(--ow-chrome2)', 'border:1px solid var(--ow-line)',
      'border-radius:9px', 'color:var(--ow-text)', 'padding:8px 10px',
      'font-size:13px', 'outline:none', 'font-family:inherit',
      'transition:border-color .15s',
    ].join(';');

    const panelRoot = document.createElement('div');
    panelRoot.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';
    container.appendChild(panelRoot);

    /**
     * Champ de recherche.
     *
     * Vingt-trois réglages dans une liste qui défile, cela se parcourt à l'œil et
     * à l'espoir. Filtrer sur le libellé est le raccourci le plus rentable : on
     * tape « ombre » et il ne reste que ce qui compte.
     */
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = t('cfgSearch');
    search.style.cssText = inputStyle;
    panelRoot.appendChild(search);

    const emptyNote = document.createElement('div');
    emptyNote.style.cssText = 'display:none;padding:14px 2px;font-size:11px;color:#64748b;';
    emptyNote.textContent = t('cfgSearchEmpty');
    panelRoot.appendChild(emptyNote);

    /**
     * Conteneur courant.
     *
     * `sec()` le réassigne à la section qu'il vient d'ouvrir. Les aides et les
     * quelques `root.appendChild` directs de cette méthode déposent donc leurs
     * contrôles au bon endroit, sans qu'aucun d'eux ait à être modifié.
     */
    let root: HTMLElement = panelRoot;

    /** Sections construites, pour le filtrage et le pliage. */
    const sections: { label: string; box: HTMLDetailsElement; body: HTMLElement }[] = [];



    const sec = (label: string) => {
      const box = document.createElement('details');
      box.className = 'ow-card';
      // Repliée par défaut, sauf la première : on ouvre ce qu'on cherche plutôt
      // que de tout subir.
      //
      // Le choix initial est inscrit dans la mémoire de pliage, et non appliqué
      // seulement à l'objet : le filtre relit cette mémoire quand la recherche
      // est vide, et refermait donc aussitôt la section qu'on venait d'ouvrir.
      if (this._openConfigSections.size === 0 && sections.length === 0) {
        this._openConfigSections.add(label);
      }
      box.open = this._openConfigSections.has(label);

      const head = document.createElement('summary');
      head.className = 'ow-card-h';
      head.style.cursor = 'pointer';
      const name = document.createElement('b');
      name.style.flex = '1';
      name.textContent = label;
      head.append(name, Object.assign(document.createElement('span'), { className: 'ow-chev' }));
      const paint = () => {};
      box.appendChild(head);

      const body = document.createElement('div');
      body.style.cssText = 'padding:0 12px 4px;';


      box.appendChild(body);

      // `toggle` ne sert qu'à l'apparence : il se déclenche aussi quand le
      // filtre ouvre une section par programme.
      box.addEventListener('toggle', paint);

      /**
       * L'intention de l'utilisateur se lit sur le clic, pas sur `toggle`.
       *
       * `toggle` est asynchrone et indifférent à son origine : un drapeau posé
       * pendant le filtrage était déjà retombé quand l'événement arrivait, et la
       * recherche réécrivait la mémoire de pliage — effacer le champ laissait
       * alors tout refermé.
       *
       * Au moment du clic, l'action par défaut n'a pas encore inversé l'état :
       * l'intention est donc l'inverse de l'état courant.
       */
      head.addEventListener('click', () => {
        const wanted = !box.open;
        if (wanted) this._openConfigSections.add(label);
        else this._openConfigSections.delete(label);
      });
      paint();

      panelRoot.appendChild(box);
      sections.push({ label, box, body });
      root = body;
    };

    /**
     * Filtre sur le texte visible.
     *
     * On lit le contenu textuel de chaque contrôle plutôt que d'étiqueter les
     * vingt-trois appels : le libellé y est déjà, et rien ne peut se
     * désynchroniser.
     */
    const applyFilter = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;

      for (const { label, box, body } of sections) {
        let matches = 0;
        for (const child of Array.from(body.children) as HTMLElement[]) {
          const hit = !q
            || (child.textContent ?? '').toLowerCase().includes(q)
            || label.toLowerCase().includes(q);
          // Un champ masqué exprès (la couverture d'un toit ouvert) le reste.
          const off = child.dataset.off === '1';
          child.style.display = hit && !off ? '' : 'none';
          if (hit && !off) matches++;
        }
        box.style.display = matches ? '' : 'none';
        // Une recherche ouvre ce qu'elle trouve ; l'effacer rend la main au
        // pliage choisi par l'utilisateur.
        if (q) box.open = matches > 0;
        else box.open = this._openConfigSections.has(label);
        shown += matches;
      }
      emptyNote.style.display = q && shown === 0 ? '' : 'none';
    };
    search.addEventListener('input', applyFilter);
    // Appliqué en fin de construction, une fois toutes les sections présentes.
    queueMicrotask(applyFilter);

    // Text input helper
    const textInput = (value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement => {
      const inp = document.createElement('input');
      inp.value = value; inp.placeholder = placeholder;
      inp.style.cssText = inputStyle;
      inp.addEventListener('focus', () => { inp.style.borderColor = 'rgba(125,209,252,0.5)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = ''; });
      inp.addEventListener('change', () => onChange(inp.value.trim()));
      return inp;
    };

    const helpBadge = createHelpBadge;

    // ── Helper: labelled select ──────────────────────────────────────────
    const selectField = (
      labelText: string,
      helpText: string | null,
      options: [string, string][],
      current: string,
      onChange: (v: string) => void,
    ) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      lbl.textContent = labelText;
      row.appendChild(lbl);
      if (helpText) row.appendChild(helpBadge(helpText));
      wrap.appendChild(row);
      const sel = document.createElement('select');
      sel.style.cssText = inputStyle + SELECT_STYLE;
      options.forEach(([val, label]) => {
        const o = styleOption(document.createElement('option'));
        o.value = val; o.textContent = label;
        if (current === val) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.appendChild(sel);
      root.appendChild(wrap);
    };

    // ── Helper: slider with help badge ───────────────────────────────────
    const sliderWithHelp = (
      labelText: string, helpText: string | null,
      min: number, max: number, step: number, value: number,
      fmt: (v: number) => string, onChange: (v: number) => void,
    ) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      lbl.textContent = labelText;
      hdr.appendChild(lbl);
      if (helpText) hdr.appendChild(helpBadge(helpText));
      const spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';
      hdr.appendChild(spacer);
      const val = document.createElement('span');
      val.style.cssText = 'font-size:12px;color:var(--ow-text);font-weight:600;font-variant-numeric:tabular-nums;';
      val.textContent = fmt(value);
      hdr.appendChild(val);
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = String(step); sl.value = String(value);
      sl.style.cssText = 'width:100%;cursor:pointer;margin:0;accent-color:var(--ow-acc);';
      sl.addEventListener('input', () => { val.textContent = fmt(parseFloat(sl.value)); onChange(parseFloat(sl.value)); });
      wrap.appendChild(hdr); wrap.appendChild(sl);
      root.appendChild(wrap);
    };

    // ── Helper: toggle with help badge ───────────────────────────────────
    const toggleWithHelp = (labelText: string, helpText: string | null, checked: boolean, onChange: (v: boolean) => void) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:9px;margin-bottom:10px;cursor:pointer;font-size:13px;color:var(--ow-text);';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = checked; chk.style.cssText = 'cursor:pointer;width:16px;height:16px;accent-color:var(--ow-acc);';
      chk.addEventListener('change', () => onChange(chk.checked));
      const lbl = document.createElement('span');
      lbl.textContent = labelText;
      wrap.appendChild(chk); wrap.appendChild(lbl);
      if (helpText) wrap.appendChild(helpBadge(helpText));
      root.appendChild(wrap);
    };

    // ══════════════════════════════════════════════════════════════════════
    // 0) SCENE — scene ID, model URL
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgScene'));

    // Importer son plan : le même chemin que le glisser-déposer sur la carte,
    // pour qui ne pense pas à glisser ou n'a pas de souris (tablette).
    if (this.onDrawPlan) {
      const draw = document.createElement('button');
      draw.type = 'button';
      draw.className = 'ow-btn ow-primary';
      draw.style.cssText = 'width:100%;margin-bottom:8px;';
      draw.append(icon('pencil', 16), document.createTextNode(t('planDraw')));
      draw.addEventListener('click', () => this.onDrawPlan?.());
      root.appendChild(draw);
    }
    if (this.onImportModel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ow-btn';
      btn.style.cssText = 'width:100%;margin-bottom:6px;';
      btn.append(icon('plus', 16), document.createTextNode(t('importButton')));
      btn.addEventListener('click', () => this.onImportModel?.());
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11.5px;color:var(--ow-muted);margin-bottom:12px;line-height:1.45;';
      hint.textContent = t('importHint');
      root.append(btn, hint);
    }

    {
      /**
       * Liste des scènes.
       *
       * Le réglage était un champ de saisie avec une liste déroulante cachée :
       * il fallait connaître le nom de la scène pour la charger, on ne voyait
       * pas ce qu'elle contenait, et rien ne permettait d'en supprimer une —
       * alors que le backend sait le faire depuis le début.
       */
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:1px;margin-bottom:10px;background:var(--ow-line);border:1px solid var(--ow-line);border-radius:10px;overflow:hidden;';
      root.appendChild(list);

      const loading = document.createElement('div');
      loading.style.cssText = 'padding:11px 12px;font-size:12.5px;color:var(--ow-muted);background:var(--ow-chrome);';
      loading.textContent = t('cfgScenesLoading');
      list.appendChild(loading);

      const activeId = this.getSceneId();

      /**
       * Résumé d'une scène en une seule ligne.
       *
       * Une première version affichait quatre pastilles — ancres, ouvrants,
       * règles, vues. Le panneau ne fait que deux cent trente pixels : elles
       * s'empilaient les unes sous les autres, six lignes par scène, avec des
       * « 0 ouvrant, 0 règle, 0 vue » répétés partout.
       *
       * On ne montre donc que ce qui existe. Une scène vide le dit en un mot,
       * ce qui est plus informatif qu'une rangée de zéros.
       */
      const summarize = (s: SceneSummary): string => {
        if (s.error) return t('cfgSceneUnreadable');
        const bits: string[] = [];
        const add = (n: number, label: string) => {
          if (n > 0) bits.push(`${n} ${n === 1 ? label.replace(/s$/, '') : label}`);
        };
        add(s.anchors, t('cfgTallyAnchors'));
        add(s.parts, t('cfgTallyParts'));
        add(s.rules, t('cfgTallyRules'));
        add(s.views, t('cfgTallyViews'));
        return bits.length ? bits.join(' · ') : t('cfgSceneEmptyOne');
      };

      const render = (summaries: SceneSummary[]) => {
        list.innerHTML = '';
        if (summaries.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:11px 12px;font-size:12.5px;color:var(--ow-muted);background:var(--ow-chrome);';
          empty.textContent = t('cfgScenesEmpty');
          list.appendChild(empty);
          return;
        }

        for (const sum of summaries) {
          const isActive = sum.id === activeId;

          /**
           * La ligne entière charge la scène.
           *
           * Un bouton « Charger » par ligne mangeait la largeur disponible et
           * poussait le résumé à la ligne suivante. Cliquer la scène qu'on veut
           * ouvrir est de toute façon le geste attendu.
           */
          const row = document.createElement(isActive ? 'div' : 'button');
          row.style.cssText = [
            'display:flex', 'align-items:center', 'gap:6px', 'width:100%',
            'text-align:left', 'font-family:inherit',
            'padding:10px 10px 10px 11px', 'border:none',
            'border-left:2px solid ' + (isActive ? '#7dd3fc' : 'transparent'),
            isActive ? 'background:color-mix(in srgb, var(--ow-acc) 12%, var(--ow-chrome))' : 'background:var(--ow-chrome)',
            isActive ? 'cursor:default' : 'cursor:pointer',
          ].join(';');

          if (!isActive) {
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--ow-chrome2)'; });
            row.addEventListener('mouseleave', () => { row.style.background = 'var(--ow-chrome)'; });
            row.addEventListener('click', () => {
              this.onSceneSettingsChange?.({ scene_id: sum.id } as SceneSettings, true);
            });
            (row as HTMLButtonElement).title = t('cfgSceneLoadTitle').replace('{id}', sum.id);
          }

          const text = document.createElement('span');
          text.style.cssText = 'flex:1;min-width:0;display:block;';

          const name = document.createElement('span');
          name.style.cssText = [
            'display:block', 'font-size:13.5px',
            `font-weight:${isActive ? 650 : 500}`,
            `color:${isActive ? 'var(--ow-acc)' : 'var(--ow-text)'}`,
            'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
          ].join(';');
          name.textContent = sum.id;
          text.appendChild(name);

          const sub = document.createElement('span');
          sub.style.cssText = [
            'display:block', 'margin-top:2px', 'font-size:12px',
            `color:${sum.error ? '#fbbf24' : '#64748b'}`,
            'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
          ].join(';');
          sub.textContent = (sum.error ? '⚠ ' : '') + summarize(sum)
            + (isActive ? ` · ${t('cfgSceneActive')}` : '');
          text.appendChild(sub);
          row.appendChild(text);

          // La scène ouverte se recharge : après un redémarrage de Home
          // Assistant, ou pour abandonner ce qui s'affiche et relire le serveur.
          if (isActive) {
            const reload = document.createElement('span');
            reload.setAttribute('role', 'button');
            reload.style.cssText = 'flex-shrink:0;color:#7dd3fc;cursor:pointer;font-size:13px;line-height:1;padding:3px 4px;';
            reload.textContent = '↻';
            reload.title = t('cfgSceneReload');
            reload.addEventListener('click', () => {
              this.onSceneSettingsChange?.({ scene_id: sum.id } as SceneSettings, true);
            });
            row.appendChild(reload);
          }

          const del = document.createElement('span');
          del.setAttribute('role', 'button');
          del.style.cssText = 'flex-shrink:0;color:rgba(248,113,113,0.5);cursor:pointer;font-size:14px;line-height:1;padding:3px 4px;';
          del.textContent = '×';
          del.title = t('cfgSceneDelete');
          // La scène ouverte n'est pas supprimable : la carte se retrouverait
          // sans rien à afficher, et l'utilisateur sans moyen de revenir.
          if (isActive) {
            del.style.opacity = '0.2';
            del.style.cursor = 'default';
            del.title = t('cfgSceneDeleteActive');
          } else {
            del.addEventListener('click', (e) => {
              // Sans cela, le clic remonterait à la ligne et chargerait la
              // scène qu'on cherche à supprimer.
              e.stopPropagation();
              if (!confirm(t('cfgSceneConfirm').replace('{id}', sum.id))) return;
              const hass = this.getHass();
              if (!hass) return;
              deleteScene(hass, sum.id)
                .then(() => refresh())
                .catch((err) => console.error('[Owlnest] delete_scene failed:', err));
            });
          }
          row.appendChild(del);
          list.appendChild(row);
        }
      };

      const refresh = () => {
        const hass = this.getHass();
        if (!hass) return;
        this.listScenesFn?.()
          .then((ids) => summarizeScenes(hass, ids))
          .then(render)
          .catch(() => render([]));
      };
      refresh();

      // ── Créer une scène ────────────────────────────────────────────────
      const newRow = document.createElement('div');
      newRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
      const newInput = textInput('', t('cfgSceneIdPh'), () => {});
      newRow.appendChild(newInput);
      const create = document.createElement('button');
      create.textContent = t('cfgSceneCreate');
      create.type = 'button';
      create.className = 'ow-btn';
      create.style.flexShrink = '0';
      create.addEventListener('click', () => {
        const id = newInput.value.trim();
        if (!id) return;
        this.onSceneSettingsChange?.({ scene_id: id } as SceneSettings, true);
      });
      newRow.appendChild(create);

      const newWrap = document.createElement('div');
      newWrap.style.cssText = 'margin-bottom:8px;';
      const newLblRow = document.createElement('div');
      newLblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const newLbl = document.createElement('span');
      newLbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      newLbl.textContent = t('cfgSceneId');
      newLblRow.appendChild(newLbl);
      newLblRow.appendChild(helpBadge(t('helpSceneId')));
      newWrap.append(newLblRow, newRow);
      root.appendChild(newWrap);
    }

    // ── Petits contrôles de l'apparence ─────────────────────────────────
    /** Un interrupteur, à la place des cases à cocher. */
    const switchField = (labelText: string, helpText: string | null, on: boolean, onChange: (v: boolean) => void) => {
      const row = document.createElement('div');
      row.className = 'ow-row-opt';
      row.style.cssText = 'margin-bottom:10px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'display:flex;align-items:center;font-size:13px;color:var(--ow-text);';
      lbl.textContent = labelText;
      if (helpText) lbl.appendChild(helpBadge(helpText));
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = `ow-switch${on ? ' ow-on' : ''}`;
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(on));
      sw.setAttribute('aria-label', labelText);
      sw.addEventListener('click', () => {
        const v = !sw.classList.contains('ow-on');
        sw.classList.toggle('ow-on', v);
        sw.setAttribute('aria-checked', String(v));
        onChange(v);
      });
      row.append(lbl, sw);
      root.appendChild(row);
    };

    /** Un choix parmi quelques-uns, en boutons côte à côte. */
    const segField = (labelText: string, helpText: string | null, options: [string, string][], current: string, onChange: (v: string) => void) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      lbl.textContent = labelText;
      row.appendChild(lbl);
      if (helpText) row.appendChild(helpBadge(helpText));
      const seg = document.createElement('div');
      seg.className = `ow-seg${options.length > 3 ? ' ow-seg-wrap' : ''}`;
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', labelText);
      for (const [val, text] of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.setAttribute('role', 'radio');
        const paint = (v: string) => { b.classList.toggle('ow-on', v === val); b.setAttribute('aria-checked', String(v === val)); };
        paint(current);
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach((x) => { x.classList.remove('ow-on'); x.setAttribute('aria-checked', 'false'); });
          paint(val);
          onChange(val);
        });
        seg.appendChild(b);
      }
      wrap.append(row, seg);
      root.appendChild(wrap);
      return wrap;
    };

    /** Des pastilles de couleur, et une dernière pour choisir la sienne. */
    const swatchField = (labelText: string, colors: readonly string[], current: string, onChange: (c: string) => void) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;margin-bottom:6px;';
      lbl.textContent = labelText;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
      const all: HTMLElement[] = [];
      const mark = (c: string) => all.forEach((el) => {
        const on = (el.dataset.color ?? '').toLowerCase() === c.toLowerCase();
        el.style.boxShadow = on ? '0 0 0 2px var(--ow-chrome), 0 0 0 4px var(--ow-acc)' : 'inset 0 0 0 1px rgba(0,0,0,0.25)';
      });
      for (const c of colors) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.color = c;
        b.title = c;
        b.setAttribute('aria-label', c);
        b.style.cssText = `width:26px;height:26px;border-radius:50%;border:none;cursor:pointer;background:${c};`;
        b.addEventListener('click', () => { mark(c); onChange(c); });
        row.appendChild(b);
        all.push(b);
      }
      // La sienne : un sélecteur de couleur habillé en pastille arc-en-ciel.
      const custom = document.createElement('label');
      custom.title = t('cfgCustomColor');
      custom.style.cssText = 'position:relative;width:26px;height:26px;border-radius:50%;cursor:pointer;overflow:hidden;background:conic-gradient(#f87171,#fbbf24,#34d399,#38bdf8,#a78bfa,#f87171);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.25);';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#888888';
      input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;';
      input.addEventListener('input', () => { mark(input.value); onChange(input.value); });
      custom.appendChild(input);
      row.appendChild(custom);
      mark(current);
      wrap.append(lbl, row);
      root.appendChild(wrap);
    };

    // ══════════════════════════════════════════════════════════════════════
    // 1) APPARENCE — façade, toit, jardin, sol, fond
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgLook'));

    // La façade appartient au plan dessiné (elle vaut pour tous les étages).
    const look = this.getPlanLook?.();
    if (look) {
      swatchField(t('cfgFacadeColor'), FACADE_COLORS, look.outside ?? '#e4ddd0', (c) => this.setPlanLook?.({ outside: c }));
      segField(t('cfgFacade'), null, [
        ['smooth', t('cfgFacadeSmooth')],
        ['render', t('cfgFacadeRender')],
        ['brick', t('cfgFacadeBrick')],
        ['wood', t('cfgFacadeWood')],
        ['stone', t('cfgFacadeStone')],
      ], look.facade ?? 'smooth', (v) => this.setPlanLook?.({ facade: v as FacadeMaterial }));
      switchField(t('cfgPlinth'), t('helpPlinth'), !!look.plinth, (v) => this.setPlanLook?.({ plinth: v }));

      let coverWrap: HTMLElement | null = null;
      segField(t('cfgRoof'), t('helpRoof'), [
        ['flat', t('cfgRoofFlat')],
        ['hip', t('cfgRoofHip')],
      ], rendering.roof ?? 'flat', (v) => {
        if (coverWrap) { coverWrap.dataset.off = v === 'hip' ? '' : '1'; coverWrap.style.display = v === 'hip' ? '' : 'none'; }
        this.onSceneSettingsChange?.({ rendering: { roof: v as 'flat' | 'hip' } });
      });
      coverWrap = segField(t('cfgRoofColor'), null, [
        ['tile', t('cfgRoofTile')],
        ['slate', t('cfgRoofSlate')],
        ['zinc', t('cfgRoofZinc')],
      ], rendering.roof_color ?? 'tile', (v) => {
        this.onSceneSettingsChange?.({ rendering: { roof_color: v as 'tile' | 'slate' | 'zinc' } });
      });
      if ((rendering.roof ?? 'flat') !== 'hip') { coverWrap.dataset.off = '1'; coverWrap.style.display = 'none'; }
    }

    segField(t('cfgGarden'), t('helpGarden'), [
      ['none', t('cfgGardenNone')],
      ['some', t('cfgGardenSome')],
      ['lush', t('cfgGardenLush')],
    ], rendering.garden ?? 'none', (v) => {
      this.onSceneSettingsChange?.({ rendering: { garden: v as 'none' | 'some' | 'lush' } });
    });

    selectField(t('cfgGroundStyle'), t('helpGroundStyle'), [
      ['square', t('cfgGroundSquare')],
      ['disc', t('cfgGroundDisc')],
      ['podium', t('cfgGroundPodium')],
      ['infinite', t('cfgGroundInfinite')],
      ['none', t('cfgGroundNone')],
    ], rendering.ground_style ?? 'square', (v) => {
      this.onSceneSettingsChange?.({ rendering: { ground_style: v as 'square' | 'disc' | 'infinite' | 'podium' | 'none' } });
    });

    swatchField(t('cfgGroundColor'), GROUND_COLORS, rendering.ground_color ?? '#4a6741',
      (c) => this.onSceneSettingsChange?.({ rendering: { ground_color: c } }));

    {
      const currentStyle = rendering.ground_style ?? 'square';
      if (currentStyle !== 'infinite' && currentStyle !== 'none') {
        sliderWithHelp(t('cfgGroundScale'), t('helpGroundScale'), 0.5, 3, 0.1, rendering.ground_scale ?? 1.0,
          (v) => '\u00d7' + v.toFixed(1), (v) => this.onSceneSettingsChange?.({ rendering: { ground_scale: v } }));
      }
    }

    switchField(t('cfgTransparent'), t('helpTransparent'), rendering.transparent_background === true, (v) => {
      this.onSceneSettingsChange?.({ rendering: { transparent_background: v } });
    });

    // ══════════════════════════════════════════════════════════════════════
    // 2) LUMIÈRE — soleil, ambiance, luminosité, ombres
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgLight'));

    sliderWithHelp(t('cfgSunIntensity'), t('helpSunIntensity'), 0, 3, 0.05, rendering.sun_intensity ?? 0.8,
      (v) => `${Math.round(v * 100)} %`, (v) => this.onSceneSettingsChange?.({ rendering: { sun_intensity: v } }));

    sliderWithHelp(t('cfgAmbientIntensity'), t('helpAmbientIntensity'), 0, 2, 0.05, rendering.ambient_intensity ?? 0.7,
      (v) => `${Math.round(v * 100)} %`, (v) => this.onSceneSettingsChange?.({ rendering: { ambient_intensity: v } }));

    sliderWithHelp(t('cfgExposure'), t('helpExposure'), 0.5, 2, 0.05, rendering.exposure ?? 1.4,
      (v) => `${Math.round(v * 100)} %`, (v) => this.onSceneSettingsChange?.({ rendering: { exposure: v } }));

    switchField(t('cfgShadows'), t('helpShadows'), rendering.shadows !== false, (v) => {
      this.onSceneSettingsChange?.({ rendering: { shadows: v } });
    });

    switchField(t('cfgLightOcclusion'), t('helpLightOcclusion'), rendering.light_occlusion === 'top', (v) => {
      this.onSceneSettingsChange?.({ rendering: { light_occlusion: v ? 'top' : 'none' } });
    });

    // ══════════════════════════════════════════════════════════════════════
    // 3) CAMÉRA ET PASTILLES — zoom, inclinaison, voir à travers, regroupement
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgCamPins'));
    const orbit = settings.orbit ?? {};

    /**
     * Distances d'orbite, exprimées en multiples de l'envergure du modèle.
     *
     * La valeur enregistrée reste une distance absolue : c'est le modèle de
     * données qui compte, pas l'unité d'affichage.
     */
    const span = this.getModelSpan?.() ?? 0;
    const relative = span > 0;
    const unit = relative ? span : 1;

    sliderWithHelp(
      t('cfgMinDist'), t('helpMinDist'),
      relative ? 0.01 : 0, relative ? 0.5 : 20, relative ? 0.01 : 0.5,
      (orbit.min_distance ?? (relative ? span * 0.05 : 1)) / unit,
      (v) => (relative ? `${v.toFixed(2)}×` : v.toFixed(1)),
      (v) => this.onSceneSettingsChange?.({ orbit: { min_distance: v * unit } }),
    );

    sliderWithHelp(
      t('cfgMaxDist'), t('helpMaxDist'),
      relative ? 0.5 : 1, relative ? 6 : 200, relative ? 0.1 : 1,
      (orbit.max_distance ?? (relative ? span * 3 : 100)) / unit,
      (v) => (relative ? `${v.toFixed(1)}×` : String(Math.round(v))),
      (v) => this.onSceneSettingsChange?.({ orbit: { max_distance: v * unit } }),
    );

    // Enregistré en fraction de demi-tour (0,5 = à l'horizontale) ; affiché en degrés.
    sliderWithHelp(t('cfgMaxPolar'), t('helpMaxPolar'), 0.1, 0.55, 0.01, orbit.max_polar_angle ?? 0.48,
      (v) => `${Math.round(v * 180)}°`, (v) => this.onSceneSettingsChange?.({ orbit: { max_polar_angle: v } }));

    // 0 = inactif. Il suit le point de vue, là où la coupe horizontale est fixe.
    sliderWithHelp(t('cfgXray'), t('helpXray'), 0, 1, 0.05, rendering.xray ?? 0,
      (v) => (v <= 0 ? t('cutawayOff') : `${Math.round(v * 100)} %`),
      (v) => this.onSceneSettingsChange?.({ rendering: { xray: v } }));

    sliderWithHelp(t('cfgClusterThreshold'), t('helpCluster'), 0, 60, 5, settings.cluster_threshold ?? 0,
      (v) => (v <= 0 ? t('cutawayOff') : `${Math.round(v)} px`),
      (v) => this.onSceneSettingsChange?.({ cluster_threshold: v }));

    // ══════════════════════════════════════════════════════════════════════
    // 5) PERFORMANCE — quality preset
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgPerf'));

    {
      const current = rendering.quality ?? 'auto';
      selectField(
        t('cfgQuality'),
        t('helpQuality'),
        [
          ['auto', t('cfgQualityAuto')],
          ['high', t('cfgQualityHigh')],
          ['balanced', t('cfgQualityBalanced')],
          ['low', t('cfgQualityLow')],
        ],
        current,
        (v) => {
          this.onSceneSettingsChange?.({ rendering: { quality: v as QualityLevel } });
          // Le libellé du matériel dépend du niveau retenu — on le rafraîchit.
          detail.textContent = describe(v as QualityLevel);
        },
      );

      // Rendre la détection lisible plutôt qu'opaque : l'utilisateur doit
      // pouvoir vérifier ce qui a été choisi pour lui, et pourquoi.
      const describe = (level: QualityLevel) =>
        level === 'auto'
          ? `${t('cfgQualityDetected')} : ${detectionLabel()} → ${resolveLevel('auto')}`
          : `${t('cfgQualityDetected')} : ${detectionLabel()}`;

      const more = document.createElement('details');
      more.style.cssText = 'margin:-4px 0 8px;';
      const moreH = document.createElement('summary');
      moreH.style.cssText = 'font-size:11.5px;color:var(--ow-muted);cursor:pointer;';
      moreH.textContent = t('cfgQualityDetails');
      const detail = document.createElement('div');
      detail.style.cssText = 'font-size:11.5px;color:var(--ow-muted);margin-top:4px;line-height:1.5;';
      detail.textContent = describe(current as QualityLevel);
      more.append(moreH, detail);
      root.appendChild(more);

      const reloadNote = document.createElement('div');
      reloadNote.style.cssText = 'font-size:11.5px;color:var(--ow-muted);margin:0 0 8px;line-height:1.5;';
      reloadNote.textContent = t('cfgQualityReload');
      root.appendChild(reloadNote);
    }

    // ── Language ──────────────────────────────────────────────────────
    sec(t('cfgLang'));

    {
      const langLblRow = document.createElement('div');
      langLblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const langLbl = document.createElement('span');
      langLbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      langLbl.textContent = t('cfgLang');
      langLblRow.appendChild(langLbl);
      langLblRow.appendChild(helpBadge(t('helpLanguage')));
      root.appendChild(langLblRow);
    }

    const langSelect = document.createElement('select');
    langSelect.style.cssText = inputStyle + SELECT_STYLE;
    const langs: ['en' | 'fr', string][] = [['en', t('langEn')], ['fr', t('langFr')]];
    langs.forEach(([val, label]) => {
      const opt = styleOption(document.createElement('option'));
      opt.value = val; opt.textContent = label;
      if ((settings.language ?? 'en') === val) opt.selected = true;
      langSelect.appendChild(opt);
    });
    langSelect.addEventListener('change', () => {
      const lang = langSelect.value as 'en' | 'fr';
      setLang(lang);
      this.onSceneSettingsChange?.({ language: lang });
      // Rebuild inspector to apply new language
      this._buildBar();
      this.buildAnchorList();
    });
    root.appendChild(langSelect);
  }

  private _buildWeatherTab(container: HTMLElement) {
    const settings = this.getSceneSettings?.() ?? {};
    const inputStyle = [
      'width:100%', 'box-sizing:border-box',
      'background:var(--ow-chrome2)', 'border:1px solid var(--ow-line)',
      'border-radius:9px', 'color:var(--ow-text)', 'padding:8px 10px',
      'font-size:13px', 'outline:none', 'font-family:inherit',
      'transition:border-color .15s',
    ].join(';');

    const root = document.createElement('div');
    root.style.cssText = 'padding:4px 14px 14px;display:flex;flex-direction:column;gap:0;';
    container.appendChild(root);

    const sec = (label: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:13.5px;font-weight:700;color:var(--ow-text);margin:14px 0 10px;';
      d.textContent = label;
      root.appendChild(d);
    };

    const field = (labelText: string, el: HTMLElement, helpText?: string) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;';
      const lblRow = document.createElement('div');
      lblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:12px;color:var(--ow-muted);font-weight:600;';
      lbl.textContent = labelText;
      lblRow.appendChild(lbl);
      if (helpText) lblRow.appendChild(createHelpBadge(helpText));
      wrap.appendChild(lblRow); wrap.appendChild(el);
      root.appendChild(wrap);
    };

    // ── Environment ───────────────────────────────────────────────────
    sec(t('cfgEnv'));

    const entityAutocomplete = (
      value: string, placeholder: string, domainFilter: string, onChange: (v: string) => void,
    ): HTMLDivElement => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;';
      const inp = document.createElement('input');
      const dlId = `owlnest-env-dl-${Math.random().toString(36).slice(2)}`;
      inp.setAttribute('list', dlId);
      inp.value = value; inp.placeholder = placeholder;
      inp.style.cssText = inputStyle;
      inp.addEventListener('focus', () => { inp.style.borderColor = 'rgba(125,209,252,0.5)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = ''; });
      inp.addEventListener('change', () => onChange(inp.value.trim()));
      const dl = document.createElement('datalist');
      dl.id = dlId;
      const hass = this.getHass();
      if (hass?.states) {
        Object.keys(hass.states)
          .filter((eid) => eid.startsWith(domainFilter))
          .sort()
          .forEach((eid) => {
            const opt = document.createElement('option');
            opt.value = eid;
            const fn = (hass.states[eid] as any)?.attributes?.friendly_name;
            if (fn) opt.label = fn;
            dl.appendChild(opt);
          });
      }
      wrap.appendChild(inp); wrap.appendChild(dl);
      return wrap;
    };

    // Le soleil réel : son mode et l'orientation de la maison n'ont de sens
    // qu'avec une entité soleil, ils apparaissent donc avec elle.
    const sunExtras = document.createElement('div');
    const rendering = settings.rendering ?? {};
    const paintSunExtras = (entity: string) => { sunExtras.style.display = entity ? '' : 'none'; };
    field(t('cfgSunEntity'), entityAutocomplete(
      settings.sun_entity ?? this.getConfig?.()?.sun_entity ?? '', t('cfgSunEntityPh'), 'sun.',
      (v) => { paintSunExtras(v); this.onSceneSettingsChange?.({ sun_entity: v }); },
    ), t('helpSunEntity'));
    {
      const modeSel = document.createElement('select');
      modeSel.style.cssText = inputStyle + SELECT_STYLE;
      for (const [val, label] of [['showcase', t('cfgSunModeShowcase')], ['realistic', t('cfgSunModeRealistic')]] as const) {
        const o = styleOption(document.createElement('option'));
        o.value = val; o.textContent = label;
        if ((rendering.sun_mode ?? 'showcase') === val) o.selected = true;
        modeSel.appendChild(o);
      }
      modeSel.addEventListener('change', () => this.onSceneSettingsChange?.({ rendering: { sun_mode: modeSel.value as 'showcase' | 'realistic' } }));
      const orient = document.createElement('div');
      const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const toCardinal = (deg: number) => `${Math.round(deg)}° ${cardinals[Math.round(((deg % 360) + 360) % 360 / 45) % 8]}`;
      const val = document.createElement('div');
      val.style.cssText = 'font-size:12px;color:var(--ow-text);font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:4px;';
      val.textContent = toCardinal(rendering.house_orientation ?? 0);
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = '0'; sl.max = '359'; sl.step = '5'; sl.value = String(rendering.house_orientation ?? 0);
      sl.style.cssText = 'width:100%;cursor:pointer;margin:0;accent-color:var(--ow-acc);';
      sl.addEventListener('input', () => {
        val.textContent = toCardinal(parseFloat(sl.value));
        this.onSceneSettingsChange?.({ rendering: { house_orientation: parseFloat(sl.value) } });
      });
      orient.append(val, sl);
      const inner = root;
      root.appendChild(sunExtras);
      // `field` dépose dans `root` : on l'oriente un instant vers le bloc du soleil.
      const fieldInto = (label: string, el: HTMLElement, help: string) => {
        const before = sunExtras.childElementCount;
        field(label, el, help);
        const added = inner.lastElementChild;
        if (added && sunExtras.childElementCount === before) sunExtras.appendChild(added);
      };
      fieldInto(t('cfgSunMode'), modeSel, t('helpSunMode'));
      fieldInto(t('cfgHouseOrientation'), orient, t('helpHouseOrientation'));
      paintSunExtras(settings.sun_entity ?? this.getConfig?.()?.sun_entity ?? '');
    }

    field(t('cfgWeatherEntity'), entityAutocomplete(
      settings.weather_entity ?? this.getConfig?.()?.weather_entity ?? '', t('cfgWeatherEntityPh'), 'weather.',
      (v) => { this.onSceneSettingsChange?.({ weather_entity: v }); },
    ), t('helpWeatherEntity'));

    // La brume : une affaire d'ambiance, plus de réglage général.
    {
      const fogWrap = document.createElement('div');
      const fogVal = document.createElement('div');
      fogVal.style.cssText = 'font-size:12px;color:var(--ow-text);font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:4px;';
      const fmtFog = (v: number) => (v <= 0 ? t('cutawayOff') : `${Math.round((v / 0.05) * 100)} %`);
      fogVal.textContent = fmtFog(rendering.fog_density ?? 0.018);
      const fog = document.createElement('input');
      fog.type = 'range'; fog.min = '0'; fog.max = '0.05'; fog.step = '0.001'; fog.value = String(rendering.fog_density ?? 0.018);
      fog.style.cssText = 'width:100%;cursor:pointer;margin:0;accent-color:var(--ow-acc);';
      fog.addEventListener('input', () => {
        fogVal.textContent = fmtFog(parseFloat(fog.value));
        this.onSceneSettingsChange?.({ rendering: { fog_density: parseFloat(fog.value) } });
      });
      fogWrap.append(fogVal, fog);
      field(t('cfgFogDensityShort'), fogWrap, t('helpFogDensity'));
    }

    // ── Simulation ────────────────────────────────────────────────────
    sec(t('cfgSim'));

    const simContainer = document.createElement('div');
    simContainer.style.cssText = 'margin-bottom:4px;zoom:1.15;';
    root.appendChild(simContainer);
    const sim = this.getSim?.();
    if (sim) {
      sim.buildContentInto(simContainer);
    } else {
      simContainer.style.cssText += ';font-size:10px;color:rgba(255,255,255,0.28);padding:4px 0;';
      simContainer.textContent = '—';
    }
  }

  /**
   * Champ entity_id : saisie libre (coller un identifiant reste le plus rapide)
   * doublée d'un bouton qui ouvre le sélecteur complet — pièces, états,
   * recherche. Remplace les datalist tronqués à 200 entrées, qui n'offraient
   * ni contexte ni exhaustivité.
   */
  private _entityField(
    value: string,
    inputStyle: string,
    onChange: (entityId: string) => void,
  ): { wrap: HTMLDivElement; input: HTMLInputElement } {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:5px;align-items:center;';

    const input = document.createElement('input');
    input.value = value;
    input.placeholder = 'entity_id…';
    input.style.cssText = inputStyle + ';flex:1;min-width:0;';
    input.addEventListener('change', () => onChange(input.value.trim()));

    const btn = document.createElement('button');
    btn.textContent = t('anchorBrowse');
    btn.title = t('pickTitle');
    btn.style.cssText = 'flex:0 0 auto;background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.3);border-radius:7px;color:#7dd3fc;font-size:10px;padding:6px 9px;cursor:pointer;font-family:inherit;white-space:nowrap;';
    btn.addEventListener('click', () => {
      const hass = this.getHass();
      if (!hass) return;
      openEntityPicker({
        container: this.overlayContainer,
        hass,
        onPick: (entityId) => { input.value = entityId; onChange(entityId); },
      });
    });

    wrap.append(input, btn);
    return { wrap, input };
  }

  /**
   * Le capteur d'un ouvrant : un grand bouton qui montre ce qui est relié (nom,
   * état) et ouvre la liste des entités. Plus d'identifiant à taper.
   */
  private _sensorPicker(
    value: string,
    onChange: (entityId: string, name?: string) => void,
    opts: { placed?: Set<string>; empty?: StringKey; emptyHint?: StringKey } = {},
  ): { el: HTMLElement; refresh: () => void } {
    let current = value;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ow-picker';
    const paint = (id: string) => {
      btn.innerHTML = '';
      const hass = this.getHass();
      const st = id ? hass?.states[id] : undefined;
      const tile = document.createElement('span');
      tile.className = 'ow-tile';
      tile.append(icon(id ? anchorIcon({ entity: id }) : 'plus', 18));
      const col = document.createElement('span');
      col.className = 'ow-nm';
      const name = document.createElement('b');
      const sub = document.createElement('span');
      if (!id) {
        btn.classList.add('ow-empty-pick');
        name.textContent = t(opts.empty ?? 'partPickSensor');
        sub.textContent = t(opts.emptyHint ?? 'partPickSensorHint');
      } else {
        btn.classList.remove('ow-empty-pick');
        const friendly = st?.attributes?.friendly_name;
        name.textContent = typeof friendly === 'string' && friendly ? friendly : id;
        sub.textContent = st ? `${id} · ${stateLabel(id, st.state, st.attributes ?? {})}` : `${id} · ${t('partEntityUnknown')}`;
      }
      col.append(name, sub);
      const change = document.createElement('span');
      change.className = 'ow-picker-act';
      change.textContent = id ? t('partChangeSensor') : '';
      btn.append(tile, col, change);
    };
    btn.addEventListener('click', () => {
      const hass = this.getHass();
      if (!hass) return;
      openEntityPicker({
        container: this.overlayContainer,
        hass,
        placed: opts.placed,
        onPick: (entityId, name) => { current = entityId; paint(entityId); onChange(entityId, name); },
      });
    });
    paint(value);
    return { el: btn, refresh: () => paint(current) };
  }

  /**
   * La fiche d'un appareil, dans le panneau : les mêmes briques que celle des
   * ouvrants. Chaque réglage s'applique tout de suite et s'enregistre seul.
   *
   * Ce qui change avec la nature de l'ancre (appareil, étiquette, roue, vers
   * une vue) reconstruit la fiche : seuls les réglages utiles restent.
   */
  private _buildPropsSection(container: HTMLDivElement, key: string, anchor: EditableAnchor, goBack?: () => void) {
    container.innerHTML = '';
    container.classList.remove('ow-legacy');
    container.classList.add('ow-sheet-host');

    const domain = anchor.entity.split('.')[0];
    const kind: AnchorKind = anchor.kind ?? 'entity';
    const isEntityKind = kind === 'entity';
    // Les réglages de lumière, de précision et d'action n'ont de sens que pour
    // une ancre liée à une entité.
    const isLight = isEntityKind && domain === 'light';
    const isSensor = isEntityKind && (domain === 'sensor' || domain === 'binary_sensor');
    const rebuild = () => {
      const fresh = this.getEditor()?.anchors.get(key);
      if (fresh) this._buildPropsSection(container, key, fresh, goBack);
    };
    const update = (props: Partial<EditableAnchor>) => {
      this.getEditor()?.updateAnchor(key, props);
      this.scheduleAutoSave();
    };

    const inputStyle = 'width:100%;box-sizing:border-box;background:var(--ow-chrome2);border:1px solid var(--ow-line);border-radius:9px;color:var(--ow-text);padding:8px 10px;font-size:13px;outline:none;font-family:inherit;';

    // ── En-tête ───────────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.className = 'ow-form-h ow-sheet-h';
    if (goBack) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'ow-ib';
      back.title = t('backAnchors');
      back.setAttribute('aria-label', t('backAnchors'));
      back.append(icon('back', 18));
      back.addEventListener('click', goBack);
      hdr.appendChild(back);
    }
    const tile = document.createElement('span');
    tile.className = 'ow-tile';
    tile.append(icon(anchorIcon(anchor), 18));
    const titleCol = document.createElement('div');
    titleCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';
    const title = document.createElement('b');
    title.style.cssText = 'font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    title.textContent = anchorTitle(anchor);
    const subtitle = document.createElement('span');
    subtitle.style.cssText = 'font-size:12px;color:var(--ow-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    subtitle.textContent = anchorSubtitle(anchor);
    titleCol.append(title, subtitle);
    hdr.append(tile, titleCol);
    container.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'ow-form-b';
    container.appendChild(body);

    // ── Briques ───────────────────────────────────────────────────────
    const card = (label: string, iconName: string, fold?: { key: string; open: boolean }) => {
      const box = document.createElement(fold ? 'details' : 'section');
      box.className = 'ow-card';
      const head = document.createElement(fold ? 'summary' : 'div');
      head.className = 'ow-card-h';
      const name = document.createElement('b');
      name.textContent = label;
      const digest = document.createElement('span');
      digest.className = 'ow-digest';
      head.append(icon(iconName, 17), name, digest);
      if (fold) head.append(Object.assign(document.createElement('span'), { className: 'ow-chev' }));
      const inner = document.createElement('div');
      inner.className = 'ow-card-b';
      box.append(head, inner);
      if (fold && box instanceof HTMLDetailsElement) {
        box.open = this._sheetFold[fold.key] ?? fold.open;
        box.addEventListener('toggle', () => { this._sheetFold[fold.key] = box.open; });
      }
      body.appendChild(box);
      return { inner, digest };
    };
    const field = (label: string, control: HTMLElement, into: HTMLElement) => {
      const wrap = document.createElement('div');
      wrap.className = 'ow-field';
      const l = document.createElement('label');
      l.textContent = label;
      wrap.append(l, control);
      into.appendChild(wrap);
      return wrap;
    };
    const hintLine = (into: HTMLElement, text: string, warn = false) => {
      const h = document.createElement('div');
      h.className = warn ? 'ow-warn-t' : 'ow-hint-line';
      h.textContent = text;
      into.appendChild(h);
    };
    const segmented = (
      options: ReadonlyArray<readonly [string, string, string?]>,
      value: string, onChange: (v: string) => void,
    ) => {
      const seg = document.createElement('div');
      seg.className = 'ow-seg';
      seg.setAttribute('role', 'radiogroup');
      for (const [v, lab, ic] of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        const on = v === value;
        b.classList.toggle('ow-on', on);
        b.setAttribute('aria-checked', String(on));
        if (ic) b.append(icon(ic, 16));
        b.append(document.createTextNode(lab));
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('ow-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
          onChange(v);
        });
        seg.appendChild(b);
      }
      return seg;
    };
    const slider = (
      into: HTMLElement, label: string, min: number, max: number, step: number, value: number,
      fmt: (v: number) => string, onChange: (v: number) => void,
    ) => {
      const range = document.createElement('input');
      range.type = 'range'; range.min = String(min); range.max = String(max); range.step = String(step);
      range.value = String(value);
      range.setAttribute('aria-label', label);
      const out = document.createElement('span');
      out.className = 'ow-range-v';
      out.textContent = fmt(value);
      range.addEventListener('pointerdown', () => { this._editorDragging = true; });
      range.addEventListener('pointerup', () => { this._editorDragging = false; this.scheduleAutoSave(); });
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        out.textContent = fmt(v);
        onChange(v);
        this.syncLightsToScene();
        this.requestRender();
      });
      const row = document.createElement('div');
      row.className = 'ow-range';
      row.append(range, out);
      return field(label, row, into);
    };
    const selectOf = (options: ReadonlyArray<readonly [string, string]>, value: string, onChange: (v: string) => void) => {
      const sel = document.createElement('select');
      sel.style.cssText = inputStyle + SELECT_STYLE;
      for (const [v, l] of options) {
        const o = styleOption(document.createElement('option'));
        o.value = v; o.textContent = l;
        if (v === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };

    // ── Ce que c'est ──────────────────────────────────────────────────
    const what = card(t('sheetWhat'), 'bulb');
    field(t('anchorFieldKind'), segmented([
      ['entity', t('sheetKindEntity'), 'bulb'],
      ['label', t('sheetKindLabel'), 'tag'],
      ['menu', t('sheetKindMenu'), 'menu'],
      ['nav', t('sheetKindNav'), 'nav'],
    ], kind, (v) => {
      update({ kind: v === 'entity' ? undefined : v as AnchorKind });
      // Les champs affichés dépendent de la nature.
      rebuild();
    }), what.inner);
    hintLine(what.inner, t(
      kind === 'label' ? 'anchorKindLabelHint'
      : kind === 'menu' ? 'anchorKindMenuHint'
      : kind === 'nav' ? 'anchorKindNavHint'
      : 'anchorKindEntityHint',
    ));
    if (isEntityKind) {
      const placed = new Set<string>();
      this.getEditor()?.anchors.forEach((a) => { if (a.entity) placed.add(a.entity); });
      const picker = this._sensorPicker(anchor.entity, (entity, name) => {
        update({
          entity,
          // Un libellé encore au défaut de l'ancienne entité n'a plus de sens.
          ...(!anchor.label || anchor.label === anchor.entity.split('.')[1] ? { label: name ?? entity } : {}),
        });
        this.updateAnchorList();
      }, { placed, empty: 'sheetPickDevice', emptyHint: 'sheetPickDeviceHint' });
      what.inner.appendChild(picker.el);
      this._liveForm = () => picker.refresh();
    } else {
      this._liveForm = null;
    }
    const nameInput = document.createElement('input');
    nameInput.value = anchor.label;
    nameInput.placeholder = t('anchorNamePh');
    nameInput.style.cssText = inputStyle;
    nameInput.addEventListener('change', () => {
      const label = nameInput.value.trim() || anchorTitle(anchor);
      update({ label });
      title.textContent = label;
    });
    field(t('anchorFieldName'), nameInput, what.inner);

    // ── Nature « vers une vue » ───────────────────────────────────────
    if (kind === 'nav') {
      const nav = card(t('anchorSectionNav'), 'camera');
      const views = this.getViews?.() ?? [];
      field(t('anchorNavView'), selectOf(
        [['', t('anchorNavNone')], ...views.map((v) => [v.id ?? '', v.label] as const)],
        anchor.navViewId ?? '',
        (v) => update({ navViewId: v || undefined }),
      ), nav.inner);
      if (!views.length) hintLine(nav.inner, t('anchorNavNoViews'), true);
    }

    // ── Nature « roue d'actions » : reprise de l'éditeur d'actions ────
    if (kind === 'menu') {
      const menu = card(t('anchorSectionActions'), 'menu');
      this._buildActionsEditor(menu.inner, key, inputStyle);
    }

    // ── Apparence ─────────────────────────────────────────────────────
    const look = card(t('sheetLook'), 'brush');
    // Icône : le sélecteur de Home Assistant s'il est là, sinon un champ.
    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const preview = document.createElement('ha-icon') as HTMLElement;
    preview.setAttribute('icon', anchor.icon ?? 'mdi:help-circle-outline');
    preview.style.cssText = `--mdi-icon-size:22px;width:36px;height:36px;border-radius:10px;background:var(--ow-chrome2);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${anchor.icon ? 'var(--ow-acc)' : 'var(--ow-muted)'};`;
    if (customElements.get('ha-icon-picker') != null) {
      const picker = document.createElement('ha-icon-picker') as HTMLElement;
      picker.setAttribute('value', anchor.icon ?? '');
      picker.setAttribute('label', '');
      picker.style.cssText = 'flex:1;--mdc-text-field-fill-color:var(--ow-chrome2);--mdc-theme-primary:var(--ow-acc);';
      picker.addEventListener('value-changed', ((e: CustomEvent) => {
        const v = (e.detail?.value as string) || undefined;
        update({ icon: v });
        preview.setAttribute('icon', v ?? 'mdi:help-circle-outline');
      }) as EventListener);
      iconWrap.append(preview, picker);
    } else {
      const iconInput = document.createElement('input');
      iconInput.value = anchor.icon ?? '';
      iconInput.placeholder = t('sheetIconAuto');
      iconInput.style.cssText = inputStyle + 'flex:1;';
      iconInput.addEventListener('change', () => {
        const v = iconInput.value.trim() || undefined;
        update({ icon: v });
        preview.setAttribute('icon', v ?? 'mdi:help-circle-outline');
      });
      iconWrap.append(preview, iconInput);
    }
    field(t('anchorFieldIcon'), iconWrap, look.inner);

    // La couleur d'une lampe vient de l'entité elle-même : la surcharger
    // n'aurait pas de sens.
    if (isEntityKind && !isLight) {
      const colorWrap = document.createElement('div');
      colorWrap.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = anchor.color ?? '#44aaff';
      colorInput.setAttribute('aria-label', t('anchorFieldColor'));
      const auto = document.createElement('button');
      auto.type = 'button';
      const paint = (on: boolean) => {
        colorInput.style.cssText = `width:44px;height:34px;padding:0;border:1px solid var(--ow-line);border-radius:9px;background:transparent;cursor:pointer;opacity:${on ? 1 : 0.4};`;
        auto.className = `ow-btn ow-small${on ? ' ow-ghost' : ''}`;
        auto.style.flex = '1';
      };
      auto.textContent = t('anchorColorAuto');
      paint(!!anchor.color);
      colorInput.addEventListener('change', () => { update({ color: colorInput.value }); paint(true); });
      auto.addEventListener('click', () => { update({ color: undefined }); paint(false); });
      colorWrap.append(colorInput, auto);
      field(t('anchorFieldColor'), colorWrap, look.inner);
      hintLine(look.inner, t('anchorColorHint'));
    }

    // Vignette d'une caméra : proposée dès que le descripteur en prévoit une,
    // même ramenée à une pastille, sinon on ne pourrait plus revenir en arrière.
    if (isEntityKind && describeEntity(anchor.entity).overlay === 'thumbnail') {
      const display = anchor.display === 'icon' ? 'icon' : 'auto';
      field(t('anchorFieldDisplay'), segmented([
        ['auto', t('anchorDisplayThumb'), 'camera'], ['icon', t('anchorDisplayIcon'), 'sensor'],
      ], display, (v) => { update({ display: v === 'auto' ? undefined : 'icon' }); rebuild(); }), look.inner);
      if (display !== 'icon') {
        slider(look.inner, t('anchorThumbSize'), 0.3, 4, 0.1, anchor.size ?? 1, (v) => `× ${v.toFixed(1)}`,
          (v) => update({ size: v }));
        hintLine(look.inner, t('anchorThumbHint'));
      }
    }

    // Précision d'un capteur : quelques choix plutôt qu'un nombre à taper.
    if (isSensor) {
      field(t('anchorPrecision'), segmented([
        ['', t('sheetPrecisionAuto')], ['0', '18'], ['1', '17,6'], ['2', '17,58'], ['3', '17,583'],
      ], anchor.precision !== undefined ? String(Math.min(anchor.precision, 3)) : '', (v) =>
        update({ precision: v === '' ? undefined : Number(v) })), look.inner);
    }

    // ── Lumière ───────────────────────────────────────────────────────
    if (isLight) {
      const light = card(t('anchorSectionLight'), 'sun');
      slider(light.inner, t('anchorLightIntensity'), 0.1, 3, 0.1, anchor.lightIntensity ?? 1, (v) => `× ${v.toFixed(1)}`,
        (v) => this.getEditor()?.updateAnchor(key, { lightIntensity: v }));
      const tiles = document.createElement('div');
      tiles.className = 'ow-tiles';
      const styles: [import('../types').LightStyle, string, string][] = [
        ['point', t('lightStyleAmbient'), 'bulb'], ['spot', t('lightStyleSpot'), 'target'], ['beam', t('lightStyleBeam'), 'sun'],
      ];
      let currentStyle = anchor.lightStyle ?? 'point';
      const dir = document.createElement('div');
      const paintTiles = () => {
        tiles.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('ow-on', b.dataset.style === currentStyle));
        dir.style.display = currentStyle === 'spot' || currentStyle === 'beam' ? '' : 'none';
      };
      for (const [id, label, ic] of styles) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.style = id;
        b.append(icon(ic, 22), document.createTextNode(label));
        b.addEventListener('click', () => {
          currentStyle = id;
          paintTiles();
          update({ lightStyle: id });
        });
        tiles.appendChild(b);
      }
      field(t('sheetLightStyle'), tiles, light.inner);
      // Orientation d'un spot : lue sur la poignée de la 3D.
      const [dx, dy, dz] = anchor.lightDirection ?? [0, -1, 0];
      const elDeg = (Math.asin(Math.max(-1, Math.min(1, -dy))) * 180) / Math.PI;
      const azDeg = Math.round((((Math.atan2(dx, dz) * 180) / Math.PI) + 360) % 360);
      const readout = document.createElement('div');
      readout.className = 'ow-readout';
      const row = document.createElement('div');
      row.className = 'ow-readout-row';
      row.append(
        Object.assign(document.createElement('span'), { textContent: t('anchorSectionOrientation') }),
        Object.assign(document.createElement('span'), { className: 'ow-state', textContent: `Az ${azDeg}° · ${elDeg >= 0 ? '↓' : '↑'}${Math.abs(Math.round(elDeg))}°` }),
      );
      readout.appendChild(row);
      dir.appendChild(readout);
      const gizmo = document.createElement('div');
      gizmo.className = 'ow-hint-line';
      gizmo.innerHTML = t('orientationGizmoHint');
      dir.appendChild(gizmo);
      light.inner.appendChild(dir);
      paintTiles();
    }

    // ── Au toucher ────────────────────────────────────────────────────
    if (isEntityKind) {
      const tap = card(t('sheetTap'), 'hand');
      const tapSeg = segmented([
        ['default', t('anchorTapDefault')], ['toggle', t('anchorTapToggle')], ['more_info', t('anchorTapMoreInfo')],
        ['activate', t('anchorTapActivate')], ['media_play_pause', t('anchorTapPlayPause')], ['none', t('anchorTapNone')],
      ], anchor.tapAction ?? 'default', (v) => update({ tapAction: v === 'default' ? undefined : (v as TapAction) }));
      tapSeg.classList.add('ow-seg-wrap');
      tap.inner.appendChild(tapSeg);
      hintLine(tap.inner, t('sheetTapHint'));
    }

    // ── Visible seulement si… (repliée) ───────────────────────────────
    const vis = card(t('anchorSectionVisibility'), 'eye', { key: 'visibility', open: !!anchor.visibleIf });
    if (anchor.visibleIf) vis.digest.textContent = t('sheetVisibilitySet');
    this._buildVisibleIfSection(vis.inner, `anc-${key}`, anchor.visibleIf, inputStyle, (cond) => {
      update({ visibleIf: cond });
      vis.digest.textContent = cond ? t('sheetVisibilitySet') : '';
    });

    // ── Gérer ─────────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'ow-btn';
    dupBtn.title = 'Ctrl+D';
    dupBtn.append(icon('copy', 16), document.createTextNode(t('sheetDuplicate')));
    dupBtn.addEventListener('click', () => this.getEditor()?.duplicate());
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ow-btn ow-danger';
    delBtn.title = t('anchorDeleteTitle');
    const delLabel = document.createTextNode(t('sheetDelete'));
    delBtn.append(icon('trash', 16), delLabel);
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm === '1') { this.getEditor()?.deleteSelected(); return; }
      delBtn.dataset.confirm = '1';
      delLabel.textContent = t('sheetDeleteConfirm');
      setTimeout(() => {
        if (delBtn.dataset.confirm !== '1') return;
        delBtn.dataset.confirm = '';
        delLabel.textContent = t('sheetDelete');
      }, 3000);
    });
    actions.append(dupBtn, delBtn);
    body.appendChild(actions);
  }

  /** Sections repliées de la fiche d'un appareil, d'une ouverture à l'autre. */
  private _sheetFold: Record<string, boolean> = {};

  /** La liste des ouvrants, repeinte (après un changement d'étage, par exemple). */
  refreshPartsList() {
    if (this._partsBody) this._fillPartsList(this._partsBody);
  }

  updateAnchorList() {
    this._paintSteps();
    if (!this._panel) return;
    const listView = this._panel.querySelector<HTMLDivElement>('#inspector-list');
    const detailView = this._panel.querySelector<HTMLDivElement>('#inspector-detail');
    if (!listView || !detailView) return;

    const isDetailVisible = detailView.style.display !== 'none';
    const showDetail = () => { listView.style.display = 'none'; detailView.style.display = 'block'; };
    const showList   = () => { listView.style.display = 'flex';  detailView.style.display = 'none'; };

    this._fillListView(listView, detailView, showDetail, showList);

    // If we were in detail view, re-render the detail with fresh data.
    // Skip rebuild if a field inside the detail currently has focus — the user
    // is mid-edit and a rebuild would destroy their input.
    const detailHasFocus = detailView.contains(document.activeElement);
    if (isDetailVisible && !detailHasFocus) {
      const editor = this.getEditor();
      const selKey = editor?.selectedKey;
      const selCardId = this.getSelectedCardId?.();
      detailView.innerHTML = '';
      if (selKey && editor?.anchors.has(selKey)) {
        this._buildPropsSection(detailView, selKey, editor.anchors.get(selKey)!, showList);
        showDetail();
      } else if (selCardId) {
        const selCard = (this.getCards?.() ?? []).find((c) => c.id === selCardId);
        if (selCard) { this._buildCardPropsSection(detailView, selCard, showList); showDetail(); }
        else showList();
      } else {
        showList();
      }
    }
  }

  scheduleAutoSave() {
    if (!this.getSceneId()) return;
    this._saveStatus = 'unsaved';
    this._updateSaveIndicator();
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(async () => {
      this._autoSaveTimer = null;
      this._saveStatus = 'saving';
      this._updateSaveIndicator();
      await this.onSave();
      this._saveStatus = 'saved';
      this._updateSaveIndicator();
      this._paintSteps();
    }, 2000);
  }

  showStatusBar(text: string) {
    let bar = this.cardContainer.querySelector<HTMLElement>('#editor-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'editor-status-bar';
      Object.assign(bar.style, {
        position: 'absolute',
        bottom: '16px',
        left: 'calc(50% - var(--ow-dock, 0px) / 2)',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        fontSize: '12px',
        padding: '4px 14px',
        borderRadius: '20px',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: '100',
        letterSpacing: '0.03em',
      });
      this.cardContainer.appendChild(bar);
    }
    bar.textContent = text;
    bar.style.display = 'block';
  }

  hideStatusBar() {
    const bar = this.cardContainer.querySelector<HTMLElement>('#editor-status-bar');
    if (bar) bar.style.display = 'none';
  }

  private _updateSaveIndicator() {
    const el = this._panel?.querySelector<HTMLElement>('#save-indicator');
    if (!el) return;
    if (this._saveStatus === 'unsaved') {
      el.textContent = t('saveIndicator_unsaved');
      el.style.color = '#f59e0b';
    } else if (this._saveStatus === 'saving') {
      el.textContent = t('saveIndicator_saving');
      el.style.color = '#94a3b8';
    } else {
      el.textContent = t('saveIndicator_saved');
      el.style.color = '#22c55e';
    }
  }

  markSaved() { this._saveStatus = 'saved'; this._updateSaveIndicator(); }

  cancelPendingSave() {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  }

  get hasPendingSave() { return this._saveStatus === 'unsaved' && this._autoSaveTimer !== null; }

  /** Show a template picker inside the list area; clicking places a card in the scene. */
  private _showCardTemplatePicker(list: HTMLDivElement) {

    const overlay = document.createElement('div');
    overlay.style.cssText = 'padding:10px;background:rgba(5,9,20,0.97);border-top:1px solid rgba(255,255,255,0.08);';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;';
    title.textContent = t('cardPickerTitle');
    overlay.appendChild(title);

    const templates: { type: SceneCardType; icon: string; label: string; desc: string; color: string }[] = [
      { type: 'room',   icon: '🏠', label: t('cardTypeRoom'),   desc: t('cardPickerRoomDesc'),   color: '#7dd3fc' },
      { type: 'entity', icon: '📊', label: t('cardTypeEntity'), desc: t('cardPickerEntityDesc'), color: '#86efac' },
      { type: 'info',   icon: 'ℹ️',  label: t('cardTypeInfo'),   desc: t('cardPickerInfoDesc'),  color: '#fbbf24' },
    ];

    templates.forEach(({ type, icon, label, desc, color }) => {
      const btn = document.createElement('button');
      btn.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px',
        'width:100%', 'padding:9px 10px', 'margin-bottom:5px',
        'background:rgba(255,255,255,0.04)', 'border:1px solid rgba(255,255,255,0.08)',
        'border-radius:8px', 'cursor:pointer', 'font-family:inherit',
        'text-align:left', 'transition:all .15s',
      ].join(';');
      btn.innerHTML = `
        <span style="font-size:22px;flex-shrink:0;">${icon}</span>
        <span style="flex:1;min-width:0;">
          <span style="display:block;font-size:11px;font-weight:700;color:${color};">${label}</span>
          <span style="display:block;font-size:10px;color:rgba(255,255,255,0.38);margin-top:1px;">${desc}</span>
        </span>
        <span style="font-size:16px;color:rgba(255,255,255,0.2);">›</span>
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.borderColor = `rgba(${color.slice(1).match(/../g)!.map(h => parseInt(h, 16)).join(',')},0.3)`; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.04)'; btn.style.borderColor = 'rgba(255,255,255,0.08)'; });
      btn.addEventListener('click', () => {
        overlay.remove();
        if (this.onStartCardPlacement) this.onStartCardPlacement(type);
      });
      overlay.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'width:100%;padding:5px;background:none;border:none;color:rgba(255,255,255,0.3);font-size:10px;font-family:inherit;cursor:pointer;margin-top:2px;';
    cancelBtn.textContent = t('btnCancel');
    cancelBtn.addEventListener('click', () => overlay.remove());
    overlay.appendChild(cancelBtn);

    // Insert after the cards sep row (before the first card row or empty state)
    list.appendChild(overlay);
  }

  private _buildCardPropsSection(container: HTMLDivElement, card: SceneCard, goBack?: () => void) {
    container.innerHTML = '';

    const inputStyle = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e2e8f0;padding:6px 9px;font-size:11px;outline:none;font-family:inherit;';
    const secStyle = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
    const lblStyle = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;';

    const hass = this.getHass();

    // ── Back navigation ───────────────────────────────────────────────
    if (goBack) {
      const nav = document.createElement('div');
      nav.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 0 10px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:12px;';
      const backBtn = document.createElement('button');
      backBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.35);font-size:12px;padding:0;line-height:1;transition:color .12s;display:flex;align-items:center;gap:4px;font-family:inherit;';
      backBtn.innerHTML = `← <span style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">${t('backCards')}</span>`;
      backBtn.addEventListener('mouseenter', () => { backBtn.style.color = '#7dd3fc'; });
      backBtn.addEventListener('mouseleave', () => { backBtn.style.color = 'rgba(255,255,255,0.35)'; });
      backBtn.addEventListener('click', goBack);
      nav.appendChild(backBtn);
      container.appendChild(nav);
    }

    // Title row
    const typeIcons: Record<string, string> = { room: '🏠', entity: '📊', info: 'ℹ️' };
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:2px;display:flex;align-items:center;gap:6px;';
    title.innerHTML = `<span>${typeIcons[card.type] ?? '▦'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${card.name}</span>`;
    container.appendChild(title);

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:2px;';
    sub.textContent = `${t('cardSubtitle')} · ${CARD_TYPE_LABELS[card.type]()}`;
    container.appendChild(sub);

    // ── Section: Général ───────────────────────────────────────────────────

    const sec1 = document.createElement('div');
    sec1.style.cssText = secStyle;
    sec1.textContent = t('cardSectionGeneral');
    container.appendChild(sec1);

    // Name input
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'margin-bottom:8px;';
    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = lblStyle;
    nameLbl.textContent = t('cardFieldName');
    const nameInp = document.createElement('input');
    nameInp.value = card.name;
    nameInp.placeholder = t('cardNamePh');
    nameInp.style.cssText = inputStyle;
    nameInp.addEventListener('change', () => {
      this._updateCard(card.id, { name: nameInp.value.trim() || t('cardNameDefault') });
      title.querySelector('span:last-child')!.textContent = nameInp.value.trim() || t('cardNameDefault');
    });
    nameWrap.appendChild(nameLbl);
    nameWrap.appendChild(nameInp);
    container.appendChild(nameWrap);

    // ── Section: Position ──────────────────────────────────────────────────

    const secPos = document.createElement('div');
    secPos.style.cssText = secStyle;
    secPos.textContent = t('cardSectionPosition');
    container.appendChild(secPos);

    const axisLabels: ['X', 'Y', 'Z'] = ['X', 'Y', 'Z'];
    const axisColors = ['#f87171', '#4ade80', '#60a5fa'];
    const posRow = document.createElement('div');
    posRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:8px;';
    axisLabels.forEach((ax, i) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = `font-size:9px;font-weight:700;color:${axisColors[i]};text-transform:uppercase;letter-spacing:.06em;text-align:center;`;
      lbl.textContent = ax;
      const inpWrap = document.createElement('div');
      inpWrap.style.cssText = 'position:relative;display:flex;align-items:center;';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.01';
      inp.value = card.position[i].toFixed(3);
      inp.title = t('cardPositionTitle');
      inp.style.cssText = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;padding:4px 22px 4px 6px;font-size:11px;outline:none;font-family:inherit;text-align:center;';
      const unit = document.createElement('span');
      unit.textContent = 'm';
      unit.style.cssText = 'position:absolute;right:5px;font-size:9px;color:rgba(255,255,255,0.3);pointer-events:none;font-family:inherit;';
      inp.addEventListener('change', () => {
        const pos: [number, number, number] = [...card.position];
        pos[i] = parseFloat(inp.value) || 0;
        this._updateCard(card.id, { position: pos });
      });
      inpWrap.appendChild(inp);
      inpWrap.appendChild(unit);
      cell.appendChild(lbl);
      cell.appendChild(inpWrap);
      posRow.appendChild(cell);
    });
    container.appendChild(posRow);

    // ── Section: Apparence ─────────────────────────────────────────────────

    const sec2 = document.createElement('div');
    sec2.style.cssText = secStyle;
    sec2.textContent = t('cardSectionAppearance');
    container.appendChild(sec2);

    // Size presets (small / medium / large)
    const sizeLbl = document.createElement('div');
    sizeLbl.style.cssText = lblStyle;
    sizeLbl.textContent = t('cardFieldSize');
    container.appendChild(sizeLbl);

    const sizeBtnRow = document.createElement('div');
    sizeBtnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:10px;';
    const sizePairs: [import('../cards/types').SceneCardSize, string][] = [
      ['small', 'S (0.6m)'],
      ['medium', 'M (1.0m)'],
      ['large', 'L (1.5m)'],
    ];
    const sizeButtons: HTMLButtonElement[] = [];
    sizePairs.forEach(([sz, label]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      const active = card.size === sz || (!card.size && sz === 'medium');
      btn.style.cssText = `background:${active ? 'rgba(125,211,252,0.15)' : 'rgba(255,255,255,0.04)'};border:1px solid ${active ? 'rgba(125,211,252,0.5)' : 'rgba(255,255,255,0.1)'};border-radius:6px;color:${active ? '#7dd3fc' : '#94a3b8'};padding:5px 2px;font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s;`;
      btn.addEventListener('click', () => {
        this._updateCard(card.id, { size: sz });
        sizeButtons.forEach((b, j) => {
          const isSel = sizePairs[j][0] === sz;
          b.style.background = isSel ? 'rgba(125,211,252,0.15)' : 'rgba(255,255,255,0.04)';
          b.style.borderColor = isSel ? 'rgba(125,211,252,0.5)' : 'rgba(255,255,255,0.1)';
          b.style.color = isSel ? '#7dd3fc' : '#94a3b8';
        });
      });
      sizeButtons.push(btn);
      sizeBtnRow.appendChild(btn);
    });
    container.appendChild(sizeBtnRow);

    // Accent color
    const colorWrap = document.createElement('div');
    colorWrap.style.cssText = 'margin-bottom:10px;';
    const colorLbl = document.createElement('div');
    colorLbl.style.cssText = lblStyle;
    colorLbl.textContent = t('cardFieldAccentColor');
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = card.accentColor ?? CARD_DEFAULT_ACCENT[card.type];
    colorInp.style.cssText = 'width:36px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:2px;background:rgba(255,255,255,0.06);';
    colorInp.addEventListener('change', () => {
      colorText.value = colorInp.value;
      this._updateCard(card.id, { accentColor: colorInp.value });
    });
    const colorText = document.createElement('input');
    colorText.type = 'text';
    colorText.value = card.accentColor ?? CARD_DEFAULT_ACCENT[card.type];
    colorText.style.cssText = inputStyle + 'flex:1;padding:4px 8px;font-size:11px;';
    colorText.addEventListener('change', () => {
      const v = colorText.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { colorInp.value = v; this._updateCard(card.id, { accentColor: v }); }
    });
    colorInp.addEventListener('input', () => { colorText.value = colorInp.value; });
    colorRow.appendChild(colorInp);
    colorRow.appendChild(colorText);
    colorWrap.appendChild(colorLbl);
    colorWrap.appendChild(colorRow);
    container.appendChild(colorWrap);

    // ── Section: Template ──────────────────────────────────────────────────

    const secTpl = document.createElement('div');
    secTpl.style.cssText = secStyle;
    secTpl.textContent = CARD_TYPE_LABELS[card.type as import('../cards/types').SceneCardType]();
    container.appendChild(secTpl);

    const mkEntityInput = (val: string, _id: string, onChange: (v: string) => void) => {
      const { wrap } = this._entityField(val, inputStyle, onChange);
      wrap.style.marginBottom = '8px';
      return wrap;
    };

    const mkTextInput = (val: string, placeholder: string, onChange: (v: string) => void) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const inp = document.createElement('input');
      inp.value = val;
      inp.placeholder = placeholder;
      inp.style.cssText = inputStyle;
      inp.addEventListener('change', () => onChange(inp.value));
      wrap.appendChild(inp);
      return wrap;
    };

    const mkFieldLabel = (text: string) => {
      const l = document.createElement('div');
      l.style.cssText = lblStyle;
      l.textContent = text;
      return l;
    };

    const mkToggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#94a3b8;cursor:pointer;margin-bottom:6px;';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = checked;
      chk.addEventListener('change', () => onChange(chk.checked));
      row.appendChild(chk);
      row.appendChild(document.createTextNode(label));
      return row;
    };

    if (card.type === 'room') {
      // Icon emoji
      container.appendChild(mkFieldLabel(t('cardRoomIconLabel')));
      container.appendChild(mkTextInput(card.icon ?? '', '🏠', (v) => this._updateCard(card.id, { icon: v || undefined } as Partial<import('../cards/types').RoomCard>)));

      // Entities (up to 4)
      const maxEntities = 4;
      const entitiesWrap = document.createElement('div');
      entitiesWrap.style.cssText = 'margin-bottom:8px;';
      container.appendChild(mkFieldLabel(t('cardRoomEntitiesLabel').replace('{n}', String(maxEntities))));
      container.appendChild(entitiesWrap);

      const getFreshEntities = (): string[] => {
        const fresh = (this.getCards?.() ?? []).find((c) => c.id === card.id) as import('../cards/types').RoomCard | undefined;
        return fresh?.entities ?? [];
      };

      const renderEntityList = () => {
        entitiesWrap.innerHTML = '';
        const entities = getFreshEntities();
        entities.forEach((eid, idx) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px;';
          const { wrap: entField } = this._entityField(eid, inputStyle, (v) => {
            const newList = [...getFreshEntities()];
            newList[idx] = v;
            this._updateCard(card.id, { entities: newList.filter(Boolean) } as Partial<import('../cards/types').RoomCard>);
          });
          entField.style.flex = '1';
          const rmBtn = document.createElement('button');
          rmBtn.textContent = '×';
          rmBtn.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.6);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;';
          rmBtn.addEventListener('click', () => {
            const newList = getFreshEntities().filter((_, j) => j !== idx);
            this._updateCard(card.id, { entities: newList } as Partial<import('../cards/types').RoomCard>);
            renderEntityList();
          });
          row.appendChild(entField); row.appendChild(rmBtn);
          entitiesWrap.appendChild(row);
        });
        if (entities.length < maxEntities) {
          const addBtn = document.createElement('button');
          addBtn.textContent = t('cardRoomAddEntity');
          addBtn.style.cssText = 'background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);border-radius:6px;color:#64748b;padding:5px 10px;font-size:10px;font-family:inherit;cursor:pointer;width:100%;';
          addBtn.addEventListener('click', () => {
            const newList = [...getFreshEntities(), ''];
            this._updateCard(card.id, { entities: newList } as Partial<import('../cards/types').RoomCard>);
            renderEntityList();
          });
          entitiesWrap.appendChild(addBtn);
        }
      };
      renderEntityList();

      // Show toggles
      container.appendChild(mkToggle(t('cardRoomShowName'), card.show?.name !== false, (v) => this._updateCard(card.id, { show: { ...card.show, name: v } } as Partial<import('../cards/types').RoomCard>)));
      container.appendChild(mkToggle(t('cardRoomShowStates'), card.show?.entities !== false, (v) => this._updateCard(card.id, { show: { ...card.show, entities: v } } as Partial<import('../cards/types').RoomCard>)));

    } else if (card.type === 'entity') {
      // Entity ID
      container.appendChild(mkFieldLabel(t('cardEntityLabel')));
      container.appendChild(mkEntityInput(card.entity_id ?? '', 'entity', (v) => this._updateCard(card.id, { entity_id: v } as Partial<import('../cards/types').EntityCard>)));

      // Label override
      container.appendChild(mkFieldLabel(t('cardEntityOptLabel')));
      container.appendChild(mkTextInput(card.label ?? '', t('cardEntityLabelPh'), (v) => this._updateCard(card.id, { label: v || undefined } as Partial<import('../cards/types').EntityCard>)));

      // Show toggles
      container.appendChild(mkToggle(t('cardEntityShowLabel'), card.show?.label !== false, (v) => this._updateCard(card.id, { show: { ...card.show, label: v } } as Partial<import('../cards/types').EntityCard>)));
      container.appendChild(mkToggle(t('cardEntityShowUnit'), card.show?.unit !== false, (v) => this._updateCard(card.id, { show: { ...card.show, unit: v } } as Partial<import('../cards/types').EntityCard>)));
      container.appendChild(mkToggle(t('cardEntityShowButton'), card.show?.button === true, (v) => this._updateCard(card.id, { show: { ...card.show, button: v } } as Partial<import('../cards/types').EntityCard>)));

    } else if (card.type === 'info') {
      // Icon emoji
      container.appendChild(mkFieldLabel(t('cardInfoIconLabel')));
      container.appendChild(mkTextInput(card.icon ?? '', 'ℹ️', (v) => this._updateCard(card.id, { icon: v || undefined } as Partial<import('../cards/types').InfoCard>)));

      // Subtitle
      container.appendChild(mkFieldLabel(t('cardInfoSubtitleLabel')));
      container.appendChild(mkTextInput(card.subtitle ?? '', 'Texte…', (v) => this._updateCard(card.id, { subtitle: v || undefined } as Partial<import('../cards/types').InfoCard>)));

      // Color override
      container.appendChild(mkFieldLabel(t('cardInfoColorLabel')));
      const colorOverrideWrap = document.createElement('div');
      colorOverrideWrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px;';
      const colorOInp = document.createElement('input');
      colorOInp.type = 'color';
      colorOInp.value = card.color ?? CARD_DEFAULT_ACCENT[card.type];
      colorOInp.style.cssText = 'width:36px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:2px;background:rgba(255,255,255,0.06);';
      const colorOText = document.createElement('input');
      colorOText.type = 'text';
      colorOText.value = card.color ?? '';
      colorOText.placeholder = t('cardInfoColorPh');
      colorOText.style.cssText = inputStyle + 'flex:1;padding:4px 8px;font-size:11px;';
      colorOInp.addEventListener('change', () => {
        colorOText.value = colorOInp.value;
        this._updateCard(card.id, { color: colorOInp.value } as Partial<import('../cards/types').InfoCard>);
      });
      colorOInp.addEventListener('input', () => { colorOText.value = colorOInp.value; });
      colorOText.addEventListener('change', () => {
        const v = colorOText.value.trim();
        if (!v) { this._updateCard(card.id, { color: undefined } as Partial<import('../cards/types').InfoCard>); return; }
        if (/^#[0-9a-fA-F]{6}$/.test(v)) { colorOInp.value = v; this._updateCard(card.id, { color: v } as Partial<import('../cards/types').InfoCard>); }
      });
      colorOverrideWrap.appendChild(colorOInp);
      colorOverrideWrap.appendChild(colorOText);
      container.appendChild(colorOverrideWrap);

      // Show toggles
      container.appendChild(mkToggle(t('cardInfoShowName'), card.show?.name !== false, (v) => this._updateCard(card.id, { show: { ...card.show, name: v } } as Partial<import('../cards/types').InfoCard>)));
      container.appendChild(mkToggle(t('cardInfoShowSubtitle'), card.show?.subtitle !== false, (v) => this._updateCard(card.id, { show: { ...card.show, subtitle: v } } as Partial<import('../cards/types').InfoCard>)));
    }

    // ── Section: Visibilité conditionnelle ────────────────────────────────────

    const secVis = document.createElement('div');
    secVis.style.cssText = secStyle;
    secVis.textContent = t('cardSectionVisibility');
    container.appendChild(secVis);
    this._buildVisibleIfSection(container, `card-${card.id}`, card.visibleIf, inputStyle, (cond) => {
      this._updateCard(card.id, { visibleIf: cond });
    });

    // ── Section: Gérer ─────────────────────────────────────────────────────

    const sec3 = document.createElement('div');
    sec3.style.cssText = secStyle;
    sec3.textContent = t('cardSectionManage');
    container.appendChild(sec3);

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:8px;color:#f87171;padding:7px 8px;font-size:10px;font-family:inherit;cursor:pointer;width:100%;';
    delBtn.innerHTML = t('cardBtnDelete');
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm === '1') {
        this._pushCardSnap();
        const cards = (this.getCards ? this.getCards() : []).filter((x) => x.id !== card.id);
        if (this.saveCards) this.saveCards(cards).then(() => { if (this.onSelectCard) this.onSelectCard(null); this.updateAnchorList(); });
      } else {
        delBtn.dataset.confirm = '1';
        delBtn.innerHTML = t('cardBtnDeleteConfirm');
        delBtn.style.background = 'rgba(239,68,68,0.35)';
        delBtn.style.borderColor = 'rgba(239,68,68,0.65)';
        setTimeout(() => {
          if (delBtn.dataset.confirm === '1') {
            delBtn.dataset.confirm = '';
            delBtn.innerHTML = t('cardBtnDelete');
            delBtn.style.background = 'rgba(239,68,68,0.1)';
            delBtn.style.borderColor = 'rgba(239,68,68,0.25)';
          }
        }, 3000);
      }
    });
    container.appendChild(delBtn);
  }

  private _updateCard(id: string, changes: Partial<SceneCard>) {
    const cards = (this.getCards ? this.getCards() : []).map((c) => c.id === id ? { ...c, ...changes } : c) as SceneCard[];
    if (this.saveCards) this.saveCards(cards);
  }

  // ── Shared: visibleIf UI ────────────────────────────────────────────────────

  private static readonly _STATE_SUGGESTIONS: Record<string, string[]> = {
    light:               ['on', 'off'],
    switch:              ['on', 'off'],
    input_boolean:       ['on', 'off'],
    fan:                 ['on', 'off'],
    humidifier:          ['on', 'off'],
    binary_sensor:       ['on', 'off'],
    cover:               ['open', 'closed', 'opening', 'closing'],
    climate:             ['heat', 'cool', 'off', 'auto', 'fan_only', 'dry'],
    media_player:        ['playing', 'paused', 'idle', 'off', 'standby'],
    alarm_control_panel: ['armed_home', 'armed_away', 'disarmed', 'triggered', 'arming'],
    lock:                ['locked', 'unlocked'],
    vacuum:              ['cleaning', 'docked', 'idle', 'returning', 'off'],
    input_select:        [],  // populated dynamically from entity attributes
  };

  /**
   * Builds the "Visibilité conditionnelle" section and appends it to `container`.
   * `idPrefix` must be unique per usage (used for datalist ids).
   * `onApply` is called with the new condition (or undefined to clear).
   */
  /** L'éditeur des entrées d'une roue d'actions (nature `menu`). */
  private _buildActionsEditor(container: HTMLElement, key: string, inputStyle: string) {
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    container.appendChild(listWrap);
    type Act = import('../types').AnchorAction;

    const getActions = (): Act[] => this.getEditor()?.anchors.get(key)?.actions ?? [];
    const writeActions = (next: Act[]) => {
      this.getEditor()?.updateAnchor(key, { actions: next });
      this.scheduleAutoSave();
      renderActions();
    };
    const patch = (idx: number, props: Partial<Act>) => {
      const next = [...getActions()];
      next[idx] = { ...next[idx], ...props };
      writeActions(next);
    };

    const renderActions = () => {
      listWrap.innerHTML = '';
      const actions = getActions();

      actions.forEach((act, idx) => {
        const row = document.createElement('div');
        row.className = 'ow-act-row';

        // Nom et icône de l'entrée, et de quoi la retirer.
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;gap:6px;align-items:center;';
        const labInp = document.createElement('input');
        labInp.value = act.label;
        labInp.placeholder = t('anchorActionLabelAuto');
        labInp.setAttribute('aria-label', t('anchorActionLabelAuto'));
        labInp.style.cssText = inputStyle + 'flex:1;min-width:0;';
        labInp.addEventListener('change', () => patch(idx, { label: labInp.value.trim() }));
        const icoInp = document.createElement('input');
        icoInp.value = act.icon ?? '';
        icoInp.placeholder = 'mdi:…';
        icoInp.setAttribute('aria-label', t('anchorFieldIcon'));
        icoInp.style.cssText = inputStyle + 'width:96px;flex:0 0 auto;';
        icoInp.addEventListener('change', () => patch(idx, { icon: icoInp.value.trim() || undefined }));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ow-ib';
        del.title = t('anchorActionDelete');
        del.setAttribute('aria-label', t('anchorActionDelete'));
        del.style.color = '#f87171';
        del.append(icon('trash', 16));
        del.addEventListener('click', () => writeActions(getActions().filter((_, j) => j !== idx)));
        head.append(labInp, icoInp, del);
        row.appendChild(head);

        // Ce que fait l'entrée.
        const seg = document.createElement('div');
        seg.className = 'ow-seg';
        for (const [v, l, ic] of [
          ['entity', t('actTypeEntity'), 'bulb'], ['service', t('actTypeService'), 'play'], ['view', t('actTypeView'), 'camera'],
        ] as const) {
          const b = document.createElement('button');
          b.type = 'button';
          b.classList.toggle('ow-on', act.type === v);
          b.append(icon(ic, 15), document.createTextNode(l));
          b.addEventListener('click', () => { if (act.type !== v) patch(idx, { type: v }); });
          seg.appendChild(b);
        }
        row.appendChild(seg);

        if (act.type === 'entity') {
          // Tout vient du descripteur : il n'y a que la cible à choisir.
          row.appendChild(this._sensorPicker(
            act.entity_id ?? (act.service_data?.entity_id as string) ?? '',
            (v) => patch(idx, { entity_id: v || undefined }),
            { empty: 'sheetPickDevice', emptyHint: 'sheetPickDeviceHint' },
          ).el);
        } else if (act.type === 'view') {
          const vs = document.createElement('select');
          vs.style.cssText = inputStyle + SELECT_STYLE;
          const n0 = styleOption(document.createElement('option'));
          n0.value = ''; n0.textContent = t('anchorNavNone');
          vs.appendChild(n0);
          for (const v of this.getViews?.() ?? []) {
            const o = styleOption(document.createElement('option'));
            o.value = v.id ?? ''; o.textContent = v.label;
            if (act.view_id === v.id) o.selected = true;
            vs.appendChild(o);
          }
          vs.addEventListener('change', () => patch(idx, { view_id: vs.value || undefined }));
          row.appendChild(vs);
        } else {
          // Un seul champ « domaine.service » : la forme sous laquelle HA les documente.
          const svc = document.createElement('input');
          svc.value = act.domain && act.service ? `${act.domain}.${act.service}` : '';
          svc.placeholder = t('anchorActionServicePh');
          svc.setAttribute('aria-label', t('anchorActionService'));
          svc.style.cssText = inputStyle;
          svc.addEventListener('change', () => {
            const parts = svc.value.trim().split('.');
            const d = parts.shift();
            patch(idx, { domain: d || undefined, service: parts.join('.') || undefined });
          });
          row.appendChild(svc);
          row.appendChild(this._sensorPicker(
            (act.service_data?.entity_id as string) ?? '',
            (v) => {
              const data: Record<string, unknown> = { ...(getActions()[idx].service_data ?? {}) };
              if (v) data.entity_id = v; else delete data.entity_id;
              patch(idx, { service_data: Object.keys(data).length ? data : undefined });
            },
            { empty: 'actPickTarget', emptyHint: 'actPickTargetHint' },
          ).el);
        }

        // Une entrée sans cible ne fait rien : le dire, plutôt qu'une entrée muette.
        const missing =
          act.type === 'entity' ? (!act.entity_id && !act.service_data?.entity_id ? t('anchorActionNoEntity') : null)
          : act.type === 'service' ? (!act.domain || !act.service ? t('anchorActionNoService') : null)
          : (!act.view_id ? t('anchorActionNoView') : null);
        if (missing) {
          const warn = document.createElement('div');
          warn.className = 'ow-warn-t';
          warn.textContent = missing;
          row.appendChild(warn);
        }
        listWrap.appendChild(row);
      });

      if (!actions.length) {
        const empty = document.createElement('div');
        empty.className = 'ow-hint-line';
        empty.textContent = t('anchorActionEmpty');
        listWrap.appendChild(empty);
      }

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;';
      // Voie principale : composer un groupe en cochant plusieurs entités.
      const addEntities = document.createElement('button');
      addEntities.type = 'button';
      addEntities.className = 'ow-btn ow-primary ow-small';
      addEntities.style.flex = '1';
      addEntities.append(icon('plus', 15), document.createTextNode(t('anchorActionAddEntities').replace(/^[+＋]\s*/, '')));
      addEntities.addEventListener('click', () => {
        const hass = this.getHass();
        if (!hass) return;
        // Les entités déjà dans la roue sont signalées, pas ajoutées deux fois.
        const already = new Set<string>();
        for (const a of getActions()) {
          const id = a.entity_id ?? (a.service_data?.entity_id as string | undefined);
          if (id) already.add(id);
        }
        openEntityPicker({
          container: this.overlayContainer,
          hass,
          placed: already,
          multi: true,
          onPick: () => {},
          onPickMany: (ids) => writeActions([
            ...getActions(),
            ...ids.filter((id) => !already.has(id)).map((id, n) => ({
              id: `act_${Date.now()}_${n}`, label: '', type: 'entity' as const, entity_id: id,
            })),
          ]),
        });
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ow-btn ow-small';
      add.title = t('anchorActionAddHint');
      add.textContent = t('anchorActionAdd').replace(/^[+＋]\s*/, '');
      add.addEventListener('click', () => writeActions([...getActions(), { id: `act_${Date.now()}`, label: '', type: 'entity' }]));
      btnRow.append(addEntities, add);
      listWrap.appendChild(btnRow);
    };

    renderActions();
  }

  /**
   * « Visible seulement si » : la pastille s'affiche ou se masque selon l'état
   * d'un autre appareil (un capteur de présence, un mode de la maison…).
   */
  private _buildVisibleIfSection(
    container: HTMLElement,
    idPrefix: string,
    current: import('../rules/types').EntityCondition | undefined,
    inputStyle: string,
    onApply: (cond: import('../rules/types').EntityCondition | undefined) => void,
  ) {
    const ops: [string, string][] = [
      ['eq', t('opEq')], ['neq', t('opNeq')],
      ['gt', t('opGt')], ['lt', t('opLt')],
      ['gte', t('opGte')], ['lte', t('opLte')],
      ['contains', t('opContains')],
    ];
    // negate : « Masquer si » ; sinon « Afficher si ». Par défaut, masquer.
    let negate = current ? (current.negate ?? false) : true;
    let entity = current?.entity_id ?? '';

    const fields = document.createElement('div');
    fields.style.cssText = `display:${current ? 'flex' : 'none'};flex-direction:column;gap:10px;`;

    // L'interrupteur de la section.
    const toggleRow = document.createElement('div');
    toggleRow.className = 'ow-row-opt';
    const toggleLbl = document.createElement('span');
    toggleLbl.textContent = t('visibilityCondition');
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = `ow-switch${current ? ' ow-on' : ''}`;
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!current));
    sw.setAttribute('aria-label', t('visibilityCondition'));
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('ow-on');
      sw.classList.toggle('ow-on', on);
      sw.setAttribute('aria-checked', String(on));
      fields.style.display = on ? 'flex' : 'none';
      if (!on) onApply(undefined); else apply();
    });
    toggleRow.append(toggleLbl, sw);
    container.append(toggleRow, fields);

    // Masquer si / Afficher si.
    const mode = document.createElement('div');
    mode.className = 'ow-seg';
    const modeBtn = (hide: boolean, label: string, ic: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.classList.toggle('ow-on', negate === hide);
      b.append(icon(ic, 15), document.createTextNode(label));
      b.addEventListener('click', () => {
        negate = hide;
        mode.querySelectorAll('button').forEach((x) => x.classList.toggle('ow-on', x === b));
        apply();
      });
      mode.appendChild(b);
    };
    modeBtn(true, t('visibilityHideIf'), 'eyeOff');
    modeBtn(false, t('visibilityShowIf'), 'eye');
    fields.appendChild(mode);

    // L'appareil dont l'état décide.
    fields.appendChild(this._sensorPicker(entity, (v) => {
      entity = v;
      refreshSuggestions();
      apply();
    }, { empty: 'visPickDevice', emptyHint: 'visPickDeviceHint' }).el);

    // L'opérateur et la valeur, avec les états connus de l'appareil en puces.
    const condRow = document.createElement('div');
    condRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:6px;';
    const opSel = document.createElement('select');
    opSel.style.cssText = inputStyle + SELECT_STYLE + 'width:auto;';
    opSel.setAttribute('aria-label', t('visOperator'));
    for (const [v, l] of ops) {
      const o = styleOption(document.createElement('option'));
      o.value = v; o.textContent = l;
      if (current?.operator === v) o.selected = true;
      opSel.appendChild(o);
    }
    const valInp = document.createElement('input');
    valInp.value = String(current?.value ?? '');
    valInp.placeholder = t('condValuePh');
    valInp.setAttribute('aria-label', t('condValuePh'));
    valInp.style.cssText = inputStyle;
    condRow.append(opSel, valInp);
    fields.appendChild(condRow);
    const chips = document.createElement('div');
    chips.className = 'ow-chips';
    fields.appendChild(chips);

    const refreshSuggestions = () => {
      chips.innerHTML = '';
      const st = entity ? this.getHass()?.states[entity] : undefined;
      if (!entity) return;
      const domain = entity.split('.')[0];
      const fromSelect = st?.attributes?.options as string[] | undefined;
      const known = fromSelect?.length ? fromSelect : knownStates(entity, st?.state);
      const values = [...new Set([...(known.length ? known : EditPanel._STATE_SUGGESTIONS[domain] ?? []), ...(st ? [st.state] : [])])];
      for (const v of values.slice(0, 10)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `ow-chip2${valInp.value === v ? ' ow-on' : ''}`;
        chip.textContent = stateLabel(entity, v, st?.attributes ?? {});
        chip.title = v;
        chip.addEventListener('click', () => {
          valInp.value = v;
          refreshSuggestions();
          apply();
        });
        chips.appendChild(chip);
      }
    };
    refreshSuggestions();

    const apply = () => {
      const val = valInp.value.trim();
      const op = opSel.value as import('../rules/types').ConditionOperator;
      if (!entity || !val) return;
      onApply({ entity_id: entity, operator: op, value: val, negate });
    };
    valInp.addEventListener('change', () => { refreshSuggestions(); apply(); });
    opSel.addEventListener('change', apply);
    void idPrefix;
  }

  // ── Rules UI ────────────────────────────────────────────────────────────────

  private _fillRulesList(pane: HTMLDivElement) {
    pane.innerHTML = '';
    pane.classList.remove('ow-legacy');
    const rules = this.getRules ? this.getRules() : [];

    if (rules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ow-empty';
      const b = document.createElement('b');
      b.textContent = t('rulesEmpty');
      empty.append(b, document.createTextNode(t('rulesEmptyHint')));
      pane.appendChild(empty);
      return;
    }

    rules.forEach((rule) => {
      const enabled = rule.enabled !== false;
      const row = document.createElement('div');
      row.className = `ow-dev${enabled ? '' : ' ow-off'}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const tile = document.createElement('span');
      tile.className = 'ow-tile';
      if (enabled) tile.style.cssText = 'background:color-mix(in srgb, var(--ow-acc) 18%, transparent);color:var(--ow-acc);';
      tile.append(icon('bolt', 18));
      const col = document.createElement('span');
      col.className = 'ow-nm';
      const name = document.createElement('b');
      name.textContent = rule.label || ruleSummary(rule, this.getHass(), this.getViews?.() ?? []).split('  →  ')[0] || `${t('ruleDefaultLabel')} ${rule.id.slice(-4)}`;
      const sub = document.createElement('span');
      sub.textContent = ruleSummary(rule, this.getHass(), this.getViews?.() ?? []);
      sub.title = sub.textContent;
      col.append(name, sub);

      const btns = document.createElement('span');
      btns.className = 'ow-rowbtns';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ow-ib';
      del.title = t('ruleDeleteTitle');
      del.setAttribute('aria-label', t('ruleDeleteTitle'));
      del.append(icon('trash', 16));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!del.dataset.armed) {
          del.dataset.armed = '1';
          del.style.color = '#f87171';
          setTimeout(() => { delete del.dataset.armed; del.style.color = ''; }, 3000);
          return;
        }
        this._pushRuleSnap();
        const newRules = (this.getRules?.() ?? []).filter((r) => r.id !== rule.id);
        this.saveRules?.(newRules).then(() => this._fillRulesList(pane));
      });
      btns.appendChild(del);

      // Activer ou couper la règle sans l'ouvrir.
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = `ow-switch${enabled ? ' ow-on' : ''}`;
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(enabled));
      sw.title = enabled ? t('ruleToggleDisable') : t('ruleToggleEnable');
      sw.setAttribute('aria-label', sw.title);
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        const newRules = (this.getRules?.() ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: !enabled } : r));
        this.saveRules?.(newRules).then(() => this._fillRulesList(pane));
      });

      row.append(tile, col, btns, sw);
      const open = () => this._openRuleModal(rule, () => this._fillRulesList(pane));
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      pane.appendChild(row);
    });
  }

  // ── Ouvrants ──────────────────────────────────────────────────────────────

  private _partsBody: HTMLElement | null = null;
  /** Ferme le formulaire d'ouvrant affiché, en conservant ses réglages. */
  private _closePartModal: (() => void) | null = null;
  /** Ouvrant affiché dans le formulaire, et fermeture sans rien enregistrer. */
  private _partModalId: string | null = null;
  private _discardPartModal: (() => void) | null = null;

  /**
   * Sections de réglages ouvertes.
   *
   * Le panneau se reconstruit souvent — à chaque enregistrement, à chaque
   * sélection. Sans cette mémoire, les sections se refermeraient sous les doigts
   * de l'utilisateur.
   */
  private _openConfigSections = new Set<string>();

  /** Passe la carte en mode sélection, puis ouvre le formulaire sur la pièce. */
  private _startPartPick() {
    if (!this.onStartPartPicking) return;
    this.showStatusBar?.(t('partPickHint'));
    this.onStartPartPicking((hit) => {
      this.hideStatusBar?.();
      // Un clic sur n'importe quelle pièce d'un objet déjà animé rouvre son ouvrant.
      const outline = this.getModelOutline?.();
      const hitNode = outline?.byRank.find((n) => n.meshRank === hit.meshIndex);
      const around = hitNode && outline
        ? new Set([hitNode.rank, ...ancestorsOf(outline, hitNode.rank)])
        : new Set<number>();
      const parts = this.getParts?.() ?? [];
      // Une animation ne se déduit pas de la pièce cliquée : plusieurs
      // ouvrants peuvent partir du même canapé, chacun avec ses pistes.
      const existing = (hit.partId ? parts.find((p) => p.id === hit.partId) : undefined)
        ?? parts.find((p) => p.motion !== 'animation' && !p.node && p.mesh === hit.mesh && p.triangle === hit.triangle)
        ?? parts.find((p) => p.motion !== 'animation' && !!p.node && p.nodeIndex !== undefined && around.has(p.nodeIndex)
          && outline?.byRank[p.nodeIndex]?.name === p.node)
        ?? parts.find((p) => p.motion === 'animation' && !(p.clips?.length)
          && p.mesh === hit.mesh && p.triangle === hit.triangle);
      if (existing) { this._openPartModal(existing, hit); return; }
      this._openPartModal({
        id: `part_${Date.now()}`,
        entity: '',
        mesh: hit.mesh,
        meshIndex: hit.meshIndex,
        triangle: hit.triangle,
        motion: hit.guess === 'window' ? 'slide' : 'swing',
        hinge: 'start',
        angle: 90,
        slide: 'down',
        travel: 1,
        duration: 1.2,
      }, hit);
    });
  }

  private _fillPartsList(pane: HTMLElement) {
    pane.innerHTML = '';
    this._livePartRows.clear();
    const parts = this.getParts?.() ?? [];
    const hass = this.getHass();

    // Portes et fenêtres reconnues dans un export Sweet Home 3D : un clic les
    // ajoute toutes, réglées, au lieu de les désigner une à une.
    const detected = this.countDetectedOpenings?.() ?? 0;
    const tools = document.createElement('div');
    tools.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px 14px 0;';
    if (detected > 0) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ow-btn ow-primary';
      add.style.cssText = 'justify-content:flex-start;white-space:normal;text-align:left;';
      add.append(icon('sparkle', 16), document.createTextNode(t('sh3dAddDetected').replace('{n}', String(detected))));
      add.addEventListener('click', () => {
        add.disabled = true;
        this.onAddDetectedOpenings?.().then(() => this._fillPartsList(pane));
      });
      tools.appendChild(add);
    }
    // Des ouvrants existent déjà (ancien modèle, ajout à la main) : on peut
    // repartir de ceux reconnus, sans perdre les capteurs déjà reliés.
    const all = this.countAllDetectedOpenings?.() ?? 0;
    if (parts.length > 0 && all > 0) {
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'ow-btn ow-ghost ow-small';
      replace.style.cssText = 'justify-content:flex-start;white-space:normal;text-align:left;';
      replace.append(icon('swap', 15), document.createTextNode(t('sh3dReplaceDetected').replace('{n}', String(all))));
      replace.addEventListener('click', () => {
        if (!confirm(t('sh3dReplaceConfirm').replace('{n}', String(parts.length)).replace('{m}', String(all)))) return;
        replace.disabled = true;
        this.onReplaceDetectedOpenings?.().then(() => this._fillPartsList(pane));
      });
      tools.appendChild(replace);
    }
    if (tools.children.length) pane.appendChild(tools);

    if (parts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ow-empty';
      const b = document.createElement('b');
      b.textContent = t('partsEmptyTitle');
      empty.append(b, document.createTextNode(t('partsEmpty')));
      pane.appendChild(empty);
      return;
    }

    // Ceux qui attendent un capteur d'abord : c'est ce qui reste à faire.
    const groups: [string, OwlnestPart[]][] = [
      [t('partsToLink'), parts.filter((p) => !p.entity)],
      [t('partsLinked'), parts.filter((p) => !!p.entity)],
    ];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      const head = document.createElement('div');
      head.className = 'ow-room';
      const hb = document.createElement('b');
      hb.textContent = title;
      const hn = document.createElement('span');
      hn.textContent = String(list.length);
      head.append(hb, hn);
      pane.appendChild(head);

      for (const part of list) {
        const row = document.createElement('div');
        row.className = `ow-dev${this._partModalId === part.id ? ' ow-on' : ''}`;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        const tile = document.createElement('span');
        tile.className = 'ow-tile';
        const st = part.entity ? hass?.states[part.entity] : undefined;
        const paintTile = (s2: typeof st) => {
          let frac = 0;
          if (s2) {
            frac = openFraction(part.entity, s2.state, s2.attributes, part.openWhen);
            if (part.invert) frac = 1 - frac;
          }
          tile.style.cssText = frac > 0.5 ? 'background:color-mix(in srgb, #34d399 22%, transparent);color:#34d399;' : '';
        };
        paintTile(st);
        tile.append(icon(PART_ICON[part.motion] ?? 'door', 18));
        const col = document.createElement('span');
        col.className = 'ow-nm';
        const name = document.createElement('b');
        const friendly = st?.attributes?.friendly_name;
        name.textContent = part.label || (typeof friendly === 'string' ? friendly : '') || part.entity || t('partTitle');
        // Une porte d'un autre étage : son étage, en petit, à côté du nom.
        const floorName = this.partFloor?.(part);
        if (floorName) {
          const tag = document.createElement('span');
          tag.className = 'ow-floor-tag';
          tag.textContent = floorName;
          name.append(tag);
        }
        const sub = document.createElement('span');
        if (!part.entity) {
          sub.textContent = t('partNoEntity');
          sub.style.color = '#fbbf24';
        } else {
          const sensor = typeof friendly === 'string' && friendly !== name.textContent ? `${friendly} · ` : '';
          const paintSub = (s2: typeof st) => {
            sub.textContent = s2 ? `${sensor}${stateLabel(part.entity, s2.state, s2.attributes ?? {})}` : `${part.entity} · ${t('partEntityUnknown')}`;
          };
          paintSub(st);
          this._livePartRows.set(part.id, () => {
            const s2 = this.getHass()?.states[part.entity];
            paintTile(s2);
            paintSub(s2);
          });
        }
        col.append(name, sub);
        const btns = document.createElement('span');
        btns.className = 'ow-rowbtns';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ow-ib';
        del.title = t('partDelete');
        del.setAttribute('aria-label', t('partDelete'));
        del.append(icon('trash', 16));
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (del.dataset.armed) {
            // Le formulaire encore ouvert réenregistrerait l'ouvrant en se fermant.
            if (this._partModalId === part.id) this._discardPartModal?.();
            const next = (this.getParts?.() ?? []).filter((p) => p.id !== part.id);
            this.saveParts?.(next).then(() => this._fillPartsList(pane));
            return;
          }
          del.dataset.armed = '1';
          del.style.color = '#f87171';
          del.title = t('partDeleteConfirm');
          setTimeout(() => { delete del.dataset.armed; del.style.color = ''; del.title = t('partDelete'); }, 3000);
        });
        btns.appendChild(del);
        row.append(tile, col, btns);
        const open = () => this._openPartModal(part, null);
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        pane.appendChild(row);
      }
    }
  }

  /**
   * La fiche d'un ouvrant, dans le panneau de droite : la maison reste
   * visible à côté, pour voir chaque réglage agir.
   *
   * L'ordre suit ce qu'on fait vraiment : relier le capteur, vérifier que ça
   * bouge dans le bon sens, ajuster le mouvement. Les couleurs et le choix de
   * l'objet dans l'arborescence du modèle sont repliés : on y vient rarement.
   */
  private _openPartModal(part: OwlnestPart, hit: PickedPart | null) {
    // Une porte d'un autre étage : on y va d'abord, pour la voir bouger.
    if (this.partFloor?.(part)) this.showPartFloor?.(part);
    this._closePartModal?.();
    this._panel?.querySelector('#owlnest-part-modal')?.remove();
    const host = this._panel;
    if (!host) return;
    if (this._narrow) this._setPanelOpen(true);
    const draft: OwlnestPart = JSON.parse(JSON.stringify(part));
    this._pieceTris = hit?.triangles ?? null;
    // Les réglages s'appliquent en direct : « Annuler » doit pouvoir revenir à
    // l'état d'avant, ou retirer l'ouvrant s'il vient d'être créé.
    const original: OwlnestPart = JSON.parse(JSON.stringify(part));
    const isNew = !(this.getParts?.() ?? []).some((p) => p.id === part.id);

    const inputStyle = 'width:100%;box-sizing:border-box;background:var(--ow-chrome2);border:1px solid var(--ow-line);border-radius:9px;color:var(--ow-text);padding:8px 10px;font-size:13px;outline:none;font-family:inherit;';

    /**
     * Chaque réglage prend effet tout de suite.
     *
     * Aucun de ces champs ne modifie la géométrie détachée : la carte peut donc
     * recalculer l'animation sans recharger le modèle. Si l'ouvrant n'est pas
     * encore monté (première ouverture du formulaire), on l'enregistre pour
     * qu'il le soit.
     */
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    // Rempli une fois les sections construites, plus bas.
    let refreshDigests: () => void = () => {};

    const apply = () => {
      if (closed) return;
      if (!this.onConfigurePart?.({ ...draft })) {
        void this._commitPart(draft, false);
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void this._commitPart(draft, false); }, 600);
      refreshReadout();
      refreshDigests();
    };

    const form = document.createElement('div');
    form.id = 'owlnest-part-modal';
    form.className = 'ow-ed ow-form';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', t('partTitle'));
    form.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); void cancel(); }
    });

    // ── En-tête : retour, nom, ce qu'on regarde ──────────────────────────
    const hdr = document.createElement('div');
    hdr.className = 'ow-form-h';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ow-ib';
    back.title = t('partBack');
    back.setAttribute('aria-label', t('partBack'));
    back.append(icon('back', 18));
    const titleCol = document.createElement('div');
    titleCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';
    const title = document.createElement('b');
    title.style.cssText = 'font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const subtitle = document.createElement('span');
    subtitle.style.cssText = 'font-size:12px;color:var(--ow-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    titleCol.append(title, subtitle);
    hdr.append(back, titleCol);
    const dims = hit ? `${hit.size.map((v) => v.toFixed(0)).join(' × ')} cm` : '';

    const body = document.createElement('div');
    body.className = 'ow-form-b';
    form.append(hdr, body);

    // ── Briques du formulaire ────────────────────────────────────────────
    /** Une carte de réglages ; `fold` la rend repliable (et retient son état). */
    const card = (label: string, iconName: string, fold?: { key: string; open: boolean }) => {
      const box = document.createElement(fold ? 'details' : 'section');
      box.className = 'ow-card';
      const head = document.createElement(fold ? 'summary' : 'div');
      head.className = 'ow-card-h';
      const name = document.createElement('b');
      name.textContent = label;
      const digest = document.createElement('span');
      digest.className = 'ow-digest';
      head.append(icon(iconName, 17), name, digest);
      if (fold) head.append(Object.assign(document.createElement('span'), { className: 'ow-chev' }));
      const inner = document.createElement('div');
      inner.className = 'ow-card-b';
      box.append(head, inner);
      if (fold && box instanceof HTMLDetailsElement) {
        box.open = this._partFold[fold.key] ?? fold.open;
        box.addEventListener('toggle', () => { this._partFold[fold.key] = box.open; });
      }
      body.appendChild(box);
      return { inner, digest, box };
    };

    const field = (label: string, control: HTMLElement, into: HTMLElement) => {
      const wrap = document.createElement('div');
      wrap.className = 'ow-field';
      const l = document.createElement('label');
      l.textContent = label;
      wrap.append(l, control);
      into.appendChild(wrap);
      return wrap;
    };

    const hintLine = (into: HTMLElement, text: string) => {
      const h = document.createElement('div');
      h.className = 'ow-hint-line';
      h.textContent = text;
      into.appendChild(h);
    };

    /** Des boutons côte à côte plutôt qu'une liste déroulante : tout se voit d'un coup d'œil. */
    const segmented = (
      options: ReadonlyArray<readonly [string, string, string?]>,
      value: string, onChange: (v: string) => void,
    ) => {
      const seg = document.createElement('div');
      seg.className = 'ow-seg';
      seg.setAttribute('role', 'radiogroup');
      for (const [v, lab, ic] of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        const on = v === value;
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('ow-on', on);
        if (ic) b.append(icon(ic, 16));
        b.append(document.createTextNode(lab));
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('ow-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
          onChange(v);
          apply();
        });
        seg.appendChild(b);
      }
      return seg;
    };

    const choice = (
      into: HTMLElement, label: string, options: ReadonlyArray<readonly [string, string]>,
      value: string, onChange: (v: string) => void,
    ) => field(label, segmented(options, value, onChange), into);

    const slider = (
      into: HTMLElement, label: string,
      min: number, max: number, step: number, value: number,
      format: (v: number) => string, onInput: (v: number) => void,
    ) => {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(min); range.max = String(max); range.step = String(step);
      range.value = String(value);
      range.setAttribute('aria-label', label);
      const out = document.createElement('span');
      out.className = 'ow-range-v';
      out.textContent = format(value);
      range.addEventListener('input', () => {
        out.textContent = format(range.valueAsNumber);
        onInput(range.valueAsNumber);
        apply();
      });
      const row = document.createElement('div');
      row.className = 'ow-range';
      row.append(range, out);
      return field(label, row, into);
    };

    /** Un interrupteur avec son libellé, sur une ligne. */
    const toggle = (into: HTMLElement, label: string, on: boolean, onChange: (v: boolean) => void, hint?: string) => {
      const row = document.createElement('div');
      row.className = 'ow-row-opt';
      const text = document.createElement('span');
      text.textContent = label;
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = `ow-switch${on ? ' ow-on' : ''}`;
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(on));
      sw.setAttribute('aria-label', label);
      if (hint) sw.title = hint;
      sw.addEventListener('click', () => {
        const next = !sw.classList.contains('ow-on');
        sw.classList.toggle('ow-on', next);
        sw.setAttribute('aria-checked', String(next));
        onChange(next);
      });
      row.append(text, sw);
      into.appendChild(row);
      return { row, set: (v: boolean) => { sw.classList.toggle('ow-on', v); sw.setAttribute('aria-checked', String(v)); } };
    };

    // ── Nom ───────────────────────────────────────────────────────────────
    // Laissé vide, la liste retombe sur le nom de l'entité : on le montre en
    // filigrane pour que ce repli soit visible.
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.style.cssText = inputStyle;
    nameInput.value = draft.label ?? '';
    const refreshName = () => {
      const friendly = this.getHass()?.states[draft.entity]?.attributes?.friendly_name;
      const fallback = (typeof friendly === 'string' && friendly) || draft.entity || t('partTitle');
      nameInput.placeholder = fallback;
      title.textContent = draft.label || fallback;
    };
    nameInput.addEventListener('input', () => {
      draft.label = nameInput.value.trim() || undefined;
      refreshName();
      apply();
    });
    const nameBox = document.createElement('div');
    nameBox.style.cssText = 'padding:2px 2px 0;';
    field(t('partName'), nameInput, nameBox);
    body.appendChild(nameBox);
    refreshName();

    // ── Capteur ───────────────────────────────────────────────────────────
    const secEntity = card(t('partSecEntity'), 'sensor');
    const sensor = this._sensorPicker(draft.entity, (id) => {
      draft.entity = id;
      refreshName();
      // L'entité change : les états proposés ne sont plus les mêmes.
      draft.openWhen = undefined;
      rebuildStates();
      apply();
    });
    secEntity.inner.appendChild(sensor.el);
    // « Ce qui bouge » juste après le capteur : c'est ce qu'on vérifie en premier.
    const secWhat = card(t('partSecWhat'), 'cube', { key: 'what', open: false });

    // Ce que la carte lit de cette entité : sans ça, une entité mal
    // interprétée ressemble à une panne.
    const readout = document.createElement('div');
    readout.className = 'ow-readout';
    secEntity.inner.appendChild(readout);

    const statesBox = document.createElement('div');
    secEntity.inner.appendChild(statesBox);

    const invToggle = toggle(secEntity.inner, t('partInvert'), !!draft.invert, (v) => {
      draft.invert = v || undefined;
      apply();
    });

    const currentFraction = (): { state: string | undefined; frac: number } => {
      const st = this.getHass()?.states[draft.entity];
      if (!draft.entity || !st) return { state: undefined, frac: 0 };
      let f = openFraction(draft.entity, st.state, st.attributes, draft.openWhen);
      if (draft.invert) f = 1 - f;
      return { state: st.state, frac: f };
    };

    const refreshReadout = () => {
      const { state, frac } = currentFraction();
      readout.innerHTML = '';
      // Sans capteur, le bouton du dessus le dit déjà.
      readout.style.display = draft.entity ? '' : 'none';
      const line = (text: string, cls = '') => {
        const d = document.createElement('div');
        if (cls) d.className = cls;
        d.textContent = text;
        readout.appendChild(d);
        return d;
      };
      if (!draft.entity) { line(t('partNoEntity'), 'ow-warn-t'); return; }
      if (state === undefined) { line(t('partEntityUnknown'), 'ow-warn-t'); return; }
      const label = stateLabel(draft.entity, state, this.getHass()?.states[draft.entity]?.attributes ?? {});
      const verdict = frac > 0.99 ? t('partReadOpen') : frac < 0.01 ? t('partReadClosed') : `${Math.round(frac * 100)} %`;
      const row = document.createElement('div');
      row.className = 'ow-readout-row';
      const now = document.createElement('span');
      now.textContent = `${t('partReadNow')} ${label}`;
      const pill = document.createElement('span');
      pill.className = `ow-state${frac > 0.5 ? ' ow-open' : ''}`;
      pill.textContent = verdict;
      row.append(now, pill);
      readout.appendChild(row);
      // Un domaine sans notion d'ouverture doit être signalé, pas subi : sinon
      // l'ouvrant reste immobile et rien n'explique pourquoi.
      if (!hasOpenSemantics(draft.entity) && !draft.openWhen?.length) line(t('partNeedsStates'), 'ow-warn-t');
    };

    // Quels états valent « ouvert ».
    const rebuildStates = () => {
      statesBox.innerHTML = '';
      if (!draft.entity) return;
      const st = this.getHass()?.states[draft.entity];
      const options = knownStates(draft.entity, st?.state);
      if (options.length < 2) return;
      const chips = document.createElement('div');
      chips.className = 'ow-chips';
      // Aucune sélection = lecture automatique par le descripteur. Le premier
      // clic bascule en choix explicite.
      for (const value of options) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `ow-chip2${draft.openWhen?.includes(value) ? ' ow-on' : ''}`;
        chip.textContent = stateLabel(draft.entity, value, st?.attributes ?? {});
        chip.addEventListener('click', () => {
          const set = new Set(draft.openWhen ?? []);
          if (set.has(value)) set.delete(value); else set.add(value);
          draft.openWhen = set.size ? [...set] : undefined;
          rebuildStates();
          apply();
        });
        chips.appendChild(chip);
      }
      const wrap = document.createElement('div');
      wrap.appendChild(chips);
      hintLine(wrap, draft.openWhen?.length ? t('partOpenWhenSet') : t('partOpenWhenAuto'));
      field(t('partOpenWhen'), wrap, statesBox);
    };

    // ── Essayer : faire bouger l'ouvrant sans toucher à la maison ─────────
    const secTry = card(t('partPreview'), 'play');
    const previewRange = document.createElement('input');
    previewRange.type = 'range'; previewRange.min = '0'; previewRange.max = '100'; previewRange.step = '1';
    previewRange.value = '0';
    previewRange.setAttribute('aria-label', t('partPreview'));
    const preview = (f: number) => this.onPreviewPart?.(draft.id, f);
    previewRange.addEventListener('input', () => preview(previewRange.valueAsNumber / 100));
    const ends = document.createElement('div');
    ends.className = 'ow-ends';
    ends.append(
      Object.assign(document.createElement('span'), { textContent: t('partReadClosed') }),
      Object.assign(document.createElement('span'), { textContent: t('partReadOpen') }),
    );
    const tryRow = document.createElement('div');
    tryRow.className = 'ow-range ow-big-range';
    tryRow.appendChild(previewRange);
    secTry.inner.append(tryRow, ends);
    hintLine(secTry.inner, t('partPreviewNote'));

    // ── Mouvement ─────────────────────────────────────────────────────────
    const secMotion = card(t('partSecMotion'), 'move');
    const clips = this.getClips?.() ?? [];
    const motions: [OwlnestPart['motion'], string, string, string][] = [
      ['swing', t('partSwingShort'), 'door', t('partSwing')],
      ['slide', t('partSlideShort'), 'slider', t('partSlide')],
      ['extend', t('partExtendShort'), 'awning', t('partExtend')],
    ];
    // Proposé seulement si le fichier en contient : sinon c'est un choix sans issue.
    if (clips.length || draft.motion === 'animation') motions.push(['animation', t('partAnimationShort'), 'play', t('partAnimation')]);
    const tiles = document.createElement('div');
    tiles.className = 'ow-tiles';
    tiles.setAttribute('role', 'radiogroup');
    tiles.setAttribute('aria-label', t('partMotion'));
    const paintTiles = () => tiles.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = b.dataset.motion === draft.motion;
      b.classList.toggle('ow-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    for (const [value, label, ic, long] of motions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.motion = value;
      b.setAttribute('role', 'radio');
      b.title = long;
      b.append(icon(ic, 22), document.createTextNode(label));
      b.addEventListener('click', () => {
        if (draft.motion === value) return;
        draft.motion = value;
        if (draft.motion !== 'animation') draft.clips = undefined;
        // Monté d'abord en déroulant : la détection lit l'ouvrant tel qu'il est.
        if (draft.motion === 'extend') { apply(); redetect(false); }
        paintTiles();
        rebuildSpecific();
        apply();
        objectSection?.refresh();
      });
      tiles.appendChild(b);
    }
    secMotion.inner.appendChild(tiles);
    paintTiles();

    const specific = document.createElement('div');
    secMotion.inner.appendChild(specific);

    // ── Déroulant ─────────────────────────────────────────────────────────
    // Les valeurs par défaut viennent de la géométrie montée : seuls les
    // écarts de l'utilisateur sont enregistrés.
    let extInfo: ExtendInfo | null = null;
    /** Relit la détection. `all` revient entièrement à la géométrie. */
    const redetect = (all: boolean) => {
      if (all) {
        draft.extendAxis = undefined;
        draft.extendTilt = undefined;
        draft.extendAnchor = undefined;
        draft.followers = undefined;
        apply();
      }
      extInfo = this.getExtendInfo?.(draft.id) ?? null;
      // Les suiveurs suggérés sont figés dans la configuration : la tablette
      // n'a pas à les rechercher à chaque chargement.
      if (extInfo && draft.followers === undefined) {
        draft.followers = extInfo.suggested;
        apply();
      }
      objectSection?.refresh();
    };

    const buildExtend = () => {
      if (!extInfo) redetect(false);
      const info = extInfo;
      if (!info) {
        // Ouvrant pas encore monté : son premier enregistrement est en cours.
        hintLine(specific, t('partExtendPending'));
        setTimeout(() => {
          if (closed || draft.motion !== 'extend' || extInfo) return;
          redetect(false);
          if (extInfo) rebuildSpecific();
        }, 700);
        return;
      }
      const detected = info.axis;
      const axis = draft.extendAxis ?? detected;
      const mark = (v: ExtendAxis, lab: string) => (v === detected ? `${lab} · ${t('partExtendDetected')}` : lab);
      choice(specific, t('partExtendAxis'), [
        ['out', mark('out', t('partExtendOut'))],
        ['vertical', mark('vertical', t('partExtendVertical'))],
        ['along', mark('along', t('partExtendAlong'))],
      ], axis, (v) => {
        draft.extendAxis = v === detected ? undefined : (v as ExtendAxis);
        rebuildSpecific();
      });

      if (axis === 'out') {
        const tilt = Math.round(info.tilt);
        slider(specific, t('partExtendTilt'), -90, 90, 1, Math.round(draft.extendTilt ?? info.tilt),
          (v) => `${v}°`, (v) => { draft.extendTilt = v === tilt ? undefined : v; });
        hintLine(specific, `${t('partExtendTiltHint')} ${tilt}°`);
      }

      const anchorLabels = axis === 'out'
        ? [t('partExtendAnchorWall'), t('partExtendAnchorFar')]
        : axis === 'vertical'
          ? [t('partExtendAnchorTop'), t('partExtendAnchorBottom')]
          : [t('partExtendAnchorStart'), t('partExtendAnchorEnd')];
      choice(specific, t('partExtendAnchor'), [['start', anchorLabels[0]], ['end', anchorLabels[1]]],
        draft.extendAnchor ?? 'start', (v) => { draft.extendAnchor = v === 'end' ? 'end' : undefined; });

      slider(specific, t('partExtendOpenScale'), 0, 150, 1, Math.round((draft.extendOpen ?? 1) * 100),
        (v) => `${v} %`, (v) => { draft.extendOpen = v === 100 ? undefined : v / 100; });
      slider(specific, t('partExtendClosedScale'), 0, 100, 1, Math.round((draft.extendClosed ?? 0) * 100),
        (v) => `${v} %`, (v) => { draft.extendClosed = v === 0 ? undefined : v / 100; });
      hintLine(specific, t('partExtendScaleHint'));

      // Même champ que « Inverser » : un volet qui rapporte 100 % fermé.
      choice(specific, t('partExtendClosedAt'), [
        ['0', t('partExtendClosedAt0')], ['100', t('partExtendClosedAt100')],
      ], draft.invert ? '100' : '0', (v) => {
        draft.invert = v === '100' || undefined;
        invToggle.set(!!draft.invert);
      });

      // ── Suiveurs ──
      const list = draft.followers ?? [];
      const same = (a: { node: string; nodeIndex?: number }, b: { node: string; nodeIndex?: number }) =>
        a.node === b.node && a.nodeIndex === b.nodeIndex;
      const setFollowers = (next: NonNullable<OwlnestPart['followers']>) => {
        draft.followers = next;
        rebuildSpecific();
        apply();
        objectSection?.refresh();
      };
      const box = document.createElement('div');
      const chips = document.createElement('div');
      chips.className = 'ow-chips';
      if (!list.length) {
        const none = document.createElement('span');
        none.className = 'ow-hint-line';
        none.textContent = t('partFollowersNone');
        chips.appendChild(none);
      }
      for (const f of list) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ow-chip2 ow-on';
        chip.textContent = `${f.node} ✕`;
        chip.addEventListener('click', () => setFollowers(list.filter((x) => x !== f)));
        chips.appendChild(chip);
      }
      const add = document.createElement('select');
      add.style.cssText = inputStyle + SELECT_STYLE + 'margin-top:6px;';
      const first = document.createElement('option');
      first.value = ''; first.textContent = t('partFollowersAdd');
      add.appendChild(styleOption(first));
      const offered = info.candidates.filter((c) => !list.some((f) => same(f, c)));
      offered.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${c.touching ? '★ ' : ''}${c.node}`;
        add.appendChild(styleOption(o));
      });
      add.addEventListener('change', () => {
        const c = offered[Number(add.value)];
        if (add.value === '' || !c) return;
        setFollowers([...list, { node: c.node, nodeIndex: c.nodeIndex }]);
      });
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'ow-btn ow-small';
      again.style.cssText = 'margin-top:8px;width:100%;';
      again.append(icon('rotl', 15), document.createTextNode(t('partExtendRedetect')));
      again.addEventListener('click', () => { redetect(true); rebuildSpecific(); });
      box.append(chips, add);
      hintLine(box, t('partFollowersHint'));
      box.append(again);
      field(t('partFollowers'), box, specific);
    };

    // ── Animations du fichier ─────────────────────────────────────────────
    const buildClips = () => {
      if (!clips.length) {
        hintLine(specific, t('partAnimationNone'));
        return;
      }
      const chosen = new Set(draft.clips ?? []);
      const setClips = (next: Set<string>) => {
        draft.clips = next.size ? [...next] : undefined;
        // Durée de Blender par défaut : l'animation se joue à sa vitesse d'origine.
        const longest = Math.max(0, ...clips.filter((c) => next.has(c.name)).map((c) => c.duration));
        if (longest > 0) draft.duration = Math.round(longest * 10) / 10;
        rebuildSpecific();
        apply();
        objectSection?.refresh();
      };
      const chips = document.createElement('div');
      chips.className = 'ow-chips';
      const chip = (label: string, on: boolean, missing: boolean, tip: string, onClick: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ow-chip2${on ? ' ow-on' : ''}${missing ? ' ow-miss' : ''}`;
        b.textContent = label;
        b.title = tip;
        b.addEventListener('click', onClick);
        chips.appendChild(b);
      };
      for (const c of clips) {
        const on = chosen.has(c.name);
        chip(`${c.name} · ${c.duration.toFixed(1)} s`, on, false, c.nodes.join(', '), () => {
          const next = new Set(chosen);
          if (on) next.delete(c.name); else next.add(c.name);
          setClips(next);
        });
      }
      // Animation renommée ou supprimée dans Blender : visible, et retirable.
      for (const name of chosen) {
        if (clips.some((c) => c.name === name)) continue;
        chip(`${name} ✕`, true, true, t('partAnimationMissing'), () => {
          const next = new Set(chosen);
          next.delete(name);
          setClips(next);
        });
      }
      field(t('partAnimationClips'), chips, specific);
      hintLine(specific, chosen.size ? t('partAnimationHint') : t('partAnimationPick'));
    };

    const rebuildSpecific = () => {
      specific.innerHTML = '';
      // Pour un déroulant, l'inversion se règle par « Fermé à ».
      invToggle.row.style.display = draft.motion === 'extend' ? 'none' : '';
      // Les animations désignent elles-mêmes ce qui bouge, et ne détachent rien
      // qui puisse emmener d'autres pièces.
      secWhat.box.style.display = draft.motion === 'animation' ? 'none' : '';
      if (draft.motion === 'animation') {
        buildClips();
      } else if (draft.motion === 'extend') {
        buildExtend();
      } else if (draft.motion === 'swing') {
        const horizontal = draft.swingAxis === 'horizontal';
        choice(specific, t('partSwingAxis'), [
          ['vertical', t('partSwingVertical')], ['horizontal', t('partSwingHorizontal')],
        ], horizontal ? 'horizontal' : 'vertical', (v) => {
          draft.swingAxis = v === 'horizontal' ? 'horizontal' : undefined;
          rebuildSpecific();
        });
        choice(specific, t('partHinge'), horizontal
          ? [['start', t('partHingeBottom')], ['end', t('partHingeTop')]]
          : [['start', t('partHingeStart')], ['end', t('partHingeEnd')]],
        draft.hinge ?? 'start', (v) => { draft.hinge = v as 'start' | 'end'; });
        choice(specific, t('partSwingSide'), [['front', t('partSwingFront')], ['back', t('partSwingBack')]],
          draft.swingSide ?? 'front', (v) => { draft.swingSide = v === 'back' ? 'back' : undefined; });
        slider(specific, t('partAngle'), 15, 170, 5, draft.angle ?? 90,
          (v) => `${v}°`, (v) => { draft.angle = v; });
      } else {
        field(t('partSlideDir'), segmented([
          ['down', t('partSlideDown'), 'down'], ['up', t('partSlideUp'), 'up'],
          ['start', t('partSlideStart'), 'back'], ['end', t('partSlideEnd'), 'chevron'],
        ], draft.slide ?? 'down', (v) => { draft.slide = v as OwlnestPart['slide']; }), specific);
        slider(specific, t('partTravel'), 20, 120, 5, Math.round((draft.travel ?? 1) * 100),
          (v) => `${v} %`, (v) => { draft.travel = v / 100; });
      }
      slider(specific, t('partDuration'), 0.1, 10, 0.1, draft.duration ?? 1.2,
        (v) => `${v.toFixed(1)} s`, (v) => { draft.duration = Math.max(0.1, Math.round(v * 10) / 10); });
    };

    // ── Couleurs selon l'état (repliée) ───────────────────────────────────
    const secLook = card(t('partSecLook'), 'brush', { key: 'look', open: false });

    // Même contrôle que la couleur d'une ancre ; le bouton revient au défaut,
    // qui est ici l'absence de teinte.
    const tintBox = document.createElement('div');
    let tintHover = false;
    const tintFocused = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement && a.type === 'color' && tintBox.contains(a);
    };
    tintBox.addEventListener('pointerenter', () => { tintHover = true; objectSection?.mute(true); });
    tintBox.addEventListener('pointerleave', () => {
      tintHover = false;
      if (!tintFocused()) objectSection?.mute(false);
    });
    const colorRow = (key: 'closedColor' | 'openColor', label: string, hint: string, fallback: string) => {
      const colorWrap = document.createElement('div');
      colorWrap.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = draft[key] ?? fallback;
      colorInput.setAttribute('aria-label', label);
      const noneBtn = document.createElement('button');
      noneBtn.type = 'button';
      noneBtn.textContent = t('partColorNone');
      const paint = () => {
        const on = !!draft[key];
        colorInput.style.cssText = `width:44px;height:34px;padding:0;border:1px solid var(--ow-line);border-radius:9px;background:transparent;cursor:pointer;opacity:${on ? 1 : 0.35};`;
        noneBtn.className = `ow-btn ow-small${on ? ' ow-ghost' : ''}`;
        noneBtn.style.flex = '1';
      };
      const set = (value: string | undefined) => {
        if (draft[key] === value) return;
        draft[key] = value;
        paint();
        apply();
      };
      // Rouvrir le sélecteur sur la couleur déjà affichée ne déclenche pas
      // `input` : le clic suffit donc à activer la teinte.
      colorInput.addEventListener('click', () => set(colorInput.value));
      colorInput.addEventListener('input', () => set(colorInput.value));
      colorInput.addEventListener('blur', () => { if (!tintHover) objectSection?.mute(false); });
      noneBtn.addEventListener('click', () => set(undefined));
      paint();
      colorWrap.append(colorInput, noneBtn);
      field(label, colorWrap, tintBox);
      hintLine(tintBox, hint);
    };
    colorRow('closedColor', t('partColorClosed'), t('partColorClosedHint'), '#22c55e');
    colorRow('openColor', t('partColorOpen'), t('partColorOpenHint'), '#f59e0b');
    slider(tintBox, t('partColorStrength'), 5, 100, 5, Math.round((draft.tintStrength ?? 0.55) * 100),
      (v) => `${v} %`, (v) => { draft.tintStrength = v === 55 ? undefined : v / 100; });
    hintLine(tintBox, t('partColorStrengthHint'));
    secLook.inner.appendChild(tintBox);

    // L'objet du modèle : l'arborescence, gardée pour les cas où le clic ne
    // suffit pas. Écrite pour l'ancien panneau, elle est agrandie d'un bloc.
    const objectSection = this._partObjectSection(draft, inputStyle, () => {
      // Autre objet : les suiveurs de l'ancien n'ont plus de sens.
      if (draft.motion === 'extend') draft.followers = undefined;
      apply();
      if (draft.motion === 'extend') { redetect(false); rebuildSpecific(); }
    });
    hintLine(secWhat.inner, t('partWhatHint'));
    const repick = document.createElement('button');
    repick.type = 'button';
    repick.className = 'ow-btn ow-small';
    repick.style.cssText = 'width:100%;margin-bottom:10px;';
    repick.append(icon('hand', 15), document.createTextNode(t('partRepick')));
    repick.addEventListener('click', () => {
      // Désigner une autre pièce : le formulaire se rouvre sur elle.
      flushAndClose();
      this._startPartPick();
    });
    secWhat.inner.appendChild(repick);
    if (objectSection) {
      const legacy = document.createElement('div');
      legacy.className = 'ow-legacy';
      legacy.appendChild(objectSection.el);
      secWhat.inner.appendChild(legacy);
    }

    // Les pièces qui suivent l'ouvrant, choisies au clic : sur un export plat,
    // une poignée n'est ni soudée au vantail ni groupée avec lui.
    const extraList = document.createElement('div');
    extraList.className = 'ow-chips';
    extraList.style.marginBottom = '8px';
    const fillExtra = () => {
      extraList.textContent = '';
      const pieces = draft.extra ?? [];
      if (!pieces.length) {
        const vide = document.createElement('span');
        vide.className = 'ow-hint-line';
        vide.textContent = t('partExtraEmpty');
        extraList.appendChild(vide);
        return;
      }
      pieces.forEach((piece, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ow-chip2 ow-on';
        chip.title = t('partExtraDrop');
        chip.textContent = `${piece.label || `${piece.mesh} · ${piece.triangle}`} ✕`;
        chip.addEventListener('click', () => {
          draft.extra = (draft.extra ?? []).filter((_, j) => j !== i);
          if (!draft.extra.length) draft.extra = undefined;
          fillExtra();
          apply();
        });
        extraList.appendChild(chip);
      });
    };
    const extraAdd = document.createElement('button');
    extraAdd.type = 'button';
    extraAdd.className = 'ow-btn ow-small';
    extraAdd.style.cssText = 'width:100%;margin-bottom:10px;';
    extraAdd.append(icon('plus', 15), document.createTextNode(t('partExtraAdd').replace(/^[+＋]\s*/, '')));
    extraAdd.addEventListener('click', () => {
      if (!this.onStartPartPicking) return;
      this.showStatusBar?.(t('partExtraPick'));
      this.onStartPartPicking((h) => {
        this.hideStatusBar?.();
        // La piece de l'ouvrant lui-meme n'a rien a faire dans la liste : elle
        // bouge deja, et l'extraire deux fois casserait la geometrie.
        if (h.mesh === draft.mesh && h.triangle === draft.triangle) return;
        const pieces = draft.extra ?? [];
        if (pieces.some((p) => p.mesh === h.mesh && p.triangle === h.triangle)) return;
        draft.extra = [...pieces, {
          mesh: h.mesh,
          meshIndex: h.meshIndex,
          triangle: h.triangle,
          label: `${h.size.map((v) => v.toFixed(0)).join(' × ')} cm`,
        }];
        fillExtra();
        apply();
      });
    });
    const extraBox = document.createElement('div');
    field(t('partExtra'), extraBox, secWhat.inner).title = t('partExtraHint');
    extraBox.append(extraList, extraAdd);
    fillExtra();
    const carryCount = document.createElement('div');
    carryCount.className = 'ow-hint-line';
    const showCarried = () => {
      const n = this.getCarriedCount?.(draft.id) ?? 0;
      carryCount.textContent = draft.carry !== true ? '' : (n ? tn('partCarryCount', n) : t('partCarryNone'));
    };
    toggle(secWhat.inner, t('partCarry'), draft.carry === true, (v) => {
      draft.carry = v ? true : undefined;
      apply();
      showCarried();
    }, t('partCarryHint'));
    secWhat.inner.appendChild(carryCount);
    showCarried();

    /**
     * Ce que chaque carte repliée dit d'elle : ce qui distingue cet ouvrant,
     * pas le nom du réglage.
     */
    refreshDigests = () => {
      const extras = draft.extra?.length ?? 0;
      const object = draft.node ?? (dims || t('partSecPiece'));
      secWhat.digest.textContent = extras ? `${object} + ${extras}` : object;
      const colours = [draft.closedColor, draft.openColor].filter(Boolean) as string[];
      secLook.digest.innerHTML = '';
      if (!colours.length) secLook.digest.textContent = t('partSecNoColour');
      for (const c of colours) {
        const dot = document.createElement('i');
        dot.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${c};margin-left:4px;vertical-align:middle;`;
        secLook.digest.appendChild(dot);
      }
      const motion = motions.find((m) => m[0] === draft.motion)?.[1] ?? draft.motion;
      subtitle.textContent = [motion, draft.entity ? '' : t('partNoEntity')].filter(Boolean).join(' · ');
    };
    refreshDigests();
    rebuildSpecific();

    // ── Pied : supprimer, annuler, enregistrer ────────────────────────────
    const foot = document.createElement('div');
    foot.className = 'ow-form-f';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ow-ib';
    del.title = t('partDelete');
    del.setAttribute('aria-label', t('partDelete'));
    del.style.color = '#f87171';
    del.append(icon('trash', 18));
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ow-btn ow-ghost';
    cancelBtn.textContent = t('btnCancel');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ow-btn ow-primary';
    ok.append(icon('check', 16), document.createTextNode(t('ruleModalSave')));
    foot.append(del, Object.assign(document.createElement('span'), { style: 'flex:1' }), cancelBtn, ok);
    form.appendChild(foot);

    const close = () => {
      if (saveTimer) clearTimeout(saveTimer);
      objectSection?.dispose();
      preview(0);
      if (this._closePartModal === flushAndClose) this._closePartModal = null;
      if (this._discardPartModal === close) { this._discardPartModal = null; this._partModalId = null; }
      closed = true;
      if (this._liveForm === live) this._liveForm = null;
      form.remove();
      if (this._partsBody) this._fillPartsList(this._partsBody);
    };
    const cancel = async () => {
      close();
      if (isNew) {
        const next = (this.getParts?.() ?? []).filter((p) => p.id !== original.id);
        await this.saveParts?.(next);
        if (this._partsBody) this._fillPartsList(this._partsBody);
      } else {
        this.onConfigurePart?.({ ...original });
        await this._commitPart(original, true);
      }
    };
    // Ouvrir un autre ouvrant pendant que celui-ci est affiché : on garde les
    // réglages déjà visibles à l'écran plutôt que de les perdre en silence.
    const flushAndClose = () => {
      close();
      void this._commitPart(draft, true);
    };
    this._closePartModal = flushAndClose;
    this._discardPartModal = close;
    this._partModalId = draft.id;
    const live = () => { refreshReadout(); sensor.refresh(); };
    this._liveForm = live;

    back.addEventListener('click', () => flushAndClose());
    cancelBtn.addEventListener('click', () => { void cancel(); });
    ok.addEventListener('click', async () => {
      await this._commitPart(draft, true);
      close();
    });
    del.addEventListener('click', () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.title = t('partDeleteConfirm');
        del.style.background = 'rgba(239,68,68,0.18)';
        setTimeout(() => { delete del.dataset.armed; del.title = t('partDelete'); del.style.background = ''; }, 3000);
        return;
      }
      close();
      const next = (this.getParts?.() ?? []).filter((p) => p.id !== draft.id);
      void this.saveParts?.(next).then(() => { if (this._partsBody) this._fillPartsList(this._partsBody); });
    });

    host.appendChild(form);
    objectSection?.reveal();
    nameInput.blur();

    // La pièce doit exister côté carte pour que l'aperçu et les réglages en
    // direct aient une cible.
    void this._commitPart(draft, false);
    rebuildStates();
    refreshReadout();
  }

  /** Section « Objet » repliée ou non, d'un formulaire à l'autre. */
  private _partObjectOpen = true;
  /** Sections depliees de la fenetre d'ouvrant, retenues entre deux ouvertures. */
  private _partFold: Record<string, boolean> = {};

  /**
   * Choix de l'objet animé, façon « Outliner » de Blender.
   *
   * L'arborescence est celle du modèle tel que chargé ; la pièce cliquée y
   * figure comme une feuille sous sa maille. Survoler une ligne teinte l'objet
   * dans la vue, la sélectionner en fait l'ouvrant — la carte le remonte en
   * direct, sans recharger le modèle.
   *
   * Toutes les lignes sont calculées, mais seule la fenêtre visible est
   * dessinée : un modèle à des milliers de nœuds reste fluide, et aucun objet
   * n'est hors d'atteinte.
   */
  private _partObjectSection(
    draft: OwlnestPart,
    inputStyle: string,
    onChange: () => void,
  ): {
    el: HTMLElement; dispose: () => void; reveal: () => void; mute: (on: boolean) => void; refresh: () => void;
  } | null {
    const outline = this.getModelOutline?.();
    if (!outline || outline.byRank.length === 0) return null;
    const PIECE = PIECE_ROW;
    const ROW_H = 21;
    const VIEW_H = 220;
    const OVERSCAN = 8;

    const { seed } = locatePart(outline, draft);
    const selectedRank = (): number | null => locatePart(outline, draft).selected;

    const expanded = new Set<number>(revealRanks(outline, { selected: selectedRank(), seed }));
    const reveal = (rank: number) => { for (const a of ancestorsOf(outline, rank)) expanded.add(a); };
    /** Replis demandés pendant un filtrage, qui sinon déplie d'office. */
    let collapsed = new Set<number>();
    let query = '';

    // ── Surlignage ──────────────────────────────────────────────────────
    const pieceTarget = (): PartHighlightTarget => ({
      part: draft.node ? undefined : draft.id,
      mesh: seed?.meshRank, triangle: draft.triangle,
    });
    const selectedTarget = (): PartHighlightTarget => {
      const r = selectedRank();
      const followers = draft.motion === 'extend'
        ? (draft.followers ?? []).map((f) => f.nodeIndex).filter((n): n is number => n !== undefined)
        : undefined;
      return { part: draft.id, node: r ?? undefined, mesh: seed?.meshRank, triangle: draft.triangle, followers };
    };
    let hover: PartHighlightTarget | null = null;
    let muted = false;
    const highlight = () => this.onHighlightPart?.(
      muted ? { hover: null, selected: null } : { hover, selected: selectedTarget() },
    );

    // ── Structure ───────────────────────────────────────────────────────
    const box = document.createElement('details');
    box.open = this._partObjectOpen;
    box.style.cssText = 'margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;background:rgba(255,255,255,0.02);';
    const head = document.createElement('summary');
    head.style.cssText = 'cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;padding:7px 9px;user-select:none;';
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    chevron.style.cssText = 'font-size:8px;color:#475569;transition:transform .15s;display:inline-block;';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;';
    label.textContent = t('partObject');
    const summary = document.createElement('span');
    summary.style.cssText = 'flex:1;min-width:0;text-align:right;font-size:10px;color:#fdba74;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    head.append(chevron, label, summary);
    box.appendChild(head);
    const paintHead = () => { chevron.style.transform = box.open ? 'rotate(90deg)' : 'none'; };
    box.addEventListener('toggle', () => { this._partObjectOpen = box.open; paintHead(); });
    paintHead();

    const inner = document.createElement('div');
    inner.style.cssText = 'padding:0 9px 9px;';
    box.appendChild(inner);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = t('partObjectFilter');
    filter.style.cssText = inputStyle + 'flex:1;width:auto;';
    const parentBtn = document.createElement('button');
    parentBtn.textContent = '↑';
    parentBtn.title = t('partObjectParent');
    parentBtn.style.cssText = 'flex-shrink:0;width:28px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#cbd5e1;cursor:pointer;font-size:12px;font-family:inherit;';
    bar.append(filter, parentBtn);
    inner.appendChild(bar);

    // Hauteur fixée, pas plafonnée : la fenêtre à dessiner se déduit de
    // `clientHeight`, qui doit valoir quelque chose avant le premier dessin.
    const tree = document.createElement('div');
    tree.style.cssText = `position:relative;height:${VIEW_H}px;overflow-y:auto;border-radius:6px;background:rgba(0,0,0,0.25);font-size:11px;`;
    const spacer = document.createElement('div');
    spacer.style.cssText = 'position:relative;';
    tree.appendChild(spacer);
    inner.appendChild(tree);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:9px;color:#64748b;line-height:1.5;margin-top:5px;';
    hint.textContent = t('partObjectHint');
    inner.appendChild(hint);

    // ── Sélection ───────────────────────────────────────────────────────
    const select = (rank: number) => {
      if (rank === PIECE) { draft.node = undefined; draft.nodeIndex = undefined; }
      else {
        const n = outline.byRank[rank];
        draft.node = n.name;
        draft.nodeIndex = n.rank;
      }
      rebuild();
      onChange();
      highlight();
    };
    parentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const r = selectedRank();
      const target = r === null ? seed : outline.byRank[r].parent;
      if (!target) return;
      reveal(target.rank);
      select(target.rank);
      pendingReveal = true;
      tryReveal();
    });

    const trisLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} k` : String(n));

    const row = (
      rank: number, depth: number, name: string, icon: string, tris: number,
      toggle: 'open' | 'closed' | null, dim: boolean, title: string, sel: boolean,
    ) => {
      const el = document.createElement('div');
      el.dataset.rank = String(rank);
      el.title = title;
      el.style.cssText = [
        'position:absolute', 'left:0', 'right:0',
        'display:flex', 'align-items:center', 'gap:4px', `height:${ROW_H}px`, 'cursor:pointer',
        `padding:0 6px 0 ${4 + depth * 12}px`, 'white-space:nowrap',
        sel ? 'background:rgba(255,140,26,0.22)' : '',
        sel ? 'box-shadow:inset 2px 0 0 #ff8c1a' : '',
        `color:${sel ? '#ffd9b0' : dim ? '#64748b' : '#cbd5e1'}`,
      ].filter(Boolean).join(';');
      const tg = document.createElement('span');
      tg.dataset.toggle = String(rank);
      tg.textContent = toggle === 'open' ? '▾' : toggle === 'closed' ? '▸' : '';
      tg.style.cssText = 'width:12px;flex-shrink:0;text-align:center;font-size:9px;color:#64748b;';
      const ic = document.createElement('span');
      ic.textContent = icon;
      ic.style.cssText = `width:13px;flex-shrink:0;text-align:center;font-size:10px;color:${rank === PIECE ? '#fdba74' : '#7dd3fc'};`;
      const nm = document.createElement('span');
      nm.textContent = name;
      nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;';
      const tr = document.createElement('span');
      tr.textContent = tris ? trisLabel(tris) : '';
      tr.style.cssText = 'flex-shrink:0;font-size:9px;color:#475569;font-variant-numeric:tabular-nums;';
      el.append(tg, ic, nm, tr);
      return el;
    };

    let rows: OutlineRow[] = [];
    let f = filterOutline(outline, '');
    let current: number | null = null;

    /** Dessine les seules lignes visibles, placées à leur hauteur dans la liste. */
    const paint = () => {
      const view = tree.clientHeight || VIEW_H;
      const first = Math.max(0, Math.floor(tree.scrollTop / ROW_H) - OVERSCAN);
      const last = Math.min(rows.length, Math.ceil((tree.scrollTop + view) / ROW_H) + OVERSCAN);
      const frag = document.createDocumentFragment();
      for (let i = first; i < last; i++) {
        const { rank, node, depth, hasKids, open } = rows[i];
        const toggle = hasKids ? (open ? 'open' : 'closed') : null;
        // La pièce cliquée, feuille virtuelle sous sa maille.
        const el = node
          ? row(rank, depth, node.name, node.meshRank >= 0 ? '△' : '▣', node.tris, toggle,
            !!f.visible && !f.matches.has(rank),
            node.material ? `${node.name} · ${node.material}` : node.name, current === rank)
          : row(PIECE, depth, t('partObjectPiece'), '◆', this._pieceTris ?? 0,
            null, false, t('partObjectPieceHint'), current === null);
        el.style.top = `${i * ROW_H}px`;
        frag.appendChild(el);
      }
      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:8px 10px;color:#64748b;font-size:10px;';
        empty.textContent = t('partObjectNone');
        frag.appendChild(empty);
      }
      spacer.replaceChildren(frag);
    };

    /** Recalcule la liste — dépliage, filtre ou sélection ont changé. */
    const rebuild = () => {
      f = filterOutline(outline, query);
      for (const r of collapsed) f.expand.delete(r);
      const effective = new Set([...expanded].filter((r) => !collapsed.has(r)));
      rows = outlineRows(outline, effective, f, seed);
      current = selectedRank();
      spacer.style.height = `${rows.length * ROW_H}px`;

      const n = current !== null ? outline.byRank[current] : null;
      summary.textContent = n ? `${n.name} · ${trisLabel(n.tris)}` : `${t('partObjectPiece')}${seed ? ` · ${seed.name}` : ''}`;
      parentBtn.disabled = n ? !n.parent : !seed;
      parentBtn.style.opacity = parentBtn.disabled ? '0.35' : '1';
      paint();
    };

    /**
     * Amène la sélection au centre de la liste.
     *
     * Rien ne se mesure tant que la liste n'est pas affichée : formulaire pas
     * encore ouvert, ou section repliée. La demande reste alors en attente et
     * se rejoue à l'ouverture de la section.
     */
    let pendingReveal = true;
    const tryReveal = () => {
      if (!pendingReveal || !box.open || !tree.isConnected || tree.clientHeight === 0) return;
      pendingReveal = false;
      const idx = rows.findIndex((r) => r.rank === (current ?? PIECE));
      if (idx < 0) return;
      tree.scrollTop = centredScrollTop(idx, ROW_H, tree.clientHeight, rows.length);
      paint();
    };
    box.addEventListener('toggle', () => { if (box.open) requestAnimationFrame(tryReveal); });

    let paintQueued = false;
    tree.addEventListener('scroll', () => {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(() => { paintQueued = false; paint(); });
    });

    // ── Évènements, délégués au conteneur ───────────────────────────────
    const rankAt = (e: Event): number | null => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-rank]');
      return el ? Number(el.dataset.rank) : null;
    };
    tree.addEventListener('click', (e) => {
      const tg = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
      if (tg && tg.textContent) {
        const r = Number(tg.dataset.toggle);
        const isOpen = rows.find((x) => x.rank === r)?.open ?? false;
        if (isOpen) { expanded.delete(r); collapsed.add(r); } else { expanded.add(r); collapsed.delete(r); }
        rebuild();
        return;
      }
      const r = rankAt(e);
      if (r !== null) select(r);
    });
    tree.addEventListener('mouseover', (e) => {
      const r = rankAt(e);
      const next = r === null ? null : r === PIECE ? pieceTarget() : { node: r };
      if (JSON.stringify(next) === JSON.stringify(hover)) return;
      hover = next;
      highlight();
    });
    tree.addEventListener('mouseleave', () => { hover = null; highlight(); });

    let filterTimer: ReturnType<typeof setTimeout> | null = null;
    filter.addEventListener('input', () => {
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        query = filter.value;
        collapsed = new Set();
        tree.scrollTop = 0;
        rebuild();
      }, 80);
    });
    // Le formulaire intercepte Échap pour « Annuler » : dans le champ, Échap
    // vide d'abord le filtre.
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filter.value) {
        e.preventDefault();
        e.stopPropagation();
        filter.value = '';
        query = '';
        collapsed = new Set();
        rebuild();
        pendingReveal = true;
        tryReveal();
      }
    });

    rebuild();
    highlight();

    return {
      el: box,
      dispose: () => {
        if (filterTimer) clearTimeout(filterTimer);
        this.onHighlightPart?.({ hover: null, selected: null });
      },
      // Appelé une fois le formulaire affiché ; l'image suivante rattrape un
      // affichage encore en cours de mise en page.
      reveal: () => { tryReveal(); requestAnimationFrame(tryReveal); },
      // Le surlignage masquerait la teinte qu'on est en train de régler.
      mute: (on: boolean) => {
        if (on === muted) return;
        muted = on;
        highlight();
      },
      refresh: () => highlight(),
    };
  }

  /** Taille de la pièce cliquée, reprise du dernier clic pour l'arborescence. */
  private _pieceTris: number | null = null;

  /** Enregistre le brouillon. `refreshList` évite de redessiner à chaque réglage. */
  private async _commitPart(draft: OwlnestPart, refreshList: boolean) {
    const current = this.getParts?.() ?? [];
    const exists = current.some((p) => p.id === draft.id);
    const next = exists
      ? current.map((p) => (p.id === draft.id ? { ...draft } : p))
      : [...current, { ...draft }];
    await this.saveParts?.(next);
    if (refreshList && this._partsBody) this._fillPartsList(this._partsBody);
  }

  private _openRuleModal(existing: OwlnestRule | null, onSaved: () => void) {
    this._panel?.querySelector('#owlnest-rule-modal')?.remove();
    const host = this._panel;
    if (!host) return;
    if (this._narrow) this._setPanelOpen(true);

    const inputStyle = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;padding:5px 8px;font-size:11px;outline:none;font-family:inherit;';
    const lblStyle   = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;display:block;';
    const fieldStyle = 'margin-bottom:10px;';
    const hass = this.getHass();
    const views = this.getViews?.() ?? [];
    const cards = this.getCards?.() ?? [];

    // Working copy
    const draft: OwlnestRule = existing
      ? normalizeRule(JSON.parse(JSON.stringify(existing)) as OwlnestRule)
      : {
          id: `rule_${Date.now()}`,
          label: '',
          enabled: true,
          triggers: [{ type: 'entity_state', entity_id: '' }],
          conditions: [],
          logic: 'and',
          actions: [],
        };
    draft.triggers ??= [];
    draft.conditions ??= [];

    // Dans le panneau, élargi le temps de l'édition : la règle se lit comme
    // une phrase et a besoin de place pour ses morceaux.
    const dialog = document.createElement('div');
    dialog.id = 'owlnest-rule-modal';
    dialog.className = 'ow-ed ow-form';
    dialog.setAttribute('role', 'dialog');
    dialog.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
    });
    const closeForm = () => {
      dialog.remove();
      this._setPanelWidth(PANEL_W);
    };
    this._setPanelWidth(RULE_PANEL_W);

    const hdrEl = document.createElement('div');
    hdrEl.className = 'ow-form-h';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'ow-ib';
    backBtn.title = t('ruleModalClose');
    backBtn.setAttribute('aria-label', t('ruleModalClose'));
    backBtn.append(icon('back', 18));
    backBtn.addEventListener('click', closeForm);
    const hdrTitle = document.createElement('b');
    hdrTitle.style.cssText = 'font-size:15px;flex:1;';
    hdrTitle.textContent = existing ? t('ruleModalEdit') : t('ruleModalNew');
    hdrEl.append(backBtn, hdrTitle);
    dialog.appendChild(hdrEl);

    // Le contenu garde ses morceaux de phrase, écrits pour l'ancienne fenêtre.
    const bodyEl = document.createElement('div');
    bodyEl.className = 'ow-form-b';
    const bodyInner = document.createElement('div');
    bodyInner.className = 'ow-rule-body';
    bodyEl.appendChild(bodyInner);
    dialog.appendChild(bodyEl);

    const mk = (tag: string) => document.createElement(tag);
    const mkLbl = (text: string) => {
      const l = mk('label') as HTMLLabelElement;
      l.style.cssText = lblStyle; l.textContent = text; return l;
    };
    const mkInp = (val: string, placeholder = '') => {
      const i = mk('input') as HTMLInputElement;
      i.value = val; i.placeholder = placeholder; i.style.cssText = inputStyle; return i;
    };
    const mkEntityInput = (val: string, _uid: string) => {
      const { wrap, input } = this._entityField(val, inputStyle, () => {});
      input.value = val;
      return { wrap, input };
    };
    const secHdr = (text: string) => {
      const d = mk('div') as HTMLDivElement;
      d.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      d.textContent = text; return d;
    };

    // ── Vocabulaire visuel ───────────────────────────────────────────────────
    // Une règle se lit comme une phrase : « Porte d'entrée passe à Ouverte ».
    // Les champs sont donc des mots dans la phrase, pas des cases d'un
    // formulaire empilé.

    const PILL = 'background:var(--ow-chrome2);border:1px solid var(--ow-line);border-radius:9px;color:var(--ow-text);padding:7px 10px;font-size:13px;font-family:inherit;cursor:pointer;outline:none;color-scheme:dark;';
    const WORD = 'font-size:13px;color:var(--ow-muted);';
    const LINK = 'background:none;border:none;color:var(--ow-acc);font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;padding:3px 0;text-align:left;';

    const nameOf = (id: string) => {
      if (!id) return '';
      const fn = hass?.states[id]?.attributes?.friendly_name;
      return (typeof fn === 'string' && fn) ? fn : (id.split('.')[1] ?? id);
    };

    const word = (text: string) => {
      const s = mk('span') as HTMLSpanElement;
      s.style.cssText = WORD; s.textContent = text; return s;
    };

    /** Ligne-phrase : les éléments s'enchaînent et passent à la ligne au besoin. */
    const sentence = (...els: HTMLElement[]) => {
      const r = mk('div') as HTMLDivElement;
      r.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px;';
      els.forEach((e) => r.appendChild(e));
      return r;
    };

    /** Liste déroulante compacte, dimensionnée par son contenu. */
    const pillSel = (options: [string, string][], value: string, onChange: (v: string) => void) => {
      const sel = mk('select') as HTMLSelectElement;
      sel.style.cssText = PILL + 'width:auto;';
      for (const [v, l] of options) {
        const o = mk('option') as HTMLOptionElement;
        o.value = v; o.textContent = l;
        styleOption(o);
        sel.appendChild(o);
      }
      sel.value = value;
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };

    /**
     * Bouton portant le nom lisible d'une entité, qui ouvre le sélecteur.
     * Bien plus lisible qu'un `entity_id` brut au milieu d'une phrase.
     */
    const entityPill = (value: string, onPick: (id: string) => void) => {
      const b = mk('button') as HTMLButtonElement;
      b.style.cssText = PILL;
      const paint = (v: string) => {
        b.textContent = v ? nameOf(v) : t('ruleChoose');
        b.style.color = v ? 'var(--ow-text)' : 'var(--ow-muted)';
      };
      paint(value);
      b.addEventListener('click', () => {
        if (!hass) return;
        openEntityPicker({
          container: this.overlayContainer,
          hass,
          onPick: (id) => { paint(id); onPick(id); },
        });
      });
      return b;
    };

    /**
     * Ancres réellement présentes dans la scène.
     *
     * Une action « mettre en évidence » ne peut viser qu'une ancre existante :
     * proposer le catalogue d'entités de HA laisserait choisir des cibles qui
     * n'apparaissent nulle part, donc des actions muettes.
     *
     * La valeur retenue est l'`entity_id` quand il y en a un, sinon le libellé —
     * c'est ainsi que la carte résout la cible à l'exécution.
     */
    const anchorOptions = (current: string): [string, string][] => {
      const out: [string, string][] = [['', t('ruleChoose')]];
      const seen = new Set<string>();
      this.getEditor()?.anchors.forEach((a) => {
        const value = a.entity || a.label;
        if (!value || seen.has(value)) return;
        seen.add(value);
        const kind = a.kind ?? 'entity';
        const name = a.label || nameOf(a.entity) || value;
        out.push([value, kind === 'entity' ? name : `${name} · ${KIND_LABEL[kind]()}`]);
      });
      // Une cible enregistrée dont l'ancre a été supprimée reste visible, sinon
      // ouvrir la règle l'effacerait en silence.
      if (current && !seen.has(current)) out.push([current, `${current} ⚠`]);
      return out;
    };

    const stateOptions = (entityId: string, value: string | undefined): [string, string][] => {
      const st = entityId ? hass?.states[entityId] : undefined;
      const opts: [string, string][] = [['', t('ruleAnyState')]];
      for (const s of knownStates(entityId, st?.state)) {
        opts.push([s, stateLabel(entityId, s, st?.attributes ?? {})]);
      }
      if (value && !opts.some(([v]) => v === value)) opts.push([value, value]);
      return opts;
    };

    const numInput = (value: number | undefined, ph: string, onChange: (n: number | undefined) => void) => {
      const i = mk('input') as HTMLInputElement;
      i.type = 'number'; i.placeholder = ph;
      i.value = value !== undefined ? String(value) : '';
      i.style.cssText = PILL + 'width:74px;';
      i.addEventListener('input', () => {
        const n = parseFloat(i.value);
        onChange(Number.isFinite(n) ? n : undefined);
      });
      return i;
    };

    const linkBtn = (label: string, onClick: () => void) => {
      const b = mk('button') as HTMLButtonElement;
      b.textContent = label; b.style.cssText = LINK;
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    };

    const removeBtn = (onClick: () => void) => {
      const b = mk('button') as HTMLButtonElement;
      b.type = 'button';
      b.className = 'ow-ib';
      b.title = t('ruleRemove');
      b.setAttribute('aria-label', t('ruleRemove'));
      b.style.cssText = 'width:30px;height:30px;color:#f87171;margin-left:auto;';
      b.append(icon('trash', 15));
      b.addEventListener('click', onClick);
      return b;
    };

    /** Bloc coloré d'une phase de la règle. */
    const PHASE_ICON: Record<string, string> = { '⚡': 'bolt', '⊘': 'eyeOff', '▶': 'play' };
    const phase = (accent: string, tint: string, glyph: string, title: string) => {
      const box = mk('div') as HTMLDivElement;
      box.className = 'ow-card';
      box.style.cssText = `padding:12px;margin-bottom:10px;background:color-mix(in srgb, ${tint} 100%, var(--ow-chrome2));`;
      const hdr = mk('div') as HTMLDivElement;
      hdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
      const ic = icon(PHASE_ICON[glyph] ?? 'bolt', 17);
      ic.style.color = accent;
      const tt = mk('span') as HTMLSpanElement;
      tt.textContent = title;
      tt.style.cssText = 'font-size:13.5px;font-weight:700;color:var(--ow-text);';
      hdr.append(ic, tt);
      box.appendChild(hdr);
      const body = mk('div') as HTMLDivElement;
      box.appendChild(body);
      return { box, body };
    };

    // Le resume automatique sert de suggestion pour le nom. Il est recalcule a
    // chaque modification : fige, il affichait « aucune action » sur une regle
    // qui en avait.
    let syncNamePlaceholder = () => {};

    // ── Exemples de départ ───────────────────────────────────────────────────
    if (!existing) {
      const tplTitle = mk('div') as HTMLDivElement;
      tplTitle.style.cssText = 'font-size:12px;font-weight:600;color:var(--ow-muted);margin-bottom:8px;';
      tplTitle.textContent = t('ruleTplTitle');
      bodyInner.appendChild(tplTitle);

      const tplRow = mk('div') as HTMLDivElement;
      tplRow.className = 'ow-chips';
      tplRow.style.marginBottom = '14px';

      const templates: Array<[string, () => void]> = [
        [t('ruleTplDoor'), () => {
          draft.triggers = [{ type: 'entity_state', entity_id: '', to: 'on' }];
          draft.actions = [{ type: 'go_to_view', view_id: '' }, { type: 'highlight_anchor', anchor: '' }];
        }],
        [t('ruleTplLeak'), () => {
          draft.triggers = [{ type: 'entity_state', entity_id: '', to: 'on' }];
          draft.actions = [
            { type: 'toast', message: t('ruleTplLeakMsg'), level: 'warn' },
            { type: 'highlight_anchor', anchor: '' },
          ];
        }],
        [t('ruleTplTime'), () => {
          draft.triggers = [{ type: 'time', at: '22:00' }];
          draft.actions = [{ type: 'go_to_view', view_id: '' }];
        }],
        [t('ruleTplEmpty'), () => {
          draft.triggers = [{ type: 'entity_state', entity_id: '' }];
          draft.actions = [];
        }],
      ];

      templates.forEach(([label, apply], i) => {
        const c = mk('button') as HTMLButtonElement;
        c.type = 'button';
        c.textContent = label;
        c.className = i === templates.length - 1 ? 'ow-chip2' : 'ow-chip2 ow-on';
        c.addEventListener('click', () => {
          apply();
          renderTriggers(); renderConditions(); renderActions();
        });
        tplRow.appendChild(c);
      });
      bodyInner.appendChild(tplRow);
    }

    // ── Quand ────────────────────────────────────────────────────────────────
    const whenPhase = phase('#378ADD', 'rgba(56,138,221,0.09)', '⚡', t('ruleWhen'));
    bodyInner.appendChild(whenPhase.box);

    const renderTriggers = () => {
      whenPhase.body.innerHTML = '';
      (draft.triggers ?? []).forEach((trg, idx) => {
        const block = mk('div') as HTMLDivElement;
        block.style.cssText = idx > 0 ? 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);' : '';

        const kindSel = pillSel([
          ['entity_state', t('ruleTrigState')],
          ['numeric_state', t('ruleTrigNumeric')],
          ['time', t('ruleTrigTime')],
        ], trg.type, (v) => {
          draft.triggers![idx] = v === 'time'
            ? { type: 'time', at: '22:00' }
            : v === 'numeric_state'
              ? { type: 'numeric_state', entity_id: '', above: 20 }
              : { type: 'entity_state', entity_id: '' };
          renderTriggers();
        });

        const head = sentence(kindSel);
        if ((draft.triggers ?? []).length > 1) {
          head.appendChild(removeBtn(() => { draft.triggers!.splice(idx, 1); renderTriggers(); }));
        }
        block.appendChild(head);

        if (trg.type === 'time') {
          const inp = mk('input') as HTMLInputElement;
          inp.type = 'time'; inp.value = trg.at;
          inp.style.cssText = PILL + 'width:auto;';
          inp.addEventListener('input', () => { (draft.triggers![idx] as typeof trg).at = inp.value; });
          block.appendChild(sentence(word(t('ruleAtWord')), inp));
        } else if (trg.type === 'entity_state') {
          block.appendChild(sentence(
            entityPill(trg.entity_id, (id) => {
              (draft.triggers![idx] as typeof trg).entity_id = id;
              renderTriggers();
            }),
            word(t('rulePassesTo')),
            pillSel(stateOptions(trg.entity_id, trg.to), trg.to ?? '',
              (v) => { (draft.triggers![idx] as typeof trg).to = v || undefined; }),
          ));
        } else {
          block.appendChild(sentence(
            entityPill(trg.entity_id, (id) => {
              (draft.triggers![idx] as typeof trg).entity_id = id;
              renderTriggers();
            }),
            pillSel([['above', t('ruleGoesAbove')], ['below', t('ruleGoesBelow')]],
              trg.below !== undefined && trg.above === undefined ? 'below' : 'above',
              (v) => {
                const cur = draft.triggers![idx] as typeof trg;
                const n = cur.above ?? cur.below ?? 0;
                draft.triggers![idx] = v === 'above'
                  ? { ...cur, above: n, below: undefined }
                  : { ...cur, below: n, above: undefined };
                renderTriggers();
              }),
            numInput(trg.above ?? trg.below, '20', (n) => {
              const cur = draft.triggers![idx] as typeof trg;
              if (cur.below !== undefined && cur.above === undefined) cur.below = n;
              else cur.above = n;
            }),
          ));
          const attrLine = mk('div') as HTMLDivElement;
          const attrInp = mk('input') as HTMLInputElement;
          attrInp.placeholder = t('ruleAttributePh');
          attrInp.value = trg.attribute ?? '';
          attrInp.style.cssText = PILL + 'width:150px;';
          attrInp.addEventListener('input', () => {
            (draft.triggers![idx] as typeof trg).attribute = attrInp.value.trim() || undefined;
          });
          attrLine.appendChild(sentence(word(t('ruleOnAttribute')), attrInp));
          block.appendChild(attrLine);
        }

        // Durée : repliée derrière un lien, parce qu'elle est rarement utile.
        if (trg.type !== 'time') {
          const holdWrap = mk('div') as HTMLDivElement;
          const showHold = trg.for !== undefined;
          if (showHold) {
            holdWrap.appendChild(sentence(
              word(t('ruleAndStaysFor')),
              numInput(Math.round((trg.for ?? 0) / 60) || 1, '5', (n) => {
                (draft.triggers![idx] as { for?: number }).for = n ? Math.round(n * 60) : undefined;
              }),
              word(t('ruleMinutes')),
              removeBtn(() => { (draft.triggers![idx] as { for?: number }).for = undefined; renderTriggers(); }),
            ));
          } else {
            holdWrap.appendChild(linkBtn(t('ruleAndStays'), () => {
              (draft.triggers![idx] as { for?: number }).for = 300;
              renderTriggers();
            }));
          }
          block.appendChild(holdWrap);
        }

        whenPhase.body.appendChild(block);
      });

      const more = mk('div') as HTMLDivElement;
      more.style.cssText = 'margin-top:9px;';
      more.appendChild(linkBtn(t('ruleOrSomethingElse'), () => {
        draft.triggers = [...(draft.triggers ?? []), { type: 'entity_state', entity_id: '' }];
        renderTriggers();
      }));
      whenPhase.body.appendChild(more);
      syncNamePlaceholder();
    };

    // ── Si (optionnel) ───────────────────────────────────────────────────────
    const ifHost = mk('div') as HTMLDivElement;
    bodyInner.appendChild(ifHost);

    const OPS: [string, string][] = [
      ['eq', t('ruleOpIs')], ['neq', t('ruleOpIsNot')],
      ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'],
      ['contains', t('ruleOpContains')],
    ];

    const renderConditions = () => {
      ifHost.innerHTML = '';
      const conds = draft.conditions ?? [];

      // Vide : une seule ligne discrète, pas une section entière.
      if (!conds.length) {
        const idle = mk('div') as HTMLDivElement;
        idle.style.cssText = 'padding:10px 12px;margin-bottom:10px;border-radius:12px;border:1px dashed var(--ow-line);display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        idle.appendChild(word(t('ruleOnlyIf')));
        idle.appendChild(linkBtn(t('ruleAddConditionLink'), () => {
          draft.conditions = [{ entity_id: '', operator: 'eq', value: '' }];
          renderConditions();
        }));
        ifHost.appendChild(idle);
        syncNamePlaceholder();
        return;
      }

      const p = phase('#888780', 'rgba(136,135,128,0.09)', '⊘', t('ruleIf'));
      ifHost.appendChild(p.box);

      // Le ET/OU n'a de sens qu'à partir de deux conditions.
      if (conds.length > 1) {
        p.body.appendChild(sentence(
          word(t('ruleNeed')),
          pillSel([['and', t('ruleLogicAnd')], ['or', t('ruleLogicOr')]], draft.logic ?? 'and',
            (v) => { draft.logic = v as 'and' | 'or'; }),
        ));
      }

      conds.forEach((cond, idx) => {
        const block = mk('div') as HTMLDivElement;
        block.style.cssText = idx > 0 ? 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);' : '';

        if (cond.type === 'time') {
          const after = mk('input') as HTMLInputElement;
          after.type = 'time'; after.value = cond.after ?? '';
          after.style.cssText = PILL + 'width:auto;';
          after.addEventListener('input', () => { (draft.conditions![idx] as typeof cond).after = after.value || undefined; });
          const before = mk('input') as HTMLInputElement;
          before.type = 'time'; before.value = cond.before ?? '';
          before.style.cssText = PILL + 'width:auto;';
          before.addEventListener('input', () => { (draft.conditions![idx] as typeof cond).before = before.value || undefined; });
          const row = sentence(word(t('ruleBetween')), after, word(t('ruleAndWord')), before);
          row.appendChild(removeBtn(() => { draft.conditions!.splice(idx, 1); renderConditions(); }));
          block.appendChild(row);
        } else {
          const row = sentence(
            entityPill(cond.entity_id, (id) => {
              (draft.conditions![idx] as { entity_id: string }).entity_id = id;
              renderConditions();
            }),
            pillSel(OPS, cond.operator, (v) => {
              (draft.conditions![idx] as typeof cond).operator = v as typeof cond.operator;
            }),
            pillSel(stateOptions(cond.entity_id, String(cond.value ?? '')), String(cond.value ?? ''),
              (v) => { (draft.conditions![idx] as typeof cond).value = v; }),
          );
          row.appendChild(removeBtn(() => { draft.conditions!.splice(idx, 1); renderConditions(); }));
          block.appendChild(row);
        }
        p.body.appendChild(block);
      });

      const add = mk('div') as HTMLDivElement;
      add.style.cssText = 'margin-top:8px;display:flex;gap:12px;';
      add.appendChild(linkBtn(t('ruleAddConditionLink'), () => {
        draft.conditions = [...conds, { entity_id: '', operator: 'eq', value: '' }];
        renderConditions();
      }));
      add.appendChild(linkBtn(t('ruleAddTimeWindow'), () => {
        draft.conditions = [...conds, { type: 'time', after: '22:00' }];
        renderConditions();
      }));
      p.body.appendChild(add);
      syncNamePlaceholder();
    };

    // ── Alors ────────────────────────────────────────────────────────────────
    const thenPhase = phase('#639922', 'rgba(99,153,34,0.09)', '▶', t('ruleThen'));
    bodyInner.appendChild(thenPhase.box);

    const renderActions = () => {
      thenPhase.body.innerHTML = '';

      draft.actions.forEach((action, idx) => {
        const block = mk('div') as HTMLDivElement;
        block.style.cssText = idx > 0 ? 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);' : '';

        const kindSel = pillSel([
          ['go_to_view', t('ruleActionGoToView')],
          ['highlight_anchor', t('ruleActionHighlight')],
          ['toast', t('ruleActionToast')],
          ['call_service', t('ruleActionCallService')],
        ], action.type, (v) => {
          draft.actions[idx] =
            v === 'go_to_view' ? { type: 'go_to_view', view_id: '' }
            : v === 'highlight_anchor' ? { type: 'highlight_anchor', anchor: '' }
            : v === 'toast' ? { type: 'toast', message: '' }
            : { type: 'call_service', domain: '', service: '' };
          renderActions();
        });

        const head = sentence(kindSel);
        head.appendChild(removeBtn(() => { draft.actions.splice(idx, 1); renderActions(); }));
        block.appendChild(head);

        if (action.type === 'go_to_view') {
          const opts: [string, string][] = [['', t('ruleChoose')]];
          views.forEach((v) => opts.push([v.id ?? '', v.label]));
          block.appendChild(sentence(
            word(t('ruleTheView')),
            pillSel(opts, action.view_id, (v) => { (draft.actions[idx] as typeof action).view_id = v; }),
          ));
          if (!views.length) {
            const warn = mk('div') as HTMLDivElement;
            warn.className = 'ow-warn-t';
            warn.textContent = t('ruleNoViews');
            block.appendChild(warn);
          }
        } else if (action.type === 'highlight_anchor') {
          const col = mk('input') as HTMLInputElement;
          col.type = 'color'; col.value = action.color ?? '#ef4444';
          col.style.cssText = 'width:34px;height:32px;padding:0;border:1px solid var(--ow-line);border-radius:9px;background:transparent;cursor:pointer;';
          col.addEventListener('change', () => { (draft.actions[idx] as typeof action).color = col.value; });
          const opts = anchorOptions(action.anchor);
          block.appendChild(sentence(
            pillSel(opts, action.anchor,
              (v) => { (draft.actions[idx] as typeof action).anchor = v; }),
            word(t('ruleInColour')),
            col,
          ));
          if (opts.length <= 1) {
            const warn = mk('div') as HTMLDivElement;
            warn.className = 'ow-warn-t';
            warn.textContent = t('ruleNoAnchors');
            block.appendChild(warn);
          }
        } else if (action.type === 'toast') {
          const msg = mk('input') as HTMLInputElement;
          msg.placeholder = t('ruleToastPh'); msg.value = action.message;
          msg.style.cssText = PILL + 'flex:1;min-width:150px;';
          msg.addEventListener('input', () => { (draft.actions[idx] as typeof action).message = msg.value; });
          block.appendChild(sentence(
            msg,
            pillSel([['info', t('ruleToastInfo')], ['warn', t('ruleToastWarn')]], action.level ?? 'info',
              (v) => { (draft.actions[idx] as typeof action).level = v as 'info' | 'warn'; }),
          ));
        } else {
          const svc = mk('input') as HTMLInputElement;
          svc.placeholder = 'light.turn_on';
          svc.value = action.domain && action.service ? `${action.domain}.${action.service}` : '';
          svc.style.cssText = PILL + 'width:170px;';
          svc.addEventListener('input', () => {
            const parts = svc.value.trim().split('.');
            const d = parts.shift();
            const a = draft.actions[idx] as typeof action;
            a.domain = d ?? ''; a.service = parts.join('.');
          });
          block.appendChild(sentence(
            svc,
            word(t('ruleOnWord')),
            entityPill((action.service_data?.entity_id as string) ?? '', (id) => {
              const a = draft.actions[idx] as typeof action;
              a.service_data = id ? { ...(a.service_data ?? {}), entity_id: id } : undefined;
            }),
          ));
        }

        thenPhase.body.appendChild(block);
      });

      if (!draft.actions.length) {
        const hint = mk('div') as HTMLDivElement;
        hint.style.cssText = 'font-size:12px;color:var(--ow-muted);margin-bottom:8px;line-height:1.5;';
        hint.textContent = t('ruleScopeHint');
        thenPhase.body.appendChild(hint);
      }

      const add = mk('div') as HTMLDivElement;
      add.style.cssText = 'margin-top:8px;';
      add.appendChild(linkBtn(draft.actions.length ? t('ruleAndAlso') : t('ruleAddFirstAction'), () => {
        draft.actions.push({ type: 'go_to_view', view_id: '' });
        renderActions();
      }));
      thenPhase.body.appendChild(add);
      syncNamePlaceholder();
    };

    renderTriggers();
    renderConditions();
    renderActions();

    // ── Réglages avancés ─────────────────────────────────────────────────────
    const advWrap = mk('div') as HTMLDivElement;
    advWrap.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--ow-line);';
    const advBody = mk('div') as HTMLDivElement;
    advBody.style.cssText = 'display:none;padding-top:10px;';

    const advToggle = mk('button') as HTMLButtonElement;
    advToggle.style.cssText = LINK + 'display:flex;gap:6px;align-items:center;';
    let advOpen = false;
    const paintAdv = () => {
      advToggle.textContent = `${advOpen ? '⌄' : '›'}  ${t('ruleAdvanced')}`;
      advBody.style.display = advOpen ? 'block' : 'none';
    };
    advToggle.addEventListener('click', () => { advOpen = !advOpen; paintAdv(); });
    paintAdv();

    const labelInp = mk('input') as HTMLInputElement;
    labelInp.value = draft.label ?? '';
    labelInp.style.cssText = PILL + 'width:100%;box-sizing:border-box;';
    labelInp.addEventListener('input', () => { draft.label = labelInp.value; });
    syncNamePlaceholder = () => {
      labelInp.placeholder = ruleIsComplete(draft)
        ? ruleSummary(draft, hass, views).slice(0, 70)
        : t('ruleNameExPh');
    };
    syncNamePlaceholder();
    advBody.appendChild(sentence(word(t('ruleNameOptional'))));
    advBody.appendChild(labelInp);

    const cdRow = mk('div') as HTMLDivElement;
    cdRow.style.cssText = 'margin-top:10px;';
    cdRow.appendChild(sentence(
      word(t('rulePauseBetween')),
      numInput(draft.cooldown, '0', (n) => { draft.cooldown = n && n > 0 ? n : undefined; }),
      word(t('ruleSeconds')),
    ));
    advBody.appendChild(cdRow);

    advWrap.append(advToggle, advBody);
    bodyInner.appendChild(advWrap);

    // ── Pied ─────────────────────────────────────────────────────────────────
    const footer = mk('div') as HTMLDivElement;
    footer.className = 'ow-form-f';

    const testBtn = mk('button') as HTMLButtonElement;
    testBtn.type = 'button';
    testBtn.textContent = t('ruleTry');
    testBtn.title = t('ruleTestHint');
    testBtn.className = 'ow-btn';
    testBtn.addEventListener('click', () => {
      this.onTestRule?.(draft);
      testBtn.textContent = t('ruleTestDone');
      window.setTimeout(() => { testBtn.textContent = t('ruleTry'); }, 1500);
    });

    const cancelBtn = mk('button') as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('ruleModalCancel');
    cancelBtn.className = 'ow-btn ow-ghost';
    cancelBtn.style.marginLeft = 'auto';
    cancelBtn.addEventListener('click', closeForm);

    const saveBtn = mk('button') as HTMLButtonElement;
    saveBtn.type = 'button';
    saveBtn.textContent = t('ruleModalSave');
    saveBtn.className = 'ow-btn ow-primary';
    saveBtn.addEventListener('click', async () => {
      const bad = (draft.triggers ?? []).find((x) => x.type !== 'time' && !x.entity_id.trim());
      if (bad || !(draft.triggers ?? []).length) {
        saveBtn.textContent = t('ruleNeedsTrigger');
        window.setTimeout(() => { saveBtn.textContent = t('ruleModalSave'); }, 2000);
        return;
      }
      draft.label = labelInp.value.trim() || undefined;
      draft.trigger = undefined;
      const current = this.getRules?.() ?? [];
      const isNew = !current.find((r) => r.id === draft.id);
      const newRules = isNew ? [...current, draft] : current.map((r) => r.id === draft.id ? draft : r);
      this._pushRuleSnap();
      await this.saveRules?.(newRules);
      closeForm();
      onSaved();
    });

    footer.append(testBtn, cancelBtn, saveBtn);
    dialog.appendChild(footer);

    host.appendChild(dialog);
  }
}
