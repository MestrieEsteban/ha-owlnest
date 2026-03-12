import type { Hass, CardConfig, EditableAnchor, CameraView } from '../types';
import type { SceneCard, SceneCardType } from '../cards/types';
import { CARD_SCALE, CARD_DEFAULT_ACCENT, CARD_TYPE_LABELS } from '../cards/types';
import type { AnchorEditor, EditorTool } from '../editor';
import type { OwlnestRule, Action } from '../rules/types';

export class EditPanel {
  private _panel: HTMLDivElement | null = null;
  private _saveStatus: 'saved' | 'unsaved' | 'saving' = 'saved';
  private _editorDragging = false;
  private _gizmoDragging = false;
  private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
  ) {}

  showToolbar() {
    // Preserve existing view buttons so they stay visible in edit mode
    const existingViewBtns = Array.from(this.hudLeft.children) as HTMLElement[];
    this.hudLeft.innerHTML = '';
    this.hudRight.innerHTML = '';
    this.hudSep.style.display = 'none';

    // ── Tool buttons (left) ───────────────────────────────────────────
    const tools: Array<{ id: string; label: string; title: string }> = [
      { id: 'select', label: '↖', title: 'Sélectionner / Déplacer  (S)' },
      { id: 'add',    label: '＋', title: 'Ajouter ancre  (A)' },
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
    undoBtn.title = 'Annuler (Ctrl+Z)';
    undoBtn.style.cssText += ';color:rgba(255,255,255,0.55);font-size:14px;min-width:28px;padding:4px 7px;';
    undoBtn.addEventListener('click', () => this.getEditor()?.undo());

    const redoBtn = this._btn('↪', 'rgba(255,255,255,0.07)');
    redoBtn.title = 'Rétablir (Ctrl+Y)';
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
    }

    // ── Right: close ─────────────────────────────────────────────────
    const doneBtn = this._btn('Terminé', 'rgba(255,255,255,0.07)');
    doneBtn.style.color = 'rgba(255,255,255,0.6)';
    doneBtn.title = 'Quitter le mode édition (les modifications sont auto-sauvegardées)';
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
    hintBar.appendChild(hint('S', 'Sélect.'));
    hintBar.appendChild(hint('A', 'Ajouter'));
    hintBar.appendChild(hint('G', 'Saisir'));
    hintBar.appendChild(hint('G→X/Y/Z', 'axe'));
    hintBar.appendChild(hint('R', 'Rotation'));
    hintBar.appendChild(hint('X', 'Suppr.'));
    hintBar.appendChild(hint('H', 'Masquer'));
    hintBar.appendChild(hint('Ctrl+D', 'Dupliquer'));
    hintBar.appendChild(hint('Ctrl+Z', 'Annuler'));
    hintBar.appendChild(hint('Esc', 'Désélect.'));
    hintBar.appendChild(hint('Clic droit', 'Menu'));
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
    headerTitle.textContent = 'Scène';
    header.appendChild(headerTitle);
    if (this.getSceneId()) {
      const saveInd = document.createElement('span');
      saveInd.id = 'save-indicator';
      saveInd.style.cssText = 'font-size:10px;color:#22c55e;transition:color .2s;';
      saveInd.textContent = '✓ Sauvé';
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
      warn.textContent = '⚠ Aucun scene_id configuré — les modifications ne seront pas persistées.';
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

    // ── Tab header ────────────────────────────────────────────────────
    const TAB_DEFS = [
      { id: 'anchors', label: `Ancres${anchors.size > 0 ? ` (${anchors.size})` : ''}` },
      { id: 'cards',   label: `Cartes${cards.length > 0 ? ` (${cards.length})` : ''}` },
      { id: 'rules',   label: `Règles${rulesCount > 0 ? ` (${rulesCount})` : ''}` },
    ] as const;
    type TabId = typeof TAB_DEFS[number]['id'];

    // Determine which tab should be active by default
    const defaultTab: TabId = this.getSelectedCardId?.() ? 'cards' : 'anchors';
    let activeTab: TabId = defaultTab;

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';

    const tabBtns = new Map<TabId, HTMLButtonElement>();
    const tabPanes = new Map<TabId, HTMLDivElement>();

    const switchTab = (id: TabId) => {
      activeTab = id;
      tabBtns.forEach((b, k) => {
        const on = k === id;
        b.style.color = on ? '#7dd3fc' : 'rgba(255,255,255,0.3)';
        b.style.borderBottom = on ? '2px solid #7dd3fc' : '2px solid transparent';
        b.style.background = on ? 'rgba(125,209,252,0.06)' : 'transparent';
      });
      tabPanes.forEach((p, k) => { p.style.display = k === id ? 'flex' : 'none'; });
    };

    TAB_DEFS.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.style.cssText = 'flex:1;background:transparent;border:none;border-bottom:2px solid transparent;padding:7px 4px 5px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer;color:rgba(255,255,255,0.3);transition:all .15s;letter-spacing:.03em;';
      btn.textContent = label;
      btn.addEventListener('click', () => switchTab(id));
      tabBtns.set(id, btn);
      tabBar.appendChild(btn);

      const pane = document.createElement('div');
      pane.style.cssText = 'flex-direction:column;flex:1;min-height:0;overflow:hidden;display:none;';
      tabPanes.set(id, pane);
    });

    listView.appendChild(tabBar);
    tabPanes.forEach(p => listView.appendChild(p));

    // ── Anchors pane ─────────────────────────────────────────────────
    const anchorsPane = tabPanes.get('anchors')!;

    const batchBar = document.createElement('div');
    batchBar.style.cssText = 'display:flex;align-items:center;padding:5px 10px 3px;gap:4px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;';
    const countLbl = document.createElement('span');
    countLbl.id = 'anchor-count-lbl';
    countLbl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);flex:1;';
    countLbl.textContent = `${anchors.size} ancre${anchors.size !== 1 ? 's' : ''}`;
    const batchBtnStyle = 'background:none;border:none;cursor:pointer;padding:3px 6px;border-radius:5px;font-size:11px;color:rgba(255,255,255,0.35);transition:all .15s;';
    const showAllBtn = document.createElement('button');
    showAllBtn.title = 'Tout afficher'; showAllBtn.innerHTML = '● Tout'; showAllBtn.style.cssText = batchBtnStyle;
    showAllBtn.addEventListener('mouseenter', () => { showAllBtn.style.color = '#4ade80'; });
    showAllBtn.addEventListener('mouseleave', () => { showAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    showAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: false }));
    const hideAllBtn = document.createElement('button');
    hideAllBtn.title = 'Tout masquer'; hideAllBtn.innerHTML = '○ Aucun'; hideAllBtn.style.cssText = batchBtnStyle;
    hideAllBtn.addEventListener('mouseenter', () => { hideAllBtn.style.color = '#f87171'; });
    hideAllBtn.addEventListener('mouseleave', () => { hideAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    hideAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: true }));
    batchBar.appendChild(countLbl); batchBar.appendChild(showAllBtn); batchBar.appendChild(hideAllBtn);
    anchorsPane.appendChild(batchBar);

    const anchorsScroll = document.createElement('div');
    anchorsScroll.id = 'anchor-list-body';
    anchorsScroll.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:3px 0;';
    anchorsPane.appendChild(anchorsScroll);

    if (anchors.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = 'Aucune ancre<br><span style="font-size:10px;opacity:.7">Outil ＋ → clic sur le modèle</span>';
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
        nameEl.textContent = a.label || a.entity.split('.')[1];
        const entityEl = document.createElement('div');
        entityEl.style.cssText = `font-size:10px;color:${a.hidden ? 'rgba(255,255,255,0.15)' : color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;opacity:0.8;`;
        entityEl.textContent = a.entity;
        col.appendChild(nameEl); col.appendChild(entityEl);

        const rowBtnStyle = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:12px;flex-shrink:0;line-height:1;border-radius:4px;color:rgba(255,255,255,0.4);transition:all .12s;opacity:0;';
        const eyeBtn = document.createElement('button');
        eyeBtn.style.cssText = rowBtnStyle;
        eyeBtn.textContent = a.hidden ? '🙈' : '👁';
        eyeBtn.title = a.hidden ? 'Afficher (H)' : 'Masquer (H)';
        if (a.hidden) eyeBtn.style.opacity = '0.45';
        eyeBtn.addEventListener('mouseenter', () => { eyeBtn.style.opacity = '1'; eyeBtn.style.background = 'rgba(255,255,255,0.1)'; });
        eyeBtn.addEventListener('mouseleave', () => { eyeBtn.style.opacity = a.hidden ? '0.5' : '0.6'; eyeBtn.style.background = 'none'; });
        eyeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.getEditor()?.updateAnchor(key, { hidden: !a.hidden }); this.scheduleAutoSave(); });

        const dupBtn = document.createElement('button');
        dupBtn.style.cssText = rowBtnStyle;
        dupBtn.textContent = '⎘'; dupBtn.title = 'Dupliquer (Ctrl+D)';
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

    const cardsHeader = document.createElement('div');
    cardsHeader.style.cssText = 'display:flex;align-items:center;padding:6px 10px 4px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;gap:6px;';
    const cardsHeaderLabel = document.createElement('span');
    cardsHeaderLabel.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);flex:1;';
    cardsHeaderLabel.innerHTML = `${cards.length} carte${cards.length !== 1 ? 's' : ''} <span style="font-size:8px;font-weight:700;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:3px;padding:1px 4px;margin-left:4px;">BETA</span>`;
    const addCardBtn = document.createElement('button');
    addCardBtn.style.cssText = 'background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.28);border-radius:6px;color:#7dd3fc;padding:3px 9px;font-size:10px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .15s;';
    addCardBtn.textContent = '+ Ajouter';
    cardsHeader.appendChild(cardsHeaderLabel); cardsHeader.appendChild(addCardBtn);
    cardsPane.appendChild(cardsHeader);

    const cardsScroll = document.createElement('div');
    cardsScroll.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:3px 0;';
    cardsPane.appendChild(cardsScroll);

    addCardBtn.addEventListener('click', () => this._showCardTemplatePicker(cardsScroll));

    const CARD_ICONS: Record<SceneCardType, string> = { room: '🏠', entity: '📊', info: 'ℹ️' };
    const CARD_COLORS: Record<SceneCardType, string> = { room: '#7dd3fc', entity: '#86efac', info: '#fbbf24' };

    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = 'Aucune carte<br><span style="font-size:10px;opacity:.7">Cliquez + Ajouter</span>';
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
        subEl.textContent = `${CARD_TYPE_LABELS[c.type] ?? c.type} · ${c.size ?? 'medium'}`;
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

    const rulesHeader = document.createElement('div');
    rulesHeader.style.cssText = 'display:flex;align-items:center;padding:6px 10px 4px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;gap:6px;';
    const rulesHeaderLabel = document.createElement('span');
    rulesHeaderLabel.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);flex:1;';
    const rulesCountBadge = '<span style="font-size:8px;font-weight:700;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:3px;padding:1px 4px;margin-left:4px;">BETA</span>';
    rulesHeaderLabel.innerHTML = `${rulesCount} règle${rulesCount !== 1 ? 's' : ''}${rulesCountBadge}`;
    const rulesAddBtn = document.createElement('button');
    rulesAddBtn.style.cssText = 'background:rgba(125,209,252,0.12);border:1px solid rgba(125,209,252,0.28);border-radius:6px;color:#7dd3fc;padding:3px 9px;font-size:10px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .15s;';
    rulesAddBtn.textContent = '+ Ajouter';
    rulesHeader.appendChild(rulesHeaderLabel); rulesHeader.appendChild(rulesAddBtn);
    rulesPane.appendChild(rulesHeader);

    const rulesBody = document.createElement('div');
    rulesBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    rulesPane.appendChild(rulesBody);
    this._fillRulesList(rulesBody);

    rulesAddBtn.addEventListener('click', () => {
      this._openRuleModal(null, () => {
        this._fillRulesList(rulesBody);
        const newCount = (this.getRules?.() ?? []).length;
        rulesHeaderLabel.innerHTML = `${newCount} règle${newCount !== 1 ? 's' : ''}${rulesCountBadge}`;
      });
    });

    // Activate default tab
    switchTab(activeTab);
  }

  private _buildPropsSection(container: HTMLDivElement, key: string, anchor: EditableAnchor, goBack?: () => void) {
    container.innerHTML = '';

    const domain = anchor.entity.split('.')[0];
    const isLight = domain === 'light';

    // ── Back navigation ───────────────────────────────────────────────
    if (goBack) {
      const nav = document.createElement('div');
      nav.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 0 10px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:12px;';
      const backBtn = document.createElement('button');
      backBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.35);font-size:12px;padding:0;line-height:1;transition:color .12s;display:flex;align-items:center;gap:4px;font-family:inherit;';
      backBtn.innerHTML = '← <span style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Ancres</span>';
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
    title.textContent = anchor.label || anchor.entity.split('.')[1];
    container.appendChild(title);
    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    subtitle.textContent = anchor.entity;
    container.appendChild(subtitle);

    // ── Section: Liaison HA ──────────────────────────────────────────
    secDiv('Liaison HA');

    const entityWrap = document.createElement('div');
    entityWrap.style.cssText = 'position:relative;';
    const entityInput = document.createElement('input');
    const dlId = `owlnest-dl-${key}`;
    entityInput.setAttribute('list', dlId);
    entityInput.value = anchor.entity;
    entityInput.placeholder = 'light.salon, switch.tv…';
    entityInput.style.cssText = inputStyle;
    entityInput.addEventListener('focus', () => { entityInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
    entityInput.addEventListener('blur', () => { entityInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
    entityInput.addEventListener('change', () => {
      const v = entityInput.value.trim();
      if (v) { this.getEditor()?.updateAnchor(key, { entity: v }); this.scheduleAutoSave(); }
    });
    const datalist = document.createElement('datalist');
    datalist.id = dlId;
    const hass = this.getHass();
    if (hass?.states) {
      for (const eid of Object.keys(hass.states).sort()) {
        const opt = document.createElement('option');
        opt.value = eid;
        const fn = (hass.states[eid] as any)?.attributes?.friendly_name;
        if (fn) opt.label = fn;
        datalist.appendChild(opt);
      }
    }
    entityWrap.appendChild(entityInput); entityWrap.appendChild(datalist);
    field('Entité', entityWrap);

    const labelInput = document.createElement('input');
    labelInput.value = anchor.label;
    labelInput.placeholder = 'Nom affiché…';
    labelInput.style.cssText = inputStyle;
    labelInput.addEventListener('focus', () => { labelInput.style.borderColor = 'rgba(125,209,252,0.5)'; });
    labelInput.addEventListener('blur', () => { labelInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
    labelInput.addEventListener('change', () => {
      this.getEditor()?.updateAnchor(key, { label: labelInput.value.trim() || anchor.entity.split('.')[1] });
      this.scheduleAutoSave();
    });
    field('Nom', labelInput);

    // ── Section: Lumière ─────────────────────────────────────────────
    if (isLight) {
      secDiv('Lumière');

      sliderField('Intensité', 0.1, 3, 0.1, anchor.lightIntensity ?? 1, '#fbbf24',
        (v) => `×${v.toFixed(1)}`,
        (v) => this.getEditor()?.updateAnchor(key, { lightIntensity: v }),
      );

      // Style buttons
      const styleRow = document.createElement('div');
      styleRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px;';
      const styleConfigs: { id: import('../types').LightStyle; label: string; icon: string }[] = [
        { id: 'point', label: 'Ambiante', icon: '○' },
        { id: 'spot',  label: 'Spot',     icon: '◎' },
        { id: 'beam',  label: 'Rayon',    icon: '⊙' },
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
      dirHeader.textContent = 'Orientation';
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
      gizmoHint.innerHTML = '↻ Glisser les<br>anneaux 3D';
      dirDisplay.appendChild(gizmoHint);

      dirSection.appendChild(dirDisplay);
      container.appendChild(dirSection);
    }

    // ── Section: Visibilité conditionnelle ────────────────────────────
    secDiv('Visibilité');
    this._buildVisibleIfSection(container, `anc-${key}`, anchor.visibleIf, inputStyle, (cond) => {
      this.getEditor()?.updateAnchor(key, { visibleIf: cond });
      this.scheduleAutoSave();
    });

    // ── Section: Gérer ───────────────────────────────────────────────
    secDiv('Gérer');

    const actRow = document.createElement('div');
    actRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

    const dupBtn = document.createElement('button');
    dupBtn.style.cssText = [
      'background:rgba(255,255,255,0.06)', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:8px', 'color:#e2e8f0', 'padding:7px 4px',
      'font-size:10px', 'font-family:inherit', 'cursor:pointer',
      'transition:all .15s',
    ].join(';');
    dupBtn.innerHTML = '⎘ Dupliquer';
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
    delBtn.innerHTML = '✕ Supprimer';
    delBtn.title = 'X — Supprimer l\'ancre';
    delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'rgba(239,68,68,0.25)'; delBtn.style.borderColor = 'rgba(239,68,68,0.5)'; });
    delBtn.addEventListener('mouseleave', () => { delBtn.style.background = 'rgba(239,68,68,0.1)'; delBtn.style.borderColor = 'rgba(239,68,68,0.25)'; });
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm === '1') {
        this.getEditor()?.deleteSelected();
      } else {
        delBtn.dataset.confirm = '1';
        delBtn.innerHTML = '⚠ Confirmer ?';
        delBtn.style.background = 'rgba(239,68,68,0.35)';
        delBtn.style.borderColor = 'rgba(239,68,68,0.65)';
        setTimeout(() => {
          if (delBtn.dataset.confirm === '1') {
            delBtn.dataset.confirm = '';
            delBtn.innerHTML = '✕ Supprimer';
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
      el.textContent = '● Non sauvé';
      el.style.color = '#f59e0b';
    } else if (this._saveStatus === 'saving') {
      el.textContent = '⏳ Sauvegarde…';
      el.style.color = '#94a3b8';
    } else {
      el.textContent = '✓ Sauvé';
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
    title.textContent = 'Choisir un modèle';
    overlay.appendChild(title);

    const templates: { type: SceneCardType; icon: string; label: string; desc: string; color: string }[] = [
      { type: 'room',   icon: '🏠', label: 'Pièce',  desc: 'Vue synthèse d\'une pièce',   color: '#7dd3fc' },
      { type: 'entity', icon: '📊', label: 'Entité', desc: 'Focus sur une entité HA',     color: '#86efac' },
      { type: 'info',   icon: 'ℹ️',  label: 'Info',   desc: 'Label contextuel décoratif', color: '#fbbf24' },
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
    cancelBtn.textContent = 'Annuler';
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
      backBtn.innerHTML = '← <span style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Cartes</span>';
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
    sub.textContent = `Carte 3D · ${CARD_TYPE_LABELS[card.type]}`;
    container.appendChild(sub);

    // ── Section: Général ───────────────────────────────────────────────────

    const sec1 = document.createElement('div');
    sec1.style.cssText = secStyle;
    sec1.textContent = 'Général';
    container.appendChild(sec1);

    // Name input
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'margin-bottom:8px;';
    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = lblStyle;
    nameLbl.textContent = 'Nom';
    const nameInp = document.createElement('input');
    nameInp.value = card.name;
    nameInp.placeholder = 'Nom de la carte';
    nameInp.style.cssText = inputStyle;
    nameInp.addEventListener('change', () => {
      this._updateCard(card.id, { name: nameInp.value.trim() || 'Sans nom' });
      title.querySelector('span:last-child')!.textContent = nameInp.value.trim() || 'Sans nom';
    });
    nameWrap.appendChild(nameLbl);
    nameWrap.appendChild(nameInp);
    container.appendChild(nameWrap);

    // ── Section: Position ──────────────────────────────────────────────────

    const secPos = document.createElement('div');
    secPos.style.cssText = secStyle;
    secPos.textContent = 'Position';
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
      inp.title = 'Position en mètres dans l\'espace 3D';
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
    sec2.textContent = 'Apparence';
    container.appendChild(sec2);

    // Size presets (small / medium / large)
    const sizeLbl = document.createElement('div');
    sizeLbl.style.cssText = lblStyle;
    sizeLbl.textContent = 'Taille';
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
    colorLbl.textContent = 'Couleur accent';
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
    secTpl.textContent = CARD_TYPE_LABELS[card.type as import('../cards/types').SceneCardType];
    container.appendChild(secTpl);

    const mkEntityInput = (val: string, id: string, onChange: (v: string) => void) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      const dlId = `dl-card-${card.id}-${id}`;
      const inp = document.createElement('input');
      inp.value = val;
      inp.placeholder = 'entity_id…';
      inp.setAttribute('list', dlId);
      inp.style.cssText = inputStyle;
      inp.addEventListener('change', () => onChange(inp.value.trim()));
      const dl = document.createElement('datalist');
      dl.id = dlId;
      if (hass?.states) {
        Object.keys(hass.states).sort().slice(0, 200).forEach((eid) => {
          const opt = document.createElement('option'); opt.value = eid; dl.appendChild(opt);
        });
      }
      wrap.appendChild(inp);
      wrap.appendChild(dl);
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
      container.appendChild(mkFieldLabel('Icône (emoji)'));
      container.appendChild(mkTextInput(card.icon ?? '', '🏠', (v) => this._updateCard(card.id, { icon: v || undefined } as Partial<import('../cards/types').RoomCard>)));

      // Entities (up to 4)
      const maxEntities = 4;
      const entitiesWrap = document.createElement('div');
      entitiesWrap.style.cssText = 'margin-bottom:8px;';
      container.appendChild(mkFieldLabel(`Entités (max ${maxEntities})`));
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
          const dlId = `dl-room-ent-${card.id}-${idx}`;
          const inp = document.createElement('input');
          inp.value = eid;
          inp.placeholder = 'entity_id…';
          inp.setAttribute('list', dlId);
          inp.style.cssText = inputStyle + 'flex:1;';
          inp.addEventListener('change', () => {
            const newList = [...getFreshEntities()];
            newList[idx] = inp.value.trim();
            this._updateCard(card.id, { entities: newList.filter(Boolean) } as Partial<import('../cards/types').RoomCard>);
          });
          const dl = document.createElement('datalist');
          dl.id = dlId;
          if (hass?.states) {
            Object.keys(hass.states).sort().slice(0, 200).forEach((e) => {
              const opt = document.createElement('option'); opt.value = e; dl.appendChild(opt);
            });
          }
          const rmBtn = document.createElement('button');
          rmBtn.textContent = '×';
          rmBtn.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.6);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;';
          rmBtn.addEventListener('click', () => {
            const newList = getFreshEntities().filter((_, j) => j !== idx);
            this._updateCard(card.id, { entities: newList } as Partial<import('../cards/types').RoomCard>);
            renderEntityList();
          });
          row.appendChild(inp); row.appendChild(dl); row.appendChild(rmBtn);
          entitiesWrap.appendChild(row);
        });
        if (entities.length < maxEntities) {
          const addBtn = document.createElement('button');
          addBtn.textContent = '+ Entité';
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
      container.appendChild(mkToggle('Afficher le nom', card.show?.name !== false, (v) => this._updateCard(card.id, { show: { ...card.show, name: v } } as Partial<import('../cards/types').RoomCard>)));
      container.appendChild(mkToggle('Afficher les états', card.show?.entities !== false, (v) => this._updateCard(card.id, { show: { ...card.show, entities: v } } as Partial<import('../cards/types').RoomCard>)));

    } else if (card.type === 'entity') {
      // Entity ID
      container.appendChild(mkFieldLabel('Entité'));
      container.appendChild(mkEntityInput(card.entity_id ?? '', 'entity', (v) => this._updateCard(card.id, { entity_id: v } as Partial<import('../cards/types').EntityCard>)));

      // Label override
      container.appendChild(mkFieldLabel('Label (optionnel)'));
      container.appendChild(mkTextInput(card.label ?? '', 'Automatique', (v) => this._updateCard(card.id, { label: v || undefined } as Partial<import('../cards/types').EntityCard>)));

      // Show toggles
      container.appendChild(mkToggle('Afficher le label', card.show?.label !== false, (v) => this._updateCard(card.id, { show: { ...card.show, label: v } } as Partial<import('../cards/types').EntityCard>)));
      container.appendChild(mkToggle('Afficher l\'unité', card.show?.unit !== false, (v) => this._updateCard(card.id, { show: { ...card.show, unit: v } } as Partial<import('../cards/types').EntityCard>)));
      container.appendChild(mkToggle('Bouton d\'action', card.show?.button === true, (v) => this._updateCard(card.id, { show: { ...card.show, button: v } } as Partial<import('../cards/types').EntityCard>)));

    } else if (card.type === 'info') {
      // Icon emoji
      container.appendChild(mkFieldLabel('Icône (emoji)'));
      container.appendChild(mkTextInput(card.icon ?? '', 'ℹ️', (v) => this._updateCard(card.id, { icon: v || undefined } as Partial<import('../cards/types').InfoCard>)));

      // Subtitle
      container.appendChild(mkFieldLabel('Sous-titre'));
      container.appendChild(mkTextInput(card.subtitle ?? '', 'Texte…', (v) => this._updateCard(card.id, { subtitle: v || undefined } as Partial<import('../cards/types').InfoCard>)));

      // Color override
      container.appendChild(mkFieldLabel('Couleur texte (optionnel)'));
      const colorOverrideWrap = document.createElement('div');
      colorOverrideWrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px;';
      const colorOInp = document.createElement('input');
      colorOInp.type = 'color';
      colorOInp.value = card.color ?? CARD_DEFAULT_ACCENT[card.type];
      colorOInp.style.cssText = 'width:36px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:2px;background:rgba(255,255,255,0.06);';
      const colorOText = document.createElement('input');
      colorOText.type = 'text';
      colorOText.value = card.color ?? '';
      colorOText.placeholder = 'Hérite de l\'accent';
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
    secVis.textContent = 'Visibilité';
    container.appendChild(secVis);
    this._buildVisibleIfSection(container, `card-${card.id}`, card.visibleIf, inputStyle, (cond) => {
      this._updateCard(card.id, { visibleIf: cond });
    });

    // ── Section: Gérer ─────────────────────────────────────────────────────

    const sec3 = document.createElement('div');
    sec3.style.cssText = secStyle;
    sec3.textContent = 'Gérer';
    container.appendChild(sec3);

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:8px;color:#f87171;padding:7px 8px;font-size:10px;font-family:inherit;cursor:pointer;width:100%;';
    delBtn.innerHTML = '✕ Supprimer la carte';
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm === '1') {
        const cards = (this.getCards ? this.getCards() : []).filter((x) => x.id !== card.id);
        if (this.saveCards) this.saveCards(cards).then(() => { if (this.onSelectCard) this.onSelectCard(null); this.updateAnchorList(); });
      } else {
        delBtn.dataset.confirm = '1';
        delBtn.innerHTML = '⚠ Confirmer la suppression ?';
        delBtn.style.background = 'rgba(239,68,68,0.35)';
        delBtn.style.borderColor = 'rgba(239,68,68,0.65)';
        setTimeout(() => {
          if (delBtn.dataset.confirm === '1') {
            delBtn.dataset.confirm = '';
            delBtn.innerHTML = '✕ Supprimer la carte';
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
      ['eq','= égal'],['neq','≠ différent'],
      ['gt','> supérieur'],['lt','< inférieur'],
      ['gte','≥ sup. ou égal'],['lte','≤ inf. ou égal'],
      ['contains','⊃ contient'],
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
    toggleLbl.textContent = 'Conditionner la visibilité';
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
    const btnHide = mkModeBtn('Masquer si…', negate);
    const btnShow = mkModeBtn('Afficher si…', !negate);
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
    const entityDlId = `${idPrefix}-eid`;
    const entityInp = document.createElement('input');
    entityInp.value = current?.entity_id ?? '';
    entityInp.placeholder = 'entity_id…';
    entityInp.setAttribute('list', entityDlId);
    entityInp.style.cssText = inputStyle;
    const entityDl = document.createElement('datalist');
    entityDl.id = entityDlId;
    if (hass?.states) {
      for (const eid of Object.keys(hass.states).sort().slice(0, 300)) {
        const opt = document.createElement('option');
        opt.value = eid;
        opt.label = (hass.states[eid]?.attributes?.friendly_name as string) ?? '';
        entityDl.appendChild(opt);
      }
    }
    entityWrap.appendChild(entityInp);
    entityWrap.appendChild(entityDl);
    fields.appendChild(entityWrap);

    // State hint (current state of selected entity)
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:6px;min-height:14px;padding-left:2px;';
    fields.appendChild(hint);

    // Operator + value row
    const condRow = document.createElement('div');
    condRow.style.cssText = 'display:grid;grid-template-columns:90px 1fr;gap:5px;margin-bottom:6px;';
    const opSel = document.createElement('select');
    opSel.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e2e8f0;padding:5px 6px;font-size:11px;outline:none;font-family:inherit;cursor:pointer;';
    ops.forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l;
      if (current?.operator === v) o.selected = true;
      opSel.appendChild(o);
    });
    const valDlId = `${idPrefix}-val`;
    const valInp = document.createElement('input');
    valInp.value = String(current?.value ?? '');
    valInp.placeholder = 'valeur…';
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
      hint.textContent = `État actuel : ${stateObj.state}${friendlyName ? `  ·  ${friendlyName}` : ''}`;

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
      empty.innerHTML = 'Aucune règle<br><span style="font-size:10px;opacity:.7">Cliquer sur + Ajouter</span>';
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
      labelEl.textContent = rule.label || `Règle ${rule.id.slice(-4)}`;

      const triggerSummary = document.createElement('div');
      triggerSummary.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;';
      const t = rule.trigger;
      triggerSummary.textContent = t.type === 'entity_state'
        ? `${t.entity_id}${t.to ? ` → ${t.to}` : ''}`
        : t.type;

      info.appendChild(labelEl);
      info.appendChild(triggerSummary);

      // Enable toggle
      const toggle = document.createElement('label');
      toggle.style.cssText = 'display:flex;align-items:center;cursor:pointer;flex-shrink:0;';
      toggle.title = enabled ? 'Désactiver' : 'Activer';
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
      editBtn.title = 'Modifier';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openRuleModal(rule, () => this._fillRulesList(pane));
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:rgba(248,113,113,0.5);cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;';
      delBtn.textContent = '×';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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
    hdrTitle.textContent = existing ? 'Modifier la règle' : 'Nouvelle règle';
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;padding:5px 12px;font-size:11px;font-family:inherit;cursor:pointer;';
    closeBtn.textContent = 'Fermer';
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
    const mkEntityInput = (val: string, uid: string) => {
      const wrap = mk('div') as HTMLDivElement;
      const dlId = `dl-rule-${uid}`;
      const i = mkInp(val, 'entity_id…');
      i.setAttribute('list', dlId);
      const dl = mk('datalist') as HTMLDataListElement;
      dl.id = dlId;
      if (hass?.states) {
        Object.keys(hass.states).sort().slice(0, 200).forEach((e) => {
          const opt = mk('option') as HTMLOptionElement; opt.value = e; dl.appendChild(opt);
        });
      }
      wrap.appendChild(i); wrap.appendChild(dl);
      return { wrap, input: i };
    };
    const secHdr = (text: string) => {
      const d = mk('div') as HTMLDivElement;
      d.style.cssText = 'font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);';
      d.textContent = text; return d;
    };

    // ── Label ────────────────────────────────────────────────────────────────
    bodyEl.appendChild(secHdr('Général'));
    const labelWrap = mk('div') as HTMLDivElement; labelWrap.style.cssText = fieldStyle;
    labelWrap.appendChild(mkLbl('Nom de la règle'));
    const labelInp = mkInp(draft.label ?? '', 'Ex: Porte ouverte → Vue entrée');
    labelInp.addEventListener('input', () => { draft.label = labelInp.value; });
    labelWrap.appendChild(labelInp);
    bodyEl.appendChild(labelWrap);

    // ── Trigger ──────────────────────────────────────────────────────────────
    bodyEl.appendChild(secHdr('Déclencheur'));

    const trig = draft.trigger.type === 'entity_state' ? draft.trigger : { type: 'entity_state' as const, entity_id: '', to: '' };

    const trigEntityWrap = mk('div') as HTMLDivElement; trigEntityWrap.style.cssText = fieldStyle;
    trigEntityWrap.appendChild(mkLbl('Entité'));
    const { wrap: tew, input: trigEntityInp } = mkEntityInput(trig.entity_id, 'trig-entity');
    trigEntityInp.addEventListener('input', () => { (draft.trigger as typeof trig).entity_id = trigEntityInp.value.trim(); });
    trigEntityWrap.appendChild(tew);
    bodyEl.appendChild(trigEntityWrap);

    const trigRow = mk('div') as HTMLDivElement;
    trigRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';

    const trigFromWrap = mk('div') as HTMLDivElement;
    trigFromWrap.appendChild(mkLbl('De (optionnel)'));
    const trigFromInp = mkInp(trig.from ?? '', 'ex: off');
    trigFromInp.addEventListener('input', () => {
      const v = trigFromInp.value.trim();
      (draft.trigger as typeof trig).from = v || undefined;
    });
    trigFromWrap.appendChild(trigFromInp);

    const trigToWrap = mk('div') as HTMLDivElement;
    trigToWrap.appendChild(mkLbl('Vers'));
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
    bodyEl.appendChild(secHdr('Actions'));

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
          ['go_to_view',   '📷 Aller à la vue'],
          ['show_card',    '👁 Afficher carte'],
          ['hide_card',    '🙈 Masquer carte'],
          ['call_service', '⚙ Appeler service'],
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
          const emptyOpt = mk('option') as HTMLOptionElement; emptyOpt.value = ''; emptyOpt.textContent = '-- Choisir une vue --'; sel.appendChild(emptyOpt);
          views.forEach((v) => {
            const opt = mk('option') as HTMLOptionElement; opt.value = v.id ?? ''; opt.textContent = v.label; sel.appendChild(opt);
          });
          sel.value = action.view_id;
          sel.addEventListener('change', () => { (draft.actions[idx] as typeof action).view_id = sel.value; });
          aRow.appendChild(sel);
        } else if (action.type === 'show_card' || action.type === 'hide_card') {
          const sel = mk('select') as HTMLSelectElement;
          sel.style.cssText = inputStyle;
          const emptyOpt = mk('option') as HTMLOptionElement; emptyOpt.value = ''; emptyOpt.textContent = '-- Choisir une carte --'; sel.appendChild(emptyOpt);
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
      addABtn.textContent = '+ Ajouter une action';
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
    cancelBtn.textContent = 'Annuler';
    cancelBtn.style.cssText = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#94a3b8;padding:8px;font-size:11px;font-family:inherit;cursor:pointer;';
    cancelBtn.addEventListener('click', () => { dialog.close(); dialog.remove(); });

    const saveBtn = mk('button') as HTMLButtonElement;
    saveBtn.textContent = 'Enregistrer';
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
