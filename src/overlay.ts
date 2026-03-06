import * as THREE from 'three';
import type { EntityDomain } from './types';

const ICONS: Record<string, string> = {
  light: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-1 17h2v1h-2v-1z"/></svg>`,
  switch: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="10" rx="5" ry="5"/><circle cx="17" cy="12" r="3" fill="currentColor" style="fill:#0d1117"/></svg>`,
  cover: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v2H3V3zm0 4h18v2l-9 6-9-6V7zm0 10h18v2H3v-2z"/></svg>`,
  climate: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a4 4 0 0 0-4 4v7.27A6 6 0 1 0 16 13.27V6a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v1h-4V6a2 2 0 0 1 2-2zm0 16a4 4 0 0 1-2.45-7.18L11 12V9h2v3l1.45.82A4 4 0 0 1 12 20z"/></svg>`,
  media_player: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm-2 13V8l7 4-7 4z"/></svg>`,
  sensor: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M3 3v18h18V3H3zm16 16H5V5h14v14zM7 17l3-4 2 2.5 3-4 3 5.5H7z"/></svg>`,
  binary_sensor: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="7"/></svg>`,
  default: `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
};

function getIcon(domain: EntityDomain): string {
  return ICONS[domain] ?? ICONS.default;
}

export class AnchorOverlay {
  readonly el: HTMLDivElement;
  private _label: HTMLDivElement;
  private _pressTimer: ReturnType<typeof setTimeout> | null = null;
  private _pressing = false;

  constructor(
    container: HTMLElement,
    domain: EntityDomain,
    labelText: string,
    onShortClick: () => void,
    onLongPress: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      'width:38px',
      'height:38px',
      'border-radius:50%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'z-index:5',
      'background:rgba(15,15,25,0.65)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'border:1.5px solid rgba(255,255,255,0.12)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
      'transition:transform .15s ease, box-shadow .3s ease, border-color .3s ease',
      'user-select:none',
      '-webkit-user-select:none',
      'pointer-events:auto',
    ].join(';');

    this.el.innerHTML = getIcon(domain);

    // Tooltip label
    this._label = document.createElement('div');
    this._label.textContent = labelText;
    this._label.style.cssText = [
      'position:absolute',
      'bottom:calc(100% + 8px)',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.82)',
      'color:#fff',
      'font-size:11px',
      'font-family:var(--primary-font-family,sans-serif)',
      'padding:3px 8px',
      'border-radius:4px',
      'white-space:nowrap',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .15s',
    ].join(';');
    this.el.appendChild(this._label);

    container.appendChild(this.el);

    // Hover
    this.el.addEventListener('mouseenter', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1.2)';
      this._label.style.opacity = '1';
    });
    this.el.addEventListener('mouseleave', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1)';
      this._label.style.opacity = '0';
      this._cancel();
    });

    // Press detection — stops propagation so OrbitControls doesn't interfere
    this.el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this._startPress(onShortClick, onLongPress);
    });
    this.el.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      this._endPress(onShortClick);
    });
    this.el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      this._startPress(onShortClick, onLongPress);
    }, { passive: true });
    this.el.addEventListener('touchend', (e) => {
      e.stopPropagation();
      this._endPress(onShortClick);
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private _startPress(_onShortClick: () => void, onLongPress: () => void) {
    this._pressing = true;
    this._pressTimer = setTimeout(() => {
      if (!this._pressing) return;
      this._pressing = false;
      this.el.style.transform = 'translate(-50%,-50%) scale(1)';
      onLongPress();
    }, 500);
  }

  private _endPress(onShortClick: () => void) {
    if (!this._pressing) return;
    this._pressing = false;
    clearTimeout(this._pressTimer!);
    this._pressTimer = null;
    onShortClick();
  }

  private _cancel() {
    this._pressing = false;
    if (this._pressTimer) { clearTimeout(this._pressTimer); this._pressTimer = null; }
  }

  updatePosition(worldPos: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    const p = worldPos.clone().project(camera);
    if (p.z >= 1) { this.el.style.display = 'none'; return; }
    this.el.style.display = 'flex';
    this.el.style.left = `${((p.x + 1) / 2) * w}px`;
    this.el.style.top = `${((-p.y + 1) / 2) * h}px`;
  }

  updateState(on: boolean, color: THREE.Color, labelText: string) {
    const path = this.el.querySelector('path,circle,rect') as SVGElement | null;
    if (on) {
      const hex = `#${color.getHexString()}`;
      if (path) path.style.fill = hex;
      this.el.style.boxShadow = `0 0 14px 3px ${hex}99, 0 2px 8px rgba(0,0,0,0.5)`;
      this.el.style.borderColor = `${hex}55`;
    } else {
      if (path) path.style.fill = '#555';
      this.el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
      this.el.style.borderColor = 'rgba(255,255,255,0.12)';
    }
    this._label.textContent = labelText;
  }

  destroy() {
    this.el.remove();
  }
}

// ── Sensor overlay — read-only value badge ─────────────────────────────────

export class SensorOverlay {
  readonly el: HTMLDivElement;

  constructor(container: HTMLElement, onClick: () => void) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      'padding:4px 10px',
      'border-radius:12px',
      'background:rgba(15,15,25,0.72)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'border:1px solid rgba(0,204,136,0.3)',
      'color:#00cc88',
      'font-size:12px',
      'font-weight:600',
      'font-family:var(--primary-font-family,sans-serif)',
      'white-space:nowrap',
      'pointer-events:auto',
      'cursor:pointer',
      'z-index:5',
      'transition:transform .15s ease, box-shadow .3s ease',
      'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
    ].join(';');

    this.el.addEventListener('mouseenter', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1.08)';
    });
    this.el.addEventListener('mouseleave', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    this.el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    this.el.addEventListener('touchend', (e) => { e.stopPropagation(); onClick(); });

    container.appendChild(this.el);
  }

  updateValue(value: string, unit: string, label: string) {
    this.el.textContent = `${value}${unit}`;
    this.el.title = label;
  }

  updatePosition(worldPos: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    const p = worldPos.clone().project(camera);
    if (p.z >= 1) { this.el.style.display = 'none'; return; }
    this.el.style.display = 'block';
    this.el.style.left = `${((p.x + 1) / 2) * w}px`;
    this.el.style.top = `${((-p.y + 1) / 2) * h}px`;
  }

  destroy() {
    this.el.remove();
  }
}
