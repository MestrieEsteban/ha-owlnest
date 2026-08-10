import type { Hass, CardConfig, EditableAnchor, CameraView, SceneSettings } from '../types';
import type { SceneCard, SceneCardType } from '../cards/types';
import { CARD_DEFAULT_ACCENT, CARD_TYPE_LABELS, CARDS_ENABLED } from '../cards/types';
import type { AnchorEditor, EditorTool } from '../editor';
import type { OwlnestRule, Action } from '../rules/types';
import { t, setLang } from '../i18n';
import { openEntityPicker } from '../entities/picker';
import { detectionLabel, resolveLevel } from '../quality';
import type { TapAction } from '../entities/descriptors';
import type { QualityLevel } from '../quality';
import type { AnchorKind } from '../types';

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
  return KIND_LABEL[a.kind ?? 'entity']();
}

const KIND_LABEL: Record<AnchorKind, () => string> = {
  entity: () => t('anchorKindEntity'),
  label:  () => t('anchorKindLabel'),
  menu:   () => t('anchorKindMenu'),
  nav:    () => t('anchorKindNav'),
};

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
    'flex-shrink:0', 'margin-left:4px',
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
    private getViewMgr?: () => { buildViewsSection: (c: HTMLElement) => void } | null,
    private getSceneSettings?: () => SceneSettings,
    private onSceneSettingsChange?: (s: SceneSettings, reloadScene?: boolean) => void,
    private listScenesFn?: () => Promise<string[]>,
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

  showToolbar() {
    // Preserve existing view buttons so they stay visible in edit mode
    const existingViewBtns = Array.from(this.hudLeft.children) as HTMLElement[];
    this.hudLeft.innerHTML = '';
    this.hudRight.innerHTML = '';
    this.hudSep.style.display = 'none';

    // ── Tool buttons (left) ───────────────────────────────────────────
    const tools: Array<{ id: string; label: string; title: string }> = [
      { id: 'select', label: t('toolSelect'), title: t('toolSelectTitle') },
    ];

    const toolBtns = new Map<string, HTMLButtonElement>();
    const setActiveTool = (id: string) => {
      toolBtns.forEach((b, k) => {
        const on = k === id;
        b.style.background = on ? 'rgba(59,130,246,0.9)' : 'rgba(255,255,255,0.07)';
        b.style.boxShadow  = on ? '0 0 0 1.5px rgba(59,130,246,0.5)' : 'none';
        b.style.color = on ? '#fff' : 'rgba(255,255,255,0.55)';
      });
    };

    tools.forEach(({ id, label, title }) => {
      const btn = this._btn(label, 'rgba(255,255,255,0.07)');
      btn.style.color = 'rgba(255,255,255,0.55)';
      btn.style.fontSize = '14px';
      btn.style.minWidth = '30px';
      btn.style.padding = '4px 8px';
      btn.title = title;
      btn.addEventListener('click', () => {
        this.getEditor()?.setTool(id as EditorTool);
        setActiveTool(id);
      });
      toolBtns.set(id, btn);
      this.hudLeft.appendChild(btn);
    });

    // Separator
    const sep1 = document.createElement('div');
    sep1.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.12);margin:0 2px;';
    this.hudLeft.appendChild(sep1);

    // Undo / Redo
    const undoBtn = this._btn('↩', 'rgba(255,255,255,0.07)');
    undoBtn.title = t('undoTitle');
    undoBtn.style.cssText += ';color:rgba(255,255,255,0.55);font-size:14px;min-width:28px;padding:4px 7px;';
    undoBtn.addEventListener('click', () => this.getEditor()?.undo());

    const redoBtn = this._btn('↪', 'rgba(255,255,255,0.07)');
    redoBtn.title = t('redoTitle');
    redoBtn.style.cssText += ';color:rgba(255,255,255,0.55);font-size:14px;min-width:28px;padding:4px 7px;';
    redoBtn.addEventListener('click', () => this.getEditor()?.redo());

    this.hudLeft.appendChild(undoBtn);
    this.hudLeft.appendChild(redoBtn);

    // Move view buttons to center of HUD (hudSep repurposed as flex center container)
    this.hudSep.innerHTML = '';
    if (existingViewBtns.length > 0) {
      this.hudSep.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;gap:2px;';
      existingViewBtns.forEach(b => this.hudSep.appendChild(b));
    } else {
      this.hudSep.style.cssText = 'flex:1;';
    }

    const editor = this.getEditor();
    if (editor) {
      const prevOnToolChange = editor.onToolChange;
      editor.onToolChange = (t) => {
        setActiveTool(t);
        prevOnToolChange?.(t);
      };
      // Chain card/rule undo into anchor editor fallback so Ctrl+Z and buttons both work
      editor.onUndoFallback = () => { if (!this._undoCards()) this._undoRules(); };
      editor.onRedoFallback = () => { if (!this._redoCards()) this._redoRules(); };
    }

    // ── Right: close ─────────────────────────────────────────────────
    const doneBtn = this._btn(t('doneBtn'), 'rgba(255,255,255,0.07)');
    doneBtn.style.color = 'rgba(255,255,255,0.6)';
    doneBtn.title = t('doneBtnTitle');
    doneBtn.addEventListener('click', () => this.onClose());
    this.hudRight.appendChild(doneBtn);

    setActiveTool('select');

    // Hint row — inserted above the pill bar inside _hud so it never overlaps
    const hintBar = document.createElement('div');
    hintBar.id = 'editor-hint-bar';
    hintBar.style.cssText = [
      'display:flex', 'gap:8px', 'align-items:center', 'justify-content:center',
      'font-size:10px', 'color:rgba(255,255,255,0.35)', 'pointer-events:none',
      'white-space:nowrap', 'padding:0 4px',
    ].join(';');
    const kbdStyle = 'background:rgba(255,255,255,0.1);border-radius:3px;padding:1px 4px;color:rgba(255,255,255,0.6);font-weight:600;margin-right:3px;font-size:9px;';
    const hint = (key: string, label: string) => {
      const span = document.createElement('span');
      span.innerHTML = `<span style="${kbdStyle}">${key}</span>${label}`;
      return span;
    };
    hintBar.appendChild(hint('S', t('hintSelect')));
    hintBar.appendChild(hint('A', t('hintAdd')));
    hintBar.appendChild(hint('G', t('hintGrab')));
    hintBar.appendChild(hint('G→X/Y/Z', t('hintAxis')));
    hintBar.appendChild(hint('R', t('hintRotate')));
    hintBar.appendChild(hint('X', t('hintDelete')));
    hintBar.appendChild(hint('H', t('hintHide')));
    hintBar.appendChild(hint('Ctrl+D', t('hintDup')));
    hintBar.appendChild(hint('Ctrl+Z', t('hintUndo')));
    hintBar.appendChild(hint('Esc', t('hintEsc')));
    hintBar.appendChild(hint(t('hintRClickKey'), t('hintRClick')));
    // Insert before the last child (the pill bar) so it appears above it
    this.hud.insertBefore(hintBar, this.hud.lastChild);

    this._saveStatus = 'saved';
    this.buildAnchorList();
  }

  private _btn(label: string, bg: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      `background:${bg}`,
      'border:none',
      'color:#fff',
      'border-radius:8px',
      'padding:5px 10px',
      'cursor:pointer',
      'font-size:12px',
      'font-family:var(--primary-font-family,sans-serif)',
      'transition:background .15s, box-shadow .15s',
      'white-space:nowrap',
    ].join(';');
    return btn;
  }

  hideToolbar() {
    this._panel?.remove();
    this._panel = null;
    this.hud.querySelector('#editor-hint-bar')?.remove();
    // Restore HUD to normal camera view + action buttons
    this.rebuildNormalHUD();
  }

  buildAnchorList() {
    this._panel?.remove();
    if (!this.overlayContainer || !this.getEditor()) return;

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px',
      'width:264px', 'max-height:calc(100% - 80px)',
      'background:rgba(6,10,20,0.93)',
      'backdrop-filter:blur(18px)', '-webkit-backdrop-filter:blur(18px)',
      'border:1px solid rgba(255,255,255,0.09)',
      'border-radius:14px', 'overflow:hidden',
      'display:flex', 'flex-direction:column',
      'z-index:15', 'pointer-events:auto',
      'font-family:var(--primary-font-family,sans-serif)',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    // Stop key events bubbling to HA shortcuts
    panel.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        e.stopPropagation();
      }
    });

    // ── Header ────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;padding:9px 12px 8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;gap:6px;';
    const headerTitle = document.createElement('span');
    headerTitle.style.cssText = 'font-size:11px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em;flex:1;';
    headerTitle.textContent = t('inspectorTitle');
    header.appendChild(headerTitle);
    if (this.getSceneId()) {
      const saveInd = document.createElement('span');
      saveInd.id = 'save-indicator';
      saveInd.style.cssText = 'font-size:10px;color:#22c55e;transition:color .2s;';
      saveInd.textContent = t('saveIndicator_saved');
      header.appendChild(saveInd);
    }
    panel.appendChild(header);

    // Warning banner if no scene_id — modifications not persisted
    if (!this.getSceneId()) {
      const warn = document.createElement('div');
      warn.style.cssText = [
        'padding:7px 12px', 'font-size:10px', 'color:#f59e0b',
        'background:rgba(245,158,11,0.08)', 'border-bottom:1px solid rgba(245,158,11,0.18)',
        'line-height:1.5', 'flex-shrink:0',
      ].join(';');
      warn.textContent = t('warnNoSceneId');
      panel.appendChild(warn);
    }

    // ── Body: list view ↔ detail view ─────────────────────────────────
    const listView = document.createElement('div');
    listView.id = 'inspector-list';
    listView.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

    const detailView = document.createElement('div');
    detailView.id = 'inspector-detail';
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

    const DOMAIN_ICONS: Record<string, string> = {
      light: '💡', switch: '🔌', cover: '🪟',
      sensor: '📡', binary_sensor: '⬤', climate: '🌡️', media_player: '🔊',
    };
    const DOMAIN_COLORS: Record<string, string> = {
      light: '#fbbf24', switch: '#4ade80', cover: '#fb923c',
      sensor: '#60a5fa', binary_sensor: '#22d3ee',
      climate: '#f87171', media_player: '#c084fc',
    };

    const cards = this.getCards ? this.getCards() : [];
    const rulesCount = (this.getRules?.() ?? []).length;

    // ── Sidebar + content layout ──────────────────────────────────────
    listView.style.flexDirection = 'row';

    const TAB_DEFS = [
      { id: 'anchors', icon: '⊕', label: anchors.size > 0 ? `${t('tabAnchors')} (${anchors.size})` : t('tabAnchors') },
      { id: 'cards',   icon: '☰', label: cards.length > 0  ? `${t('tabCards')} (${cards.length})`  : t('tabCards') },
      { id: 'rules',   icon: '⚡', label: rulesCount > 0    ? `${t('tabRules')} (${rulesCount})`    : t('tabRules') },
      { id: 'camera',  icon: '◎', label: t('tabCamera') },
      { id: 'weather', icon: '☁', label: t('tabWeather') },
      { id: 'config',  icon: '⚙', label: t('tabConfig') },
    ] as const;
    type TabId = typeof TAB_DEFS[number]['id'];

    const defaultTab: TabId = CARDS_ENABLED && this.getSelectedCardId?.() ? 'cards' : 'anchors';
    // Un onglet masqué mémorisé d'un précédent rendu ne doit pas être restauré :
    // son volet existe toujours, mais aucun bouton ne permettrait d'en sortir.
    const tabVisible = (id: string) => id !== 'cards' || CARDS_ENABLED;
    const remembered = this._activeInspectorTab;
    let activeTab: TabId =
      (remembered && TAB_DEFS.find(d => d.id === remembered) && tabVisible(remembered)
        ? remembered as TabId
        : null) ?? defaultTab;

    // Left icon rail
    const sidebar = document.createElement('div');
    sidebar.style.cssText = [
      'width:36px', 'flex-shrink:0',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'background:rgba(0,0,0,0.22)',
      'border-right:1px solid rgba(255,255,255,0.06)',
      'padding:4px 0', 'gap:1px',
    ].join(';');

    // Right content area
    const contentArea = document.createElement('div');
    contentArea.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;';

    const tabBtns = new Map<TabId, HTMLButtonElement>();
    const tabPanes = new Map<TabId, HTMLDivElement>();

    const switchTab = (id: TabId) => {
      activeTab = id;
      this._activeInspectorTab = id;
      tabBtns.forEach((b, k) => {
        const on = k === id;
        b.style.color      = on ? '#7dd3fc' : 'rgba(255,255,255,0.22)';
        b.style.borderLeft = on ? '2px solid #7dd3fc' : '2px solid transparent';
        b.style.background = on ? 'rgba(125,209,252,0.1)' : 'transparent';
      });
      tabPanes.forEach((p, k) => { p.style.display = k === id ? 'flex' : 'none'; });
    };

    TAB_DEFS.forEach(({ id, icon, label }) => {
      // Onglet masqué : pas de bouton dans la barre latérale…
      const hideTab = id === 'cards' && !CARDS_ENABLED;
      if (!hideTab) {
        const btn = document.createElement('button');
        btn.style.cssText = [
          'width:32px', 'height:32px',
          'background:transparent',
          'border:none', 'border-left:2px solid transparent',
          'border-radius:6px',
          'cursor:pointer', 'color:rgba(255,255,255,0.22)',
          'font-size:14px', 'line-height:1',
          'display:flex', 'align-items:center', 'justify-content:center',
          'transition:all .15s', 'flex-shrink:0',
        ].join(';');
        btn.textContent = icon;
        btn.title = label;
        btn.addEventListener('click', () => switchTab(id));
        tabBtns.set(id, btn);
        sidebar.appendChild(btn);
      }

      // …mais le volet est toujours créé : la suite de cette fonction y accède
      // par son identifiant, et une absence ferait échouer toute la construction
      // des onglets suivants.
      const pane = document.createElement('div');
      pane.style.cssText = 'flex-direction:column;flex:1;min-height:0;overflow:hidden;display:none;';
      tabPanes.set(id, pane);
    });

    // Sidebar tooltip (floats to the right of the icon rail)
    listView.style.position = 'relative';
    const sidebarTooltip = document.createElement('div');
    sidebarTooltip.style.cssText = [
      'position:absolute', 'left:42px', 'z-index:30',
      'background:rgba(15,23,42,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:7px', 'padding:4px 9px',
      'font-size:10px', 'font-weight:600', 'color:#e2e8f0',
      'white-space:nowrap', 'pointer-events:none',
      'opacity:0', 'transition:opacity .12s',
      'font-family:var(--primary-font-family,sans-serif)',
      'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
    ].join(';');
    listView.appendChild(sidebarTooltip);

    tabBtns.forEach((btn, id) => {
      const def = TAB_DEFS.find(d => d.id === id)!;
      btn.addEventListener('mouseenter', () => {
        const br = btn.getBoundingClientRect();
        const lr = listView.getBoundingClientRect();
        sidebarTooltip.style.top = `${br.top - lr.top + br.height / 2 - 11}px`;
        sidebarTooltip.textContent = def.label;
        sidebarTooltip.style.opacity = '1';
      });
      btn.addEventListener('mouseleave', () => { sidebarTooltip.style.opacity = '0'; });
    });

    // Uniform tab pane header helper
    const buildTabHeader = (
      pane: HTMLElement,
      title: string,
      desc: string,
      action?: { label: string; onClick: () => void; badge?: string },
    ): void => {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:8px 10px 6px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

      const titleEl = document.createElement('span');
      titleEl.style.cssText = 'font-size:10px;font-weight:700;color:#e2e8f0;text-transform:uppercase;letter-spacing:.06em;flex:1;';
      titleEl.textContent = title;
      row.appendChild(titleEl);

      if (action?.badge) {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:8px;font-weight:700;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:3px;padding:1px 4px;';
        badge.textContent = action.badge;
        row.appendChild(badge);
      }

      if (action) {
        const btn = document.createElement('button');
        btn.style.cssText = 'background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.28);border-radius:6px;color:#7dd3fc;padding:2px 8px;font-size:10px;font-family:inherit;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s;';
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        row.appendChild(btn);
      }

      hdr.appendChild(row);

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.25);line-height:1.4;';
      descEl.textContent = desc;
      hdr.appendChild(descEl);

      pane.appendChild(hdr);
    };

    listView.appendChild(sidebar);
    listView.appendChild(contentArea);
    tabPanes.forEach(p => contentArea.appendChild(p));

    // ── Anchors pane ─────────────────────────────────────────────────
    const anchorsPane = tabPanes.get('anchors')!;

    buildTabHeader(anchorsPane, t('tabAnchors'), t('tabAnchorsDesc'), {
      label: t('addAnchor'),
      onClick: () => this.getEditor()?.setTool('add'),
    });

    // Batch visibility bar
    const batchBar = document.createElement('div');
    batchBar.style.cssText = 'display:flex;align-items:center;padding:3px 10px 3px;gap:4px;border-bottom:1px solid rgba(255,255,255,0.04);flex-shrink:0;';
    const batchBtnStyle = 'background:none;border:none;cursor:pointer;padding:3px 6px;border-radius:5px;font-size:11px;color:rgba(255,255,255,0.35);transition:all .15s;';
    const showAllBtn = document.createElement('button');
    showAllBtn.title = t('showAll'); showAllBtn.innerHTML = t('showAll'); showAllBtn.style.cssText = batchBtnStyle;
    showAllBtn.addEventListener('mouseenter', () => { showAllBtn.style.color = '#4ade80'; });
    showAllBtn.addEventListener('mouseleave', () => { showAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    showAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: false }));
    const hideAllBtn = document.createElement('button');
    hideAllBtn.title = t('hideAll'); hideAllBtn.innerHTML = t('hideAll'); hideAllBtn.style.cssText = batchBtnStyle;
    hideAllBtn.addEventListener('mouseenter', () => { hideAllBtn.style.color = '#f87171'; });
    hideAllBtn.addEventListener('mouseleave', () => { hideAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    hideAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: true }));
    batchBar.appendChild(showAllBtn); batchBar.appendChild(hideAllBtn);
    anchorsPane.appendChild(batchBar);

    const anchorsScroll = document.createElement('div');
    anchorsScroll.id = 'anchor-list-body';
    anchorsScroll.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:3px 0;';
    anchorsPane.appendChild(anchorsScroll);

    if (anchors.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = `${t('anchorEmpty')}<br><span style="font-size:10px;opacity:.7">${t('anchorEmptyHint')}</span>`;
      anchorsScroll.appendChild(empty);
    } else {
      anchors.forEach((a, key) => {
        const isSelected = key === selectedKey;
        const domain = a.entity.split('.')[0];
        const color = DOMAIN_COLORS[domain] ?? '#94a3b8';
        const icon = DOMAIN_ICONS[domain] ?? '●';

        const row = document.createElement('div');
        row.style.cssText = [
          'display:flex', 'align-items:center', 'gap:8px',
          'padding:6px 10px', 'cursor:pointer',
          `background:${isSelected ? 'rgba(59,130,246,0.18)' : 'transparent'}`,
          `border-left:2px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
          'transition:background .1s, border-color .1s',
        ].join(';');
        if (!isSelected) {
          row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.05)'; row.style.borderLeftColor = 'rgba(255,255,255,0.12)'; });
          row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; row.style.borderLeftColor = 'transparent'; });
        }

        const iconEl = document.createElement('span');
        iconEl.style.cssText = `font-size:13px;flex-shrink:0;opacity:${a.hidden ? 0.2 : 0.9};`;
        iconEl.textContent = icon;

        const col = document.createElement('div');
        col.style.cssText = 'flex:1;min-width:0;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = `font-size:12px;font-weight:500;${a.hidden ? 'color:rgba(255,255,255,0.25);' : 'color:#e2e8f0;'}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;`;
        nameEl.textContent = anchorTitle(a);
        const entityEl = document.createElement('div');
        entityEl.style.cssText = `font-size:10px;color:${a.hidden ? 'rgba(255,255,255,0.15)' : color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;opacity:0.8;`;
        entityEl.textContent = anchorSubtitle(a);
        col.appendChild(nameEl); col.appendChild(entityEl);

        const rowBtnStyle = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:12px;flex-shrink:0;line-height:1;border-radius:4px;color:rgba(255,255,255,0.4);transition:all .12s;opacity:0;';
        const eyeBtn = document.createElement('button');
        eyeBtn.style.cssText = rowBtnStyle;
        eyeBtn.textContent = a.hidden ? '🙈' : '👁';
        eyeBtn.title = a.hidden ? t('anchorShow') : t('anchorHide');
        if (a.hidden) eyeBtn.style.opacity = '0.45';
        eyeBtn.addEventListener('mouseenter', () => { eyeBtn.style.opacity = '1'; eyeBtn.style.background = 'rgba(255,255,255,0.1)'; });
        eyeBtn.addEventListener('mouseleave', () => { eyeBtn.style.opacity = a.hidden ? '0.5' : '0.6'; eyeBtn.style.background = 'none'; });
        eyeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.getEditor()?.updateAnchor(key, { hidden: !a.hidden }); this.scheduleAutoSave(); });

        const dupBtn = document.createElement('button');
        dupBtn.style.cssText = rowBtnStyle;
        dupBtn.textContent = '⎘'; dupBtn.title = t('anchorDup');
        dupBtn.addEventListener('mouseenter', () => { dupBtn.style.opacity = '1'; dupBtn.style.background = 'rgba(255,255,255,0.1)'; });
        dupBtn.addEventListener('mouseleave', () => { dupBtn.style.opacity = '0.6'; dupBtn.style.background = 'none'; });
        dupBtn.addEventListener('click', (e) => { e.stopPropagation(); this.getEditor()?.selectAnchor(key); this.getEditor()?.duplicate(); });

        const showBtns = () => { eyeBtn.style.opacity = a.hidden ? '0.5' : '0.6'; dupBtn.style.opacity = '0.6'; };
        const hideBtns = () => { eyeBtn.style.opacity = a.hidden ? '0.35' : '0'; dupBtn.style.opacity = '0'; };
        if (!isSelected) { row.addEventListener('mouseenter', showBtns); row.addEventListener('mouseleave', hideBtns); }
        else { setTimeout(showBtns, 0); }

        row.appendChild(iconEl); row.appendChild(col); row.appendChild(eyeBtn); row.appendChild(dupBtn);
        row.addEventListener('click', () => {
          this.getEditor()?.selectAnchor(key);
          this._buildPropsSection(detailView, key, editor.anchors.get(key)!, showList);
          showDetail();
        });
        anchorsScroll.appendChild(row);
      });
    }

    // ── Cards pane ───────────────────────────────────────────────────
    const cardsPane = tabPanes.get('cards')!;
    cardsPane.style.cssText += ';overflow:hidden;';

    buildTabHeader(cardsPane, t('tabCards'), t('tabCardsDesc'), {
      label: t('addCard'),
      badge: 'BETA',
      onClick: () => this._showCardTemplatePicker(cardsScroll),
    });

    const cardsScroll = document.createElement('div');
    cardsScroll.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:3px 0;';
    cardsPane.appendChild(cardsScroll);

    const CARD_ICONS: Record<SceneCardType, string> = { room: '🏠', entity: '📊', info: 'ℹ️' };
    const CARD_COLORS: Record<SceneCardType, string> = { room: '#7dd3fc', entity: '#86efac', info: '#fbbf24' };

    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = `${t('cardEmptyList')}<br><span style="font-size:10px;opacity:.7">${t('cardEmptyListHint')}</span>`;
      cardsScroll.appendChild(empty);
    } else {
      cards.forEach((c) => {
        const isSelected = this.getSelectedCardId ? this.getSelectedCardId() === c.id : false;
        const row = document.createElement('div');
        row.style.cssText = [
          'display:flex', 'align-items:center', 'gap:8px',
          'padding:6px 10px', 'cursor:pointer',
          `background:${isSelected ? 'rgba(59,130,246,0.18)' : 'transparent'}`,
          `border-left:2px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
          'transition:background .1s, border-color .1s',
        ].join(';');
        if (!isSelected) {
          row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.05)'; });
          row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        }
        const iconEl = document.createElement('span');
        iconEl.style.cssText = 'font-size:16px;flex-shrink:0;';
        iconEl.textContent = CARD_ICONS[c.type] ?? '▦';
        const col = document.createElement('div');
        col.style.cssText = 'flex:1;min-width:0;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:12px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;';
        nameEl.textContent = c.name;
        const subEl = document.createElement('div');
        subEl.style.cssText = `font-size:10px;color:${CARD_COLORS[c.type] ?? '#7dd3fc'};opacity:0.65;line-height:1.3;`;
        subEl.textContent = `${(CARD_TYPE_LABELS[c.type] ?? (() => c.type))()} · ${c.size ?? 'medium'}`;
        col.appendChild(nameEl); col.appendChild(subEl);
        row.appendChild(iconEl); row.appendChild(col);
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
    });

    const rulesBody = document.createElement('div');
    rulesBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    rulesPane.appendChild(rulesBody);
    this._fillRulesList(rulesBody);

    // ── Camera pane ───────────────────────────────────────────────────
    const cameraPane = tabPanes.get('camera')!;
    cameraPane.style.cssText += ';overflow-y:auto;';
    buildTabHeader(cameraPane, t('tabCamera'), t('tabCameraDesc'));
    const viewsContainer = document.createElement('div');
    viewsContainer.style.cssText = 'padding:4px 12px 8px;';
    cameraPane.appendChild(viewsContainer);
    const viewMgr = this.getViewMgr?.();
    if (viewMgr) {
      viewMgr.buildViewsSection(viewsContainer);
    }

    // ── Weather pane ──────────────────────────────────────────────────
    const weatherPane = tabPanes.get('weather')!;
    weatherPane.style.cssText += ';overflow-y:auto;';
    buildTabHeader(weatherPane, t('tabWeather'), t('tabWeatherDesc'));
    this._buildWeatherTab(weatherPane);

    // ── Config pane ──────────────────────────────────────────────────
    const configPane = tabPanes.get('config')!;
    configPane.style.cssText += ';overflow-y:auto;';
    buildTabHeader(configPane, t('tabConfig'), t('tabConfigDesc'));
    this._buildConfigTab(configPane);

    // Activate default tab
    switchTab(activeTab);
  }

  private _buildConfigTab(container: HTMLElement) {
    const settings = this.getSceneSettings?.() ?? {};
    const rendering = settings.rendering ?? {};

    const inputStyle = [
      'width:100%', 'box-sizing:border-box',
      'background:rgba(255,255,255,0.04)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:7px', 'color:#e2e8f0', 'padding:6px 9px',
      'font-size:11px', 'outline:none', 'font-family:inherit',
      'transition:border-color .15s',
    ].join(';');

    const root = document.createElement('div');
    root.style.cssText = 'padding:10px 12px 14px;display:flex;flex-direction:column;gap:0;';
    container.appendChild(root);

    // Section divider helper
    const sec = (label: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      d.textContent = label;
      root.appendChild(d);
    };

    // Text input helper
    const textInput = (value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement => {
      const inp = document.createElement('input');
      inp.value = value; inp.placeholder = placeholder;
      inp.style.cssText = inputStyle;
      inp.addEventListener('focus', () => { inp.style.borderColor = 'rgba(125,209,252,0.5)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = 'rgba(255,255,255,0.1)'; });
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
      wrap.style.cssText = 'margin-bottom:8px;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
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
      wrap.style.cssText = 'margin-bottom:8px;';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
      lbl.textContent = labelText;
      hdr.appendChild(lbl);
      if (helpText) hdr.appendChild(helpBadge(helpText));
      const spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';
      hdr.appendChild(spacer);
      const val = document.createElement('span');
      val.style.cssText = 'font-size:10px;color:#e2e8f0;font-weight:600;';
      val.textContent = fmt(value);
      hdr.appendChild(val);
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = String(step); sl.value = String(value);
      sl.style.cssText = 'width:100%;cursor:pointer;margin:0;accent-color:#7dd3fc;';
      sl.addEventListener('input', () => { val.textContent = fmt(parseFloat(sl.value)); onChange(parseFloat(sl.value)); });
      wrap.appendChild(hdr); wrap.appendChild(sl);
      root.appendChild(wrap);
    };

    // ── Helper: toggle with help badge ───────────────────────────────────
    const toggleWithHelp = (labelText: string, helpText: string | null, checked: boolean, onChange: (v: boolean) => void) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:8px;cursor:pointer;font-size:11px;color:#e2e8f0;';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = checked; chk.style.cursor = 'pointer';
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

    {
      const sceneIdInput = textInput(this.getSceneId() ?? '', t('cfgSceneIdPh'), () => {});
      const sceneIdDlId = 'owlnest-cfg-scenes-dl';
      sceneIdInput.setAttribute('list', sceneIdDlId);
      const scenesDl = document.createElement('datalist');
      scenesDl.id = sceneIdDlId;
      root.appendChild(scenesDl);
      this.listScenesFn?.().then((ids) => {
        ids.forEach((id) => {
          const opt = document.createElement('option');
          opt.value = id;
          scenesDl.appendChild(opt);
        });
      });
      const sceneRow = document.createElement('div');
      sceneRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
      sceneRow.appendChild(sceneIdInput);
      const loadSceneBtn = document.createElement('button');
      loadSceneBtn.textContent = t('cfgLoadScene');
      loadSceneBtn.style.cssText = 'flex-shrink:0;background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.28);border-radius:7px;color:#7dd3fc;padding:6px 10px;font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap;';
      loadSceneBtn.addEventListener('click', () => {
        const newId = sceneIdInput.value.trim();
        if (!newId) return;
        localStorage.setItem('owlnest_scene_id', newId);
        this.onSceneSettingsChange?.({ scene_id: newId } as SceneSettings, true);
      });
      sceneRow.appendChild(loadSceneBtn);
      const sceneWrap = document.createElement('div');
      sceneWrap.style.cssText = 'margin-bottom:8px;';
      const sceneLblRow = document.createElement('div');
      sceneLblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const sceneLbl = document.createElement('span');
      sceneLbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
      sceneLbl.textContent = t('cfgSceneId');
      sceneLblRow.appendChild(sceneLbl);
      sceneLblRow.appendChild(helpBadge(t('helpSceneId')));
      sceneWrap.appendChild(sceneLblRow); sceneWrap.appendChild(sceneRow);
      root.appendChild(sceneWrap);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 0b) PERFORMANCE — quality preset
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
          this.onSceneSettingsChange?.({ rendering: { ...rendering, quality: v as QualityLevel } });
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

      const detail = document.createElement('div');
      detail.style.cssText = 'font-size:9px;color:#475569;margin:-4px 0 8px;line-height:1.5;';
      detail.textContent = describe(current as QualityLevel);
      root.appendChild(detail);

      const reloadNote = document.createElement('div');
      reloadNote.style.cssText = 'font-size:9px;color:#475569;margin:0 0 8px;line-height:1.5;';
      reloadNote.textContent = t('cfgQualityReload');
      root.appendChild(reloadNote);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 1) SCENE PRESENTATION — sun mode, orientation, occlusion
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgPresentation'));

    selectField(t('cfgSunMode'), t('helpSunMode'), [
      ['showcase', t('cfgSunModeShowcase')],
      ['realistic', t('cfgSunModeRealistic')],
    ], rendering.sun_mode ?? 'showcase', (v) => {
      this.onSceneSettingsChange?.({ rendering: { ...rendering, sun_mode: v as 'showcase' | 'realistic' } });
    });

    // House orientation — compass slider
    {
      const currentOrientation = rendering.house_orientation ?? 0;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
      lbl.textContent = t('cfgHouseOrientation');
      hdr.appendChild(lbl);
      hdr.appendChild(helpBadge(t('helpHouseOrientation')));
      const spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';
      hdr.appendChild(spacer);
      const val = document.createElement('span');
      val.style.cssText = 'font-size:10px;color:#e2e8f0;font-weight:600;';
      const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const toCardinal = (deg: number) => {
        const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
        return `${Math.round(deg)}° ${cardinals[idx]}`;
      };
      val.textContent = toCardinal(currentOrientation);
      hdr.appendChild(val);
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = '0'; sl.max = '359'; sl.step = '5'; sl.value = String(currentOrientation);
      sl.style.cssText = 'width:100%;cursor:pointer;margin:0;accent-color:#7dd3fc;';
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        val.textContent = toCardinal(v);
        this.onSceneSettingsChange?.({ rendering: { ...rendering, house_orientation: v } });
      });
      wrap.appendChild(hdr); wrap.appendChild(sl);
      root.appendChild(wrap);
    }

    selectField(t('cfgLightOcclusion'), t('helpLightOcclusion'), [
      ['none', t('cfgOcclusionNone')],
      ['top', t('cfgOcclusionTop')],
    ], rendering.light_occlusion ?? 'none', (v) => {
      this.onSceneSettingsChange?.({ rendering: { ...rendering, light_occlusion: v as 'none' | 'top' } });
    });

    // ══════════════════════════════════════════════════════════════════════
    // 2) GROUND — style, color, scale
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgGroundStyle'));

    selectField(t('cfgGroundStyle'), t('helpGroundStyle'), [
      ['square', t('cfgGroundSquare')],
      ['disc', t('cfgGroundDisc')],
      ['podium', t('cfgGroundPodium')],
      ['infinite', t('cfgGroundInfinite')],
      ['none', t('cfgGroundNone')],
    ], rendering.ground_style ?? 'square', (v) => {
      this.onSceneSettingsChange?.({ rendering: { ...rendering, ground_style: v as 'square' | 'disc' | 'infinite' | 'podium' | 'none' } });
    });

    // Ground color
    {
      const colorWrap = document.createElement('div');
      colorWrap.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;gap:8px;';
      const colorLbl = document.createElement('div');
      colorLbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;flex:1;';
      colorLbl.textContent = t('cfgGroundColor');
      colorLbl.appendChild(helpBadge(t('helpGroundColor')));
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = rendering.ground_color ?? '#1a1a2e';
      colorInput.style.cssText = 'width:36px;height:24px;border:none;border-radius:6px;cursor:pointer;padding:0;background:none;';
      colorInput.addEventListener('input', () => this.onSceneSettingsChange?.({ rendering: { ...rendering, ground_color: colorInput.value } }));
      colorWrap.appendChild(colorLbl); colorWrap.appendChild(colorInput);
      root.appendChild(colorWrap);
    }

    // Ground scale (visible for disc, podium, square — not infinite/none)
    {
      const currentStyle = rendering.ground_style ?? 'square';
      if (currentStyle !== 'infinite' && currentStyle !== 'none') {
        sliderWithHelp(t('cfgGroundScale'), t('helpGroundScale'), 0.5, 3, 0.1, rendering.ground_scale ?? 1.0,
          (v) => '\u00d7' + v.toFixed(1), (v) => this.onSceneSettingsChange?.({ rendering: { ...rendering, ground_scale: v } }));
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 3) LIGHTING — sun, ambient, exposure, shadows
    // ══════════════════════════════════════════════════════════════════════
    sec(t('cfgRender'));

    sliderWithHelp(t('cfgSunIntensity'), t('helpSunIntensity'), 0, 3, 0.05, rendering.sun_intensity ?? 0.8,
      (v) => v.toFixed(2), (v) => this.onSceneSettingsChange?.({ rendering: { ...rendering, sun_intensity: v } }));

    sliderWithHelp(t('cfgAmbientIntensity'), t('helpAmbientIntensity'), 0, 2, 0.05, rendering.ambient_intensity ?? 0.7,
      (v) => v.toFixed(2), (v) => this.onSceneSettingsChange?.({ rendering: { ...rendering, ambient_intensity: v } }));

    sliderWithHelp(t('cfgExposure'), t('helpExposure'), 0.5, 2, 0.05, rendering.exposure ?? 1.4,
      (v) => v.toFixed(2), (v) => this.onSceneSettingsChange?.({ rendering: { ...rendering, exposure: v } }));

    toggleWithHelp(t('cfgShadows'), t('helpShadows'), rendering.shadows !== false, (v) => {
      this.onSceneSettingsChange?.({ rendering: { ...rendering, shadows: v } });
    });

    // ══════════════════════════════════════════════════════════════════════
    // 4) ATMOSPHERE — fog, transparent
    // ══════════════════════════════════════════════════════════════════════
    sliderWithHelp(t('cfgFogDensity'), t('helpFogDensity'), 0, 0.05, 0.001, rendering.fog_density ?? 0.018,
      (v) => v.toFixed(3), (v) => this.onSceneSettingsChange?.({ rendering: { ...rendering, fog_density: v } }));

    toggleWithHelp(t('cfgTransparent'), t('helpTransparent'), rendering.transparent_background === true, (v) => {
      this.onSceneSettingsChange?.({ rendering: { ...rendering, transparent_background: v } });
    });

    // ── Camera limits ─────────────────────────────────────────────────────
    sec(t('cfgOrbit'));
    const orbit = settings.orbit ?? {};

    sliderWithHelp(t('cfgMinDist'), t('helpMinDist'), 0, 20, 0.5, orbit.min_distance ?? 1,
      (v) => v.toFixed(1), (v) => this.onSceneSettingsChange?.({ orbit: { ...orbit, min_distance: v } }));

    sliderWithHelp(t('cfgMaxDist'), t('helpMaxDist'), 1, 200, 1, orbit.max_distance ?? 100,
      (v) => String(Math.round(v)), (v) => this.onSceneSettingsChange?.({ orbit: { ...orbit, max_distance: v } }));

    sliderWithHelp(t('cfgMaxPolar'), t('helpMaxPolar'), 0, 1, 0.05, orbit.max_polar_angle ?? 0.5,
      (v) => (v).toFixed(2) + '\u00d7\u03c0', (v) => this.onSceneSettingsChange?.({ orbit: { ...orbit, max_polar_angle: v } }));

    // ── Clustering ────────────────────────────────────────────────────────
    sec(t('cfgCluster'));
    const clusterWrap = document.createElement('div');
    clusterWrap.style.cssText = 'margin-bottom:8px;';
    const clusterLbl = document.createElement('div');
    clusterLbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;';
    clusterLbl.textContent = t('cfgClusterThreshold');
    clusterLbl.appendChild(helpBadge(t('helpCluster')));
    const clusterInput = document.createElement('input');
    clusterInput.type = 'number'; clusterInput.min = '0'; clusterInput.step = '5';
    clusterInput.value = String(settings.cluster_threshold ?? 0);
    clusterInput.style.cssText = inputStyle;
    clusterInput.addEventListener('change', () => {
      this.onSceneSettingsChange?.({ cluster_threshold: parseFloat(clusterInput.value) || 0 });
    });
    clusterWrap.appendChild(clusterLbl); clusterWrap.appendChild(clusterInput);
    root.appendChild(clusterWrap);

    // ── Language ──────────────────────────────────────────────────────
    sec(t('cfgLang'));

    {
      const langLblRow = document.createElement('div');
      langLblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const langLbl = document.createElement('span');
      langLbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
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
      this.buildAnchorList();
    });
    root.appendChild(langSelect);
  }

  private _buildWeatherTab(container: HTMLElement) {
    const settings = this.getSceneSettings?.() ?? {};
    const inputStyle = [
      'width:100%', 'box-sizing:border-box',
      'background:rgba(255,255,255,0.04)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:7px', 'color:#e2e8f0', 'padding:6px 9px',
      'font-size:11px', 'outline:none', 'font-family:inherit',
      'transition:border-color .15s',
    ].join(';');

    const root = document.createElement('div');
    root.style.cssText = 'padding:10px 12px 14px;display:flex;flex-direction:column;gap:0;';
    container.appendChild(root);

    const sec = (label: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      d.textContent = label;
      root.appendChild(d);
    };

    const field = (labelText: string, el: HTMLElement, helpText?: string) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const lblRow = document.createElement('div');
      lblRow.style.cssText = 'display:flex;align-items:center;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
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
      inp.addEventListener('blur',  () => { inp.style.borderColor = 'rgba(255,255,255,0.1)'; });
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

    field(t('cfgSunEntity'), entityAutocomplete(
      settings.sun_entity ?? this.getConfig?.()?.sun_entity ?? '', t('cfgSunEntityPh'), 'sun.',
      (v) => { this.onSceneSettingsChange?.({ sun_entity: v }); },
    ), t('helpSunEntity'));

    field(t('cfgWeatherEntity'), entityAutocomplete(
      settings.weather_entity ?? this.getConfig?.()?.weather_entity ?? '', t('cfgWeatherEntityPh'), 'weather.',
      (v) => { this.onSceneSettingsChange?.({ weather_entity: v }); },
    ), t('helpWeatherEntity'));

    // ── Simulation ────────────────────────────────────────────────────
    sec(t('cfgSim'));

    const simContainer = document.createElement('div');
    simContainer.style.cssText = 'margin-bottom:4px;';
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

  private _buildPropsSection(container: HTMLDivElement, key: string, anchor: EditableAnchor, goBack?: () => void) {
    container.innerHTML = '';

    const domain = anchor.entity.split('.')[0];
    const kind: AnchorKind = anchor.kind ?? 'entity';
    const isEntityKind = kind === 'entity';
    // Les réglages de lumière, de précision et d'action n'ont de sens que pour
    // une ancre liée à une entité.
    const isLight = isEntityKind && domain === 'light';
    const isSensor = isEntityKind && (domain === 'sensor' || domain === 'binary_sensor');

    // ── Back navigation ───────────────────────────────────────────────
    if (goBack) {
      const nav = document.createElement('div');
      nav.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 0 10px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:12px;';
      const backBtn = document.createElement('button');
      backBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.35);font-size:12px;padding:0;line-height:1;transition:color .12s;display:flex;align-items:center;gap:4px;font-family:inherit;';
      backBtn.innerHTML = `← <span style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">${t('backAnchors')}</span>`;
      backBtn.addEventListener('mouseenter', () => { backBtn.style.color = '#7dd3fc'; });
      backBtn.addEventListener('mouseleave', () => { backBtn.style.color = 'rgba(255,255,255,0.35)'; });
      backBtn.addEventListener('click', goBack);
      nav.appendChild(backBtn);
      container.appendChild(nav);
    }

    // ── Section divider ──────────────────────────────────────────────
    const secDiv = (label: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      d.textContent = label;
      container.appendChild(d);
    };

    // ── Field helper ─────────────────────────────────────────────────
    const field = (labelText: string, el: HTMLElement, parent = container) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;';
      lbl.textContent = labelText;
      wrap.appendChild(lbl); wrap.appendChild(el);
      parent.appendChild(wrap);
    };

    // ── Slider helper ────────────────────────────────────────────────
    const sliderField = (labelText: string, min: number, max: number, step: number, value: number, color: string, fmt: (v: number) => string, onChange: (v: number) => void) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;';
      lbl.textContent = labelText;
      const val = document.createElement('span');
      val.style.cssText = 'font-size:10px;color:#e2e8f0;font-weight:600;';
      val.textContent = fmt(value);
      hdr.appendChild(lbl); hdr.appendChild(val);
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = String(step); sl.value = String(value);
      sl.style.cssText = `width:100%;cursor:pointer;margin:0;accent-color:${color};`;
      sl.addEventListener('pointerdown', () => { this._editorDragging = true; });
      sl.addEventListener('pointerup', () => { this._editorDragging = false; this.scheduleAutoSave(); });
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        val.textContent = fmt(v);
        onChange(v);
        this.syncLightsToScene();
        this.requestRender();
      });
      wrap.appendChild(hdr); wrap.appendChild(sl);
      container.appendChild(wrap);
    };

    const inputStyle = [
      'width:100%', 'box-sizing:border-box',
      'background:rgba(255,255,255,0.04)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:7px', 'color:#e2e8f0', 'padding:6px 9px',
      'font-size:11px', 'outline:none', 'font-family:inherit',
      'transition:border-color .15s',
    ].join(';');

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    title.textContent = anchorTitle(anchor);
    container.appendChild(title);
    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    subtitle.textContent = anchorSubtitle(anchor);
    container.appendChild(subtitle);

    // ── Section: Nature ──────────────────────────────────────────────
    // La nature commande tout le reste du panneau : changer de nature
    // reconstruit la section pour n'afficher que les champs pertinents.
    secDiv(t('anchorSectionKind'));
    {
      const kindSel = document.createElement('select');
      kindSel.style.cssText = inputStyle + SELECT_STYLE;
      const kinds: [AnchorKind, string][] = [
        ['entity', t('anchorKindEntity')],
        ['label',  t('anchorKindLabel')],
        ['menu',   t('anchorKindMenu')],
        ['nav',    t('anchorKindNav')],
      ];
      for (const [val, lab] of kinds) {
        const o = styleOption(document.createElement('option'));
        o.value = val; o.textContent = lab;
        if (kind === val) o.selected = true;
        kindSel.appendChild(o);
      }
      kindSel.addEventListener('change', () => {
        const next = kindSel.value as AnchorKind;
        this.getEditor()?.updateAnchor(key, { kind: next === 'entity' ? undefined : next });
        this.scheduleAutoSave();
        // Rechargement complet : les champs affichés dépendent de la nature.
        const fresh = this.getEditor()?.anchors.get(key);
        if (fresh) this._buildPropsSection(container, key, fresh, goBack);
      });
      field(t('anchorFieldKind'), kindSel);

      const kindHint = document.createElement('div');
      kindHint.style.cssText = 'font-size:9px;color:#475569;margin-top:-5px;margin-bottom:8px;line-height:1.5;';
      kindHint.textContent = t(
        kind === 'label' ? 'anchorKindLabelHint'
        : kind === 'menu' ? 'anchorKindMenuHint'
        : kind === 'nav' ? 'anchorKindNavHint'
        : 'anchorKindEntityHint',
      );
      container.appendChild(kindHint);
    }

    // ── Section: Liaison HA ──────────────────────────────────────────
    if (isEntityKind) secDiv(t('anchorSectionHA'));

    const entityWrap = document.createElement('div');
    entityWrap.style.cssText = 'position:relative;';
    const entityInput = document.createElement('input');
    entityInput.value = anchor.entity;
    entityInput.placeholder = 'light.salon, switch.tv…';
    entityInput.style.cssText = inputStyle;
    entityInput.addEventListener('focus', () => { entityInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
    entityInput.addEventListener('blur', () => { entityInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
    entityInput.addEventListener('change', () => {
      const v = entityInput.value.trim();
      if (v) { this.getEditor()?.updateAnchor(key, { entity: v }); this.scheduleAutoSave(); }
    });
    // Le champ reste libre (coller un entity_id est parfois le plus rapide),
    // mais le bouton ouvre le vrai sélecteur : pièces, états, recherche.
    // Un datalist de 469 entrées ne rendait aucun de ces services.
    const browseBtn = document.createElement('button');
    browseBtn.textContent = t('anchorBrowse');
    browseBtn.title = t('pickTitle');
    browseBtn.style.cssText = 'flex:0 0 auto;background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.3);border-radius:7px;color:#7dd3fc;font-size:11px;padding:6px 10px;cursor:pointer;font-family:inherit;';
    browseBtn.addEventListener('click', () => {
      const hass = this.getHass();
      if (!hass) return;
      const placed = new Set<string>();
      this.getEditor()?.anchors.forEach((a) => { if (a.entity) placed.add(a.entity); });
      openEntityPicker({
        container: this.overlayContainer,
        hass,
        placed,
        onPick: (entity, name) => {
          entityInput.value = entity;
          this.getEditor()?.updateAnchor(key, {
            entity,
            // Un libellé encore au défaut de l'ancienne entité n'a plus de sens.
            ...(anchor.label === anchor.entity.split('.')[1] ? { label: name } : {}),
          });
          this.scheduleAutoSave();
          this.updateAnchorList();
        },
      });
    });

    entityWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
    entityInput.style.cssText = inputStyle + ';flex:1;min-width:0;';
    entityInput.removeAttribute('list');
    entityWrap.appendChild(entityInput);
    entityWrap.appendChild(browseBtn);
    if (isEntityKind) field(t('anchorFieldEntity'), entityWrap);

    const labelInput = document.createElement('input');
    labelInput.value = anchor.label;
    labelInput.placeholder = t('anchorNamePh');
    labelInput.style.cssText = inputStyle;
    labelInput.addEventListener('focus', () => { labelInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
    labelInput.addEventListener('blur', () => { labelInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
    labelInput.addEventListener('change', () => {
      this.getEditor()?.updateAnchor(key, { label: labelInput.value.trim() || anchorTitle(anchor) });
      this.scheduleAutoSave();
    });
    field(t('anchorFieldName'), labelInput);

    // ── Nature `nav` : vue cible ──────────────────────────────────────
    if (kind === 'nav') {
      secDiv(t('anchorSectionNav'));
      const views = this.getViews?.() ?? [];
      const viewSel = document.createElement('select');
      viewSel.style.cssText = inputStyle + SELECT_STYLE;
      const none = styleOption(document.createElement('option'));
      none.value = ''; none.textContent = t('anchorNavNone');
      viewSel.appendChild(none);
      for (const v of views) {
        const o = styleOption(document.createElement('option'));
        o.value = v.id ?? ''; o.textContent = v.label;
        if (anchor.navViewId === v.id) o.selected = true;
        viewSel.appendChild(o);
      }
      viewSel.addEventListener('change', () => {
        this.getEditor()?.updateAnchor(key, { navViewId: viewSel.value || undefined });
        this.scheduleAutoSave();
      });
      field(t('anchorNavView'), viewSel);
      if (!views.length) {
        const warn = document.createElement('div');
        warn.style.cssText = 'font-size:9px;color:#fbbf24;margin-top:-5px;margin-bottom:8px;';
        warn.textContent = t('anchorNavNoViews');
        container.appendChild(warn);
      }
    }

    // ── Nature `menu` : roue d'actions ────────────────────────────────
    if (kind === 'menu') {
      secDiv(t('anchorSectionActions'));
      const listWrap = document.createElement('div');
      container.appendChild(listWrap);

      const getActions = (): import('../types').AnchorAction[] =>
        this.getEditor()?.anchors.get(key)?.actions ?? [];

      const writeActions = (next: import('../types').AnchorAction[]) => {
        this.getEditor()?.updateAnchor(key, { actions: next });
        this.scheduleAutoSave();
        renderActions();
      };

      const renderActions = () => {
        listWrap.innerHTML = '';
        const actions = getActions();

        actions.forEach((act, idx) => {
          const row = document.createElement('div');
          row.style.cssText = 'border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px;margin-bottom:6px;display:flex;flex-direction:column;gap:5px;';

          const head = document.createElement('div');
          head.style.cssText = 'display:flex;gap:5px;align-items:center;';

          const labInp = document.createElement('input');
          labInp.value = act.label;
          labInp.placeholder = t('anchorActionLabelAuto');
          labInp.style.cssText = inputStyle + ';flex:1;min-width:0;';
          labInp.addEventListener('change', () => {
            const next = [...getActions()];
            next[idx] = { ...next[idx], label: labInp.value.trim() };
            writeActions(next);
          });

          const icoInp = document.createElement('input');
          icoInp.value = act.icon ?? '';
          icoInp.placeholder = 'mdi:…';
          icoInp.style.cssText = inputStyle + ';width:92px;flex:0 0 auto;';
          icoInp.addEventListener('change', () => {
            const next = [...getActions()];
            next[idx] = { ...next[idx], icon: icoInp.value.trim() || undefined };
            writeActions(next);
          });

          const del = document.createElement('button');
          del.textContent = '×';
          del.title = t('anchorActionDelete');
          del.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.7);cursor:pointer;font-size:15px;padding:0 3px;line-height:1;flex:0 0 auto;';
          del.addEventListener('click', () => writeActions(getActions().filter((_, j) => j !== idx)));

          head.append(labInp, icoInp, del);
          row.appendChild(head);

          const typeSel = document.createElement('select');
          typeSel.style.cssText = inputStyle + SELECT_STYLE;
          const typeOpts: [string, string][] = [
            ['entity', t('anchorActionEntity')],
            ['service', t('anchorActionService')],
            ['view', t('anchorActionView')],
          ];
          for (const [v, l] of typeOpts) {
            const o = styleOption(document.createElement('option'));
            o.value = v; o.textContent = l;
            if (act.type === v) o.selected = true;
            typeSel.appendChild(o);
          }
          typeSel.addEventListener('change', () => {
            const next = [...getActions()];
            next[idx] = { ...next[idx], type: typeSel.value as 'service' | 'view' };
            writeActions(next);
          });
          row.appendChild(typeSel);

          if (act.type === 'entity') {
            // Tout vient du descripteur : il n'y a que la cible a choisir.
            const target = this._entityField(
              act.entity_id ?? (act.service_data?.entity_id as string) ?? '',
              inputStyle,
              (v) => {
                const next = [...getActions()];
                next[idx] = { ...next[idx], entity_id: v || undefined };
                writeActions(next);
              },
            );
            row.appendChild(target.wrap);
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
            vs.addEventListener('change', () => {
              const next = [...getActions()];
              next[idx] = { ...next[idx], view_id: vs.value || undefined };
              writeActions(next);
            });
            row.appendChild(vs);
          } else {
            // Un seul champ « domaine.service » : plus court a saisir que deux,
            // et c'est la forme sous laquelle HA les documente.
            const svc = document.createElement('input');
            svc.value = act.domain && act.service ? act.domain + '.' + act.service : '';
            svc.placeholder = t('anchorActionServicePh');
            svc.style.cssText = inputStyle;
            svc.addEventListener('change', () => {
              const parts = svc.value.trim().split('.');
              const d = parts.shift();
              const next = [...getActions()];
              next[idx] = { ...next[idx], domain: d || undefined, service: parts.join('.') || undefined };
              writeActions(next);
            });
            row.appendChild(svc);

            const target = this._entityField(
              (act.service_data?.entity_id as string) ?? '',
              inputStyle,
              (v) => {
                const next = [...getActions()];
                const data: Record<string, unknown> = { ...(next[idx].service_data ?? {}) };
                if (v) data.entity_id = v; else delete data.entity_id;
                next[idx] = { ...next[idx], service_data: Object.keys(data).length ? data : undefined };
                writeActions(next);
              },
            );
            row.appendChild(target.wrap);
          }

          // Une action de service sans service ne fait rien : le dire, plutot
          // que de laisser une entree muette dans la roue.
          const missing =
            act.type === 'entity' ? (!act.entity_id && !act.service_data?.entity_id ? t('anchorActionNoEntity') : null)
            : act.type === 'service' ? (!act.domain || !act.service ? t('anchorActionNoService') : null)
            : (!act.view_id ? t('anchorActionNoView') : null);
          if (missing) {
            const warn = document.createElement('div');
            warn.style.cssText = 'font-size:9px;color:#fbbf24;line-height:1.4;';
            warn.textContent = missing;
            row.appendChild(warn);
          }

          listWrap.appendChild(row);
        });

        if (!actions.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'font-size:10px;color:#475569;text-align:center;padding:8px 0;';
          empty.textContent = t('anchorActionEmpty');
          listWrap.appendChild(empty);
        }

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:5px;';

        // Voie principale : composer un groupe en cochant plusieurs entités.
        // Passer par « ajouter une action » puis « choisir le type » pour chaque
        // entité était le vrai irritant.
        const addEntities = document.createElement('button');
        addEntities.textContent = t('anchorActionAddEntities');
        addEntities.style.cssText = 'flex:1;background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.3);border-radius:6px;color:#7dd3fc;padding:6px 10px;font-size:10px;font-family:inherit;cursor:pointer;';
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
              ...ids
                .filter((id) => !already.has(id))
                .map((id, n) => ({
                  id: `act_${Date.now()}_${n}`,
                  label: '',
                  type: 'entity' as const,
                  entity_id: id,
                })),
            ]),
          });
        });

        const add = document.createElement('button');
        add.textContent = t('anchorActionAdd');
        add.title = t('anchorActionAddHint');
        add.style.cssText = 'flex:0 0 auto;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);border-radius:6px;color:#64748b;padding:6px 10px;font-size:10px;font-family:inherit;cursor:pointer;';
        add.addEventListener('click', () => writeActions([
          ...getActions(),
          { id: 'act_' + Date.now(), label: '', type: 'entity' },
        ]));

        btnRow.append(addEntities, add);
        listWrap.appendChild(btnRow);
      };

      renderActions();
    }

    // Icon override — use HA's <ha-icon-picker> for visual autocomplete, fallback to plain input
    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const haIconPicker = customElements.get('ha-icon-picker') != null;
    if (haIconPicker) {
      const picker = document.createElement('ha-icon-picker') as HTMLElement & { value?: string; label?: string };
      picker.setAttribute('value', anchor.icon ?? '');
      picker.setAttribute('label', '');
      picker.style.cssText = 'flex:1;--mdc-text-field-fill-color:rgba(255,255,255,0.04);--mdc-theme-primary:rgba(125,209,252,0.8);';
      picker.addEventListener('value-changed', ((e: CustomEvent) => {
        const v = (e.detail?.value as string) || undefined;
        this.getEditor()?.updateAnchor(key, { icon: v });
        this.scheduleAutoSave();
        // Update preview
        if (preview) preview.setAttribute('icon', v ?? '');
      }) as EventListener);
      iconWrap.appendChild(picker);
    } else {
      // Fallback: plain text input
      const iconInput = document.createElement('input');
      iconInput.value = anchor.icon ?? '';
      iconInput.placeholder = 'mdi:thermometer';
      iconInput.style.cssText = inputStyle + ';flex:1;';
      iconInput.addEventListener('focus', () => { iconInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
      iconInput.addEventListener('blur', () => { iconInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
      iconInput.addEventListener('change', () => {
        const v = iconInput.value.trim() || undefined;
        this.getEditor()?.updateAnchor(key, { icon: v });
        this.scheduleAutoSave();
        if (preview) preview.setAttribute('icon', v ?? '');
      });
      iconWrap.appendChild(iconInput);
    }

    // Live preview of the chosen icon
    const preview = document.createElement('ha-icon') as HTMLElement;
    preview.setAttribute('icon', anchor.icon ?? 'mdi:help-circle-outline');
    preview.style.cssText = '--mdi-icon-size:20px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);flex-shrink:0;';
    if (anchor.icon) preview.style.color = '#7dd3fc';
    iconWrap.appendChild(preview);

    field(t('anchorFieldIcon') || 'Icon', iconWrap);

    // ── Section: Comportement ─────────────────────────────────────────
    // Surcharges par ancre : le descripteur du domaine donne un défaut correct,
    // ces champs servent aux cas particuliers (déverrouiller une serrure depuis
    // la scène, neutraliser un appui, forcer une couleur de repérage).
    if (isEntityKind) {
      secDiv(t('anchorSectionBehavior'));

      const tapSel = document.createElement('select');
      tapSel.style.cssText = inputStyle + SELECT_STYLE;
      const tapOptions: [string, string][] = [
        ['default', t('anchorTapDefault')],
        ['toggle', t('anchorTapToggle')],
        ['more_info', t('anchorTapMoreInfo')],
        ['activate', t('anchorTapActivate')],
        ['media_play_pause', t('anchorTapPlayPause')],
        ['none', t('anchorTapNone')],
      ];
      for (const [val, label] of tapOptions) {
        const o = styleOption(document.createElement('option'));
        o.value = val; o.textContent = label;
        if ((anchor.tapAction ?? 'default') === val) o.selected = true;
        tapSel.appendChild(o);
      }
      tapSel.addEventListener('change', () => {
        const v = tapSel.value === 'default' ? undefined : (tapSel.value as TapAction);
        this.getEditor()?.updateAnchor(key, { tapAction: v });
        this.scheduleAutoSave();
      });
      field(t('anchorFieldTap'), tapSel);

      // La couleur d'une lampe vient de l'entité elle-même : la surcharger
      // n'aurait pas de sens.
      if (!isLight) {
        const colorWrap = document.createElement('div');
        colorWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = anchor.color ?? '#44aaff';
        colorInput.style.cssText = 'width:38px;height:28px;padding:0;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:transparent;cursor:pointer;';
        colorInput.addEventListener('change', () => {
          this.getEditor()?.updateAnchor(key, { color: colorInput.value });
          this.scheduleAutoSave();
        });

        const resetBtn = document.createElement('button');
        resetBtn.textContent = t('anchorColorAuto');
        resetBtn.style.cssText = 'flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#94a3b8;font-size:10px;padding:6px;cursor:pointer;font-family:inherit;';
        resetBtn.addEventListener('click', () => {
          this.getEditor()?.updateAnchor(key, { color: undefined });
          this.scheduleAutoSave();
          resetBtn.style.color = '#94a3b8';
        });

        colorWrap.appendChild(colorInput);
        colorWrap.appendChild(resetBtn);
        field(t('anchorFieldColor'), colorWrap);

        const colorHint = document.createElement('div');
        colorHint.style.cssText = 'font-size:9px;color:#475569;margin-top:-5px;margin-bottom:8px;';
        colorHint.textContent = t('anchorColorHint');
        container.appendChild(colorHint);
      }
    }

    // ── Section: Sensor precision ─────────────────────────────────────
    if (isSensor) {
      secDiv('Capteur');
      const precInput = document.createElement('input');
      precInput.type = 'number';
      precInput.min = '0';
      precInput.max = '6';
      precInput.step = '1';
      precInput.value = anchor.precision !== undefined ? String(anchor.precision) : '';
      precInput.placeholder = 'auto';
      precInput.style.cssText = inputStyle;
      precInput.addEventListener('focus', () => { precInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
      precInput.addEventListener('blur', () => { precInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
      precInput.addEventListener('change', () => {
        const v = precInput.value === '' ? undefined : parseInt(precInput.value, 10);
        this.getEditor()?.updateAnchor(key, { precision: v });
        this.scheduleAutoSave();
      });
      field('Précision (décimales)', precInput);
      const precHint = document.createElement('div');
      precHint.style.cssText = 'font-size:9px;color:#475569;margin-top:-5px;margin-bottom:8px;';
      precHint.textContent = 'Ex : 0 → "18", 1 → "17.6"';
      container.appendChild(precHint);
    }

    // ── Section: Lumière ─────────────────────────────────────────────
    if (isLight) {
      secDiv(t('anchorSectionLight'));

      sliderField(t('anchorLightIntensity'), 0.1, 3, 0.1, anchor.lightIntensity ?? 1, '#fbbf24',
        (v) => `×${v.toFixed(1)}`,
        (v) => this.getEditor()?.updateAnchor(key, { lightIntensity: v }),
      );

      // Style buttons
      const styleRow = document.createElement('div');
      styleRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px;';
      const styleConfigs: { id: import('../types').LightStyle; label: string; icon: string }[] = [
        { id: 'point', label: t('lightStyleAmbient'), icon: '○' },
        { id: 'spot',  label: t('lightStyleSpot'),    icon: '◎' },
        { id: 'beam',  label: t('lightStyleBeam'),    icon: '⊙' },
      ];
      let currentStyle = anchor.lightStyle ?? 'point';
      const styleBtns: HTMLButtonElement[] = [];
      let dirSection: HTMLDivElement | null = null;

      const syncStyleBtns = () => {
        styleBtns.forEach((b, i) => {
          const on = styleConfigs[i].id === currentStyle;
          b.style.background = on ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)';
          b.style.color = on ? '#fbbf24' : 'rgba(255,255,255,0.4)';
          b.style.borderColor = on ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.08)';
        });
      };

      styleConfigs.forEach(({ id, label, icon }) => {
        const btn = document.createElement('button');
        btn.style.cssText = [
          'border:1px solid rgba(255,255,255,0.08)',
          'border-radius:7px', 'padding:5px 2px', 'cursor:pointer',
          'font-size:10px', 'font-family:inherit', 'line-height:1.3',
          'transition:all .15s', 'color:rgba(255,255,255,0.4)',
          'background:rgba(255,255,255,0.05)',
          'display:flex', 'flex-direction:column', 'align-items:center', 'gap:2px',
        ].join(';');
        btn.innerHTML = `<span style="font-size:14px">${icon}</span><span>${label}</span>`;
        btn.addEventListener('click', () => {
          currentStyle = id;
          syncStyleBtns();
          this.getEditor()?.updateAnchor(key, { lightStyle: id });
          if (dirSection) dirSection.style.display = (id === 'spot' || id === 'beam') ? 'block' : 'none';
          this.scheduleAutoSave();
        });
        styleBtns.push(btn);
        styleRow.appendChild(btn);
      });
      syncStyleBtns();
      container.appendChild(styleRow);

      // ── Section: Orientation ─────────────────────────────────────
      dirSection = document.createElement('div');
      dirSection.style.display = (currentStyle === 'spot' || currentStyle === 'beam') ? 'block' : 'none';

      const dirHeader = document.createElement('div');
      dirHeader.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      dirHeader.textContent = t('anchorSectionOrientation');
      dirSection.appendChild(dirHeader);

      // Read-only Az/El display
      const dirDisplay = document.createElement('div');
      dirDisplay.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';

      const dirReadout = document.createElement('span');
      dirReadout.style.cssText = 'font-size:11px;color:#e2e8f0;font-weight:600;font-variant-numeric:tabular-nums;flex:1;';
      const dirToAzElStr = (dir?: [number, number, number]) => {
        const [dx, dy, dz] = dir ?? [0, -1, 0];
        const elRad = Math.asin(Math.max(-1, Math.min(1, -dy)));
        const elDeg = elRad * 180 / Math.PI;
        const az = Math.atan2(dx, dz);
        const azDeg = Math.round(((az * 180 / Math.PI) + 360) % 360);
        const sign = elDeg >= 0 ? '↓' : '↑';
        return `Az ${azDeg}°  ${sign}${Math.abs(Math.round(elDeg))}°`;
      };
      dirReadout.textContent = dirToAzElStr(anchor.lightDirection);
      dirDisplay.appendChild(dirReadout);

      const gizmoHint = document.createElement('span');
      gizmoHint.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.28);line-height:1.4;text-align:right;';
      gizmoHint.innerHTML = t('orientationGizmoHint');
      dirDisplay.appendChild(gizmoHint);

      dirSection.appendChild(dirDisplay);
      container.appendChild(dirSection);
    }

    // ── Section: Visibilité conditionnelle ────────────────────────────
    secDiv(t('anchorSectionVisibility'));
    this._buildVisibleIfSection(container, `anc-${key}`, anchor.visibleIf, inputStyle, (cond) => {
      this.getEditor()?.updateAnchor(key, { visibleIf: cond });
      this.scheduleAutoSave();
    });

    // ── Section: Gérer ───────────────────────────────────────────────
    secDiv(t('anchorSectionManage'));

    const actRow = document.createElement('div');
    actRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

    const dupBtn = document.createElement('button');
    dupBtn.style.cssText = [
      'background:rgba(255,255,255,0.06)', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:8px', 'color:#e2e8f0', 'padding:7px 4px',
      'font-size:10px', 'font-family:inherit', 'cursor:pointer',
      'transition:all .15s',
    ].join(';');
    dupBtn.innerHTML = t('anchorBtnDuplicate');
    dupBtn.title = 'Ctrl+D';
    dupBtn.addEventListener('mouseenter', () => { dupBtn.style.background = 'rgba(255,255,255,0.12)'; });
    dupBtn.addEventListener('mouseleave', () => { dupBtn.style.background = 'rgba(255,255,255,0.06)'; });
    dupBtn.addEventListener('click', () => this.getEditor()?.duplicate());

    const delBtn = document.createElement('button');
    delBtn.style.cssText = [
      'background:rgba(239,68,68,0.1)', 'border:1px solid rgba(239,68,68,0.25)',
      'border-radius:8px', 'color:#f87171', 'padding:7px 4px',
      'font-size:10px', 'font-family:inherit', 'cursor:pointer',
      'transition:all .15s',
    ].join(';');
    delBtn.innerHTML = t('anchorBtnDelete');
    delBtn.title = t('anchorDeleteTitle');
    delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'rgba(239,68,68,0.25)'; delBtn.style.borderColor = 'rgba(239,68,68,0.5)'; });
    delBtn.addEventListener('mouseleave', () => { delBtn.style.background = 'rgba(239,68,68,0.1)'; delBtn.style.borderColor = 'rgba(239,68,68,0.25)'; });
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm === '1') {
        this.getEditor()?.deleteSelected();
      } else {
        delBtn.dataset.confirm = '1';
        delBtn.innerHTML = t('anchorBtnConfirm');
        delBtn.style.background = 'rgba(239,68,68,0.35)';
        delBtn.style.borderColor = 'rgba(239,68,68,0.65)';
        setTimeout(() => {
          if (delBtn.dataset.confirm === '1') {
            delBtn.dataset.confirm = '';
            delBtn.innerHTML = t('anchorBtnDelete');
            delBtn.style.background = 'rgba(239,68,68,0.1)';
            delBtn.style.borderColor = 'rgba(239,68,68,0.25)';
          }
        }, 3000);
      }
    });

    actRow.appendChild(dupBtn); actRow.appendChild(delBtn);
    container.appendChild(actRow);
  }

  updateAnchorList() {
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
    }, 2000);
  }

  showStatusBar(text: string) {
    let bar = this.cardContainer.querySelector<HTMLElement>('#editor-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'editor-status-bar';
      Object.assign(bar.style, {
        position: 'absolute',
        bottom: '48px',
        left: '50%',
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
      container.appendChild(mkToggle('Afficher le nom', card.show?.name !== false, (v) => this._updateCard(card.id, { show: { ...card.show, name: v } } as Partial<import('../cards/types').InfoCard>)));
      container.appendChild(mkToggle('Afficher le sous-titre', card.show?.subtitle !== false, (v) => this._updateCard(card.id, { show: { ...card.show, subtitle: v } } as Partial<import('../cards/types').InfoCard>)));
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
  private _buildVisibleIfSection(
    container: HTMLElement,
    idPrefix: string,
    current: import('../rules/types').EntityCondition | undefined,
    inputStyle: string,
    onApply: (cond: import('../rules/types').EntityCondition | undefined) => void,
  ) {
    const hass = this.getHass();
    const ops: [string, string][] = [
      ['eq', t('opEq')], ['neq', t('opNeq')],
      ['gt', t('opGt')], ['lt',  t('opLt')],
      ['gte', t('opGte')], ['lte', t('opLte')],
      ['contains', t('opContains')],
    ];

    // negate: true → "Masquer si" (hidden when condition is true)
    //         false → "Afficher si" (visible when condition is true)
    // Default for new conditions: true (most natural use case)
    let negate = current ? (current.negate ?? false) : true;

    // Toggle row (enable/disable the whole section)
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!current;
    toggle.style.cssText = 'cursor:pointer;flex-shrink:0;accent-color:#7dd3fc;';
    const toggleLbl = document.createElement('span');
    toggleLbl.style.cssText = 'font-size:11px;color:#94a3b8;cursor:pointer;';
    toggleLbl.textContent = t('visibilityCondition');
    toggleRow.appendChild(toggle); toggleRow.appendChild(toggleLbl);
    toggleLbl.addEventListener('click', () => toggle.click());
    container.appendChild(toggleRow);

    // Fields (hidden until toggle on)
    const fields = document.createElement('div');
    fields.style.cssText = `display:${current ? 'block' : 'none'};`;
    container.appendChild(fields);

    // Mode row: [Masquer si] [Afficher si]
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;';
    const mkModeBtn = (label: string, active: boolean) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `background:${active ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.04)'};border:1px solid ${active ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)'};border-radius:6px;color:${active ? '#f87171' : '#64748b'};padding:5px 4px;font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s;`;
      return btn;
    };
    const btnHide = mkModeBtn(t('visibilityHideIf'), negate);
    const btnShow = mkModeBtn(t('visibilityShowIf'), !negate);
    const setMode = (hide: boolean) => {
      negate = hide;
      btnHide.style.cssText = `background:${hide ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.04)'};border:1px solid ${hide ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)'};border-radius:6px;color:${hide ? '#f87171' : '#64748b'};padding:5px 4px;font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s;`;
      btnShow.style.cssText = `background:${!hide ? 'rgba(134,239,172,0.15)' : 'rgba(255,255,255,0.04)'};border:1px solid ${!hide ? 'rgba(134,239,172,0.4)' : 'rgba(255,255,255,0.1)'};border-radius:6px;color:${!hide ? '#86efac' : '#64748b'};padding:5px 4px;font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s;`;
    };
    // Sync initial show-mode color
    setMode(negate);
    btnHide.addEventListener('click', () => { setMode(true); apply(); });
    btnShow.addEventListener('click', () => { setMode(false); apply(); });
    modeRow.appendChild(btnHide); modeRow.appendChild(btnShow);
    fields.appendChild(modeRow);

    // Entity input
    const entityWrap = document.createElement('div');
    entityWrap.style.cssText = 'margin-bottom:4px;';
    const entityField = this._entityField(current?.entity_id ?? '', inputStyle, () => apply());
    const entityInp = entityField.input;
    entityWrap.appendChild(entityField.wrap);
    fields.appendChild(entityWrap);

    // State hint (current state of selected entity)
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:6px;min-height:14px;padding-left:2px;';
    fields.appendChild(hint);

    // Operator + value row
    const condRow = document.createElement('div');
    condRow.style.cssText = 'display:grid;grid-template-columns:90px 1fr;gap:5px;margin-bottom:6px;';
    const opSel = document.createElement('select');
    opSel.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e2e8f0;padding:5px 6px;font-size:11px;outline:none;font-family:inherit;' + SELECT_STYLE;
    ops.forEach(([v, l]) => {
      const o = styleOption(document.createElement('option')); o.value = v; o.textContent = l;
      if (current?.operator === v) o.selected = true;
      opSel.appendChild(o);
    });
    const valDlId = `${idPrefix}-val`;
    const valInp = document.createElement('input');
    valInp.value = String(current?.value ?? '');
    valInp.placeholder = t('condValuePh');
    valInp.setAttribute('list', valDlId);
    valInp.style.cssText = inputStyle;
    const valDl = document.createElement('datalist');
    valDl.id = valDlId;
    condRow.appendChild(opSel);
    condRow.appendChild(valInp);
    fields.appendChild(condRow);
    fields.appendChild(valDl);

    // Helper: refresh hint + value suggestions for a given entity_id
    const refreshEntityContext = (eid: string) => {
      const stateObj = hass?.states[eid];
      if (!stateObj) { hint.textContent = ''; valDl.innerHTML = ''; return; }

      const friendlyName = (stateObj.attributes?.friendly_name as string) ?? '';
      hint.textContent = `${t('condCurrentState')} ${stateObj.state}${friendlyName ? `  ·  ${friendlyName}` : ''}`;

      valDl.innerHTML = '';
      const domain = eid.split('.')[0];
      const domainSuggestions = EditPanel._STATE_SUGGESTIONS[domain] ?? [];
      const selectOptions = stateObj.attributes?.options as string[] | undefined;
      const suggestions = selectOptions?.length
        ? selectOptions
        : domainSuggestions.length
          ? domainSuggestions
          : [stateObj.state];
      const all = [...new Set([...suggestions, stateObj.state])];
      for (const s of all) {
        const opt = document.createElement('option'); opt.value = s; valDl.appendChild(opt);
      }
    };

    if (current?.entity_id) refreshEntityContext(current.entity_id);

    // Apply logic — include negate in stored condition
    const apply = () => {
      const eid = entityInp.value.trim();
      const val = valInp.value.trim();
      const op = opSel.value as import('../rules/types').ConditionOperator;
      if (!eid || !val) return;
      onApply({ entity_id: eid, operator: op, value: val, negate });
    };

    entityInp.addEventListener('change', () => {
      refreshEntityContext(entityInp.value.trim());
      apply();
    });
    valInp.addEventListener('change', apply);
    opSel.addEventListener('change', apply);

    toggle.addEventListener('change', () => {
      fields.style.display = toggle.checked ? 'block' : 'none';
      if (!toggle.checked) onApply(undefined);
    });
  }

  // ── Rules UI ────────────────────────────────────────────────────────────────

  private _fillRulesList(pane: HTMLDivElement) {
    pane.innerHTML = '';

    const body = document.createElement('div');
    body.style.cssText = 'padding:2px 0 4px;';
    pane.appendChild(body);

    const rules = this.getRules ? this.getRules() : [];

    if (rules.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = `${t('rulesEmpty')}<br><span style="font-size:10px;opacity:.7">${t('rulesEmptyHint')}</span>`;
      body.appendChild(empty);
      return;
    }

    rules.forEach((rule) => {
      const enabled = rule.enabled !== false;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.04);transition:background .1s;cursor:pointer;${enabled ? '' : 'opacity:0.45;'}`;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.03)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });

      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:14px;flex-shrink:0;';
      icon.textContent = '⚡';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:11px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      labelEl.textContent = rule.label || `${t('ruleDefaultLabel')} ${rule.id.slice(-4)}`;

      const triggerSummary = document.createElement('div');
      triggerSummary.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;';
      const trig = rule.trigger;
      triggerSummary.textContent = trig.type === 'entity_state'
        ? `${trig.entity_id}${trig.to ? ` → ${trig.to}` : ''}`
        : trig.type;

      info.appendChild(labelEl);
      info.appendChild(triggerSummary);

      // Enable toggle
      const toggle = document.createElement('label');
      toggle.style.cssText = 'display:flex;align-items:center;cursor:pointer;flex-shrink:0;';
      toggle.title = enabled ? t('ruleToggleDisable') : t('ruleToggleEnable');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = enabled;
      chk.style.cssText = 'cursor:pointer;';
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        const newRules = (this.getRules?.() ?? []).map((r) =>
          r.id === rule.id ? { ...r, enabled: chk.checked } : r,
        );
        this.saveRules?.(newRules).then(() => this._fillRulesList(pane));
      });
      toggle.appendChild(chk);
      toggle.addEventListener('click', (e) => e.stopPropagation());

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.style.cssText = 'background:none;border:none;color:rgba(125,211,252,0.6);cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;';
      editBtn.textContent = '✎';
      editBtn.title = t('ruleEditTitle');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openRuleModal(rule, () => this._fillRulesList(pane));
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.5);cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;';
      delBtn.textContent = '×';
      delBtn.title = t('ruleDeleteTitle');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._pushRuleSnap();
        const newRules = (this.getRules?.() ?? []).filter((r) => r.id !== rule.id);
        this.saveRules?.(newRules).then(() => this._fillRulesList(pane));
      });

      row.addEventListener('click', () => this._openRuleModal(rule, () => this._fillRulesList(pane)));

      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(toggle);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      body.appendChild(row);
    });
  }

  private _openRuleModal(existing: OwlnestRule | null, onSaved: () => void) {
    document.getElementById('owlnest-rule-modal')?.remove();

    const inputStyle = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;padding:5px 8px;font-size:11px;outline:none;font-family:inherit;';
    const lblStyle   = 'font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;display:block;';
    const fieldStyle = 'margin-bottom:10px;';
    const hass = this.getHass();
    const views = this.getViews?.() ?? [];
    const cards = this.getCards?.() ?? [];

    // Working copy
    let draft: OwlnestRule = existing
      ? JSON.parse(JSON.stringify(existing)) as OwlnestRule
      : {
          id: `rule_${Date.now()}`,
          label: '',
          enabled: true,
          trigger: { type: 'entity_state', entity_id: '', to: '' },
          conditions: [],
          actions: [],
        };

    const dialog = document.createElement('dialog');
    dialog.id = 'owlnest-rule-modal';
    dialog.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'width:min(520px,92vw)', 'max-height:85vh',
      'background:rgba(6,10,22,0.97)', 'backdrop-filter:blur(20px)',
      'border:1px solid rgba(255,255,255,0.1)', 'border-radius:14px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.8)', 'padding:0',
      'color:#e2e8f0', 'font-family:var(--primary-font-family,sans-serif)',
      'display:flex', 'flex-direction:column', 'overflow:hidden', 'z-index:9999',
    ].join(';');
    dialog.addEventListener('keydown', (e) => e.stopPropagation());

    // Header
    const hdrEl = document.createElement('div');
    hdrEl.style.cssText = 'display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;gap:8px;';
    const hdrTitle = document.createElement('span');
    hdrTitle.style.cssText = 'font-size:12px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em;flex:1;';
    hdrTitle.textContent = existing ? t('ruleModalEdit') : t('ruleModalNew');
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;padding:5px 12px;font-size:11px;font-family:inherit;cursor:pointer;';
    closeBtn.textContent = t('ruleModalClose');
    closeBtn.addEventListener('click', () => { dialog.close(); dialog.remove(); });
    hdrEl.appendChild(hdrTitle);
    hdrEl.appendChild(closeBtn);
    dialog.appendChild(hdrEl);

    // Body
    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:14px 16px;';
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

    // ── Label ────────────────────────────────────────────────────────────────
    bodyEl.appendChild(secHdr(t('ruleModalGeneral')));
    const labelWrap = mk('div') as HTMLDivElement; labelWrap.style.cssText = fieldStyle;
    labelWrap.appendChild(mkLbl(t('ruleModalName')));
    const labelInp = mkInp(draft.label ?? '', t('ruleNameExPh'));
    labelInp.addEventListener('input', () => { draft.label = labelInp.value; });
    labelWrap.appendChild(labelInp);
    bodyEl.appendChild(labelWrap);

    // ── Trigger ──────────────────────────────────────────────────────────────
    bodyEl.appendChild(secHdr(t('ruleModalTrigger')));

    const trig = draft.trigger.type === 'entity_state' ? draft.trigger : { type: 'entity_state' as const, entity_id: '', to: '' };

    const trigEntityWrap = mk('div') as HTMLDivElement; trigEntityWrap.style.cssText = fieldStyle;
    trigEntityWrap.appendChild(mkLbl(t('ruleModalEntity')));
    const { wrap: tew, input: trigEntityInp } = mkEntityInput(trig.entity_id, 'trig-entity');
    trigEntityInp.addEventListener('input', () => { (draft.trigger as typeof trig).entity_id = trigEntityInp.value.trim(); });
    trigEntityWrap.appendChild(tew);
    bodyEl.appendChild(trigEntityWrap);

    const trigRow = mk('div') as HTMLDivElement;
    trigRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';

    const trigFromWrap = mk('div') as HTMLDivElement;
    trigFromWrap.appendChild(mkLbl(t('ruleModalFrom')));
    const trigFromInp = mkInp(trig.from ?? '', 'ex: off');
    trigFromInp.addEventListener('input', () => {
      const v = trigFromInp.value.trim();
      (draft.trigger as typeof trig).from = v || undefined;
    });
    trigFromWrap.appendChild(trigFromInp);

    const trigToWrap = mk('div') as HTMLDivElement;
    trigToWrap.appendChild(mkLbl(t('ruleModalTo')));
    const trigToInp = mkInp(trig.to ?? '', 'ex: on');
    trigToInp.addEventListener('input', () => {
      const v = trigToInp.value.trim();
      (draft.trigger as typeof trig).to = v || undefined;
    });
    trigToWrap.appendChild(trigToInp);

    trigRow.appendChild(trigFromWrap);
    trigRow.appendChild(trigToWrap);
    bodyEl.appendChild(trigRow);

    // ── Actions ──────────────────────────────────────────────────────────────
    bodyEl.appendChild(secHdr(t('ruleModalActions')));

    const actionsWrap = mk('div') as HTMLDivElement;
    bodyEl.appendChild(actionsWrap);

    const renderActions = () => {
      actionsWrap.innerHTML = '';
      draft.actions.forEach((action, idx) => {
        const aRow = mk('div') as HTMLDivElement;
        aRow.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px 10px;margin-bottom:6px;';

        const aHdr = mk('div') as HTMLDivElement;
        aHdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

        const typeSel = mk('select') as HTMLSelectElement;
        typeSel.style.cssText = inputStyle + 'flex:1;';
        [
          ['go_to_view',   t('ruleActionGoToView')],
          ['show_card',    t('ruleActionShowCard')],
          ['hide_card',    t('ruleActionHideCard')],
          ['call_service', t('ruleActionCallService')],
        ].forEach(([v, l]) => {
          const opt = mk('option') as HTMLOptionElement; opt.value = v; opt.textContent = l; typeSel.appendChild(opt);
        });
        typeSel.value = action.type;
        typeSel.addEventListener('change', () => {
          const newType = typeSel.value as Action['type'];
          if (newType === 'go_to_view')   draft.actions[idx] = { type: 'go_to_view', view_id: '' };
          if (newType === 'show_card')    draft.actions[idx] = { type: 'show_card', card_id: '' };
          if (newType === 'hide_card')    draft.actions[idx] = { type: 'hide_card', card_id: '' };
          if (newType === 'call_service') draft.actions[idx] = { type: 'call_service', domain: '', service: '' };
          renderActions();
        });

        const aDelBtn = mk('button') as HTMLButtonElement;
        aDelBtn.textContent = '×';
        aDelBtn.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.6);cursor:pointer;font-size:14px;padding:0 4px;';
        aDelBtn.addEventListener('click', () => { draft.actions.splice(idx, 1); renderActions(); });

        aHdr.appendChild(typeSel);
        aHdr.appendChild(aDelBtn);
        aRow.appendChild(aHdr);

        // Action-specific params
        if (action.type === 'go_to_view') {
          const sel = mk('select') as HTMLSelectElement;
          sel.style.cssText = inputStyle;
          const emptyOpt = mk('option') as HTMLOptionElement; emptyOpt.value = ''; emptyOpt.textContent = t('rulePickView'); sel.appendChild(emptyOpt);
          views.forEach((v) => {
            const opt = mk('option') as HTMLOptionElement; opt.value = v.id ?? ''; opt.textContent = v.label; sel.appendChild(opt);
          });
          sel.value = action.view_id;
          sel.addEventListener('change', () => { (draft.actions[idx] as typeof action).view_id = sel.value; });
          aRow.appendChild(sel);
        } else if (action.type === 'show_card' || action.type === 'hide_card') {
          const sel = mk('select') as HTMLSelectElement;
          sel.style.cssText = inputStyle;
          const emptyOpt = mk('option') as HTMLOptionElement; emptyOpt.value = ''; emptyOpt.textContent = t('rulePickCard'); sel.appendChild(emptyOpt);
          cards.forEach((c) => {
            const opt = mk('option') as HTMLOptionElement; opt.value = c.id; opt.textContent = c.name || c.id; sel.appendChild(opt);
          });
          sel.value = action.card_id;
          sel.addEventListener('change', () => { (draft.actions[idx] as typeof action).card_id = sel.value; });
          aRow.appendChild(sel);
        } else if (action.type === 'call_service') {
          const svcRow = mk('div') as HTMLDivElement;
          svcRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
          const domainInp = mkInp(action.domain, 'domain');
          domainInp.addEventListener('input', () => { (draft.actions[idx] as typeof action).domain = domainInp.value.trim(); });
          const serviceInp = mkInp(action.service, 'service');
          serviceInp.addEventListener('input', () => { (draft.actions[idx] as typeof action).service = serviceInp.value.trim(); });
          svcRow.appendChild(domainInp);
          svcRow.appendChild(serviceInp);
          aRow.appendChild(svcRow);
        }

        actionsWrap.appendChild(aRow);
      });

      // Add action button
      const addABtn = mk('button') as HTMLButtonElement;
      addABtn.textContent = t('ruleAddAction');
      addABtn.style.cssText = 'background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);border-radius:6px;color:#64748b;padding:6px 10px;font-size:10px;font-family:inherit;cursor:pointer;width:100%;margin-top:2px;';
      addABtn.addEventListener('click', () => {
        draft.actions.push({ type: 'go_to_view', view_id: '' });
        renderActions();
      });
      actionsWrap.appendChild(addABtn);
    };
    renderActions();

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = mk('div') as HTMLDivElement;
    footer.style.cssText = 'display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    const cancelBtn = mk('button') as HTMLButtonElement;
    cancelBtn.textContent = t('ruleModalCancel');
    cancelBtn.style.cssText = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#94a3b8;padding:8px;font-size:11px;font-family:inherit;cursor:pointer;';
    cancelBtn.addEventListener('click', () => { dialog.close(); dialog.remove(); });

    const saveBtn = mk('button') as HTMLButtonElement;
    saveBtn.textContent = t('ruleModalSave');
    saveBtn.style.cssText = 'flex:2;background:rgba(59,130,246,0.85);border:none;border-radius:8px;color:#fff;padding:8px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;';
    saveBtn.addEventListener('click', async () => {
      if (!draft.trigger.entity_id?.trim()) {
        trigEntityInp.style.borderColor = '#f87171';
        trigEntityInp.focus();
        return;
      }
      draft.label = labelInp.value.trim() || undefined;
      // Normalize empty strings to undefined so triggerFired doesn't reject real states
      const trig = draft.trigger as import('../rules/types').EntityStateTrigger;
      if (!trig.to?.trim())   trig.to   = undefined;
      if (!trig.from?.trim()) trig.from = undefined;
      const current = this.getRules?.() ?? [];
      const isNew = !current.find((r) => r.id === draft.id);
      const newRules = isNew ? [...current, draft] : current.map((r) => r.id === draft.id ? draft : r);
      this._pushRuleSnap();
      await this.saveRules?.(newRules);
      dialog.close();
      dialog.remove();
      onSaved();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    dialog.appendChild(footer);

    document.body.appendChild(dialog);
    dialog.showModal();
  }
}
