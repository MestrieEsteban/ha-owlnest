import * as THREE from 'three';


import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor, OwlnestScene } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable, rebuildAnchorLight, lightTargetPos } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';
import { loadScene, saveScene, sceneToEffectiveConfig, buildSceneFromEditor, captureCameraView, normalizeViews } from './scene';
import type { CameraView } from './types';
import './card-editor';

type AnyOverlay = AnchorOverlay | SensorOverlay;

class Ha3dFloorplan extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;

  // Scene backend
  private _scene: OwlnestScene | null = null;
  private _sceneLoading = false;

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
  private _anchorListPanel: HTMLDivElement | null = null;
  private _viewManagerPanel: HTMLDivElement | null = null;
  private _viewsSaving = false;
  private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _saveStatus: 'saved' | 'unsaved' | 'saving' = 'saved';
  private _savePending = false;  // true while a callWS is in flight
  private _editorDragging = false;
  private _gizmoDragging = false;  // true while XYZ gizmo arrow is held

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
    if (!config.model_url && !config.scene_id)
      throw new Error('ha-3d-floorplan: model_url or scene_id is required');
    const sceneChanged = config.scene_id !== this._config?.scene_id;
    this._config = config;
    if (sceneChanged) {
      this._scene = null;
      this._sceneLoading = false;
    }
    this._bootstrap();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this._editor?.setHass(hass);

    // If scene_id is configured and scene hasn't been fetched yet, do it now.
    // _loadModel() is deferred until scene data is available.
    if (this._config?.scene_id && !this._scene && !this._sceneLoading) {
      this._sceneLoading = true;
      this._fetchAndLoadScene(this._config.scene_id);
      return;
    }

    if (this.modelLoaded && !this._editMode) {
      syncLights(this.anchors, hass, this._effectiveConfig);
      this._updateOverlayStates();
      this._updateEnvironment();
      this._requestRender();
    }
  }

  static getStubConfig() {
    return { scene_id: 'main' };
  }

  static getConfigElement() {
    return document.createElement('ha-3d-floorplan-editor');
  }

  // ── Scene backend ─────────────────────────────────────────────────────

  /** Merged config: scene data overrides YAML config for model_url / anchors / camera_views */
  private get _effectiveConfig(): CardConfig {
    if (!this._scene) return this._config!;
    return sceneToEffectiveConfig(this._scene, this._config!);
  }

  private _fetchAndLoadScene(sceneId: string) {
    loadScene(this._hass!, sceneId)
      .then((scene) => {
        this._scene = scene;
        this._sceneLoading = false;
        this._loadModel();
      })
      .catch((err) => {
        console.warn('[Owlnest] Scene load failed:', err);
        this._sceneLoading = false;
        // Fallback: load from Lovelace config if model_url is present
        if (this._config?.model_url) this._loadModel();
      });
  }

  async _saveScene() {
    if (!this._config?.scene_id || !this._hass || !this._editor) return;
    if (this._savePending) return;  // don't pile up concurrent saves

    const sceneData = buildSceneFromEditor(
      this._config.scene_id,
      this._editor.anchors as Map<string, EditableAnchor>,
      this._scene,
      this._config,
    );

    this._savePending = true;
    try {
      await saveScene(this._hass, this._config.scene_id, sceneData);
      this._scene = sceneData;
      this._showToast('✓ Scène sauvegardée');
    } catch (err) {
      console.error('[Owlnest] Save failed:', err);
      this._showToast('✗ Erreur lors de la sauvegarde', true);
    } finally {
      this._savePending = false;
    }
  }

  private _showToast(message: string, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:absolute', 'top:12px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:200',
      `background:${isError ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)'}`,
      'backdrop-filter:blur(8px)',
      'color:#fff', 'font-size:12px', 'font-weight:600',
      'padding:6px 16px', 'border-radius:20px',
      'pointer-events:none',
      'font-family:var(--primary-font-family,sans-serif)',
      'transition:opacity .3s ease',
    ].join(';');
    this.overlayContainer?.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    setTimeout(() => toast.remove(), 2400);
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
    // Any pointer interaction keeps HUD visible (fixes disappearing buttons on click)
    card.addEventListener('pointerdown', () => this._showControls());
    // Touch — show HUD for 4 seconds on tap
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

    // If scene_id is set, defer model loading until hass is available.
    // The hass setter will call _fetchAndLoadScene → _loadModel.
    if (!this._config?.scene_id || this._scene) {
      this._loadModel();
    }
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
    btn.title = 'Vues sauvegardées';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleViewManager(); });
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
    const presets: { emoji: string; label: string; value: 'clear' | 'cloudy' | 'rain' | 'snow' }[] = [
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
        if (this.modelLoaded && this._hass) {
          syncLights(this.anchors, this._hass, this._effectiveConfig);
          this._updateOverlayStates();
          this._requestRender();
        }
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

  // ── View Manager ──────────────────────────────────────────────────────────

  private _toggleViewManager() {
    if (this._viewManagerPanel) {
      this._viewManagerPanel.remove();
      this._viewManagerPanel = null;
    } else {
      this._showViewManager();
    }
  }

  private _showViewManager() {
    if (!this.overlayContainer) return;
    this._viewManagerPanel?.remove();

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px',
      'width:260px', 'max-height:calc(100% - 80px)',
      'background:rgba(6,10,20,0.93)',
      'backdrop-filter:blur(18px)', '-webkit-backdrop-filter:blur(18px)',
      'border:1px solid rgba(255,255,255,0.09)',
      'border-radius:14px', 'overflow:hidden',
      'display:flex', 'flex-direction:column',
      'z-index:15', 'pointer-events:auto',
      'font-family:var(--primary-font-family,sans-serif)',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    // Stop typing from triggering editor shortcuts
    panel.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) e.stopPropagation();
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;gap:6px;';
    const headerTitle = document.createElement('span');
    headerTitle.style.cssText = 'font-size:11px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em;flex:1;';
    headerTitle.textContent = '📷 Vues caméra';
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { panel.remove(); this._viewManagerPanel = null; });
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Capture button
    const captureBar = document.createElement('div');
    captureBar.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    const captureBtn = document.createElement('button');
    captureBtn.style.cssText = [
      'width:100%', 'background:rgba(59,130,246,0.15)',
      'border:1px solid rgba(59,130,246,0.35)', 'border-radius:8px',
      'color:#93c5fd', 'padding:7px 10px', 'cursor:pointer',
      'font-size:11px', 'font-family:inherit', 'text-align:left',
      'transition:all .15s',
    ].join(';');
    captureBtn.textContent = '＋  Sauvegarder la vue actuelle';
    captureBtn.addEventListener('mouseenter', () => { captureBtn.style.background = 'rgba(59,130,246,0.28)'; captureBtn.style.borderColor = 'rgba(59,130,246,0.6)'; });
    captureBtn.addEventListener('mouseleave', () => { captureBtn.style.background = 'rgba(59,130,246,0.15)'; captureBtn.style.borderColor = 'rgba(59,130,246,0.35)'; });
    captureBtn.addEventListener('click', () => this._captureViewPrompt(listBody));
    captureBar.appendChild(captureBtn);
    panel.appendChild(captureBar);

    // List body
    const listBody = document.createElement('div');
    listBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:4px 0;';
    panel.appendChild(listBody);

    // No scene_id warning
    if (!this._config?.scene_id) {
      const warn = document.createElement('div');
      warn.style.cssText = 'padding:10px 12px;font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.08);border-top:1px solid rgba(245,158,11,0.15);flex-shrink:0;';
      warn.textContent = '⚠ Pas de scene_id configuré — les vues ne seront pas persistées.';
      panel.appendChild(warn);
    }

    this._viewManagerPanel = panel;
    this.overlayContainer.appendChild(panel);
    this._rebuildViewList(listBody);
  }

  /** Rebuild the scrollable view list in-place (no panel close/reopen). */
  private _rebuildViewList(listBody: HTMLDivElement) {
    listBody.innerHTML = '';
    const views = normalizeViews(this._effectiveConfig.camera_views ?? []);

    if (views.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.textContent = 'Aucune vue sauvegardée';
      listBody.appendChild(empty);
      return;
    }

    views.forEach((v) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 10px;transition:background .1s;';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      // Label (click = fly to)
      const lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;font-size:12px;color:#e2e8f0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;padding:2px 4px;transition:color .12s;';
      lbl.textContent = v.label;
      lbl.title = 'Aller à cette vue';
      lbl.addEventListener('mouseenter', () => { lbl.style.color = '#7dd3fc'; });
      lbl.addEventListener('mouseleave', () => { lbl.style.color = '#e2e8f0'; });
      lbl.addEventListener('click', () => { this._flyToView(v); this._highlightViewBtn(v.id); });
      row.appendChild(lbl);

      const iconBtnStyle = 'background:none;border:none;cursor:pointer;padding:3px 5px;font-size:12px;color:rgba(255,255,255,0.3);border-radius:4px;transition:all .12s;line-height:1;flex-shrink:0;';

      // Fly-to button
      const flyBtn = document.createElement('button');
      flyBtn.style.cssText = iconBtnStyle;
      flyBtn.textContent = '→';
      flyBtn.title = 'Aller à cette vue';
      flyBtn.addEventListener('mouseenter', () => { flyBtn.style.color = '#7dd3fc'; flyBtn.style.background = 'rgba(125,211,252,0.1)'; });
      flyBtn.addEventListener('mouseleave', () => { flyBtn.style.color = 'rgba(255,255,255,0.3)'; flyBtn.style.background = 'none'; });
      flyBtn.addEventListener('click', () => { this._flyToView(v); this._highlightViewBtn(v.id); });
      row.appendChild(flyBtn);

      // Update (overwrite with current camera)
      const updateBtn = document.createElement('button');
      updateBtn.style.cssText = iconBtnStyle;
      updateBtn.textContent = '⟳';
      updateBtn.title = 'Écraser avec la vue actuelle';
      updateBtn.addEventListener('mouseenter', () => { updateBtn.style.color = '#4ade80'; updateBtn.style.background = 'rgba(74,222,128,0.1)'; });
      updateBtn.addEventListener('mouseleave', () => { updateBtn.style.color = 'rgba(255,255,255,0.3)'; updateBtn.style.background = 'none'; });
      updateBtn.addEventListener('click', () => this._updateView(v.id!, listBody));
      row.appendChild(updateBtn);

      // Rename
      const renameBtn = document.createElement('button');
      renameBtn.style.cssText = iconBtnStyle;
      renameBtn.textContent = '✎';
      renameBtn.title = 'Renommer';
      renameBtn.addEventListener('mouseenter', () => { renameBtn.style.color = '#fbbf24'; renameBtn.style.background = 'rgba(251,191,36,0.1)'; });
      renameBtn.addEventListener('mouseleave', () => { renameBtn.style.color = 'rgba(255,255,255,0.3)'; renameBtn.style.background = 'none'; });
      renameBtn.addEventListener('click', () => this._renameViewInline(lbl, v.id!, listBody));
      row.appendChild(renameBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.style.cssText = iconBtnStyle;
      delBtn.textContent = '✕';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('mouseenter', () => { delBtn.style.color = '#f87171'; delBtn.style.background = 'rgba(248,113,113,0.1)'; });
      delBtn.addEventListener('mouseleave', () => { delBtn.style.color = 'rgba(255,255,255,0.3)'; delBtn.style.background = 'none'; });
      delBtn.addEventListener('click', () => this._deleteView(v.id!, listBody));
      row.appendChild(delBtn);

      listBody.appendChild(row);
    });
  }

  /** Show inline name prompt inside the capture bar to add a new view. */
  private _captureViewPrompt(listBody: HTMLDivElement) {
    if (!this.camera || !this.controls) return;

    // Replace capture button temporarily with an inline input
    const captureBar = listBody.previousElementSibling as HTMLDivElement;
    captureBar.innerHTML = '';

    const inputStyle = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(125,211,252,0.4);border-radius:7px;color:#e2e8f0;padding:5px 8px;font-size:11px;font-family:inherit;outline:none;';
    const inp = document.createElement('input');
    inp.placeholder = 'Nom de la vue (ex: Salon)…';
    inp.style.cssText = inputStyle;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;';

    const okBtn = document.createElement('button');
    okBtn.textContent = '✓';
    okBtn.style.cssText = 'background:rgba(59,130,246,0.8);border:none;border-radius:7px;color:#fff;padding:5px 10px;cursor:pointer;font-size:12px;font-family:inherit;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.15);border-radius:7px;color:rgba(255,255,255,0.4);padding:5px 8px;cursor:pointer;font-size:12px;';

    const restore = () => {
      captureBar.innerHTML = '';
      const btn = document.createElement('button');
      btn.style.cssText = 'width:100%;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);border-radius:8px;color:#93c5fd;padding:7px 10px;cursor:pointer;font-size:11px;font-family:inherit;text-align:left;transition:all .15s;';
      btn.textContent = '＋  Sauvegarder la vue actuelle';
      btn.addEventListener('click', () => this._captureViewPrompt(listBody));
      captureBar.appendChild(btn);
    };

    const confirm = async () => {
      const label = inp.value.trim() || 'Vue sans nom';
      const pos = this.camera!.position.toArray() as [number, number, number];
      const tgt = this.controls!.target.toArray() as [number, number, number];
      const newView = captureCameraView(pos, tgt, label);
      const views = normalizeViews([...(this._effectiveConfig.camera_views ?? []), newView]);
      restore();
      await this._saveViews(views, listBody);
    };

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', restore);
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') restore();
    });

    row.appendChild(inp); row.appendChild(okBtn); row.appendChild(cancelBtn);
    captureBar.appendChild(row);
    setTimeout(() => inp.focus(), 30);
  }

  /** Overwrite a view's position/target with the current camera state. */
  private async _updateView(id: string, listBody: HTMLDivElement) {
    if (!this.camera || !this.controls) return;
    const pos = this.camera.position.toArray() as [number, number, number];
    const tgt = this.controls.target.toArray() as [number, number, number];
    const views = normalizeViews(this._effectiveConfig.camera_views ?? []).map((v) =>
      v.id === id ? { ...v, position: pos.map((x) => +x.toFixed(4)) as [number, number, number], target: tgt.map((x) => +x.toFixed(4)) as [number, number, number] } : v,
    );
    await this._saveViews(views, listBody);
  }

  /** Turn a view label into an inline input for renaming. */
  private _renameViewInline(lbl: HTMLSpanElement, id: string, listBody: HTMLDivElement) {
    const current = lbl.textContent ?? '';
    const inp = document.createElement('input');
    inp.value = current;
    inp.style.cssText = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(251,191,36,0.4);border-radius:4px;color:#e2e8f0;padding:1px 5px;font-size:12px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;';

    const commit = async () => {
      const label = inp.value.trim() || current;
      const views = normalizeViews(this._effectiveConfig.camera_views ?? []).map((v) =>
        v.id === id ? { ...v, label } : v,
      );
      await this._saveViews(views, listBody);
    };

    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { lbl.style.display = ''; inp.remove(); }
    });
    inp.addEventListener('blur', commit);

    lbl.style.display = 'none';
    lbl.parentElement!.insertBefore(inp, lbl);
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  }

  /** Delete a view by id and save. */
  private async _deleteView(id: string, listBody: HTMLDivElement) {
    const views = normalizeViews(this._effectiveConfig.camera_views ?? []).filter((v) => v.id !== id);
    await this._saveViews(views, listBody);
  }

  /**
   * Persist updated views to the backend and refresh everything.
   * Works independently of anchor editor state.
   */
  private async _saveViews(views: CameraView[], listBody?: HTMLDivElement) {
    if (!this._config?.scene_id || !this._hass) {
      // No backend — update in-memory scene and refresh UI only
      if (this._scene) this._scene = { ...this._scene, camera_views: views };
      if (listBody) this._rebuildViewList(listBody);
      this._buildCameraViewBar();
      return;
    }
    if (this._viewsSaving) return;
    this._viewsSaving = true;
    try {
      // Build a scene object that preserves anchors but replaces camera_views
      const base: OwlnestScene = this._scene ?? {
        version: 1, scene_id: this._config.scene_id,
        model_url: this._config.model_url ?? '',
        anchors: [], camera_views: [], panels: [], rules: [],
      };
      const updated: OwlnestScene = { ...base, camera_views: views };
      await saveScene(this._hass, this._config.scene_id, updated);
      this._scene = updated;
    } catch (err) {
      console.error('[Owlnest] Failed to save views:', err);
      this._showToast('✗ Erreur lors de la sauvegarde des vues', true);
    } finally {
      this._viewsSaving = false;
    }
    if (listBody) this._rebuildViewList(listBody);
    this._buildCameraViewBar();
  }

  /** Briefly highlight the HUD button matching the given view id. */
  private _highlightViewBtn(id?: string) {
    if (!id || !this._hudLeft) return;
    const views = normalizeViews(this._effectiveConfig.camera_views ?? []);
    const idx = views.findIndex((v) => v.id === id);
    const btn = this._hudLeft.children[idx] as HTMLButtonElement | undefined;
    if (!btn) return;
    const prev = btn.style.background;
    btn.style.background = 'rgba(125,211,252,0.25)';
    btn.style.color = '#fff';
    setTimeout(() => { btn.style.background = prev; btn.style.color = 'rgba(255,255,255,0.72)'; }, 600);
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
    this._controlsHideTimer = setTimeout(() => this._hideControls(), 4000);
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
        hidden: entry.hidden,
        lightStyle: entry.lightStyle,
        lightIntensity: entry.lightIntensity,
        lightDirection: entry.lightDirection,
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
    }
    this._editor.onChanged = () => {
      this._syncEditorLightsToScene();
      this._requestRender();
      if (!this._editorDragging && !this._gizmoDragging) this._updateAnchorList();
      // Don't schedule auto-save in the middle of a gizmo drag — wait for drag end
      if (!this._gizmoDragging) this._scheduleAutoSave();
    };
    this._editor.onDragStart = (type) => {
      this._gizmoDragging = true;
      const texts: Record<string, string> = {
        grab:   'Déplacer  ·  X/Y/Z axe  ·  Entrée confirmer  ·  Esc annuler',
        rotate: 'Orienter  ·  Esc quitter',
        gizmo:  'Déplacer sur axe  ·  Relâcher pour confirmer',
      };
      this._showStatusBar(texts[type] ?? '');
    };
    this._editor.onDragEnd = () => {
      this._gizmoDragging = false;
      this._hideStatusBar();
      this._updateAnchorList();  // refresh Az/El readout etc.
      this._scheduleAutoSave();  // save once when drag finishes
    };
    this._editor.onSelectionChange = () => this._updateAnchorList();
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

    // Flush pending auto-save immediately
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
      if (this._saveStatus === 'unsaved') {
        this._saveScene();
      }
    }
    this._saveStatus = 'saved';

    const editable = new Map<string, EditableAnchor>(this._editor!.anchors as Map<string, EditableAnchor>);
    this._editor!.deactivate();

    this.anchors.forEach((entry) => {
      if (entry.light) {
        this.scene?.remove(entry.light);
        entry.light.dispose();
      }
      if (entry.lightTarget) this.scene?.remove(entry.lightTarget);
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

  // ── Auto-save ─────────────────────────────────────────────────────────

  private _scheduleAutoSave() {
    if (!this._config?.scene_id) return;
    this._saveStatus = 'unsaved';
    this._updateSaveIndicator();
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(async () => {
      this._autoSaveTimer = null;
      this._saveStatus = 'saving';
      this._updateSaveIndicator();
      await this._saveScene();
      this._saveStatus = 'saved';
      this._updateSaveIndicator();
    }, 2000);
  }

  private _showStatusBar(text: string) {
    let bar = this.shadowRoot?.querySelector<HTMLElement>('#editor-status-bar');
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
      this.shadowRoot?.querySelector('#card')?.appendChild(bar);
    }
    bar.textContent = text;
    bar.style.display = 'block';
  }

  private _hideStatusBar() {
    const bar = this.shadowRoot?.querySelector<HTMLElement>('#editor-status-bar');
    if (bar) bar.style.display = 'none';
  }

  private _updateSaveIndicator() {
    const el = this._anchorListPanel?.querySelector<HTMLElement>('#save-indicator');
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

  // ── Real-time light sync from editor ──────────────────────────────────

  private _syncEditorLightsToScene() {
    if (!this._editor || !this.scene) return;
    this._editor.anchors.forEach((ea, key) => {
      const entry = this.anchors.get(key);
      if (!entry) return;

      // Always sync position (gizmo drag)
      entry.worldPos.copy(ea.position);
      if (entry.light) entry.light.position.copy(ea.position);
      if (entry.lightTarget) {
        entry.lightTarget.position.copy(lightTargetPos(ea.position, ea.lightDirection));
        entry.lightTarget.updateMatrixWorld();
      }

      const newStyle = ea.lightStyle ?? 'point';
      const oldStyle = entry.lightStyle ?? 'point';

      if (ea.entity.split('.')[0] === 'light' && newStyle !== oldStyle) {
        // Rebuild light with new style
        rebuildAnchorLight(entry, this.scene!, this._config!, newStyle, ea.lightDirection);
        // Restore last intensity
        if (entry.light) {
          entry.light.intensity = entry.targetIntensity;
          entry.light.color.copy(entry.targetColor);
          entry.light.visible = entry.targetIntensity > 0.01;
        }
      } else if ((newStyle === 'spot' || newStyle === 'beam') && entry.lightTarget) {
        // Update direction only
        const newDir = ea.lightDirection;
        const oldDir = entry.lightDirection;
        const dirChanged = !newDir !== !oldDir ||
          (newDir && oldDir && (newDir[0] !== oldDir[0] || newDir[1] !== oldDir[1] || newDir[2] !== oldDir[2]));
        if (dirChanged) {
          entry.lightTarget.position.copy(lightTargetPos(ea.position, ea.lightDirection));
          entry.lightTarget.updateMatrixWorld();
          entry.lightDirection = ea.lightDirection;
        }
      }
    });
  }

  // ── Editor toolbar ────────────────────────────────────────────────────

  private _showEditorToolbar() {
    if (!this._hudLeft || !this._hudRight || !this._hudSep) return;

    this._hudLeft.innerHTML = '';
    this._hudRight.innerHTML = '';
    this._hudSep.style.display = 'none';

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
      const btn = this._tbBtn(label, 'rgba(255,255,255,0.07)');
      btn.style.color = 'rgba(255,255,255,0.55)';
      btn.style.fontSize = '14px';
      btn.style.minWidth = '30px';
      btn.style.padding = '4px 8px';
      btn.title = title;
      btn.addEventListener('click', () => {
        this._editor?.setTool(id as import('./editor').EditorTool);
        setActiveTool(id);
      });
      toolBtns.set(id, btn);
      this._hudLeft!.appendChild(btn);
    });

    // Separator
    const sep1 = document.createElement('div');
    sep1.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.12);margin:0 2px;';
    this._hudLeft.appendChild(sep1);

    // Undo / Redo
    const undoBtn = this._tbBtn('↩', 'rgba(255,255,255,0.07)');
    undoBtn.title = 'Annuler (Ctrl+Z)';
    undoBtn.style.cssText += ';color:rgba(255,255,255,0.55);font-size:14px;min-width:28px;padding:4px 7px;';
    undoBtn.addEventListener('click', () => this._editor?.undo());

    const redoBtn = this._tbBtn('↪', 'rgba(255,255,255,0.07)');
    redoBtn.title = 'Rétablir (Ctrl+Y)';
    redoBtn.style.cssText += ';color:rgba(255,255,255,0.55);font-size:14px;min-width:28px;padding:4px 7px;';
    redoBtn.addEventListener('click', () => this._editor?.redo());

    this._hudLeft.appendChild(undoBtn);
    this._hudLeft.appendChild(redoBtn);

    if (this._editor) this._editor.onToolChange = (t) => setActiveTool(t);

    this._hudSep.style.display = 'block';

    // ── Right: close ─────────────────────────────────────────────────
    const doneBtn = this._tbBtn('✓ Fermer', 'rgba(255,255,255,0.07)');
    doneBtn.style.color = 'rgba(255,255,255,0.6)';
    doneBtn.addEventListener('click', () => this._exitEditMode());
    this._hudRight.appendChild(doneBtn);

    setActiveTool('select');

    // Shortcut hint bar at the bottom of the canvas
    // Hint row — inserted above the pill bar inside _hud so it never overlaps
    if (this._hud) {
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
      this._hud.insertBefore(hintBar, this._hud.lastChild);
    }

    this._saveStatus = 'saved';
    this._buildAnchorList();
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
    this._anchorListPanel?.remove();
    this._anchorListPanel = null;
    this._hud?.querySelector('#editor-hint-bar')?.remove();
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

  // ── Anchor list panel ────────────────────────────────────────────────

  private _buildAnchorList() {
    this._anchorListPanel?.remove();
    if (!this.overlayContainer || !this._editor) return;

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

    if (this._config?.scene_id) {
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
    showAllBtn.addEventListener('click', () => this._editor?.updateAll({ hidden: false }));
    const hideAllBtn = document.createElement('button');
    hideAllBtn.title = 'Tout masquer (○)';
    hideAllBtn.innerHTML = '○ Aucun';
    hideAllBtn.style.cssText = batchBtnStyle;
    hideAllBtn.addEventListener('mouseenter', () => { hideAllBtn.style.color = '#f87171'; });
    hideAllBtn.addEventListener('mouseleave', () => { hideAllBtn.style.color = 'rgba(255,255,255,0.35)'; });
    hideAllBtn.addEventListener('click', () => this._editor?.updateAll({ hidden: true }));
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

    this._anchorListPanel = panel;
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
    if (!this._editor) return;
    const anchors = this._editor.anchors;
    const selectedKey = this._editor.selectedKey;

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
        this._editor?.updateAnchor(key, { hidden: !a.hidden });
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
        this._editor?.selectAnchor(key);
        this._editor?.duplicate();
      });
      row.appendChild(dupBtn);

      row.addEventListener('click', () => {
        this._editor?.selectAnchor(key);
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

  private _buildPropsSection(container: HTMLDivElement, key: string, anchor: import('./types').EditableAnchor) {
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
      sl.addEventListener('pointerup', () => { this._editorDragging = false; this._scheduleAutoSave(); });
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        val.textContent = fmt(v);
        onChange(v);
        this._syncEditorLightsToScene();
        this._requestRender();
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
      if (v) this._editor?.updateAnchor(key, { entity: v });
    });
    const datalist = document.createElement('datalist');
    datalist.id = dlId;
    if (this._hass?.states) {
      for (const eid of Object.keys(this._hass.states).sort()) {
        const opt = document.createElement('option');
        opt.value = eid;
        const fn = (this._hass.states[eid] as any)?.attributes?.friendly_name;
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
      this._editor?.updateAnchor(key, { label: labelInput.value.trim() || anchor.entity.split('.')[1] });
    });
    field('Nom', labelInput);

    // ── Section: Lumière ─────────────────────────────────────────────
    if (isLight) {
      secDiv('Lumière');

      sliderField('Intensité', 0.1, 3, 0.1, anchor.lightIntensity ?? 1, '#fbbf24',
        (v) => `×${v.toFixed(1)}`,
        (v) => this._editor?.updateAnchor(key, { lightIntensity: v }),
      );

      // Style buttons
      const styleRow = document.createElement('div');
      styleRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px;';
      const styleConfigs: { id: import('./types').LightStyle; label: string; icon: string }[] = [
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
          this._editor?.updateAnchor(key, { lightStyle: id });
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
      gizmoBtn.addEventListener('click', () => this._editor?.setTool('rotate'));
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
    dupBtn.addEventListener('click', () => this._editor?.duplicate());

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
    delBtn.addEventListener('click', () => this._editor?.deleteSelected());

    actRow.appendChild(dupBtn); actRow.appendChild(delBtn);
    container.appendChild(actRow);
  }

  private _updateAnchorList() {
    if (!this._anchorListPanel) return;
    const list = this._anchorListPanel.querySelector<HTMLDivElement>('#anchor-list-body');
    const propsPane = this._anchorListPanel.querySelector<HTMLDivElement>('#tab-pane-props');
    const countLbl = this._anchorListPanel.querySelector<HTMLElement>('#anchor-count-lbl');
    if (!list || !propsPane || !countLbl) return;

    // Rebuild tab switching closure from current DOM state
    const tabAnchorsPane = this._anchorListPanel.querySelector<HTMLElement>('#tab-pane-anchors');
    const tabAnchorsBtn = this._anchorListPanel.querySelector<HTMLButtonElement>('[data-tab="anchors"]');
    const tabPropsBtn   = this._anchorListPanel.querySelector<HTMLButtonElement>('[data-tab="props"]');
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

    const transitioning = stepTransitions(this.anchors, dt, this._effectiveConfig);
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
    const ec = this._effectiveConfig;
    if (!ec.model_url || !this.scene) return;

    let model: THREE.Group;
    try {
      model = await loadGLTF(ec.model_url);
    } catch (err) {
      console.error('[Owlnest] model load failed:', err);
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
    if (ec.rendering?.transparent_background !== true) this._addGround(box);

    this.anchors = detectAnchors(model, this.scene, ec);
    this._createOverlays();

    this._overlaysVisible = !(ec.tap_to_toggle ?? false);

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, ec);
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

    const views = this._effectiveConfig.camera_views;
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

  private _flyToView(v: CameraView) {
    this._camAnimTo = {
      pos: new THREE.Vector3(...v.position),
      target: new THREE.Vector3(...(v.target ?? [0, 0, 0])),
    };
  }

  // ── Overlay positioning + clustering ──────────────────────────────────

  private _updateOverlayPositions(w: number, h: number) {
    if (this._editMode) return;
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
      if (behind.has(name) || inCluster.has(name) || this.anchors.get(name)?.hidden) {
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
    this.anchors.forEach((e) => {
      if (e.light) { this.scene?.remove(e.light); e.light.dispose(); }
      if (e.lightTarget) this.scene?.remove(e.lightTarget);
    });
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
