import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Hass, CardConfig, AnchorEntry, SavedView } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors } from './model';
import { AnchorOverlay, SensorOverlay } from './overlay';

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
  private overlayContainer: HTMLDivElement | null = null;

  private anchors = new Map<string, AnchorEntry>();
  private overlays = new Map<string, AnyOverlay>();

  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private modelLoaded = false;
  private _locked = false;

  private _dirty = false;
  private _lastTime = 0;

  // Environment lights
  private _hemiLight: THREE.HemisphereLight | null = null;
  private _sunLight: THREE.DirectionalLight | null = null;

  // Weather
  private _weatherParticles: THREE.Object3D | null = null;
  private _weatherType: 'none' | 'rain' | 'snow' = 'none';
  private _modelBox = new THREE.Box3();

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
      this._updateOverlayStates();
      this._updateEnvironment();
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

    this.lockBtn = this._makeLockBtn();
    card.appendChild(this.lockBtn);

    this._initThree(card);

    this.ro = new ResizeObserver(() => this._onResize());
    this.ro.observe(card);

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

    const moved = this.controls?.update() ?? false;
    if (moved) this._dirty = true;

    const transitioning = stepTransitions(this.anchors, dt, this._config);
    if (transitioning) this._dirty = true;

    if (this._weatherParticles) {
      this._stepParticles(dt);
      this._dirty = true;
    }

    if ((moved || this._dirty) && this.camera && this.canvas) {
      const w = this.canvas.offsetWidth;
      const h = this.canvas.offsetHeight;
      this.anchors.forEach((entry, name) => {
        this.overlays.get(name)?.updatePosition(entry.worldPos, this.camera!, w, h);
      });
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
      this.lockBtn!.textContent = '🔓';
    }

    // Adapt fog to model scale
    if (this.scene.fog instanceof THREE.Fog) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.z);
      this.scene.fog.near = maxDim * 1.2;
      this.scene.fog.far = maxDim * 4;
    }

    this.controls!.update();
    this.scene.add(model);
    this._addGround(box);

    this.anchors = detectAnchors(model, this.scene, this._config);
    this._createOverlays();

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, this._config);
      this._updateOverlayStates();
      this._updateEnvironment();
    }
    this._requestRender();
  }

  // ── Overlays ──────────────────────────────────────────────────────────

  private _createOverlays() {
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();

    this.anchors.forEach((entry, name) => {
      const label = name.replace('ha_anchor_', '');

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
        label,
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
      const baseName = name.replace('ha_anchor_', '');

      if (overlay instanceof SensorOverlay) {
        const value = stateObj?.state ?? '—';
        const unit = (stateObj?.attributes.unit_of_measurement as string) ?? '';
        overlay.updateValue(value, unit, `${baseName}: ${value}${unit}`);
        return;
      }

      if (overlay instanceof AnchorOverlay) {
        const on = entry.targetIntensity > 0;
        const stateName = stateObj?.state ?? '—';
        let label = `${baseName} • ${stateName}`;
        if (entry.domain === 'climate') {
          const temp = stateObj?.attributes.current_temperature;
          if (temp != null) label = `${baseName} • ${temp}°`;
        } else if (entry.domain === 'cover') {
          const pct = stateObj?.attributes.current_position;
          if (pct != null) label = `${baseName} • ${pct}%`;
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

    // t = 0 at night, 1 at full day
    const t = Math.max(0, Math.min(1, (elevation + 10) / 30));

    this._hemiLight.intensity = THREE.MathUtils.lerp(0.08, 0.45, t);
    this._hemiLight.color.setHex(t > 0.5 ? 0xfff4e0 : 0x2244aa);
    this._hemiLight.groundColor.setHex(t > 0.5 ? 0x1a1a2e : 0x050a14);

    this._sunLight.intensity = Math.max(0, elevation / 60) * 0.8;
    const azRad = ((azimuth - 180) * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    this._sunLight.position.set(
      Math.sin(azRad) * Math.cos(elRad) * 10,
      Math.sin(elRad) * 10,
      Math.cos(azRad) * Math.cos(elRad) * 10,
    );

    // Tint background + fog for day/night
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

    // Fog tint + ambient dimming for overcast feel
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
      // Rain: LineSegments — each drop is a short angled streak
      const COUNT = 700;
      const pos = new Float32Array(COUNT * 6); // 2 pts × 3 coords per segment
      for (let i = 0; i < COUNT; i++) {
        const x = cx + (Math.random() - 0.5) * spreadX;
        const y = yBot + Math.random() * (yTop - yBot);
        const z = cz + (Math.random() - 0.5) * spreadZ;
        const len = 0.25 + Math.random() * 0.2;
        const wx = -0.06; // slight wind angle
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
      // Snow: Points — varied sizes, slow drift
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

    // Both LineSegments and Points have a geometry attribute
    const geo = (obj as THREE.LineSegments | THREE.Points).geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    if (type === 'rain') {
      // Move pairs of vertices (top + bottom of each streak)
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
      // Snow: slow fall + gentle horizontal drift
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

    // Reset fog and ambient
    if (this.scene?.fog) this.scene.fog.color.setHex(0x0d1117);
    if (this._hemiLight) this._hemiLight.intensity = 0.45;
  }

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
    this._removeWeatherParticles();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();
    this.anchors.clear();
    this.modelLoaded = false;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

customElements.define('ha-3d-floorplan', Ha3dFloorplan);
