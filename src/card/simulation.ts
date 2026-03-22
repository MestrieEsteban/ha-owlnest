import { syncLights } from '../lights';
import type { Hass, AnchorEntry, CardConfig } from '../types';
import { EnvironmentController } from './environment';
import type { WeatherEffect } from './environment';
import { t } from '../i18n';

export class SimulationPanel {
  private _simActive = false;
  private _simHour = 12;
  private _simWeather: 'clear' | 'cloudy' | 'rain' | 'storm' | 'hail' | 'snow' | 'fog' | 'wind' = 'clear';
  private _simOpen = false;

  constructor(
    private simExpand: HTMLDivElement | null,
    private simBtn: HTMLButtonElement | null,
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
    if (!this.simExpand) return;
    this._simOpen = !this._simOpen;
    if (this._simOpen) {
      this.simExpand.style.maxHeight = '200px';
      this.simExpand.style.opacity = '1';
      this.simExpand.style.pointerEvents = 'auto';
    } else {
      this.simExpand.style.maxHeight = '0';
      this.simExpand.style.opacity = '0';
      this.simExpand.style.pointerEvents = 'none';
    }
    this._syncSimBtn();
  }

  private _syncSimBtn() {
    if (!this.simBtn) return;
    if (this._simOpen) {
      this.simBtn.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.85)';
      this.simBtn.style.background = 'rgba(245,158,11,0.22)';
    } else if (this._simActive) {
      this.simBtn.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.5)';
      this.simBtn.style.background = 'rgba(245,158,11,0.12)';
    } else {
      this.simBtn.style.boxShadow = 'none';
      this.simBtn.style.background = '';
    }
  }

  /** Build simulation UI into the HUD pop-up (with glassmorphism shell). */
  buildContent() {
    if (!this.simExpand) return;
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
    this._buildInner(inner);
  }

  /** Build simulation UI directly into an arbitrary container (no shell). */
  buildContentInto(container: HTMLElement) {
    container.innerHTML = '';
    this._buildInner(container);
  }

  private _buildInner(inner: HTMLElement) {

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
    timeLabel.appendChild(document.createTextNode(`${t('cfgSimHour')}\u00a0: `));
    timeLabel.appendChild(timeValue);
    row1.appendChild(timeLabel);

    const activeToggle = document.createElement('label');
    activeToggle.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#888;cursor:pointer;';
    const activeCheck = document.createElement('input');
    activeCheck.type = 'checkbox';
    activeCheck.checked = this._simActive;
    activeCheck.style.cursor = 'pointer';
    activeToggle.appendChild(activeCheck);
    activeToggle.appendChild(document.createTextNode(t('cfgSimActive')));
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

    // Weather presets — 2 rows of 4
    type SimWeather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'hail' | 'snow' | 'fog' | 'wind';
    const presets: { emoji: string; label: string; value: SimWeather }[] = [
      { emoji: '☀️', label: 'Soleil',      value: 'clear'  },
      { emoji: '⛅', label: 'Nuageux',     value: 'cloudy' },
      { emoji: '🌧️', label: 'Pluie',       value: 'rain'   },
      { emoji: '⛈️', label: 'Orage',       value: 'storm'  },
      { emoji: '🌨️', label: 'Grêle',       value: 'hail'   },
      { emoji: '❄️', label: 'Neige',       value: 'snow'   },
      { emoji: '🌫️', label: 'Brouillard',  value: 'fog'    },
      { emoji: '💨', label: 'Vent',         value: 'wind'   },
    ];
    const weatherBtns: HTMLButtonElement[] = [];
    const syncWeather = () => {
      weatherBtns.forEach((b, i) => {
        const on = presets[i].value === this._simWeather;
        b.style.background = on ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)';
        b.style.boxShadow  = on ? '0 0 0 1.5px rgba(245,158,11,0.7)' : 'none';
      });
    };
    const weatherGrid = document.createElement('div');
    weatherGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;';
    for (const p of presets) {
      const wb = document.createElement('button');
      wb.title = p.label; wb.textContent = p.emoji;
      wb.style.cssText = [
        'border:none', 'border-radius:8px',
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
      weatherGrid.appendChild(wb);
    }
    syncWeather();
    inner.appendChild(weatherGrid);

    activeCheck.addEventListener('change', () => {
      this._simActive = activeCheck.checked;
      this._syncSimBtn();
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
    // Simulate a realistic azimuth trajectory: east (90°) at sunrise → south (180°) at noon → west (270°) at sunset
    const cfg = this.getEffectiveConfig();
    const sunMode = cfg?.rendering?.sun_mode ?? 'showcase';
    let azimuth = 180;
    if (sunMode === 'realistic') {
      // Map hour to azimuth: 6h→90°(E), 12h→180°(S), 18h→270°(W)
      azimuth = 90 + ((this._simHour - 6) / 12) * 180;
      azimuth = Math.max(0, Math.min(360, azimuth));
    }
    this.env.applySunLight(elevation, azimuth);

    // Apply weather — map sim presets to HA weather states
    this.env.removeWeatherParticles();
    this.env.weatherType = 'none';
    const haState: Record<typeof this._simWeather, string> = {
      clear:  '',
      cloudy: 'cloudy',
      rain:   'rainy',
      storm:  'lightning-rainy',
      hail:   'hail',
      snow:   'snowy',
      fog:    'fog',
      wind:   'windy',
    };
    const state = haState[this._simWeather];
    if (state) this.env.applyWeather(state);
    this.requestRender();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  step(_dt: number) {
    // Weather particle stepping handled by main loop (environment always animated)
  }
}
