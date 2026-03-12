import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { CardConfig, Hass } from '../types';

export type WeatherEffect =
  | 'none'
  | 'rain'
  | 'rain-heavy'
  | 'rain-storm'
  | 'lightning-only'
  | 'snow'
  | 'snow-rain'
  | 'hail'
  | 'wind'
  | 'fog'
  | 'cloudy'
  | 'exceptional';

// Map every HA weather state to an internal effect
const HA_WEATHER_MAP: Record<string, WeatherEffect> = {
  'sunny':           'none',
  'clear-night':     'none',
  'partlycloudy':    'none',
  'windy':           'wind',
  'windy-variant':   'wind',
  'cloudy':          'cloudy',
  'exceptional':     'exceptional',
  'fog':             'fog',
  'rainy':           'rain',
  'pouring':         'rain-heavy',
  'lightning':       'lightning-only',
  'lightning-rainy': 'rain-storm',
  'snowy':           'snow',
  'snowy-rainy':     'snow-rain',
  'hail':            'hail',
};

export class EnvironmentController {
  private _weatherParticles: THREE.Object3D | null = null;
  private _weatherType: WeatherEffect = 'none';
  private _weatherTime = 0;

  // Lightning flash state
  private _lightningTimer = 0;
  private _lightningFlash = 0;  // 0..1, decays each frame
  private _lightningLight: THREE.PointLight | null = null;

  constructor(
    readonly scene: THREE.Scene,
    readonly hemiLight: THREE.HemisphereLight,
    readonly sunLight: THREE.DirectionalLight,
    readonly sky: Sky | null,
    private getModelBox: () => THREE.Box3,
    private getConfig: () => CardConfig,
    private requestRender: () => void,
  ) {}

  get weatherParticles() { return this._weatherParticles; }
  get weatherType() { return this._weatherType; }
  set weatherType(v: WeatherEffect) { this._weatherType = v; }
  /** True when stepParticles must be called even without visible particles (e.g. lightning-only) */
  get needsStep() {
    return !!this._weatherParticles || this._lightningTimer > 0 || this._lightningFlash > 0;
  }

  updateFromHass(hass: Hass) {
    const cfg = this.getConfig();

    if (cfg?.sun_entity) {
      const sunState = hass.states[cfg.sun_entity];
      if (sunState) {
        const elevation = (sunState.attributes.elevation as number) ?? 0;
        const azimuth = (sunState.attributes.azimuth as number) ?? 180;
        this.applySunLight(elevation, azimuth);
      }
    }

    if (cfg?.weather_entity) {
      const weatherState = hass.states[cfg.weather_entity];
      if (weatherState) this.applyWeather(weatherState.state);
    }
  }

  applySunLight(elevation: number, azimuth: number) {
    const t = Math.max(0, Math.min(1, (elevation + 10) / 30));
    const isNight = elevation < -2;

    this.hemiLight.intensity = isNight ? 0.45 : THREE.MathUtils.lerp(0.15, 0.7, t);
    this.hemiLight.color.setHex(isNight ? 0x3a5080 : (t < 0.5 ? 0xee8833 : 0xfff4e0));
    this.hemiLight.groundColor.setHex(isNight ? 0x0d1a2e : (t > 0.5 ? 0x1a1a2e : 0x0d1020));

    this.sunLight.intensity = Math.max(0, elevation / 60) * 0.9;
    const azRad = ((azimuth - 180) * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    this.sunLight.position.set(
      Math.sin(azRad) * Math.cos(elRad) * 10,
      Math.sin(elRad) * 10,
      Math.cos(azRad) * Math.cos(elRad) * 10,
    );

    this.setSkyPos(elevation, azimuth);
    this.requestRender();
  }

  applyWeather(weatherState: string) {
    const wanted: WeatherEffect = HA_WEATHER_MAP[weatherState] ?? 'none';
    if (wanted === this._weatherType) return;
    this._weatherType = wanted;
    this.removeWeatherParticles();
    this._applyAtmosphere(wanted);
    this._createWeatherForEffect(wanted);
    this.requestRender();
  }

  // ── Atmospheric effects (lights, fog) ─────────────────────────────────────

  private _applyAtmosphere(effect: WeatherEffect) {
    const fog = this.scene.fog as THREE.FogExp2 | null;
    const baseDensity = this.getConfig()?.rendering?.fog_density ?? 0.018;

    switch (effect) {
      case 'none':
        break;

      case 'cloudy':
        this.hemiLight.intensity *= 0.5;
        this.sunLight.intensity  *= 0.2;
        if (fog) { fog.color.setHex(0x8899aa); fog.density = baseDensity * 1.4; }
        break;

      case 'exceptional':
        this.hemiLight.intensity *= 0.38;
        this.sunLight.intensity  *= 0.25;
        if (fog) { fog.color.setHex(0x1a0a00); fog.density = baseDensity * 3; }
        break;

      case 'fog':
        this.hemiLight.intensity *= 0.52;
        this.hemiLight.color.setHex(0xb8ccd8);
        this.sunLight.intensity  *= 0.06;
        // FogExp2 at ×1.4: ~3% at 2 m (interior, imperceptible), ~16% at 10 m (exterior, subtle)
        if (fog) { fog.color.setHex(0xa8b8c4); fog.density = baseDensity * 1.4; }
        break;

      case 'wind':
        this.hemiLight.intensity *= 0.88;
        if (fog) { fog.density = baseDensity * 1.1; }
        break;

      case 'rain':
        this.hemiLight.intensity *= 0.6;
        if (fog) { fog.color.setHex(0x0a1020); fog.density = baseDensity * 1.5; }
        break;

      case 'rain-heavy':
        this.hemiLight.intensity *= 0.45;
        if (fog) { fog.color.setHex(0x060e18); fog.density = baseDensity * 2.0; }
        break;

      case 'rain-storm':
        this.hemiLight.intensity *= 0.35;
        if (fog) { fog.color.setHex(0x070b12); fog.density = baseDensity * 2.5; }
        this._lightningTimer = 2 + Math.random() * 4;
        break;

      case 'lightning-only':
        this.hemiLight.intensity *= 0.32;
        if (fog) { fog.color.setHex(0x09101a); fog.density = baseDensity * 2.2; }
        this._lightningTimer = 2 + Math.random() * 5;
        break;

      case 'snow':
        this.hemiLight.intensity *= 0.8;
        this.hemiLight.color.setHex(0xd0dff0);
        if (fog) { fog.color.setHex(0x1a2030); fog.density = baseDensity * 1.2; }
        break;

      case 'snow-rain':
        this.hemiLight.intensity *= 0.62;
        this.hemiLight.color.setHex(0xb0c8d8);
        if (fog) { fog.color.setHex(0x0d1520); fog.density = baseDensity * 1.7; }
        break;

      case 'hail':
        this.hemiLight.intensity *= 0.48;
        if (fog) { fog.color.setHex(0x0a1020); fog.density = baseDensity * 1.9; }
        break;
    }
  }

  // ── Particle creation dispatch ─────────────────────────────────────────────

  private _createWeatherForEffect(effect: WeatherEffect) {
    switch (effect) {
      case 'rain':          this._createRain(900, 4.5, 2.5, 0xaac8e8, 0.5);   break;
      case 'rain-heavy':    this._createRain(1400, 7.0, 3.0, 0x8ab0d0, 0.65);  break;
      case 'rain-storm':    this._createRain(1400, 7.0, 3.0, 0x7098b8, 0.7);   break;
      case 'snow': {
        const m = this._createSnow(500);
        this._weatherParticles = m;
        this.scene.add(m);
        break;
      }
      case 'snow-rain':     this._createSnowRain();                              break;
      case 'hail':          this._createHail();                                  break;
      case 'wind':          this._createWind();                                  break;
      // fog, cloudy, exceptional, lightning-only, none — no particles
    }
  }

  // ── Rain ──────────────────────────────────────────────────────────────────

  private _createRain(
    count: number,
    baseSpeed: number,
    speedVar: number,
    color: number,
    opacity: number,
  ) {
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;
    const spawnXZ = this._makeSpawnXZ(meta);

    const pos = new Float32Array(count * 6);
    const speeds  = new Float32Array(count);
    const lengths = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const [x, z] = spawnXZ();
      const y   = yBot + Math.random() * (yTop - yBot);
      const len = 0.12 + Math.random() * 0.32;
      lengths[i] = len;
      speeds[i]  = baseSpeed + Math.random() * speedVar;
      const wx = -0.06;
      pos[i*6+0] = x;       pos[i*6+1] = y;        pos[i*6+2] = z;
      pos[i*6+3] = x + wx;  pos[i*6+4] = y - len;  pos[i*6+5] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.userData = { particleType: 'rain', spreadX, spreadZ, cx, cz, yTop, yBot,
                      modelMinX: meta.modelMinX, modelMaxX: meta.modelMaxX,
                      modelMinZ: meta.modelMinZ, modelMaxZ: meta.modelMaxZ,
                      speeds, lengths };
    this._weatherParticles = mesh;
    this.scene.add(mesh);
  }

  // ── Snow ──────────────────────────────────────────────────────────────────

  private _createSnow(count: number, colorHex = 0xddeeff, size = 0.14, opacity = 0.85) {
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;
    const spawnXZ = this._makeSpawnXZ(meta);

    const pos    = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const [x, z] = spawnXZ();
      pos[i*3+0] = x;
      pos[i*3+1] = yBot + Math.random() * (yTop - yBot);
      pos[i*3+2] = z;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.3 + Math.random() * 0.35;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex, size, transparent: true, opacity,
      depthWrite: false, sizeAttenuation: true,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.userData = { particleType: 'snow', spreadX, spreadZ, cx, cz, yTop, yBot,
                      modelMinX: meta.modelMinX, modelMaxX: meta.modelMaxX,
                      modelMinZ: meta.modelMinZ, modelMaxZ: meta.modelMaxZ,
                      phases, speeds };
    return mesh;
  }

  // ── Snow + Rain mixed ─────────────────────────────────────────────────────

  private _createSnowRain() {
    const group = new THREE.Group();
    group.userData.particleType = 'snow-rain';

    const snowMesh = this._createSnow(300, 0xc8d8e8, 0.11, 0.75);
    group.add(snowMesh);

    // Light rain overlay
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;
    const spawnXZ = this._makeSpawnXZ(meta);
    const COUNT = 500;
    const pos     = new Float32Array(COUNT * 6);
    const speeds  = new Float32Array(COUNT);
    const lengths = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const [x, z] = spawnXZ();
      const y   = yBot + Math.random() * (yTop - yBot);
      const len = 0.08 + Math.random() * 0.18;
      lengths[i] = len;
      speeds[i]  = 3.5 + Math.random() * 2.0;
      pos[i*6+0] = x;       pos[i*6+1] = y;        pos[i*6+2] = z;
      pos[i*6+3] = x - 0.04; pos[i*6+4] = y - len; pos[i*6+5] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x90aac0, transparent: true, opacity: 0.4, depthWrite: false });
    const rainMesh = new THREE.LineSegments(geo, mat);
    rainMesh.userData = { particleType: 'rain', spreadX, spreadZ, cx, cz, yTop, yBot,
                          modelMinX: meta.modelMinX, modelMaxX: meta.modelMaxX,
                          modelMinZ: meta.modelMinZ, modelMaxZ: meta.modelMaxZ,
                          speeds, lengths };
    group.add(rainMesh);

    this._weatherParticles = group;
    this.scene.add(group);
  }

  // ── Hail ──────────────────────────────────────────────────────────────────

  private _createHail() {
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;
    const spawnXZ = this._makeSpawnXZ(meta);

    const COUNT = 600;
    const pos     = new Float32Array(COUNT * 6);
    const speeds  = new Float32Array(COUNT);
    const lengths = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const [x, z] = spawnXZ();
      const y   = yBot + Math.random() * (yTop - yBot);
      const len = 0.05 + Math.random() * 0.1;   // short, chunky
      lengths[i] = len;
      speeds[i]  = 9 + Math.random() * 5;       // fast drop
      pos[i*6+0] = x;          pos[i*6+1] = y;        pos[i*6+2] = z;
      pos[i*6+3] = x - 0.02;   pos[i*6+4] = y - len;  pos[i*6+5] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xe0e8f0, transparent: true, opacity: 0.75, depthWrite: false });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.userData = { particleType: 'hail', spreadX, spreadZ, cx, cz, yTop, yBot,
                      modelMinX: meta.modelMinX, modelMaxX: meta.modelMaxX,
                      modelMinZ: meta.modelMinZ, modelMaxZ: meta.modelMaxZ,
                      speeds, lengths };
    this._weatherParticles = mesh;
    this.scene.add(mesh);
  }

  // ── Wind trails (LineSegments) ────────────────────────────────────────────

  private _createWind() {
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;

    const COUNT   = 140;
    const pos     = new Float32Array(COUNT * 6);  // head + tail per trail
    const speeds  = new Float32Array(COUNT);
    const lengths = new Float32Array(COUNT);

    // Initial wind direction — trails point backward from +X
    for (let i = 0; i < COUNT; i++) {
      const x = cx + (Math.random() - 0.5) * spreadX;
      const z = cz + (Math.random() - 0.5) * spreadZ;
      const y = yBot + Math.random() * (yTop - yBot) * 0.55;
      const len = 0.2 + Math.random() * 0.5;
      lengths[i] = len;
      speeds[i]  = 2.0 + Math.random() * 2.5;
      // head
      pos[i*6+0] = x;         pos[i*6+1] = y; pos[i*6+2] = z;
      // tail (behind the default wind direction +X)
      pos[i*6+3] = x - len;   pos[i*6+4] = y; pos[i*6+5] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xc8b890, transparent: true, opacity: 0.22, depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.userData = { particleType: 'wind', spreadX, spreadZ, cx, cz, yTop, yBot,
                      modelMinX: meta.modelMinX, modelMaxX: meta.modelMaxX,
                      modelMinZ: meta.modelMinZ, modelMaxZ: meta.modelMaxZ,
                      speeds, lengths };
    this._weatherParticles = mesh;
    this.scene.add(mesh);
  }

  // ── Particle step ─────────────────────────────────────────────────────────

  stepParticles(dt: number) {
    this._weatherTime += dt;

    // Lightning flash decay
    if (this._lightningLight) {
      this._lightningFlash -= dt * 6;
      if (this._lightningFlash <= 0) {
        this.scene.remove(this._lightningLight);
        this._lightningLight.dispose();
        this._lightningLight = null;
        this._lightningFlash = 0;
      } else {
        this._lightningLight.intensity = this._lightningFlash * 18;
      }
    } else if (this._lightningTimer > 0) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._fireLightning();
        this._lightningTimer = 3 + Math.random() * 9;
      }
    }

    const obj = this._weatherParticles;
    if (!obj) return;

    if (obj instanceof THREE.Group) {
      // snow-rain: step each child
      for (const child of obj.children) {
        this._stepObject(child as THREE.LineSegments | THREE.Points, dt);
      }
    } else {
      this._stepObject(obj as THREE.LineSegments | THREE.Points, dt);
    }
  }

  private _fireLightning() {
    const box = this.getModelBox();
    const center = box.getCenter(new THREE.Vector3());
    const light = new THREE.PointLight(0xd0e8ff, 18, 0, 1.5);
    light.position.set(center.x + (Math.random() - 0.5) * 10, box.max.y + 8, center.z + (Math.random() - 0.5) * 10);
    this.scene.add(light);
    this._lightningLight  = light;
    this._lightningFlash  = 1;
  }

  private _stepObject(obj: THREE.LineSegments | THREE.Points, dt: number) {
    const { particleType, spreadX, spreadZ, cx, cz, yTop, yBot,
            modelMinX, modelMaxX, modelMinZ, modelMaxZ,
            speeds, lengths, phases } = obj.userData as {
      particleType: string; spreadX: number; spreadZ: number;
      cx: number; cz: number; yTop: number; yBot: number;
      modelMinX: number; modelMaxX: number; modelMinZ: number; modelMaxZ: number;
      speeds: Float32Array; lengths?: Float32Array; phases?: Float32Array;
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

    const geo = obj.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = this._weatherTime;

    if (particleType === 'rain' || particleType === 'hail') {
      const windX = -0.08 + Math.sin(t * 0.35) * (particleType === 'hail' ? 0.015 : 0.04);
      const windZ = Math.sin(t * 0.22) * (particleType === 'hail' ? 0.01 : 0.02);
      for (let i = 0, pi = 0; i < arr.length; i += 6, pi++) {
        const spd = speeds[pi];
        const len = lengths![pi];
        const dy  = spd * dt;
        arr[i+1] -= dy; arr[i+4] -= dy;
        arr[i+0] += windX * dt * spd; arr[i+3] += windX * dt * spd;
        arr[i+2] += windZ * dt * spd; arr[i+5] += windZ * dt * spd;
        if (arr[i+4] < yBot) {
          const [x, z] = spawnXZ();
          arr[i+0] = x;                     arr[i+1] = yTop;
          arr[i+2] = z;                     arr[i+3] = x + windX * len / spd;
          arr[i+4] = yTop - len;            arr[i+5] = z + windZ * len / spd;
        }
      }
    } else if (particleType === 'snow') {
      const macroWindX = Math.sin(t * 0.15) * 0.25;
      const macroWindZ = Math.cos(t * 0.12) * 0.15;
      for (let i = 0, pi = 0; i < arr.length; i += 3, pi++) {
        const spd = speeds[pi];
        const ph  = phases![pi];
        arr[i+1] -= spd * dt;
        arr[i+0] += (macroWindX + Math.sin(t * 0.6 + ph) * 0.12) * dt;
        arr[i+2] += (macroWindZ + Math.cos(t * 0.4 + ph * 1.3) * 0.08) * dt;
        if (arr[i+1] < yBot) {
          const [x, z] = spawnXZ();
          arr[i+0] = x; arr[i+1] = yTop; arr[i+2] = z;
        }
      }
    } else if (particleType === 'wind') {
      // Oscillating wind direction, predominantly +X
      const windX = 1.5 + Math.sin(t * 0.1) * 0.5;
      const windZ = Math.cos(t * 0.13) * 0.35;
      const windLen = Math.sqrt(windX * windX + windZ * windZ);
      for (let i = 0, pi = 0; i < arr.length; i += 6, pi++) {
        const spd = speeds[pi];
        const len = lengths![pi];
        // Move head
        arr[i+0] += windX * spd * dt;
        arr[i+2] += windZ * spd * dt;
        // Tail dynamically trails behind head along wind direction
        arr[i+3] = arr[i+0] - (windX / windLen) * len;
        arr[i+4] = arr[i+1];
        arr[i+5] = arr[i+2] - (windZ / windLen) * len;
        // Respawn at upwind edge (left side) when head exits spread
        if (arr[i+0] > cx + spreadX * 0.52 || Math.abs(arr[i+2] - cz) > spreadZ * 0.55) {
          arr[i+0] = cx - spreadX * 0.5 + (Math.random() - 0.5) * 2;
          arr[i+1] = yBot + Math.random() * (yTop - yBot) * 0.55;
          arr[i+2] = cz + (Math.random() - 0.5) * spreadZ * 0.9;
          arr[i+3] = arr[i+0] - (windX / windLen) * len;
          arr[i+4] = arr[i+1];
          arr[i+5] = arr[i+2] - (windZ / windLen) * len;
        }
      }
    }

    pos.needsUpdate = true;
  }

  // ── Sky position ──────────────────────────────────────────────────────────

  setSkyPos(elevation: number, azimuth = 180) {
    if (!this.sky) return;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth - 180);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms['sunPosition'].value.copy(sunPos);
    const t = Math.max(0, Math.min(1, elevation / 30));
    this.sky.material.uniforms['turbidity'].value = THREE.MathUtils.lerp(10, 3, t);
    this.sky.material.uniforms['rayleigh'].value = THREE.MathUtils.lerp(3, 1.2, t);
    const transparentBg = this.getConfig()?.rendering?.transparent_background === true;
    if (transparentBg) {
      this.sky.visible = false;
    } else if (elevation < -5) {
      this.sky.visible = false;
      this.scene.background = new THREE.Color(0x05080f);
      if (this.scene.fog) (this.scene.fog as THREE.FogExp2).color.setHex(0x05080f);
    } else {
      this.sky.visible = true;
      this.scene.background = null;
      const fogHex = elevation > 20 ? 0x9fc8e8 : 0xd4845a;
      if (this.scene.fog) (this.scene.fog as THREE.FogExp2).color.setHex(fogHex);
    }
  }

  // ── Ground ────────────────────────────────────────────────────────────────

  addGround(originalBox: THREE.Box3, config: CardConfig) {
    const size = originalBox.getSize(new THREE.Vector3());
    const spread = Math.max(size.x, size.z) * 6;
    const groundY = -size.y / 2 - 0.01;
    const geo = new THREE.PlaneGeometry(spread, spread);
    const groundHex = config?.rendering?.ground_color
      ? parseInt(config.rendering.ground_color.replace('#', ''), 16)
      : 0x4a6741;
    const mat = new THREE.MeshStandardMaterial({ color: groundHex, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = groundY;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  removeWeatherParticles() {
    if (this._lightningLight) {
      this.scene.remove(this._lightningLight);
      this._lightningLight.dispose();
      this._lightningLight = null;
    }
    this._lightningFlash = 0;
    this._lightningTimer = 0;

    if (!this._weatherParticles) return;
    this.scene.remove(this._weatherParticles);

    const disposeObject = (obj: THREE.Object3D) => {
      if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    };

    if (this._weatherParticles instanceof THREE.Group) {
      this._weatherParticles.children.forEach(disposeObject);
    } else {
      disposeObject(this._weatherParticles);
    }

    this._weatherParticles = null;
    this._weatherTime = 0;

    // Reset fog density to baseline
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = this.getConfig()?.rendering?.fog_density ?? 0.018;

    this.setSkyPos(60, 180);
    this.hemiLight.intensity = 0.7;
    // NOTE: _weatherType is NOT reset here — that's the caller's responsibility
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _makeBoxMeta(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    return {
      cx:        (box.min.x + box.max.x) / 2,
      cz:        (box.min.z + box.max.z) / 2,
      yTop:       box.max.y + 5,
      yBot:       box.min.y - 0.5,
      spreadX:    Math.max(size.x * 2, 12),
      spreadZ:    Math.max(size.z * 2, 12),
      modelMinX:  box.min.x,
      modelMaxX:  box.max.x,
      modelMinZ:  box.min.z,
      modelMaxZ:  box.max.z,
    };
  }

  private _makeSpawnXZ(meta: ReturnType<typeof this._makeBoxMeta>) {
    const { cx, cz, spreadX, spreadZ, modelMinX, modelMaxX, modelMinZ, modelMaxZ } = meta;
    return (): [number, number] => {
      let x: number, z: number, tries = 0;
      do {
        x = cx + (Math.random() - 0.5) * spreadX;
        z = cz + (Math.random() - 0.5) * spreadZ;
        tries++;
      } while (tries < 30 && x > modelMinX && x < modelMaxX && z > modelMinZ && z < modelMaxZ);
      return [x, z];
    };
  }
}
