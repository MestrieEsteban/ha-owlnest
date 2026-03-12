import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { CardConfig, Hass } from '../types';

export class EnvironmentController {
  private _weatherParticles: THREE.Object3D | null = null;
  private _weatherType: 'none' | 'rain' | 'snow' = 'none';

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
  set weatherType(v: 'none' | 'rain' | 'snow') { this._weatherType = v; }

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
    const rainy = ['rainy', 'pouring', 'lightning', 'lightning-rainy'].includes(weatherState);
    const snowy = ['snowy', 'snowy-rainy'].includes(weatherState);
    const wanted: 'rain' | 'snow' | 'none' = rainy ? 'rain' : snowy ? 'snow' : 'none';

    if (wanted === this._weatherType) return;
    this._weatherType = wanted;
    this.removeWeatherParticles();

    if (wanted === 'rain') {
      this.scene.fog?.color.setHex(0x0a1020);
      this.hemiLight.intensity *= 0.6;
    } else if (wanted === 'snow') {
      this.scene.fog?.color.setHex(0x1a2030);
      this.hemiLight.intensity *= 0.8;
    }

    if (wanted !== 'none') this.createWeatherParticles(wanted);
    this.requestRender();
  }

  setSkyPos(elevation: number, azimuth = 180) {
    if (!this.sky) return;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth - 180);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms['sunPosition'].value.copy(sunPos);
    // Adjust haziness near horizon / sunset
    const t = Math.max(0, Math.min(1, elevation / 30));
    this.sky.material.uniforms['turbidity'].value = THREE.MathUtils.lerp(10, 3, t);
    this.sky.material.uniforms['rayleigh'].value = THREE.MathUtils.lerp(3, 1.2, t);
    // Night: hide sky, use dark bg
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

  createWeatherParticles(type: 'rain' | 'snow') {
    const box = this.getModelBox();
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

  stepParticles(dt: number) {
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

  removeWeatherParticles() {
    if (!this._weatherParticles) return;
    this.scene.remove(this._weatherParticles);
    const obj = this._weatherParticles as THREE.LineSegments | THREE.Points;
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
    this._weatherParticles = null;

    this.setSkyPos(60, 180);
    this.hemiLight.intensity = 0.7;
    // NOTE: _weatherType is NOT reset here — that's the caller's responsibility
  }

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
}
