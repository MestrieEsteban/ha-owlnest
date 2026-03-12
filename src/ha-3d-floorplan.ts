import * as THREE from 'three';


import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor, OwlnestScene } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable, rebuildAnchorLight, lightTargetPos } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';
import { loadScene, saveScene, sceneToEffectiveConfig, buildSceneFromEditor } from './scene';
import './card-editor';
import { EnvironmentController } from './card/environment';
import { SimulationPanel } from './card/simulation';
import { ViewManager } from './card/view-manager';
import { EditPanel } from './card/edit-panel';

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

  private _modelBox = new THREE.Box3();

  // Day simulation button
  private _simBtn: HTMLButtonElement | null = null;

  // Anchor editor
  private _editor: AnchorEditor | null = null;
  private _modelRoot: THREE.Object3D | null = null;
  private _savePending = false;  // true while a callWS is in flight

  // Modules
  private _env: EnvironmentController | null = null;
  private _sim: SimulationPanel | null = null;
  private _viewMgr: ViewManager | null = null;
  private _editPanel: EditPanel | null = null;

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
      this._env?.updateFromHass(hass);
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
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._viewMgr?.toggle(); });
    return btn;
  }

  private _makeSimBtn(icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = icon;
    btn.title = 'Simuler la journée / météo';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._sim?.toggle(); });
    return btn;
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
    if (this._sim?.isOpen) return; // keep visible while sim panel is open
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

    // Instantiate EditPanel now (needs editor, hud refs, and card container)
    const card = this.querySelector('ha-card') as HTMLElement;
    this._editPanel = new EditPanel(
      this.overlayContainer!,
      this._hud!,
      this._hudLeft!,
      this._hudRight!,
      this._hudSep!,
      card,
      () => this._editor,
      () => this._hass,
      () => this._config,
      () => this._config?.scene_id,
      () => this._saveScene(),
      () => this._exitEditMode(),
      () => this._syncEditorLightsToScene(),
      () => this._requestRender(),
      () => this._rebuildNormalHUD(),
    );

    this._editor.onChanged = () => {
      this._syncEditorLightsToScene();
      this._requestRender();
      if (!this._editPanel?.editorDragging && !this._editPanel?.gizmoDragging) this._editPanel?.updateAnchorList();
      // Don't schedule auto-save in the middle of a gizmo drag — wait for drag end
      if (!this._editPanel?.gizmoDragging) this._editPanel?.scheduleAutoSave();
    };
    this._editor.onDragStart = (type) => {
      if (this._editPanel) this._editPanel.gizmoDragging = true;
      const texts: Record<string, string> = {
        grab:   'Déplacer  ·  X/Y/Z axe  ·  Entrée confirmer  ·  Esc annuler',
        rotate: 'Orienter  ·  Esc quitter',
        gizmo:  'Déplacer sur axe  ·  Relâcher pour confirmer',
      };
      this._editPanel?.showStatusBar(texts[type] ?? '');
    };
    this._editor.onDragEnd = () => {
      if (this._editPanel) this._editPanel.gizmoDragging = false;
      this._editPanel?.hideStatusBar();
      this._editPanel?.updateAnchorList();  // refresh Az/El readout etc.
      this._editPanel?.scheduleAutoSave();  // save once when drag finishes
    };
    this._editor.onSelectionChange = () => this._editPanel?.updateAnchorList();
    this._editor.setHass(this._hass);
    this._editor.activate(editable);

    this._editPanel.showToolbar();
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
    if (this._editPanel?.hasPendingSave) {
      this._editPanel.cancelPendingSave();
      this._saveScene();
    }
    this._editPanel?.markSaved();

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

    this._editPanel?.hideToolbar();
    this._editPanel = null;
    this.overlays.forEach((o) => {
      o.el.style.display = this._overlaysVisible ? '' : 'none';
    });
    this._requestRender();
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

  // ── Rebuild normal HUD (called by EditPanel.hideToolbar) ───────────────

  private _rebuildNormalHUD() {
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
    const hasViews = !!(this._effectiveConfig.camera_views?.length);
    const hasActions = this._hudRight.children.length > 0;
    if (this._hudSep) this._hudSep.style.display = (hasViews && hasActions) ? 'block' : 'none';
    void icons; // silence unused warning

    // Also rebuild view bar in hudLeft
    this._viewMgr?.buildHUDBar();
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
    }

    // Instantiate EnvironmentController
    this._env = new EnvironmentController(
      this.scene,
      this._hemiLight,
      this._sunLight,
      this._sky,
      () => this._modelBox,
      () => this._effectiveConfig,
      () => this._requestRender(),
    );

    // Set initial sky position
    if (useSky) {
      this._env.setSkyPos(rl.sky_elevation ?? 60, 180);
    }

    this._lastTime = performance.now();
    this._loop();
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

    // Step weather particles via SimulationPanel
    this._sim?.step(dt);
    if (this._env?.weatherParticles) this._dirty = true;

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
    if (ec.rendering?.transparent_background !== true && this._env) {
      this._env.addGround(box, this._config!);
    }

    this.anchors = detectAnchors(model, this.scene, ec);
    this._createOverlays();

    this._overlaysVisible = !(ec.tap_to_toggle ?? false);

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, ec);
      this._updateOverlayStates();
      this._env?.updateFromHass(this._hass);
    }

    // Instantiate SimulationPanel now that everything is ready
    if (this._simBtn && this._simExpand) {
      this._sim = new SimulationPanel(
        this._simExpand,
        this._simBtn,
        this._env!,
        () => this._requestRender(),
        () => this._hass,
        () => this.anchors,
        () => this._effectiveConfig,
        () => this._updateOverlayStates(),
      );
      this._sim.buildContent();
    }

    // Instantiate ViewManager
    this._viewMgr = new ViewManager(
      this.overlayContainer!,
      this._hudLeft!,
      this._hudSep!,
      () => this.camera,
      () => this.controls,
      () => this._effectiveConfig,
      () => this._hass,
      () => this._config?.scene_id,
      () => this._scene,
      (scene) => { this._scene = scene; },
      (msg, err) => this._showToast(msg, err),
      (pos, target) => { this._camAnimTo = { pos, target }; },
      () => this._hudRight,
    );

    this._viewMgr.buildHUDBar();
    this._requestRender();
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
    this._env?.removeWeatherParticles();
    this._env = null;
    this._sim = null;
    this._viewMgr = null;
    this._editPanel = null;
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
