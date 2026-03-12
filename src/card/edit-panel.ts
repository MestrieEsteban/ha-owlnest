import type { Hass, CardConfig, EditableAnchor } from '../types';
import type { AnchorEditor, EditorTool } from '../editor';

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
  ) {}

  showToolbar() {
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

    const editor = this.getEditor();
    if (editor) editor.onToolChange = (t) => setActiveTool(t);

    this.hudSep.style.display = 'block';

    // ── Right: close ─────────────────────────────────────────────────
    const doneBtn = this._btn('✓ Fermer', 'rgba(255,255,255,0.07)');
    doneBtn.style.color = 'rgba(255,255,255,0.6)';
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
    hintBar.appendChild(hint('G', 'Saisir'));
    hintBar.appendChild(hint('A', 'Ajouter'));
    hintBar.appendChild(hint('X', 'Suppr.'));
    hintBar.appendChild(hint('H', 'Masquer'));
    hintBar.appendChild(hint('Ctrl+Z', 'Annuler'));
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

    // ── Tab bar ────────────────────────────────────────────────────
    const tabBar = document.createElement('div');
    tabBar.style.cssText = [
      'display:flex', 'align-items:stretch',
      'border-bottom:1px solid rgba(255,255,255,0.07)',
      'flex-shrink:0', 'padding:0 6px', 'gap:2px',
    ].join(';');

    const makeTab = (label: string, id: 'anchors' | 'props') => {
      const t = document.createElement('button');
      t.dataset.tab = id;
      t.style.cssText = [
        'background:none', 'border:none', 'cursor:pointer',
        'font-size:11px', 'font-family:inherit', 'font-weight:600',
        'padding:9px 10px 7px', 'letter-spacing:.04em',
        'border-bottom:2px solid transparent',
        'color:rgba(255,255,255,0.4)', 'transition:all .15s',
        'white-space:nowrap',
      ].join(';');
      t.textContent = label;
      return t;
    };

    const tabAnchors = makeTab('Ancres', 'anchors');
    const tabProps   = makeTab('Propriétés', 'props');
    tabBar.appendChild(tabAnchors);
    tabBar.appendChild(tabProps);

    if (this.getSceneId()) {
      const saveInd = document.createElement('span');
      saveInd.id = 'save-indicator';
      saveInd.style.cssText = 'font-size:10px;color:#22c55e;transition:color .2s;margin-left:auto;align-self:center;padding-right:4px;';
      saveInd.textContent = '✓';
      tabBar.appendChild(saveInd);
    }

    panel.appendChild(tabBar);

    // ── Tab: Anchors ───────────────────────────────────────────────
    const tabAnchorsPane = document.createElement('div');
    tabAnchorsPane.id = 'tab-pane-anchors';
    tabAnchorsPane.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';

    // Batch controls
    const batchBar = document.createElement('div');
    batchBar.style.cssText = 'display:flex;align-items:center;padding:5px 10px 3px;gap:4px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;';
    const countLbl = document.createElement('span');
    countLbl.id = 'anchor-count-lbl';
    countLbl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);flex:1;';
    const batchBtnStyle = 'background:none;border:none;cursor:pointer;padding:3px 6px;border-radius:5px;font-size:11px;color:rgba(255,255,255,0.35);transition:all .15s;';
    const showAllBtn = document.createElement('button');
    showAllBtn.title = 'Tout afficher (●)';
    showAllBtn.innerHTML = '● Tout';
    showAllBtn.style.cssText = batchBtnStyle;
    showAllBtn.addEventListener('mouseenter', () => { showAllBtn.style.color = '#4ade80'; });
    showAllBtn.addEventListener('mouseleave', () => { showAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    showAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: false }));
    const hideAllBtn = document.createElement('button');
    hideAllBtn.title = 'Tout masquer (○)';
    hideAllBtn.innerHTML = '○ Aucun';
    hideAllBtn.style.cssText = batchBtnStyle;
    hideAllBtn.addEventListener('mouseenter', () => { hideAllBtn.style.color = '#f87171'; });
    hideAllBtn.addEventListener('mouseleave', () => { hideAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    hideAllBtn.addEventListener('click', () => this.getEditor()?.updateAll({ hidden: true }));
    batchBar.appendChild(countLbl);
    batchBar.appendChild(showAllBtn);
    batchBar.appendChild(hideAllBtn);
    tabAnchorsPane.appendChild(batchBar);

    const list = document.createElement('div');
    list.id = 'anchor-list-body';
    list.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:3px 0;';
    tabAnchorsPane.appendChild(list);
    panel.appendChild(tabAnchorsPane);

    // ── Tab: Props ─────────────────────────────────────────────────
    const tabPropsPane = document.createElement('div');
    tabPropsPane.id = 'tab-pane-props';
    tabPropsPane.style.cssText = 'display:none;flex:1;min-height:0;overflow-y:auto;padding:12px 12px 10px;';
    panel.appendChild(tabPropsPane);

    // Tab switching logic
    const switchTab = (tab: 'anchors' | 'props') => {
      const onA = tab === 'anchors';
      tabAnchorsPane.style.display = onA ? 'flex' : 'none';
      tabPropsPane.style.display   = onA ? 'none' : 'block';
      const activeColor = '#7dd3fc';
      tabAnchors.style.color = onA ? activeColor : 'rgba(255,255,255,0.4)';
      tabAnchors.style.borderBottomColor = onA ? activeColor : 'transparent';
      tabProps.style.color = !onA ? activeColor : 'rgba(255,255,255,0.4)';
      tabProps.style.borderBottomColor = !onA ? activeColor : 'transparent';
    };

    tabAnchors.addEventListener('click', () => switchTab('anchors'));
    tabProps.addEventListener('click', () => switchTab('props'));

    this._panel = panel;
    this.overlayContainer.appendChild(panel);

    switchTab('anchors');
    this._fillAnchorList(list, tabPropsPane, countLbl, switchTab);
  }

  private _fillAnchorList(
    list: HTMLDivElement,
    propsPane: HTMLDivElement,
    countLbl: HTMLElement,
    switchTab: (tab: 'anchors' | 'props') => void,
  ) {
    list.innerHTML = '';
    const editor = this.getEditor();
    if (!editor) return;
    const anchors = editor.anchors;
    const selectedKey = editor.selectedKey;

    countLbl.textContent = `${anchors.size} ancre${anchors.size !== 1 ? 's' : ''}`;

    if (anchors.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.innerHTML = 'Aucune ancre<br><span style="font-size:10px;opacity:.7">Outil ＋ → clic sur le modèle</span>';
      list.appendChild(empty);
      return;
    }

    const DOMAIN_ICONS: Record<string, string> = {
      light: '💡', switch: '🔌', cover: '🪟',
      sensor: '📡', binary_sensor: '⬤', climate: '🌡️', media_player: '🔊',
    };
    const DOMAIN_COLORS: Record<string, string> = {
      light: '#fbbf24', switch: '#4ade80', cover: '#fb923c',
      sensor: '#60a5fa', binary_sensor: '#22d3ee',
      climate: '#f87171', media_player: '#c084fc',
    };

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
        row.addEventListener('mouseenter', () => {
          row.style.background = 'rgba(255,255,255,0.05)';
          row.style.borderLeftColor = 'rgba(255,255,255,0.12)';
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = 'transparent';
          row.style.borderLeftColor = 'transparent';
        });
      }

      const iconEl = document.createElement('span');
      iconEl.style.cssText = `font-size:13px;flex-shrink:0;opacity:${a.hidden ? 0.2 : 0.9};`;
      iconEl.textContent = icon;
      row.appendChild(iconEl);

      const col = document.createElement('div');
      col.style.cssText = 'flex:1;min-width:0;';
      const nameEl = document.createElement('div');
      nameEl.style.cssText = `font-size:12px;font-weight:500;${a.hidden ? 'color:rgba(255,255,255,0.25);' : 'color:#e2e8f0;'}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;`;
      nameEl.textContent = a.label || a.entity.split('.')[1];
      const entityEl = document.createElement('div');
      entityEl.style.cssText = `font-size:10px;color:${a.hidden ? 'rgba(255,255,255,0.15)' : color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;opacity:0.8;`;
      entityEl.textContent = a.entity;
      col.appendChild(nameEl); col.appendChild(entityEl);
      row.appendChild(col);

      const rowBtnStyle = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:12px;flex-shrink:0;line-height:1;border-radius:4px;color:rgba(255,255,255,0.4);transition:all .12s;opacity:0;';
      const showRowBtns = () => { eyeBtn.style.opacity = a.hidden ? '0.5' : '0.6'; dupBtn.style.opacity = '0.6'; };
      const hideRowBtns = () => { eyeBtn.style.opacity = a.hidden ? '0.35' : '0'; dupBtn.style.opacity = '0'; };
      if (!isSelected) {
        row.addEventListener('mouseenter', () => { showRowBtns(); });
        row.addEventListener('mouseleave', () => { hideRowBtns(); });
      } else {
        setTimeout(() => showRowBtns(), 0);
      }

      const eyeBtn = document.createElement('button');
      eyeBtn.style.cssText = rowBtnStyle;
      eyeBtn.textContent = a.hidden ? '🙈' : '👁';
      eyeBtn.title = a.hidden ? 'Afficher (H)' : 'Masquer (H)';
      if (a.hidden) eyeBtn.style.opacity = '0.45';
      eyeBtn.addEventListener('mouseenter', () => { eyeBtn.style.opacity = '1'; eyeBtn.style.background = 'rgba(255,255,255,0.1)'; });
      eyeBtn.addEventListener('mouseleave', () => { eyeBtn.style.opacity = a.hidden ? '0.5' : '0.6'; eyeBtn.style.background = 'none'; });
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.getEditor()?.updateAnchor(key, { hidden: !a.hidden });
      });
      row.appendChild(eyeBtn);

      const dupBtn = document.createElement('button');
      dupBtn.style.cssText = rowBtnStyle;
      dupBtn.textContent = '⎘';
      dupBtn.title = 'Dupliquer  (Ctrl+D)';
      dupBtn.addEventListener('mouseenter', () => { dupBtn.style.opacity = '1'; dupBtn.style.background = 'rgba(255,255,255,0.1)'; });
      dupBtn.addEventListener('mouseleave', () => { dupBtn.style.opacity = '0.6'; dupBtn.style.background = 'none'; });
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.getEditor()?.selectAnchor(key);
        this.getEditor()?.duplicate();
      });
      row.appendChild(dupBtn);

      row.addEventListener('click', () => {
        this.getEditor()?.selectAnchor(key);
        switchTab('props');
      });
      list.appendChild(row);
    });

    // Always rebuild props pane content
    if (selectedKey && anchors.has(selectedKey)) {
      this._buildPropsSection(propsPane, selectedKey, anchors.get(selectedKey)!);
    } else {
      propsPane.innerHTML = '<div style="padding:20px 12px;font-size:11px;color:rgba(255,255,255,0.25);text-align:center;">Sélectionne une ancre</div>';
    }
  }

  private _buildPropsSection(container: HTMLDivElement, key: string, anchor: EditableAnchor) {
    container.innerHTML = '';

    const domain = anchor.entity.split('.')[0];
    const isLight = domain === 'light';

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
      if (v) this.getEditor()?.updateAnchor(key, { entity: v });
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

      const gizmoBtn = document.createElement('button');
      gizmoBtn.style.cssText = [
        'background:rgba(125,209,252,0.1)', 'border:1px solid rgba(125,209,252,0.3)',
        'border-radius:8px', 'color:#7dd3fc', 'padding:5px 9px',
        'font-size:10px', 'font-family:inherit', 'cursor:pointer',
        'transition:all .15s', 'white-space:nowrap',
      ].join(';');
      gizmoBtn.innerHTML = '◎ Gizmo <kbd style="opacity:.6;font-size:9px">R</kbd>';
      gizmoBtn.title = 'Activer le gizmo de rotation (R)';
      gizmoBtn.addEventListener('mouseenter', () => { gizmoBtn.style.background = 'rgba(125,209,252,0.2)'; gizmoBtn.style.borderColor = 'rgba(125,209,252,0.6)'; });
      gizmoBtn.addEventListener('mouseleave', () => { gizmoBtn.style.background = 'rgba(125,209,252,0.1)'; gizmoBtn.style.borderColor = 'rgba(125,209,252,0.3)'; });
      gizmoBtn.addEventListener('click', () => this.getEditor()?.setTool('rotate'));
      dirDisplay.appendChild(gizmoBtn);

      dirSection.appendChild(dirDisplay);
      container.appendChild(dirSection);
    }

    // ── Section: Actions ─────────────────────────────────────────────
    secDiv('Actions');

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
    delBtn.addEventListener('click', () => this.getEditor()?.deleteSelected());

    actRow.appendChild(dupBtn); actRow.appendChild(delBtn);
    container.appendChild(actRow);
  }

  updateAnchorList() {
    if (!this._panel) return;
    const list = this._panel.querySelector<HTMLDivElement>('#anchor-list-body');
    const propsPane = this._panel.querySelector<HTMLDivElement>('#tab-pane-props');
    const countLbl = this._panel.querySelector<HTMLElement>('#anchor-count-lbl');
    if (!list || !propsPane || !countLbl) return;

    // Rebuild tab switching closure from current DOM state
    const tabAnchorsPane = this._panel.querySelector<HTMLElement>('#tab-pane-anchors');
    const tabAnchorsBtn = this._panel.querySelector<HTMLButtonElement>('[data-tab="anchors"]');
    const tabPropsBtn   = this._panel.querySelector<HTMLButtonElement>('[data-tab="props"]');
    const switchTab = (tab: 'anchors' | 'props') => {
      const onA = tab === 'anchors';
      if (tabAnchorsPane) tabAnchorsPane.style.display = onA ? 'flex' : 'none';
      propsPane.style.display = onA ? 'none' : 'block';
      const activeColor = '#7dd3fc';
      if (tabAnchorsBtn) { tabAnchorsBtn.style.color = onA ? activeColor : 'rgba(255,255,255,0.4)'; tabAnchorsBtn.style.borderBottomColor = onA ? activeColor : 'transparent'; }
      if (tabPropsBtn)   { tabPropsBtn.style.color = !onA ? activeColor : 'rgba(255,255,255,0.4)'; tabPropsBtn.style.borderBottomColor = !onA ? activeColor : 'transparent'; }
    };
    this._fillAnchorList(list, propsPane, countLbl, switchTab);
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
}
