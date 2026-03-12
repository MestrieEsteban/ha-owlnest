import { syncLights } from '../lights';
import type { Hass, AnchorEntry, CardConfig } from '../types';
import { EnvironmentController } from './environment';

export class SimulationPanel {
  private _simActive = false;
  private _simHour = 12;
  private _simWeather: 'clear' | 'cloudy' | 'rain' | 'snow' = 'clear';
  private _simOpen = false;

  constructor(
    private simExpand: HTMLDivElement,
    private simBtn: HTMLButtonElement,
    private env: EnvironmentController,
    private requestRender: () => void,
    private getHass: () => Hass | null,
    private getAnchors: () => Map<string, AnchorEntry>,
    private getEffectiveConfig: () => CardConfig,
    private updateOverlayStates: () => void,
  ) {}

  get isOpen() { return this._simOpen; }
  get isActive() { return this._simActive; }

  toggle() {
    this._simOpen = !this._simOpen;
    if (this._simOpen) {
      this.simExpand.style.maxHeight = '160px';
      this.simExpand.style.opacity = '1';
      this.simExpand.style.pointerEvents = 'auto';
      this.simBtn.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.85)';
    } else {
      this.simExpand.style.maxHeight = '0';
      this.simExpand.style.opacity = '0';
      this.simExpand.style.pointerEvents = 'none';
      this.simBtn.style.boxShadow = 'none';
    }
  }

  buildContent() {
    this.simExpand.innerHTML = '';

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
    this.simExpand.appendChild(inner);

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
      if (this._simActive) this.applySimulation();
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
        if (this._simActive) this.applySimulation();
      });
      weatherBtns.push(wb);
      weatherRow.appendChild(wb);
    }
    syncWeather();
    inner.appendChild(weatherRow);

    activeCheck.addEventListener('change', () => {
      this._simActive = activeCheck.checked;
      if (this._simActive) {
        this.applySimulation();
      } else {
        this.env.removeWeatherParticles();
        this.env.weatherType = 'none';
        const hass = this.getHass();
        if (hass) {
          syncLights(this.getAnchors(), hass, this.getEffectiveConfig());
          this.updateOverlayStates();
          this.requestRender();
        }
      }
    });
  }

  private _timeToElevation(hour: number): number {
    // -60 at midnight, 0 at sunrise(6h)/sunset(18h), 60 at noon
    return 60 * Math.sin(Math.PI * (hour - 6) / 12);
  }

  applySimulation() {
    const elevation = this._timeToElevation(this._simHour);
    const azimuth = 180; // south at noon, simplified
    this.env.applySunLight(elevation, azimuth);

    // Apply weather
    this.env.removeWeatherParticles();
    this.env.weatherType = 'none';
    if (this._simWeather === 'cloudy') {
      this.env.hemiLight.intensity *= 0.5;
      this.env.sunLight.intensity *= 0.2;
      this.env.scene.fog?.color.setHex(0x8899aa);
    } else if (this._simWeather === 'rain') {
      this.env.applyWeather('rainy');
    } else if (this._simWeather === 'snow') {
      this.env.applyWeather('snowy');
    }
    this.requestRender();
  }

  step(dt: number) {
    if (this._simActive && this.env.weatherParticles) this.env.stepParticles(dt);
  }
}
