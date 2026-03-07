import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';

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
  private _controlsEl: HTMLDivElement | null = null;
  private _viewBar: HTMLDivElement | null = null;
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

  // Weather
  private _weatherParticles: THREE.Object3D | null = null;
  private _weatherType: 'none' | 'rain' | 'snow' = 'none';
  private _modelBox = new THREE.Box3();

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

  // ── Init ──────────────────────────────────────────────────────────────

  private _bootstrap() {
    if (this.renderer) this._teardown();

    const card = document.createElement('ha-card');
    card.style.cssText = [
      'overflow:hidden',
      'position:relative',
      'display:block',
      'background:#050a14',
      '--ha-card-background:#050a14',
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

    // Controls group — hidden by default, revealed on hover / touch
    this._controlsEl = document.createElement('div');
    this._controlsEl.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px',
      'display:flex', 'gap:6px', 'align-items:center',
      'opacity:0', 'transition:opacity .25s ease',
      'z-index:10', 'pointer-events:none',
    ].join(';');
    card.appendChild(this._controlsEl);

    this.lockBtn = this._makeLockBtn();
    this.editBtn = this._makeEditBtn();
    this.captureBtn = this._makeCaptureBtn();
    this._controlsEl.appendChild(this.captureBtn);
    this._controlsEl.appendChild(this.editBtn);
    this._controlsEl.appendChild(this.lockBtn);

    // Hover (desktop) — show/hide controls
    card.addEventListener('mouseenter', () => this._showControls());
    card.addEventListener('mouseleave', () => this._hideControls());
    // Touch — show controls for 3 seconds on tap
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
    btn.style.cssText = this._ctrlBtnStyle();
    btn.textContent = '\uD83D\uDD13'; // 🔓
    btn.title = 'Verrouiller la vue';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleLock(); });
    return btn;
  }

  private _makeEditBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._ctrlBtnStyle();
    btn.textContent = '\u270F\uFE0F'; // ✏️
    btn.title = 'Editer les ancres';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleEditMode(); });
    return btn;
  }

  private _makeCaptureBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._ctrlBtnStyle();
    btn.textContent = '\uD83D\uDCF7'; // 📷
    btn.title = 'Capturer la vue courante';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._showCapturePopup(); });
    return btn;
  }

  private _showCapturePopup() {
    if (!this.camera || !this.controls) return;
    const p = this.camera.position;
    const t = this.controls.target;
    const fmt = (v: number) => +v.toFixed(3);
    const yaml = [
      `- label: "Ma vue"`,
      `  position: [${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}]`,
      `  target: [${fmt(t.x)}, ${fmt(t.y)}, ${fmt(t.z)}]`,
    ].join('\n');

    // Remove any existing capture popup
    this.overlayContainer?.querySelector('.capture-popup')?.remove();

    const popup = document.createElement('div');
    popup.className = 'capture-popup';
    popup.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:#1a1f2e',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:10px', 'padding:16px 20px',
      'z-index:200', 'min-width:300px', 'width:360px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'font-family:var(--primary-font-family,sans-serif)',
      'color:#fff', 'pointer-events:auto',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Vue capturée';
    title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:12px;color:#aac8e8;';

    const hint = document.createElement('div');
    hint.textContent = 'Ajoute ces lignes sous camera_views: dans ton YAML :';
    hint.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px;';

    const pre = document.createElement('textarea');
    pre.value = yaml;
    pre.readOnly = true;
    pre.style.cssText = [
      'width:100%', 'height:80px', 'box-sizing:border-box',
      'background:#0d1117', 'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:6px', 'color:#aef', 'padding:8px 10px',
      'font-size:12px', 'font-family:monospace',
      'resize:none', 'outline:none', 'line-height:1.6',
    ].join(';');

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copier';
    copyBtn.style.cssText = 'background:#1a6bff;border:none;color:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600;';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(yaml).catch(() => {});
      copyBtn.textContent = 'Copié !';
      setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1500);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fermer';
    closeBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.2);color:#aaa;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;';
    closeBtn.addEventListener('click', () => popup.remove());

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    popup.appendChild(title);
    popup.appendChild(hint);
    popup.appendChild(pre);
    popup.appendChild(btnRow);
    this.overlayContainer!.appendChild(popup);
    setTimeout(() => pre.select(), 50);
  }

  private _ctrlBtnStyle(): string {
    return [
      'background:rgba(0,0,0,.55)',
      'border:none', 'border-radius:6px',
      'color:#fff', 'cursor:pointer',
      'padding:5px 8px', 'font-size:15px',
      'line-height:1', 'pointer-events:auto',
      'transition:background .2s',
    ].join(';');
  }

  // ── Controls visibility ────────────────────────────────────────────────

  private _showControls() {
    if (!this._controlsEl) return;
    this._controlsEl.style.opacity = '1';
    this._controlsEl.style.pointerEvents = 'auto';
    if (this._viewBar) {
      this._viewBar.style.opacity = '1';
      this._viewBar.style.pointerEvents = 'auto';
    }
  }

  private _hideControls() {
    if (this._editMode) return; // keep visible in edit mode
    if (!this._controlsEl) return;
    this._controlsEl.style.opacity = '0';
    this._controlsEl.style.pointerEvents = 'none';
    if (this._viewBar) {
      this._viewBar.style.opacity = '0';
      this._viewBar.style.pointerEvents = 'none';
    }
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
    this.lockBtn!.textContent = this._locked ? '\uD83D\uDD12' : '\uD83D\uDD13'; // 🔒 🔓
    this.lockBtn!.title = this._locked ? 'Déverrouiller la vue' : 'Verrouiller la vue';
    this._saveView();
  }

  // ── Edit mode ─────────────────────────────────────────────────────────

  private _toggleEditMode() {
    if (!this.modelLoaded || !this._modelRoot) return;
    this._editMode ? this._exitEditMode() : this._enterEditMode();
  }

  private _enterEditMode() {
    this._editMode = true;
    this.editBtn!.style.background = 'rgba(26,107,255,.75)';
    this.editBtn!.title = 'Quitter le mode édition';
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
    this.editBtn!.style.background = 'rgba(0,0,0,.55)';
    this.editBtn!.title = 'Editer les ancres';

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

  private _editorToolbar: HTMLDivElement | null = null;

  private _showEditorToolbar() {
    this._removeEditorToolbar();
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute',
      'bottom:12px',
      'left:50%',
      'transform:translateX(-50%)',
      'display:flex',
      'gap:6px',
      'align-items:center',
      'background:rgba(10,14,28,0.92)',
      'border:1px solid rgba(255,255,255,0.14)',
      'border-radius:10px',
      'padding:6px 10px',
      'z-index:50',
      'pointer-events:auto',
      'font-family:var(--primary-font-family,sans-serif)',
      'white-space:nowrap',
    ].join(';');

    const tools: Array<{ id: string; label: string; title: string }> = [
      { id: 'select', label: 'Selectionner', title: 'Selectionner / deplacer une ancre' },
      { id: 'add',    label: '+ Ajouter',    title: 'Cliquer sur le modele pour placer une ancre' },
      { id: 'delete', label: 'Supprimer',    title: 'Cliquer sur une ancre pour la supprimer' },
    ];

    const toolBtns = new Map<string, HTMLButtonElement>();
    const setActiveTool = (id: string) => {
      toolBtns.forEach((b, k) => {
        b.style.background = k === id ? 'rgba(26,107,255,0.85)' : 'rgba(255,255,255,0.08)';
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
      bar.appendChild(btn);
    });

    if (this._editor) {
      this._editor.onToolChange = (t) => setActiveTool(t);
    }

    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:20px;background:rgba(255,255,255,0.15);margin:0 4px;';
    bar.appendChild(sep);

    const exportBtn = this._tbBtn('Export YAML', 'rgba(26,107,255,0.7)');
    exportBtn.addEventListener('click', () => this._editor?.showExportPopup());
    bar.appendChild(exportBtn);

    const doneBtn = this._tbBtn('Terminer', 'rgba(20,120,40,0.8)');
    doneBtn.style.fontWeight = '700';
    doneBtn.addEventListener('click', () => this._exitEditMode());
    bar.appendChild(doneBtn);

    this._editorToolbar = bar;
    this.overlayContainer!.appendChild(bar);

    setActiveTool('select');
  }

  private _tbBtn(label: string, bg: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      `background:${bg}`,
      'border:none',
      'color:#fff',
      'border-radius:6px',
      'padding:5px 11px',
      'cursor:pointer',
      'font-size:12px',
      'font-family:inherit',
      'transition:background .15s',
    ].join(';');
    return btn;
  }

  private _removeEditorToolbar() {
    this._editorToolbar?.remove();
    this._editorToolbar = null;
  }

  // ── Three.js init ─────────────────────────────────────────────────────

  private _initThree(container: HTMLElement) {
    const w = container.offsetWidth || 400;
    const h = this._config?.height ?? Math.round(w * 0.75);
    container.style.height = `${h}px`;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 20, 80);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 500);
    this.camera.position.set(0, 5, 12);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas!, antialias: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

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

    this._hemiLight = new THREE.HemisphereLight(0xfff4e0, 0x1a1a2e, 0.45);
    this.scene.add(this._hemiLight);

    this._sunLight = new THREE.DirectionalLight(0xfff4c2, 0.4);
    this._sunLight.position.set(5, 10, 5);
    this.scene.add(this._sunLight);

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
    this._addGround(box);

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
    this._viewBar?.remove();
    this._viewBar = null;
    const views = this._config?.camera_views;
    if (!views?.length) return;

    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute', 'bottom:12px', 'left:50%',
      'transform:translateX(-50%)',
      'display:flex', 'gap:6px', 'align-items:center',
      'background:rgba(0,0,0,.45)',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:20px', 'padding:5px 10px',
      'z-index:10', 'pointer-events:none',
      'opacity:0', 'transition:opacity .25s ease',
    ].join(';');

    views.forEach((v) => {
      const btn = document.createElement('button');
      btn.textContent = v.label;
      btn.style.cssText = [
        'background:transparent', 'border:none',
        'color:rgba(255,255,255,0.75)', 'cursor:pointer',
        'padding:3px 10px', 'font-size:12px',
        'font-family:var(--primary-font-family,sans-serif)',
        'border-radius:12px', 'transition:background .15s,color .15s',
        'pointer-events:auto',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,255,255,0.15)';
        btn.style.color = '#fff';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(255,255,255,0.75)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._flyToView(v);
      });
      bar.appendChild(btn);
    });

    this._viewBar = bar;
    const card = this.querySelector('ha-card') as HTMLElement;
    card?.appendChild(bar);
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
    this.anchors.forEach((entry, name) => {
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

    this._hemiLight.intensity = THREE.MathUtils.lerp(0.22, 0.45, t);
    this._hemiLight.color.setHex(t > 0.5 ? 0xfff4e0 : 0x2244aa);
    this._hemiLight.groundColor.setHex(t > 0.5 ? 0x1a1a2e : 0x0d1020);

    this._sunLight.intensity = Math.max(0, elevation / 60) * 0.8;
    const azRad = ((azimuth - 180) * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    this._sunLight.position.set(
      Math.sin(azRad) * Math.cos(elRad) * 10,
      Math.sin(elRad) * 10,
      Math.cos(azRad) * Math.cos(elRad) * 10,
    );

    const bgColor = new THREE.Color().lerpColors(
      new THREE.Color(0x050a14),
      new THREE.Color(0x0d1117),
      t,
    );
    this.scene.background = bgColor;
    if (this.scene.fog) this.scene.fog.color.copy(bgColor);

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
    const mat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.95, metalness: 0.05 });
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
    const meta = { type, spreadX, spreadZ, cx, cz, yTop, yBot };

    if (type === 'rain') {
      const COUNT = 700;
      const pos = new Float32Array(COUNT * 6);
      for (let i = 0; i < COUNT; i++) {
        const x = cx + (Math.random() - 0.5) * spreadX;
        const y = yBot + Math.random() * (yTop - yBot);
        const z = cz + (Math.random() - 0.5) * spreadZ;
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
        pos[i * 3 + 0] = cx + (Math.random() - 0.5) * spreadX;
        pos[i * 3 + 1] = yBot + Math.random() * (yTop - yBot);
        pos[i * 3 + 2] = cz + (Math.random() - 0.5) * spreadZ;
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
    const { type, spreadX, spreadZ, cx, cz, yTop, yBot } = obj.userData as {
      type: string; spreadX: number; spreadZ: number;
      cx: number; cz: number; yTop: number; yBot: number;
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
          const x = cx + (Math.random() - 0.5) * spreadX;
          const z = cz + (Math.random() - 0.5) * spreadZ;
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
          arr[i + 0] = cx + (Math.random() - 0.5) * spreadX;
          arr[i + 1] = yTop;
          arr[i + 2] = cz + (Math.random() - 0.5) * spreadZ;
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

    if (this.scene?.fog) this.scene.fog.color.setHex(0x0d1117);
    if (this._hemiLight) this._hemiLight.intensity = 0.45;
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
    this._removeEditorToolbar();
    this._viewBar?.remove();
    this._viewBar = null;
    if (this._controlsHideTimer) clearTimeout(this._controlsHideTimer);
    this.modelLoaded = false;
    this._editMode = false;
    this._modelRoot = null;
    this._camAnimTo = null;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

customElements.define('ha-3d-floorplan', Ha3dFloorplan);
