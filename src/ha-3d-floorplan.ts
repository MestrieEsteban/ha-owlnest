import * as THREE from 'three';

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';
import './card-editor';

type AnyOverlay = AnchorOverlay | SensorOverlay;

class Ha3dFloorplan extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lockBtn: HTMLButtonElement | null = null;
  private editBtn: HTMLButtonElement | null = null;
  private captureBtn: HTMLButtonElement | null = null;
  private _hud: HTMLDivElement | null = null;
  private _hudLeft: HTMLDivElement | null = null;
  private _hudSep: HTMLDivElement | null = null;
  private _hudRight: HTMLDivElement | null = null;
  private _simExpand: HTMLDivElement | null = null;
  private _simOpen = false;
  private _lockOpenIcon = '🔓';
  private _lockClosedIcon = '🔒';
  private overlayContainer: HTMLDivElement | null = null;

  private anchors = new Map<string, AnchorEntry>();
  private overlays = new Map<string, AnyOverlay>();
  private _clusters = new Map<string, ClusterOverlay>();

  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private modelLoaded = false;
  private _locked = false;
  private _editMode = false;

  private _dirty = false;
  private _lastTime = 0;

  // Overlay visibility (tap-to-toggle)
  private _overlaysVisible = true;
  private _tapStartTime = 0;
  private _tapStartPos = { x: 0, y: 0 };

  // Controls visibility (hover / touch reveal)
  private _controlsHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Camera animation
  private _camAnimTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  // Environment lights
  private _hemiLight: THREE.HemisphereLight | null = null;
  private _sunLight: THREE.DirectionalLight | null = null;
  private _sky: Sky | null = null;

  // Weather
  private _weatherParticles: THREE.Object3D | null = null;
  private _weatherType: 'none' | 'rain' | 'snow' = 'none';
  private _modelBox = new THREE.Box3();

  // Day simulation
  private _simBtn: HTMLButtonElement | null = null;
  private _simActive = false;
  private _simHour = 12;
  private _simWeather: 'clear' | 'cloudy' | 'rain' | 'snow' = 'clear';

  // Anchor editor
  private _editor: AnchorEditor | null = null;
  private _modelRoot: THREE.Object3D | null = null;

  private _requestRender() { this._dirty = true; }

  // ── Persistence ───────────────────────────────────────────────────────

  private get _storageKey() {
    return `ha-3d-floorplan:${this._config?.model_url ?? 'default'}`;
  }

  private _loadView(): SavedView | null {
    try {
      const raw = localStorage.getItem(this._storageKey);
      return raw ? (JSON.parse(raw) as SavedView) : null;
    } catch { return null; }
  }

  private _saveView() {
    if (!this.camera || !this.controls) return;
    const view: SavedView = {
      pos: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      locked: this._locked,
    };
    localStorage.setItem(this._storageKey, JSON.stringify(view));
  }

  // ── HA lifecycle ──────────────────────────────────────────────────────

  setConfig(config: CardConfig) {
    if (!config.model_url) throw new Error('ha-3d-floorplan: model_url is required');
    this._config = config;
    this._bootstrap();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this._editor?.setHass(hass);
    if (this.modelLoaded && !this._editMode) {
      syncLights(this.anchors, hass, this._config);
      this._updateOverlayStates();
      this._updateEnvironment();
      this._requestRender();
    }
  }

  static getStubConfig() {
    return { model_url: '/local/floorplan.glb', anchors: [] };
  }

  static getConfigElement() {
    return document.createElement('ha-3d-floorplan-editor');
  }

  // ── Init ──────────────────────────────────────────────────────────────

  private _bootstrap() {
    if (this.renderer) this._teardown();

    const transparentBg = this._config?.rendering?.transparent_background === true;

    const card = document.createElement('ha-card');
    card.style.cssText = [
      'overflow:hidden',
      'position:relative',
      'display:block',
      transparentBg ? 'background:transparent' : 'background:#050a14',
      transparentBg ? '--ha-card-background:transparent' : '--ha-card-background:#050a14',
      '--ha-card-border-radius:12px',
      'padding:0',
    ].join(';');
    this.innerHTML = '';
    this.appendChild(card);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    card.appendChild(this.canvas);

    this.overlayContainer = document.createElement('div');
    this.overlayContainer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    card.appendChild(this.overlayContainer);

    // ── Unified HUD ───────────────────────────────────────────────────────
    const ui = this._config?.ui ?? {};
    const uiIcons = ui.icons ?? {};
    this._lockOpenIcon  = uiIcons.lock_open   ?? '🔓';
    this._lockClosedIcon = uiIcons.lock_closed ?? '🔒';

    // Wrapper column: [simExpand] then [bar], both stretch to same width
    const hud = document.createElement('div');
    hud.style.cssText = [
      'position:absolute', 'bottom:12px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:10',
      'display:flex', 'flex-direction:column', 'align-items:stretch', 'gap:6px',
      'opacity:0', 'transition:opacity .25s ease',
      'pointer-events:none',
      'max-width:calc(100% - 24px)',
    ].join(';');
    this._hud = hud;
    card.appendChild(hud);

    // Sim expand (slides up above bar)
    const simExpand = document.createElement('div');
    simExpand.style.cssText = [
      'overflow:hidden', 'max-height:0', 'opacity:0',
      'transition:max-height .3s ease, opacity .2s ease',
      'pointer-events:none',
    ].join(';');
    this._simExpand = simExpand;
    hud.appendChild(simExpand);
    this._buildSimExpandContent();

    // Main glass pill bar
    const bar = document.createElement('div');
    bar.style.cssText = [
      'display:flex', 'align-items:center',
      'background:rgba(8,12,24,0.72)',
      'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
      'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:20px',
      'padding:5px 8px', 'gap:2px',
      'pointer-events:auto',
      'white-space:nowrap',
    ].join(';');
    hud.appendChild(bar);

    // Left: camera views (populated after model loads)
    const hudLeft = document.createElement('div');
    hudLeft.style.cssText = 'display:flex;align-items:center;gap:2px;';
    this._hudLeft = hudLeft;
    bar.appendChild(hudLeft);

    // Separator (hidden until views are present)
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;flex-shrink:0;display:none;';
    this._hudSep = sep;
    bar.appendChild(sep);

    // Right: action buttons
    const hudRight = document.createElement('div');
    hudRight.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';
    this._hudRight = hudRight;
    bar.appendChild(hudRight);

    if (ui.show_simulation !== false) {
      this._simBtn = this._makeSimBtn(uiIcons.simulation ?? '☀️');
      hudRight.appendChild(this._simBtn);
    }
    if (ui.show_lock !== false) {
      this.lockBtn = this._makeLockBtn();
      hudRight.appendChild(this.lockBtn);
    }
    if (ui.show_editor !== false) {
      this.editBtn = this._makeEditBtn(uiIcons.editor ?? '✏️');
      hudRight.appendChild(this.editBtn);
    }
    if (ui.show_capture !== false) {
      this.captureBtn = this._makeCaptureBtn(uiIcons.capture ?? '📷');
      hudRight.appendChild(this.captureBtn);
    }

    // Hover (desktop) — show/hide HUD
    card.addEventListener('mouseenter', () => this._showControls());
    card.addEventListener('mouseleave', () => this._hideControls());
    // Touch — show HUD for 3 seconds on tap
    card.addEventListener('touchstart', () => this._showControlsTemporarily(), { passive: true });

    // Canvas tap detection for overlay toggle
    this.canvas!.addEventListener('pointerdown', (e) => {
      this._tapStartTime = e.timeStamp;
      this._tapStartPos = { x: e.clientX, y: e.clientY };
    });
    this.canvas!.addEventListener('pointerup', (e) => {
      if (this._editMode) return;
      const dt = e.timeStamp - this._tapStartTime;
      const dx = e.clientX - this._tapStartPos.x;
      const dy = e.clientY - this._tapStartPos.y;
      if (dt < 250 && Math.hypot(dx, dy) < 10 && this._config?.tap_to_toggle) {
        this._toggleOverlays();
      }
    });

    this._initThree(card);

    this.ro = new ResizeObserver(() => this._onResize());
    this.ro.observe(card);

    this._loadModel();
  }

  private _makeLockBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = this._lockOpenIcon;
    btn.title = 'Verrouiller la vue';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleLock(); });
    return btn;
  }

  private _makeEditBtn(icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = icon;
    btn.title = 'Editer les ancres';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleEditMode(); });
    return btn;
  }

  private _makeCaptureBtn(icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = icon;
    btn.title = 'Capturer la vue courante';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._showCapturePopup(); });
    return btn;
  }

  private _makeSimBtn(icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = icon;
    btn.title = 'Simuler la journée / météo';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleSim(); });
    return btn;
  }

  private _toggleSim() {
    this._simOpen = !this._simOpen;
    if (!this._simExpand || !this._simBtn) return;
    if (this._simOpen) {
      this._simExpand.style.maxHeight = '160px';
      this._simExpand.style.opacity = '1';
      this._simExpand.style.pointerEvents = 'auto';
      this._simBtn.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.85)';
    } else {
      this._simExpand.style.maxHeight = '0';
      this._simExpand.style.opacity = '0';
      this._simExpand.style.pointerEvents = 'none';
      this._simBtn.style.boxShadow = 'none';
    }
  }

  private _buildSimExpandContent() {
    if (!this._simExpand) return;
    this._simExpand.innerHTML = '';

    const inner = document.createElement('div');
    inner.style.cssText = [
      'background:rgba(8,12,24,0.82)',
      'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:14px',
      'padding:10px 14px',
      'font-family:var(--primary-font-family,sans-serif)',
      'color:#fff',
      'user-select:none',
    ].join(';');
    this._simExpand.appendChild(inner);

    const fmt = (h: number) =>
      `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h%1)*60)).padStart(2,'0')}`;

    // Row 1: time label + active toggle
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';

    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = 'font-size:11px;color:#aac8e8;';
    const timeValue = document.createElement('span');
    timeValue.style.cssText = 'color:#fff;font-weight:600;';
    timeValue.textContent = fmt(this._simHour);
    timeLabel.appendChild(document.createTextNode('Heure\u00a0: '));
    timeLabel.appendChild(timeValue);
    row1.appendChild(timeLabel);

    const activeToggle = document.createElement('label');
    activeToggle.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#888;cursor:pointer;';
    const activeCheck = document.createElement('input');
    activeCheck.type = 'checkbox';
    activeCheck.checked = this._simActive;
    activeCheck.style.cursor = 'pointer';
    activeToggle.appendChild(activeCheck);
    activeToggle.appendChild(document.createTextNode('Actif'));
    row1.appendChild(activeToggle);
    inner.appendChild(row1);

    // Time slider
    const timeSlider = document.createElement('input');
    timeSlider.type = 'range';
    timeSlider.min = '0'; timeSlider.max = '24'; timeSlider.step = '0.25';
    timeSlider.value = String(this._simHour);
    timeSlider.style.cssText = 'width:100%;accent-color:#f59e0b;cursor:pointer;margin-bottom:8px;display:block;';
    timeSlider.addEventListener('input', () => {
      this._simHour = parseFloat(timeSlider.value);
      timeValue.textContent = fmt(this._simHour);
      if (this._simActive) this._applySimulation();
    });
    inner.appendChild(timeSlider);

    // Weather presets
    const weatherRow = document.createElement('div');
    weatherRow.style.cssText = 'display:flex;gap:4px;';
    const presets: { emoji: string; label: string; value: typeof this._simWeather }[] = [
      { emoji: '☀️', label: 'Soleil',  value: 'clear'  },
      { emoji: '⛅', label: 'Nuageux', value: 'cloudy' },
      { emoji: '🌧️', label: 'Pluie',   value: 'rain'   },
      { emoji: '❄️', label: 'Neige',   value: 'snow'   },
    ];
    const weatherBtns: HTMLButtonElement[] = [];
    const syncWeather = () => {
      weatherBtns.forEach((b, i) => {
        const on = presets[i].value === this._simWeather;
        b.style.background = on ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)';
        b.style.boxShadow  = on ? '0 0 0 1.5px rgba(245,158,11,0.7)' : 'none';
      });
    };
    for (const p of presets) {
      const wb = document.createElement('button');
      wb.title = p.label; wb.textContent = p.emoji;
      wb.style.cssText = [
        'flex:1', 'border:none', 'border-radius:8px',
        'font-size:16px', 'padding:5px 0',
        'cursor:pointer', 'color:#fff',
        'background:rgba(255,255,255,0.07)',
        'transition:background .15s, box-shadow .15s',
      ].join(';');
      wb.addEventListener('click', () => {
        this._simWeather = p.value;
        syncWeather();
        if (this._simActive) this._applySimulation();
      });
      weatherBtns.push(wb);
      weatherRow.appendChild(wb);
    }
    syncWeather();
    inner.appendChild(weatherRow);

    activeCheck.addEventListener('change', () => {
      this._simActive = activeCheck.checked;
      if (this._simActive) {
        this._applySimulation();
      } else {
        this._removeWeatherParticles();
        this._weatherType = 'none';
        this._updateFromHass();
      }
    });
  }

  /** Compute sun elevation from hour of day (0-24) */
  private _simTimeToElevation(hour: number): number {
    // -60 at midnight, 0 at sunrise(6h)/sunset(18h), 60 at noon
    return 60 * Math.sin(Math.PI * (hour - 6) / 12);
  }

  private _applySimulation() {
    const elevation = this._simTimeToElevation(this._simHour);
    const azimuth = 180; // south at noon, simplified
    this._applySunLight(elevation, azimuth);

    // Apply weather
    this._removeWeatherParticles();
    this._weatherType = 'none';
    if (this._simWeather === 'cloudy') {
      if (this._hemiLight) this._hemiLight.intensity *= 0.5;
      if (this._sunLight) this._sunLight.intensity *= 0.2;
      this.scene?.fog?.color.setHex(0x8899aa);
    } else if (this._simWeather === 'rain') {
      this._applyWeather('rainy');
    } else if (this._simWeather === 'snow') {
      this._applyWeather('snowy');
    }
    this._requestRender();
  }

  private _showCapturePopup() {
    if (!this.camera || !this.controls) return;
    const cam = this.camera.position;
    const tgt = this.controls.target;
    const fmt = (v: number) => +v.toFixed(3);

    this.overlayContainer?.querySelector('.capture-popup')?.remove();

    const popup = document.createElement('div');
    popup.className = 'capture-popup';
    popup.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:#1a1f2e', 'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:10px', 'padding:16px 20px',
      'z-index:200', 'width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'font-family:var(--primary-font-family,sans-serif)',
      'color:#fff', 'pointer-events:auto',
    ].join(';');

    // Title
    const title = document.createElement('div');
    title.textContent = '📷 Capturer la vue';
    title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:14px;color:#aac8e8;';
    popup.appendChild(title);

    // Label input
    const labelInput = document.createElement('input');
    labelInput.placeholder = 'Nom de la vue (ex: Salon)';
    labelInput.value = 'Ma vue';
    labelInput.style.cssText = [
      'width:100%', 'box-sizing:border-box',
      'background:#0d1117', 'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:6px', 'color:#fff', 'padding:7px 10px',
      'font-size:13px', 'outline:none', 'display:block', 'margin-bottom:10px',
    ].join(';');
    popup.appendChild(labelInput);

    // YAML preview
    const getYaml = () => {
      const label = labelInput.value.trim() || 'Ma vue';
      return `- label: "${label}"\n  position: [${fmt(cam.x)}, ${fmt(cam.y)}, ${fmt(cam.z)}]\n  target: [${fmt(tgt.x)}, ${fmt(tgt.y)}, ${fmt(tgt.z)}]`;
    };
    const pre = document.createElement('pre');
    pre.style.cssText = [
      'background:#0d1117', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:6px', 'padding:10px', 'font-size:11px', 'color:#7dd3fc',
      'margin:0 0 14px', 'overflow:auto', 'white-space:pre',
    ].join(';');
    pre.textContent = getYaml();
    popup.appendChild(pre);
    labelInput.addEventListener('input', () => { pre.textContent = getYaml(); });

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copier YAML';
    copyBtn.style.cssText = 'flex:1;background:#1a6bff;border:none;color:#fff;border-radius:6px;padding:8px 0;cursor:pointer;font-size:12px;font-weight:700;';
    copyBtn.addEventListener('click', () => {
      copyToClipboard(getYaml()).then(() => {
        copyBtn.textContent = '✓ Copié !';
        setTimeout(() => { copyBtn.textContent = '📋 Copier YAML'; }, 1500);
      });
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fermer';
    closeBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.18);color:#aaa;border-radius:6px;padding:8px 14px;cursor:pointer;font-size:12px;';
    closeBtn.addEventListener('click', () => popup.remove());

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    popup.appendChild(btnRow);

    this.overlayContainer!.appendChild(popup);
    setTimeout(() => { labelInput.select(); }, 50);
  }

  private _hudBtnStyle(): string {
    return [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'width:30px', 'height:30px',
      'border:none', 'border-radius:50%',
      'background:rgba(255,255,255,0.07)',
      'color:#fff', 'cursor:pointer',
      'font-size:15px', 'line-height:1',
      'flex-shrink:0',
      'transition:background .15s, box-shadow .15s',
    ].join(';');
  }

  // ── Controls visibility ────────────────────────────────────────────────

  private _showControls() {
    if (!this._hud) return;
    this._hud.style.opacity = '1';
    this._hud.style.pointerEvents = 'auto';
  }

  private _hideControls() {
    if (this._editMode) return;
    if (this._simOpen) return; // keep visible while sim panel is open
    if (!this._hud) return;
    this._hud.style.opacity = '0';
    this._hud.style.pointerEvents = 'none';
  }

  private _showControlsTemporarily() {
    this._showControls();
    if (this._controlsHideTimer) clearTimeout(this._controlsHideTimer);
    this._controlsHideTimer = setTimeout(() => this._hideControls(), 3000);
  }

  // ── Overlay toggle ─────────────────────────────────────────────────────

  private _toggleOverlays() {
    this._overlaysVisible = !this._overlaysVisible;
    this.overlays.forEach((o) => {
      o.el.style.display = this._overlaysVisible ? '' : 'none';
    });
    this._clusters.forEach((c) => {
      if (!this._overlaysVisible) c.hide();
    });
  }

  private _toggleLock(force?: boolean) {
    this._locked = force !== undefined ? force : !this._locked;
    if (this.controls) this.controls.enabled = !this._locked && !this._editMode;
    this.lockBtn!.textContent = this._locked ? this._lockClosedIcon : this._lockOpenIcon;
    this.lockBtn!.title = this._locked ? 'Déverrouiller la vue' : 'Verrouiller la vue';
    this.lockBtn!.style.boxShadow = this._locked ? '0 0 0 2px rgba(239,68,68,0.8)' : 'none';
    this._saveView();
  }

  // ── Edit mode ─────────────────────────────────────────────────────────

  private _toggleEditMode() {
    if (!this.modelLoaded || !this._modelRoot) return;
    this._editMode ? this._exitEditMode() : this._enterEditMode();
  }

  private _enterEditMode() {
    this._editMode = true;
    if (this.editBtn) {
      this.editBtn.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.9)';
      this.editBtn.title = 'Quitter le mode édition';
    }
    this._showControls();

    this.overlays.forEach((o) => { o.el.style.display = 'none'; });
    this._clusters.forEach((c) => c.hide());

    const editable = new Map<string, EditableAnchor>();
    this.anchors.forEach((entry, key) => {
      editable.set(key, {
        entity: entry.entityId,
        position: entry.worldPos.clone(),
        label: entry.label,
      });
    });

    if (!this._editor) {
      this._editor = new AnchorEditor(
        this.scene!,
        this.camera!,
        this.canvas!,
        this._modelRoot!,
        this.overlayContainer!,
      );
      this._editor.onChanged = () => this._requestRender();
    }
    this._editor.setHass(this._hass);
    this._editor.activate(editable);

    this._showEditorToolbar();
    this._requestRender();

    if (editable.size === 0) {
      const hint = document.createElement('div');
      hint.id = 'ha-editor-hint';
      hint.style.cssText = [
        'position:absolute', 'top:50%', 'left:50%',
        'transform:translate(-50%,-50%)',
        'background:rgba(26,107,255,0.18)',
        'border:1px dashed rgba(26,107,255,0.5)',
        'border-radius:10px',
        'padding:12px 20px',
        'color:rgba(255,255,255,0.7)',
        'font-size:13px',
        'font-family:var(--primary-font-family,sans-serif)',
        'text-align:center',
        'pointer-events:none',
        'z-index:30',
      ].join(';');
      hint.textContent = 'Clique sur le modèle pour placer une ancre';
      this.overlayContainer!.appendChild(hint);
      setTimeout(() => hint.remove(), 4000);
    }
  }

  private _exitEditMode() {
    this._editMode = false;
    if (this.editBtn) {
      this.editBtn.style.boxShadow = 'none';
      this.editBtn.title = 'Editer les ancres';
    }

    const editable = new Map<string, EditableAnchor>(this._editor!.anchors as Map<string, EditableAnchor>);
    this._editor!.deactivate();

    this.anchors.forEach((entry) => {
      if (entry.light) {
        this.scene?.remove(entry.light);
        entry.light.dispose();
      }
    });

    this.anchors = buildAnchorsFromEditable(editable, this.scene!, this._config!);

    if (this.controls) this.controls.enabled = !this._locked;

    this._createOverlays();
    if (this._hass) {
      syncLights(this.anchors, this._hass, this._config);
      this._updateOverlayStates();
    }

    this._removeEditorToolbar();
    this.overlays.forEach((o) => {
      o.el.style.display = this._overlaysVisible ? '' : 'none';
    });
    this._requestRender();
  }

  // ── Editor toolbar ────────────────────────────────────────────────────

  private _showEditorToolbar() {
    if (!this._hudLeft || !this._hudRight || !this._hudSep) return;

    // Save and clear current HUD content
    this._hudLeft.innerHTML = '';
    this._hudRight.innerHTML = '';
    this._hudSep.style.display = 'none';

    // Editor tool buttons (left side)
    const tools: Array<{ id: string; label: string; title: string }> = [
      { id: 'select', label: '↖ Sélect', title: 'Sélectionner / déplacer une ancre' },
      { id: 'add',    label: '+ Ajouter', title: 'Cliquer sur le modèle pour placer une ancre' },
      { id: 'delete', label: '✕ Suppr',  title: 'Cliquer sur une ancre pour la supprimer' },
    ];

    const toolBtns = new Map<string, HTMLButtonElement>();
    const setActiveTool = (id: string) => {
      toolBtns.forEach((b, k) => {
        b.style.background = k === id ? 'rgba(59,130,246,0.85)' : 'rgba(255,255,255,0.08)';
        b.style.boxShadow  = k === id ? '0 0 0 1.5px rgba(59,130,246,0.6)' : 'none';
        b.style.color = k === id ? '#fff' : 'rgba(255,255,255,0.6)';
      });
    };

    tools.forEach(({ id, label, title }) => {
      const btn = this._tbBtn(label, 'rgba(255,255,255,0.08)');
      btn.style.color = 'rgba(255,255,255,0.6)';
      btn.title = title;
      btn.addEventListener('click', () => {
        this._editor?.setTool(id as import('./editor').EditorTool);
        setActiveTool(id);
      });
      toolBtns.set(id, btn);
      this._hudLeft!.appendChild(btn);
    });

    if (this._editor) this._editor.onToolChange = (t) => setActiveTool(t);

    this._hudSep.style.display = 'block';

    // Right side: yaml + done
    const yamlBtn = this._tbBtn('📋 YAML', 'rgba(59,130,246,0.85)');
    yamlBtn.style.fontWeight = '700';
    yamlBtn.title = 'Exporter les ancres en YAML';
    yamlBtn.addEventListener('click', () => this._editor?.showExportPopup());
    this._hudRight.appendChild(yamlBtn);

    const doneBtn = this._tbBtn('✓ Fermer', 'rgba(255,255,255,0.07)');
    doneBtn.style.color = 'rgba(255,255,255,0.5)';
    doneBtn.addEventListener('click', () => this._exitEditMode());
    this._hudRight.appendChild(doneBtn);

    setActiveTool('select');
  }

  private _tbBtn(label: string, bg: string): HTMLButtonElement {
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

  private _removeEditorToolbar() {
    // Restore HUD to normal camera view + action buttons
    this._buildCameraViewBar();
    if (!this._hudRight) return;
    this._hudRight.innerHTML = '';
    const ui = this._config?.ui ?? {};
    const icons = ui.icons ?? {};
    if (ui.show_simulation !== false && this._simBtn) {
      this._hudRight.appendChild(this._simBtn);
    }
    if (ui.show_lock !== false && this.lockBtn) {
      this._hudRight.appendChild(this.lockBtn);
    }
    if (ui.show_editor !== false && this.editBtn) {
      this._hudRight.appendChild(this.editBtn);
    }
    if (ui.show_capture !== false && this.captureBtn) {
      this._hudRight.appendChild(this.captureBtn);
    }
    // Update separator visibility
    const hasViews = !!(this._config?.camera_views?.length);
    const hasActions = this._hudRight.children.length > 0;
    if (this._hudSep) this._hudSep.style.display = (hasViews && hasActions) ? 'block' : 'none';
    void icons; // silence unused warning
  }

  // ── Three.js init ─────────────────────────────────────────────────────

  private _initThree(container: HTMLElement) {
    const w = container.offsetWidth || 400;
    const h = this._config?.height ?? Math.round(w * 0.75);
    container.style.height = `${h}px`;

    const rl = this._config?.rendering ?? {};
    const useSky = rl.sky !== false && rl.transparent_background !== true;
    const bgHex = rl.background_color ? parseInt(rl.background_color.replace('#', ''), 16) : 0x0d1117;

    this.scene = new THREE.Scene();
    this.scene.background = useSky ? null : (rl.transparent_background ? null : new THREE.Color(bgHex));
    this.scene.fog = rl.transparent_background ? null : new THREE.FogExp2(0x9fc8e8, rl.fog_density ?? 0.018);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
    this.camera.position.set(0, 5, 12);
    const shadows = rl.shadows !== false;

    const transparentBg = rl.transparent_background === true;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas!, antialias: true, alpha: transparentBg });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = rl.exposure ?? 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (transparentBg) this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.canvas!);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const orb = this._config?.orbit ?? {};
    this.controls.minDistance = orb.min_distance ?? 1;
    this.controls.maxDistance = orb.max_distance ?? 100;
    this.controls.maxPolarAngle =
      orb.max_polar_angle !== undefined
        ? (orb.max_polar_angle * Math.PI) / 180
        : Math.PI * 0.48;

    this.controls.addEventListener('change', () => this._requestRender());
    this.controls.addEventListener('end', () => this._saveView());

    // Hemisphere — warm sky, dark ground so entity point lights stand out
    this._hemiLight = new THREE.HemisphereLight(0xfff4e0, 0x1a1a2e, rl.ambient_intensity ?? 0.7);
    this.scene.add(this._hemiLight);

    // Sun directional — soft shadows
    this._sunLight = new THREE.DirectionalLight(0xfff4c2, rl.sun_intensity ?? 0.8);
    this._sunLight.position.set(5, 10, 5);
    this._sunLight.castShadow = shadows;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near = 0.1;
    this._sunLight.shadow.camera.far = 60;
    this._sunLight.shadow.camera.left = -15;
    this._sunLight.shadow.camera.right = 15;
    this._sunLight.shadow.camera.top = 15;
    this._sunLight.shadow.camera.bottom = -15;
    this._sunLight.shadow.bias = -0.0005;
    this._sunLight.shadow.normalBias = 0.05;
    this.scene.add(this._sunLight);

    // Procedural sky — visible through windows, updated by sun_entity or default midday
    if (useSky) {
      this._sky = new Sky();
      this._sky.scale.setScalar(1500);
      this.scene.add(this._sky);
      const su = this._sky.material.uniforms;
      su['turbidity'].value = 4;
      su['rayleigh'].value = 1.2;
      su['mieCoefficient'].value = 0.005;
      su['mieDirectionalG'].value = 0.85;
      this._setSkyPos(rl.sky_elevation ?? 60, 180);
    }

    this._lastTime = performance.now();
    this._loop();
  }

  private _setSkyPos(elevation: number, azimuth = 180) {
    if (!this._sky) return;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth - 180);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this._sky.material.uniforms['sunPosition'].value.copy(sunPos);
    // Adjust haziness near horizon / sunset
    const t = Math.max(0, Math.min(1, elevation / 30));
    this._sky.material.uniforms['turbidity'].value = THREE.MathUtils.lerp(10, 3, t);
    this._sky.material.uniforms['rayleigh'].value = THREE.MathUtils.lerp(3, 1.2, t);
    // Night: hide sky, use dark bg
    const transparentBg = this._config?.rendering?.transparent_background === true;
    if (transparentBg) {
      this._sky.visible = false;
    } else if (elevation < -5) {
      this._sky.visible = false;
      this.scene!.background = new THREE.Color(0x05080f);
      if (this.scene!.fog) (this.scene!.fog as THREE.FogExp2).color.setHex(0x05080f);
    } else {
      this._sky.visible = true;
      this.scene!.background = null;
      const fogHex = elevation > 20 ? 0x9fc8e8 : 0xd4845a;
      if (this.scene!.fog) (this.scene!.fog as THREE.FogExp2).color.setHex(fogHex);
    }
  }

  // ── Render loop ───────────────────────────────────────────────────────

  private _loop = () => {
    this.rafId = requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Camera fly-to animation
    if (this._camAnimTo && this.camera && this.controls) {
      const alpha = 1 - Math.exp(-dt / 0.25);
      this.camera.position.lerp(this._camAnimTo.pos, alpha);
      this.controls.target.lerp(this._camAnimTo.target, alpha);
      if (
        this.camera.position.distanceTo(this._camAnimTo.pos) < 0.005 &&
        this.controls.target.distanceTo(this._camAnimTo.target) < 0.005
      ) {
        this.camera.position.copy(this._camAnimTo.pos);
        this.controls.target.copy(this._camAnimTo.target);
        this._camAnimTo = null;
        this._saveView();
      }
      this._dirty = true;
    }

    const moved = this.controls?.update() ?? false;
    if (moved) this._dirty = true;

    if (this._editMode) this._dirty = true;

    const transitioning = stepTransitions(this.anchors, dt, this._config);
    if (transitioning) this._dirty = true;

    if (this._weatherParticles) {
      this._stepParticles(dt);
      this._dirty = true;
    }

    if ((moved || this._dirty) && this.camera && this.canvas) {
      const w = this.canvas.offsetWidth;
      const h = this.canvas.offsetHeight;
      this._updateOverlayPositions(w, h);
    }

    if (!this._dirty) return;
    this._dirty = false;
    this.renderer?.render(this.scene!, this.camera!);
  };

  // ── Model loading ─────────────────────────────────────────────────────

  private async _loadModel() {
    if (!this._config?.model_url || !this.scene) return;

    let model: THREE.Group;
    try {
      model = await loadGLTF(this._config.model_url);
    } catch (err) {
      console.error('[ha-3d-floorplan] model load failed:', err);
      return;
    }

    // Enable shadows on all meshes
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    this._modelBox.copy(box).translate(centre.negate());

    const saved = this._loadView();
    if (saved) {
      this.camera!.position.fromArray(saved.pos);
      this.controls!.target.fromArray(saved.target);
      this._toggleLock(saved.locked);
    } else {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      this.camera!.position.set(0, maxDim * 0.6, maxDim * 1.4);
      this.camera!.lookAt(0, 0, 0);
      this.controls!.target.set(0, 0, 0);
      this.lockBtn!.textContent = '\uD83D\uDD13';
    }

    if (this.scene.fog instanceof THREE.Fog) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.z);
      this.scene.fog.near = maxDim * 1.2;
      this.scene.fog.far = maxDim * 4;
    }

    this.controls!.update();
    this.scene.add(model);
    this._modelRoot = model;
    if (this._config?.rendering?.transparent_background !== true) this._addGround(box);

    this.anchors = detectAnchors(model, this.scene, this._config);
    this._createOverlays();

    this._overlaysVisible = !(this._config?.tap_to_toggle ?? false);

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, this._config);
      this._updateOverlayStates();
      this._updateEnvironment();
    }

    this._buildCameraViewBar();
    this._requestRender();
  }

  // ── Camera views ──────────────────────────────────────────────────────

  private _buildCameraViewBar() {
    if (!this._hudLeft) return;
    this._hudLeft.innerHTML = '';

    const views = this._config?.camera_views;
    const hasViews = !!(views?.length);
    const hasActions = !!(this._hudRight && this._hudRight.children.length > 0);
    if (this._hudSep) this._hudSep.style.display = (hasViews && hasActions) ? 'block' : 'none';
    if (!hasViews) return;

    views!.forEach((v) => {
      const btn = document.createElement('button');
      btn.textContent = v.label;
      btn.style.cssText = [
        'background:transparent', 'border:none',
        'color:rgba(255,255,255,0.72)', 'cursor:pointer',
        'padding:3px 9px', 'font-size:12px',
        'font-family:var(--primary-font-family,sans-serif)',
        'border-radius:14px',
        'transition:background .15s, color .15s',
        'white-space:nowrap',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,255,255,0.12)';
        btn.style.color = '#fff';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(255,255,255,0.72)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._flyToView(v);
      });
      this._hudLeft!.appendChild(btn);
    });
  }

  private _flyToView(v: import('./types').CameraView) {
    this._camAnimTo = {
      pos: new THREE.Vector3(...v.position),
      target: v.target ? new THREE.Vector3(...v.target) : new THREE.Vector3(0, 0, 0),
    };
  }

  // ── Overlay positioning + clustering ──────────────────────────────────

  private _updateOverlayPositions(w: number, h: number) {
    // 1. Compute 2D screen positions
    const pos2d = new Map<string, { x: number; y: number }>();
    const behind = new Set<string>();

    this.anchors.forEach((entry, name) => {
      const p = entry.worldPos.clone().project(this.camera!);
      if (p.z >= 1) { behind.add(name); return; }
      pos2d.set(name, {
        x: ((p.x + 1) / 2) * w,
        y: ((-p.y + 1) / 2) * h,
      });
    });

    // 2. Cluster visible anchors (opt-in via cluster_threshold)
    const threshold = this._config?.cluster_threshold ?? 0;
    const groups = threshold > 0
      ? this._computeClusters([...pos2d.entries()], threshold)
      : [...pos2d.keys()].map(k => [k]);
    const inCluster = new Set<string>();
    const activeIds = new Set<string>();

    groups.filter(g => g.length > 1).forEach(group => {
      const id = [...group].sort().join('|');
      activeIds.add(id);
      group.forEach(k => inCluster.add(k));

      const cx = group.reduce((s, k) => s + pos2d.get(k)!.x, 0) / group.length;
      const cy = group.reduce((s, k) => s + pos2d.get(k)!.y, 0) / group.length;

      let clusterOv = this._clusters.get(id);
      if (!clusterOv) {
        clusterOv = new ClusterOverlay(this.overlayContainer!);
        this._clusters.set(id, clusterOv);
      }

      const items: ClusterItem[] = group.map(k => {
        const entry = this.anchors.get(k)!;
        return {
          domain: entry.domain,
          label: entry.label,
          on: entry.targetIntensity > 0,
          color: entry.targetColor.clone(),
          onShortClick: this._getShortClickHandler(entry),
          onLongPress: () => this._openMoreInfo(entry.entityId),
        };
      });

      clusterOv.update(items);
      clusterOv.updatePosition(cx, cy);
      clusterOv.show();
    });

    // Remove stale clusters
    this._clusters.forEach((clusterOv, id) => {
      if (!activeIds.has(id)) { clusterOv.destroy(); this._clusters.delete(id); }
    });

    // 3. Show/hide individual overlays
    this.anchors.forEach((_entry, name) => {
      const ov = this.overlays.get(name);
      if (!ov) return;
      if (behind.has(name) || inCluster.has(name)) {
        ov.el.style.display = 'none';
        return;
      }
      const p = pos2d.get(name)!;
      ov.el.style.display = ov instanceof SensorOverlay ? 'block' : 'flex';
      ov.el.style.left = `${p.x}px`;
      ov.el.style.top = `${p.y}px`;
    });
  }

  private _computeClusters(items: [string, { x: number; y: number }][], threshold: number): string[][] {
    const groups: string[][] = [];
    const assigned = new Set<string>();

    items.forEach(([key, pos]) => {
      if (assigned.has(key)) return;
      const group = [key];
      assigned.add(key);
      items.forEach(([k2, pos2]) => {
        if (k2 === key || assigned.has(k2)) return;
        if (Math.hypot(pos.x - pos2.x, pos.y - pos2.y) < threshold) {
          group.push(k2);
          assigned.add(k2);
        }
      });
      groups.push(group);
    });

    return groups;
  }

  // ── Overlays ──────────────────────────────────────────────────────────

  private _createOverlays() {
    this._clusters.forEach(c => c.destroy());
    this._clusters.clear();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();

    this.anchors.forEach((entry, name) => {
      if (entry.domain === 'sensor') {
        const overlay = new SensorOverlay(
          this.overlayContainer!,
          () => this._openMoreInfo(entry.entityId),
        );
        this.overlays.set(name, overlay);
        return;
      }

      const onShortClick = this._getShortClickHandler(entry);
      const overlay = new AnchorOverlay(
        this.overlayContainer!,
        entry.domain,
        entry.label,
        onShortClick,
        () => this._openMoreInfo(entry.entityId),
      );
      this.overlays.set(name, overlay);
    });
  }

  private _getShortClickHandler(entry: AnchorEntry): () => void {
    switch (entry.domain) {
      case 'light':
      case 'switch':
        return () => this._hass?.callService(entry.domain, 'toggle', { entity_id: entry.entityId });
      case 'cover':
        return () => this._hass?.callService('cover', 'toggle', { entity_id: entry.entityId });
      case 'media_player':
        return () => this._hass?.callService('media_player', 'media_play_pause', { entity_id: entry.entityId });
      default:
        return () => this._openMoreInfo(entry.entityId);
    }
  }

  private _updateOverlayStates() {
    this.anchors.forEach((entry, name) => {
      const overlay = this.overlays.get(name);
      if (!overlay) return;

      const stateObj = this._hass?.states[entry.entityId];

      if (overlay instanceof SensorOverlay) {
        const value = stateObj?.state ?? '\u2014';
        const unit = (stateObj?.attributes.unit_of_measurement as string) ?? '';
        overlay.updateValue(value, unit, `${entry.label}: ${value}${unit}`);
        return;
      }

      if (overlay instanceof AnchorOverlay) {
        const on = entry.targetIntensity > 0;
        const stateName = stateObj?.state ?? '\u2014';
        let label = `${entry.label} \u2022 ${stateName}`;
        if (entry.domain === 'climate') {
          const temp = stateObj?.attributes.current_temperature;
          if (temp != null) label = `${entry.label} \u2022 ${temp}\u00B0`;
        } else if (entry.domain === 'cover') {
          const pct = stateObj?.attributes.current_position;
          if (pct != null) label = `${entry.label} \u2022 ${pct}%`;
        }
        overlay.updateState(on, entry.targetColor, label);
      }
    });
  }

  private _openMoreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  // ── Environment (sun + weather) ───────────────────────────────────────

  private _updateEnvironment() {
    if (!this._hass) return;
    if (this._simActive) return; // simulation overrides HA sun/weather
    const cfg = this._config;

    if (cfg?.sun_entity) {
      const sunState = this._hass.states[cfg.sun_entity];
      if (sunState) {
        const elevation = (sunState.attributes.elevation as number) ?? 0;
        const azimuth = (sunState.attributes.azimuth as number) ?? 180;
        this._applySunLight(elevation, azimuth);
      }
    }

    if (cfg?.weather_entity) {
      const weatherState = this._hass.states[cfg.weather_entity];
      if (weatherState) this._applyWeather(weatherState.state);
    }
  }

  private _applySunLight(elevation: number, azimuth: number) {
    if (!this._hemiLight || !this._sunLight || !this.scene) return;

    const t = Math.max(0, Math.min(1, (elevation + 10) / 30));
    const isNight = elevation < -2;

    this._hemiLight.intensity = isNight ? 0.45 : THREE.MathUtils.lerp(0.15, 0.7, t);
    this._hemiLight.color.setHex(isNight ? 0x3a5080 : (t < 0.5 ? 0xee8833 : 0xfff4e0));
    this._hemiLight.groundColor.setHex(isNight ? 0x0d1a2e : (t > 0.5 ? 0x1a1a2e : 0x0d1020));

    this._sunLight.intensity = Math.max(0, elevation / 60) * 0.9;
    const azRad = ((azimuth - 180) * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    this._sunLight.position.set(
      Math.sin(azRad) * Math.cos(elRad) * 10,
      Math.sin(elRad) * 10,
      Math.cos(azRad) * Math.cos(elRad) * 10,
    );

    this._setSkyPos(elevation, azimuth);
    this._requestRender();
  }

  private _applyWeather(weatherState: string) {
    const rainy = ['rainy', 'pouring', 'lightning', 'lightning-rainy'].includes(weatherState);
    const snowy = ['snowy', 'snowy-rainy'].includes(weatherState);
    const wanted: 'rain' | 'snow' | 'none' = rainy ? 'rain' : snowy ? 'snow' : 'none';

    if (wanted === this._weatherType) return;
    this._weatherType = wanted;
    this._removeWeatherParticles();

    if (this.scene) {
      if (wanted === 'rain') {
        this.scene.fog?.color.setHex(0x0a1020);
        if (this._hemiLight) this._hemiLight.intensity *= 0.6;
      } else if (wanted === 'snow') {
        this.scene.fog?.color.setHex(0x1a2030);
        if (this._hemiLight) this._hemiLight.intensity *= 0.8;
      }
    }

    if (wanted !== 'none') this._createWeatherParticles(wanted);
    this._requestRender();
  }

  private _addGround(originalBox: THREE.Box3) {
    if (!this.scene) return;
    const size = originalBox.getSize(new THREE.Vector3());
    const spread = Math.max(size.x, size.z) * 6;
    const groundY = -size.y / 2 - 0.01;
    const geo = new THREE.PlaneGeometry(spread, spread);
    const groundHex = this._config?.rendering?.ground_color
      ? parseInt(this._config.rendering.ground_color.replace('#', ''), 16)
      : 0x4a6741;
    const mat = new THREE.MeshStandardMaterial({ color: groundHex, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = groundY;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ── Weather particles ─────────────────────────────────────────────────

  private _createWeatherParticles(type: 'rain' | 'snow') {
    if (!this.scene) return;

    const box = this._modelBox;
    const size = box.getSize(new THREE.Vector3());
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const spreadX = Math.max(size.x * 2, 12);
    const spreadZ = Math.max(size.z * 2, 12);
    const yTop = box.max.y + 5;
    const yBot = box.min.y - 0.5;
    const modelMinX = box.min.x;
    const modelMaxX = box.max.x;
    const modelMinZ = box.min.z;
    const modelMaxZ = box.max.z;
    const meta = { type, spreadX, spreadZ, cx, cz, yTop, yBot, modelMinX, modelMaxX, modelMinZ, modelMaxZ };

    const spawnXZ = (): [number, number] => {
      let x: number, z: number, tries = 0;
      do {
        x = cx + (Math.random() - 0.5) * spreadX;
        z = cz + (Math.random() - 0.5) * spreadZ;
        tries++;
      } while (tries < 30 && x > modelMinX && x < modelMaxX && z > modelMinZ && z < modelMaxZ);
      return [x, z];
    };

    if (type === 'rain') {
      const COUNT = 700;
      const pos = new Float32Array(COUNT * 6);
      for (let i = 0; i < COUNT; i++) {
        const [x, z] = spawnXZ();
        const y = yBot + Math.random() * (yTop - yBot);
        const len = 0.25 + Math.random() * 0.2;
        const wx = -0.06;
        pos[i * 6 + 0] = x;       pos[i * 6 + 1] = y;        pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x + wx;  pos[i * 6 + 4] = y - len;  pos[i * 6 + 5] = z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xaac8e8, transparent: true, opacity: 0.45 });
      const mesh = new THREE.LineSegments(geo, mat);
      mesh.userData = meta;
      this._weatherParticles = mesh;
      this.scene.add(mesh);
    } else {
      const COUNT = 350;
      const pos = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        const [x, z] = spawnXZ();
        pos[i * 3 + 0] = x;
        pos[i * 3 + 1] = yBot + Math.random() * (yTop - yBot);
        pos[i * 3 + 2] = z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xddeeff,
        size: 0.12,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const mesh = new THREE.Points(geo, mat);
      mesh.userData = meta;
      this._weatherParticles = mesh;
      this.scene.add(mesh);
    }
  }

  private _stepParticles(dt: number) {
    const obj = this._weatherParticles;
    if (!obj) return;
    const { type, spreadX, spreadZ, cx, cz, yTop, yBot, modelMinX, modelMaxX, modelMinZ, modelMaxZ } = obj.userData as {
      type: string; spreadX: number; spreadZ: number;
      cx: number; cz: number; yTop: number; yBot: number;
      modelMinX: number; modelMaxX: number; modelMinZ: number; modelMaxZ: number;
    };

    const spawnXZ = (): [number, number] => {
      let x: number, z: number, tries = 0;
      do {
        x = cx + (Math.random() - 0.5) * spreadX;
        z = cz + (Math.random() - 0.5) * spreadZ;
        tries++;
      } while (tries < 30 && x > modelMinX && x < modelMaxX && z > modelMinZ && z < modelMaxZ);
      return [x, z];
    };

    const geo = (obj as THREE.LineSegments | THREE.Points).geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    if (type === 'rain') {
      const speed = 5.5;
      const wx = -0.06 * speed * dt;
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= speed * dt;
        arr[i + 4] -= speed * dt;
        arr[i + 0] += wx; arr[i + 3] += wx;
        if (arr[i + 4] < yBot) {
          const [x, z] = spawnXZ();
          const len = 0.25 + Math.random() * 0.2;
          arr[i + 0] = x;        arr[i + 1] = yTop;       arr[i + 2] = z;
          arr[i + 3] = x - 0.06; arr[i + 4] = yTop - len; arr[i + 5] = z;
        }
      }
    } else {
      const speed = 0.5 + Math.random() * 0.1;
      const driftAmp = 0.15;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= speed * dt;
        arr[i + 0] += (Math.random() - 0.5) * driftAmp * dt;
        arr[i + 2] += (Math.random() - 0.5) * driftAmp * dt;
        if (arr[i + 1] < yBot) {
          const [x, z] = spawnXZ();
          arr[i + 0] = x;
          arr[i + 1] = yTop;
          arr[i + 2] = z;
        }
      }
    }
    pos.needsUpdate = true;
  }

  private _removeWeatherParticles() {
    if (!this._weatherParticles) return;
    this.scene?.remove(this._weatherParticles);
    const obj = this._weatherParticles as THREE.LineSegments | THREE.Points;
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
    this._weatherParticles = null;

    this._setSkyPos(60, 180);
    if (this._hemiLight) this._hemiLight.intensity = 0.7;
  }

  // ── Resize ────────────────────────────────────────────────────────────

  private _onResize() {
    const container = this.querySelector('ha-card') as HTMLElement | null;
    if (!container || !this.renderer || !this.camera) return;
    const w = container.offsetWidth;
    const h = this._config?.height ?? Math.round(w * 0.75);
    container.style.height = `${h}px`;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._requestRender();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private _teardown() {
    cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    if (this._editMode) this._editor?.deactivate();
    this.controls?.dispose();
    this.renderer?.dispose();
    this._removeWeatherParticles();
    this._clusters.forEach((c) => c.destroy());
    this._clusters.clear();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();
    this.anchors.forEach((e) => { e.light?.dispose(); });
    this.anchors.clear();
    this._hud?.remove();
    this._hud = null;
    this._hudLeft = null;
    this._hudSep = null;
    this._hudRight = null;
    this._simExpand = null;
    this._simOpen = false;
    if (this._controlsHideTimer) clearTimeout(this._controlsHideTimer);
    this.modelLoaded = false;
    this._editMode = false;
    this._modelRoot = null;
    this._camAnimTo = null;
    this._sky = null;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

customElements.define('ha-3d-floorplan', Ha3dFloorplan);
