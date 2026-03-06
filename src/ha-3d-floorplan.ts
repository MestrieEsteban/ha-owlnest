import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Hass, CardConfig, AnchorEntry, SavedView } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors } from './model';

class Ha3dFloorplan extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private lockBtn: HTMLButtonElement | null = null;

  private anchors = new Map<string, AnchorEntry>();
  private clickTargets: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private modelLoaded = false;
  private _locked = false;

  private _dirty = false;
  private _lastTime = 0;

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
    if (this.modelLoaded) {
      syncLights(this.anchors, hass, this._config);
      this._requestRender();
    }
  }

  static getStubConfig() {
    return { model_url: '/local/floorplan.glb', anchors: {} };
  }

  // ── Init ──────────────────────────────────────────────────────────────

  private _bootstrap() {
    if (this.renderer) this._teardown();

    const card = document.createElement('ha-card');
    card.style.cssText = 'overflow:hidden;position:relative;display:block;';
    this.innerHTML = '';
    this.appendChild(card);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    card.appendChild(this.canvas);

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText =
      'position:absolute;background:rgba(0,0,0,.75);color:#fff;' +
      'padding:4px 10px;border-radius:6px;font-size:12px;' +
      'pointer-events:none;display:none;white-space:nowrap;';
    card.appendChild(this.tooltip);

    this.lockBtn = this._makeLockBtn();
    card.appendChild(this.lockBtn);

    this._initThree(card);

    this.ro = new ResizeObserver(() => this._onResize());
    this.ro.observe(card);

    this.canvas.addEventListener('click', this._onClick);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', () => {
      this.tooltip!.style.display = 'none';
    });

    this._loadModel();
  }

  private _makeLockBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText =
      'position:absolute;top:8px;right:8px;' +
      'background:rgba(0,0,0,.55);border:none;border-radius:6px;' +
      'color:#fff;cursor:pointer;padding:6px 8px;font-size:16px;' +
      'line-height:1;z-index:10;transition:background .2s;';
    btn.textContent = '🔓';
    btn.title = 'Verrouiller la vue';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,0,0,.85)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,.55)'; });
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleLock(); });
    return btn;
  }

  private _toggleLock(force?: boolean) {
    this._locked = force !== undefined ? force : !this._locked;
    if (this.controls) this.controls.enabled = !this._locked;
    this.lockBtn!.textContent = this._locked ? '🔒' : '🔓';
    this.lockBtn!.title = this._locked ? 'Déverrouiller la vue' : 'Verrouiller la vue';
    this._saveView();
  }

  private _initThree(container: HTMLElement) {
    const w = container.offsetWidth || 400;
    const h = this._config?.height ?? Math.round(w * 0.6);
    container.style.height = `${h}px`;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 500);
    this.camera.position.set(0, 5, 12);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas!, antialias: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

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

    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambient);

    this._lastTime = performance.now();
    this._loop();
  }

  // ── Render loop ───────────────────────────────────────────────────────

  private _loop = () => {
    this.rafId = requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    const moved = this.controls?.update() ?? false;
    if (moved) this._dirty = true;

    const transitioning = stepTransitions(this.anchors, dt, this._config);
    if (transitioning) this._dirty = true;

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
      this.lockBtn!.textContent = '🔓';
    }

    this.controls!.update();
    this.scene.add(model);

    const { anchors, clickTargets } = detectAnchors(model, this.scene, this._config);
    this.anchors = anchors;
    this.clickTargets = clickTargets;

    this.modelLoaded = true;
    if (this._hass) syncLights(this.anchors, this._hass, this._config);
    this._requestRender();
  }

  // ── Interaction ───────────────────────────────────────────────────────

  private _hit(e: MouseEvent): THREE.Intersection | null {
    const rect = this.canvas!.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera!);
    const hits = this.raycaster.intersectObjects(this.clickTargets, false);
    return hits[0] ?? null;
  }

  private _onClick = (e: MouseEvent) => {
    const hit = this._hit(e);
    if (!hit) return;
    const entityId = hit.object.userData.entityId as string;
    this._hass?.callService('light', 'toggle', { entity_id: entityId });
  };

  private _onMouseMove = (e: MouseEvent) => {
    const hit = this._hit(e);
    if (!hit) { this.tooltip!.style.display = 'none'; return; }

    const entityId = hit.object.userData.entityId as string;
    const anchorName = hit.object.userData.anchorName as string;
    const state = this._hass?.states[entityId];
    const label = state ? `${anchorName}  •  ${state.state}` : anchorName;

    this.tooltip!.textContent = label;
    this.tooltip!.style.display = 'block';

    const rect = this.getBoundingClientRect();
    this.tooltip!.style.left = `${e.clientX - rect.left + 12}px`;
    this.tooltip!.style.top = `${e.clientY - rect.top - 28}px`;
  };

  // ── Resize ────────────────────────────────────────────────────────────

  private _onResize() {
    const container = this.querySelector('ha-card') as HTMLElement | null;
    if (!container || !this.renderer || !this.camera) return;
    const w = container.offsetWidth;
    const h = this._config?.height ?? Math.round(w * 0.6);
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
    this.controls?.dispose();
    this.renderer?.dispose();
    this.anchors.clear();
    this.clickTargets = [];
    this.modelLoaded = false;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

customElements.define('ha-3d-floorplan', Ha3dFloorplan);
