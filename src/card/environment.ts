import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { CardConfig, Hass, SunMode, GroundStyle } from '../types';
import { qualityFromConfig } from '../quality';
import { modelScale } from '../scale';

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

  /**
   * Distance du soleil à l'origine. Ajustée à la taille du modèle : si la
   * lumière se retrouve à l'intérieur de la sphère englobante, une partie de la
   * scène passe derrière la caméra d'ombre et cesse d'être ombrée.
   */
  private _sunDistance = 10;
  setSunDistance(d: number) { this._sunDistance = d; }

  /** Le soleil a bougé : les shadow maps ne sont plus valides. */
  onSunMoved?: () => void;

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

  /**
   * Teinte d'origine de la lumière d'ambiance.
   *
   * Certaines météos la refroidissent. Sans mémoire de la valeur de départ, on
   * ne saurait pas y revenir — et la scène garderait la teinte du dernier orage.
   */
  private _baseHemiColor: THREE.Color | null = null;

  /** Teinte d'origine du brouillard, pour pouvoir y revenir. */
  private _baseFogColor: THREE.Color | null = null;

  /**
   * Remet l'éclairage à ce que demande la configuration.
   *
   * `_applyAtmosphere` appliquait ses facteurs en **multipliant** l'intensité
   * courante : passer de la pluie au beau temps puis à la pluie assombrissait la
   * scène un peu plus à chaque fois, sans jamais revenir. On repart donc toujours
   * des valeurs de base, relues dans la configuration.
   */
  private _resetLights(): { hemi: number; sun: number } {
    const rl = this.getConfig()?.rendering ?? {};
    const hemi = rl.ambient_intensity ?? 0.7;
    const sun = rl.sun_intensity ?? 0.8;
    if (!this._baseHemiColor) this._baseHemiColor = this.hemiLight.color.clone();
    else this.hemiLight.color.copy(this._baseHemiColor);
    this.hemiLight.intensity = hemi;
    this.sunLight.intensity = sun;
    return { hemi, sun };
  }

  /**
   * Densité de brouillard, mise à l'échelle du modèle.
   *
   * Les météos écrivaient `fog.density` directement, en contournant la
   * transposition. Sur un export en centimètres, `0,018 × 1,5` sature le
   * brouillard à trois unités : combiné à une teinte presque noire, le modèle
   * disparaissait complètement.
   */
  /**
   * Remet l'atmosphère à sa ligne de base.
   *
   * Cette remise à zéro vivait dans `removeWeatherParticles()`, qui sort
   * immédiatement quand il n'y a rien à retirer. Or `fog`, `cloudy`,
   * `exceptional` et `lightning-only` ne créent aucune particule : on ne pouvait
   * jamais en sortir, et le brouillard gardait leur densité — et leur teinte,
   * qui n'était de toute façon jamais restaurée.
   *
   * Elle appartient donc à l'atmosphère, pas aux particules.
   */
  private _resetAtmosphere() {
    this._resetLights();
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      if (!this._baseFogColor) this._baseFogColor = fog.color.clone();
      else fog.color.copy(this._baseFogColor);
    }
    this._setFogDensity(this.getConfig()?.rendering?.fog_density ?? 0.018);
  }

  private _setFogDensity(asked: number) {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    const size = this.getModelBox().getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    fog.density = asked / modelScale(span);
  }

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

  /**
   * Apply sun light. In 'realistic' mode, house_orientation offsets the azimuth
   * so the sun trajectory matches the real-world orientation of the house.
   */
  applySunLight(elevation: number, azimuth: number) {
    const cfg = this.getConfig();
    const rl = cfg?.rendering ?? {};
    const sunMode: SunMode = rl.sun_mode ?? 'showcase';
    const isRealistic = sunMode === 'realistic';

    // User-configured base intensities (sliders in editor)
    const userSunIntensity = rl.sun_intensity ?? 0.8;
    const userAmbientIntensity = rl.ambient_intensity ?? 0.7;

    // In realistic mode, offset azimuth by house orientation
    let effectiveAzimuth = azimuth;
    if (isRealistic && rl.house_orientation !== undefined) {
      effectiveAzimuth = azimuth + rl.house_orientation;
    }

    const t = Math.max(0, Math.min(1, (elevation + 10) / 30));
    const isNight = elevation < -2;

    // ── Hemisphere (ambient) light ──────────────────────────────────────
    // The cycle computes a 0..1 factor, then multiplied by user intensity.
    let ambientFactor: number;
    if (isRealistic) {
      // Realistic: lower ambient ratio → darker shadows, more contrast
      ambientFactor = isNight ? 0.5 : THREE.MathUtils.lerp(0.15, 0.65, t);
    } else {
      // Showcase: generous ambient for a flattering, soft look
      ambientFactor = isNight ? 0.65 : THREE.MathUtils.lerp(0.2, 1.0, t);
    }
    this.hemiLight.intensity = ambientFactor * userAmbientIntensity;

    // Color interpolation: night blue → golden hour → day white
    if (isNight) {
      this.hemiLight.color.setHex(0x3a5080);
    } else if (isRealistic) {
      const goldenHour = new THREE.Color(0xeec090);
      const dayWhite   = new THREE.Color(0xf0ece4);
      if (t < 0.5) {
        this.hemiLight.color.setHex(0x3a5080);
        this.hemiLight.color.lerp(goldenHour, t * 2);
      } else {
        this.hemiLight.color.copy(goldenHour).lerp(dayWhite, (t - 0.5) * 2);
      }
    } else {
      const goldenHour = new THREE.Color(0xffc896);
      const dayWhite   = new THREE.Color(0xfff4e0);
      if (t < 0.5) {
        this.hemiLight.color.setHex(0x3a5080);
        this.hemiLight.color.lerp(goldenHour, t * 2);
      } else {
        this.hemiLight.color.copy(goldenHour).lerp(dayWhite, (t - 0.5) * 2);
      }
    }

    this.hemiLight.groundColor.setHex(isNight ? 0x0d1a2e : (t > 0.5 ? 0x1a1a2e : 0x0d1020));

    // ── Directional (sun) light ─────────────────────────────────────────
    // Cycle computes a 0..1 factor, then multiplied by user sun intensity.
    let sunFactor: number;
    if (isRealistic) {
      // Steeper curve: negligible below 5°, ramps to full between 5° and 50°
      sunFactor = Math.max(0, (elevation - 5) / 45);
      this.sunLight.color.setHex(isNight ? 0xfff4c2 : (t < 0.4 ? 0xffcc88 : 0xfff0d8));
    } else {
      sunFactor = Math.max(0, elevation / 60);
      this.sunLight.color.setHex(0xfff4c2);
    }
    this.sunLight.intensity = sunFactor * userSunIntensity;

    const azRad = ((effectiveAzimuth - 180) * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    const d = this._sunDistance;
    this.sunLight.position.set(
      Math.sin(azRad) * Math.cos(elRad) * d,
      Math.sin(elRad) * d,
      Math.cos(azRad) * Math.cos(elRad) * d,
    );

    this.setSkyPos(elevation, effectiveAzimuth);
    this.onSunMoved?.();
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
    // Toujours repartir d'une base propre : les facteurs ci-dessous sont des
    // assignations, jamais des multiplications cumulées.
    this._resetAtmosphere();
    const rl = this.getConfig()?.rendering ?? {};
    const hemi = rl.ambient_intensity ?? 0.7;
    const sun = rl.sun_intensity ?? 0.8;
    const dim = (h: number, s?: number) => {
      this.hemiLight.intensity = hemi * h;
      if (s !== undefined) this.sunLight.intensity = sun * s;
    };
    const tint = (hex: number) => this.hemiLight.color.setHex(hex);

    switch (effect) {
      case 'none':
        break;

      case 'cloudy':
        dim(0.5, 0.2);
        if (fog) fog.color.setHex(0x8899aa);
        this._setFogDensity(baseDensity * 1.4);
        break;

      case 'exceptional':
        dim(0.38, 0.25);
        if (fog) fog.color.setHex(0x1a0a00);
        this._setFogDensity(baseDensity * 3);
        break;

      case 'fog':
        dim(0.52, 0.06);
        tint(0xb8ccd8);
        if (fog) fog.color.setHex(0xa8b8c4);
        this._setFogDensity(baseDensity * 1.4);
        break;

      case 'wind':
        dim(0.88);
        this._setFogDensity(baseDensity * 1.1);
        break;

      case 'rain':
        dim(0.6);
        if (fog) fog.color.setHex(0x0a1020);
        this._setFogDensity(baseDensity * 1.5);
        break;

      case 'rain-heavy':
        dim(0.45);
        if (fog) fog.color.setHex(0x060e18);
        this._setFogDensity(baseDensity * 2.0);
        break;

      case 'rain-storm':
        dim(0.35);
        if (fog) fog.color.setHex(0x070b12);
        this._setFogDensity(baseDensity * 2.5);
        this._lightningTimer = 2 + Math.random() * 4;
        break;

      case 'lightning-only':
        dim(0.32);
        if (fog) fog.color.setHex(0x09101a);
        this._setFogDensity(baseDensity * 2.2);
        this._lightningTimer = 2 + Math.random() * 5;
        break;

      case 'snow':
        dim(0.8);
        tint(0xd0dff0);
        if (fog) fog.color.setHex(0x1a2030);
        this._setFogDensity(baseDensity * 1.2);
        break;

      case 'snow-rain':
        dim(0.62);
        tint(0xb0c8d8);
        if (fog) fog.color.setHex(0x0d1520);
        this._setFogDensity(baseDensity * 1.7);
        break;

      case 'hail':
        dim(0.48);
        if (fog) fog.color.setHex(0x0a1020);
        this._setFogDensity(baseDensity * 1.9);
        break;
    }
  }

  // ── Particle creation dispatch ─────────────────────────────────────────────

  /** Nombre de particules ajusté au profil qualité (jamais moins d'une). */
  private _n(count: number): number {
    return Math.max(1, Math.round(count * qualityFromConfig(this.getConfig()).particleScale));
  }

  /** Reconstruit les particules courantes — utilisé quand la qualité change. */
  rebuildWeather() {
    if (this._weatherType === 'none') return;
    this.removeWeatherParticles();
    this._createWeatherForEffect(this._weatherType);
    this.requestRender();
  }

  private _createWeatherForEffect(effect: WeatherEffect) {
    switch (effect) {
      case 'rain':          this._createRain(this._n(900), 4.5, 2.5, 0xaac8e8, 0.5);   break;
      case 'rain-heavy':    this._createRain(this._n(1400), 7.0, 3.0, 0x8ab0d0, 0.65);  break;
      case 'rain-storm':    this._createRain(this._n(1400), 7.0, 3.0, 0x7098b8, 0.7);   break;
      case 'snow': {
        const m = this._createSnow(this._n(500));
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

  /**
   * Facteur d'échelle des particules.
   *
   * Toutes les longueurs, vitesses et tailles de la météo étaient écrites pour
   * un modèle en mètres : des gouttes de quatre millimètres tombant à trois
   * centimètres par seconde sur un export en centimètres. Rien n'était visible.
   *
   * Les vents ne sont pas concernés : dans la boucle de mise à jour ce sont des
   * multiplicateurs adimensionnés appliqués à une vitesse déjà mise à l'échelle.
   * Les seules exceptions sont les amplitudes de la neige, multipliées par le
   * temps seul, donc bien des vitesses.
   */
  private get _wScale(): number {
    const size = this.getModelBox().getSize(new THREE.Vector3());
    return modelScale(Math.max(size.x, size.y, size.z));
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

    const k = this._wScale;
    const pos = new Float32Array(count * 6);
    const speeds  = new Float32Array(count);
    const lengths = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const [x, z] = spawnXZ();
      const y   = yBot + Math.random() * (yTop - yBot);
      const len = (0.12 + Math.random() * 0.32) * k;
      lengths[i] = len;
      speeds[i]  = (baseSpeed + Math.random() * speedVar) * k;
      const wx = -0.06 * k;
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

    const k = this._wScale;
    const pos    = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const [x, z] = spawnXZ();
      pos[i*3+0] = x;
      pos[i*3+1] = yBot + Math.random() * (yTop - yBot);
      pos[i*3+2] = z;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = (0.3 + Math.random() * 0.35) * k;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex, size: size * k, transparent: true, opacity,
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

    const snowMesh = this._createSnow(this._n(300), 0xc8d8e8, 0.11, 0.75);
    group.add(snowMesh);

    // Light rain overlay
    const box = this.getModelBox();
    const meta = this._makeBoxMeta(box);
    const { cx, cz, yTop, yBot, spreadX, spreadZ } = meta;
    const spawnXZ = this._makeSpawnXZ(meta);
    const COUNT = this._n(500);
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

    const k = this._wScale;
    const COUNT = this._n(600);
    const pos     = new Float32Array(COUNT * 6);
    const speeds  = new Float32Array(COUNT);
    const lengths = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const [x, z] = spawnXZ();
      const y   = yBot + Math.random() * (yTop - yBot);
      const len = (0.05 + Math.random() * 0.1) * k;   // short, chunky
      lengths[i] = len;
      speeds[i]  = (9 + Math.random() * 5) * k;      // fast drop
      pos[i*6+0] = x;              pos[i*6+1] = y;        pos[i*6+2] = z;
      pos[i*6+3] = x - 0.02 * k;   pos[i*6+4] = y - len;  pos[i*6+5] = z;
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

    const k = this._wScale;
    const COUNT   = this._n(140);
    const pos     = new Float32Array(COUNT * 6);  // head + tail per trail
    const speeds  = new Float32Array(COUNT);
    const lengths = new Float32Array(COUNT);

    // Initial wind direction — trails point backward from +X
    for (let i = 0; i < COUNT; i++) {
      const x = cx + (Math.random() - 0.5) * spreadX;
      const z = cz + (Math.random() - 0.5) * spreadZ;
      const y = yBot + Math.random() * (yTop - yBot) * 0.55;
      const len = (0.2 + Math.random() * 0.5) * k;
      lengths[i] = len;
      speeds[i]  = (2.0 + Math.random() * 2.5) * k;
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
      // Ces amplitudes sont multipliées par le temps seul : ce sont donc des
      // vitesses, et elles doivent suivre l'échelle du modèle. Les vents de la
      // pluie, eux, multiplient une vitesse déjà mise à l'échelle et restent
      // adimensionnés.
      const k = this._wScale;
      const macroWindX = Math.sin(t * 0.15) * 0.25 * k;
      const macroWindZ = Math.cos(t * 0.12) * 0.15 * k;
      for (let i = 0, pi = 0; i < arr.length; i += 3, pi++) {
        const spd = speeds[pi];
        const ph  = phases![pi];
        arr[i+1] -= spd * dt;
        arr[i+0] += (macroWindX + Math.sin(t * 0.6 + ph) * 0.12 * k) * dt;
        arr[i+2] += (macroWindZ + Math.cos(t * 0.4 + ph * 1.3) * 0.08 * k) * dt;
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
          arr[i+0] = cx - spreadX * 0.5 + (Math.random() - 0.5) * 2 * this._wScale;
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
      // Fog: sky blue during day, muted warm grey at golden hour (not orange)
      const fogHex = elevation > 20 ? 0x9fc8e8 : 0xb8a898;
      if (this.scene.fog) (this.scene.fog as THREE.FogExp2).color.setHex(fogHex);
    }
  }

  // ── Light occlusion (invisible shadow-casting roof) ──────────────────────

  private _occlusionMesh: THREE.Mesh | null = null;

  /**
   * Add an invisible plane above the model that casts shadows downward,
   * simulating a closed roof for light calculations. The plane is invisible
   * in the final render but participates in shadow mapping.
   */
  addOcclusion(modelBox: THREE.Box3) {
    this.removeOcclusion();
    const size = modelBox.getSize(new THREE.Vector3());
    // Cover the full footprint with generous margin
    const spreadX = size.x * 1.4;
    const spreadZ = size.z * 1.4;
    const geo = new THREE.PlaneGeometry(spreadX, spreadZ);

    // The trick: use a standard material so Three.js shadow map renders this mesh
    // during the depth pass, but make it fully transparent to the main camera.
    // - side: DoubleSide ensures the shadow is cast regardless of light direction
    // - opacity: 0 + transparent: true → invisible in main render
    // - The shadow map renderer ignores opacity and uses the depth material,
    //   so the mesh still writes to the shadow map correctly.
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      // Prevent this invisible mesh from writing to the main depth buffer
      // (avoids occluding other objects in the camera view)
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // Place just above the model top
    // Écart relatif : un plafond exporté à la hauteur exacte du modèle
    // scintillerait contre ce plan.
    mesh.position.y = size.y / 2 + Math.max(size.x, size.y, size.z) * 2e-3;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // Ensure the shadow map uses a proper depth material
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    // Don't let raycaster pick this up
    mesh.raycast = () => {};
    mesh.name = '__owlnest_occlusion';
    // renderOrder very high so transparency doesn't hide other objects
    mesh.renderOrder = 999;
    this.scene.add(mesh);
    this._occlusionMesh = mesh;
  }

  removeOcclusion() {
    if (this._occlusionMesh) {
      this.scene.remove(this._occlusionMesh);
      this._occlusionMesh.geometry.dispose();
      (this._occlusionMesh.material as THREE.Material).dispose();
      this._occlusionMesh.customDepthMaterial?.dispose();
      this._occlusionMesh = null;
    }
  }

  get hasOcclusion() { return this._occlusionMesh !== null; }

  // ── Ground ────────────────────────────────────────────────────────────────

  private _groundMesh: THREE.Mesh | THREE.Group | null = null;

  addGround(originalBox: THREE.Box3, config: CardConfig) {
    this.removeGround();
    const size = originalBox.getSize(new THREE.Vector3());

    /**
     * Écart entre le sol du décor et le plancher du modèle.
     *
     * Il était fixé à 0,01 unité — un dixième de millimètre sur un export en
     * centimètres, bien en dessous de ce que la carte de profondeur distingue.
     * Les deux plans scintillaient dès qu'on activait un sol.
     *
     * Deux millièmes de l'envergure : invisible à l'œil, largement au-dessus du
     * seuil de résolution. Même constante que la séparation des dalles
     * coplanaires, pour la même raison.
     */
    const span = Math.max(size.x, size.y, size.z, 1e-6);
    const gap = span * 2e-3;
    // Deux écarts sous le plancher : il faut laisser la place au disque du
    // podium, qui vient se glisser entre les deux. Un seul écart le ramènerait
    // exactement au niveau du plancher, donc au scintillement de départ.
    const groundY = -size.y / 2 - gap * 2;
    const groundHex = config?.rendering?.ground_color
      ? parseInt(config.rendering.ground_color.replace('#', ''), 16)
      : 0x4a6741;
    const style: GroundStyle = config?.rendering?.ground_style ?? 'square';
    const scale = config?.rendering?.ground_scale ?? 1.0;

    if (style === 'none') return;

    const maxDim = Math.max(size.x, size.z);
    const group = new THREE.Group();
    group.name = '__owlnest_ground';

    if (style === 'podium') {
      // Snow-globe-style presentation base
      const radius = maxDim * 0.9 * scale;
      const baseHeight = maxDim * 0.07;
      const rimThickness = baseHeight * 0.18;
      // Un dixième de l'épaisseur du bord — la proportion d'origine, mais
      // exprimée relativement au lieu d'une valeur en unités.
      const rimInset = rimThickness * 0.1;

      // ─ Black base body (slightly tapered cylinder)
      const baseGeo = new THREE.CylinderGeometry(radius * 0.97, radius * 1.03, baseHeight, 64);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.85,
        metalness: 0.05,
      });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = groundY - baseHeight / 2;
      base.receiveShadow = true;
      base.castShadow = true;

      // ─ Metallic rim ring (torus around top edge)
      const rimGeo = new THREE.TorusGeometry(radius * 0.97, rimThickness, 16, 64);
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        roughness: 0.2,
        metalness: 0.85,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = groundY + rimInset;
      rim.receiveShadow = true;

      // ─ Thin bottom lip ring (dark metal accent)
      const lipGeo = new THREE.TorusGeometry(radius * 1.03, rimThickness * 0.6, 12, 64);
      const lipMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.35,
        metalness: 0.7,
      });
      const lip = new THREE.Mesh(lipGeo, lipMat);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = groundY - baseHeight + rimInset;
      lip.receiveShadow = true;

      // ─ Presentation disc (user-colored top surface)
      const discGeo = new THREE.CylinderGeometry(radius * 0.94, radius * 0.94, gap, 64);
      const discMat = new THREE.MeshStandardMaterial({
        color: groundHex,
        roughness: 0.6,
        metalness: 0.08,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.y = groundY + gap;
      disc.receiveShadow = true;

      group.add(base);
      group.add(rim);
      group.add(lip);
      group.add(disc);
      this.scene.add(group);
      this._groundMesh = group as unknown as THREE.Mesh;
      return;
    }

    let geo: THREE.BufferGeometry;
    switch (style) {
      case 'disc': {
        const radius = maxDim * 1.0 * scale;
        geo = new THREE.CircleGeometry(radius, 64);
        break;
      }
      case 'infinite': {
        const spread = maxDim * 30;
        geo = new THREE.PlaneGeometry(spread, spread);
        break;
      }
      case 'square':
      default: {
        const spread = maxDim * 6 * scale;
        geo = new THREE.PlaneGeometry(spread, spread);
        break;
      }
    }

    const mat = new THREE.MeshStandardMaterial({ color: groundHex, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = groundY;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._groundMesh = mesh;
  }

  updateGroundColor(hexColor: string | undefined) {
    if (!this._groundMesh) return;
    const hex = hexColor ? parseInt(hexColor.replace('#', ''), 16) : 0x4a6741;
    const applyColor = (obj: THREE.Object3D) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.color.setHex(hex);
        mat.needsUpdate = true;
      }
    };
    if (this._groundMesh instanceof THREE.Group) {
      this._groundMesh.traverse(applyColor);
    } else {
      applyColor(this._groundMesh);
    }
  }

  removeGround() {
    if (this._groundMesh) {
      this.scene.remove(this._groundMesh);
      const dispose = (obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      };
      if (this._groundMesh instanceof THREE.Group) {
        this._groundMesh.traverse(dispose);
      } else {
        dispose(this._groundMesh);
      }
      this._groundMesh = null;
    }
  }

  get hasGround() { return this._groundMesh !== null; }

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

    // Ni le brouillard ni l'éclairage ne sont touchés ici : c'est le rôle de
    // `_resetAtmosphere()`, appelée par `_applyAtmosphere`. Les mêler rendait la
    // remise à zéro dépendante de la présence de particules.
    this.setSkyPos(60, 180);
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
