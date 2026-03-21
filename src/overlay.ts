import * as THREE from 'three';
import type { EntityDomain } from './types';

export interface ClusterItem {
  domain: EntityDomain;
  label: string;
  on: boolean;
  color: THREE.Color;
  onShortClick: () => void;
  onLongPress: () => void;
}

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

/** Render an icon element: ha-icon web component when an MDI string is given, SVG otherwise. */
function renderIconHTML(domain: EntityDomain, icon?: string): string {
  if (icon) {
    // ha-icon is registered by the HA frontend; it handles mdi:xxx, hass:xxx, etc.
    return `<ha-icon icon="${icon}" style="--mdi-icon-size:18px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;pointer-events:none;"></ha-icon>`;
  }
  return getIcon(domain);
}

export class AnchorOverlay {
  readonly el: HTMLDivElement;
  conditionHidden = false;
  private _label: HTMLDivElement;
  private _pressTimer: ReturnType<typeof setTimeout> | null = null;
  private _pressing = false;

  constructor(
    container: HTMLElement,
    domain: EntityDomain,
    labelText: string,
    onShortClick: () => void,
    onLongPress: () => void,
    icon?: string,
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

    this.el.innerHTML = renderIconHTML(domain, icon);

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
      e.preventDefault(); // prevent synthetic mousedown/mouseup that would re-trigger _endPress
      this._endPress(onShortClick);
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private _pressRing: SVGSVGElement | null = null;

  private _startPress(_onShortClick: () => void, onLongPress: () => void) {
    this._pressing = true;
    const LONG_PRESS_MS = 650;
    const RING_DELAY_MS = 200;   // ring only visible after 200 ms — normal taps stay clean
    const RING_ANIM_MS  = LONG_PRESS_MS - RING_DELAY_MS; // ~450 ms to fill

    this._pressTimer = setTimeout(() => {
      if (!this._pressing) return;
      this._pressing = false;
      this.el.style.transform = 'translate(-50%,-50%) scale(1)';
      this._pressRing?.remove();
      this._pressRing = null;
      onLongPress();
    }, LONG_PRESS_MS);

    // Show ring only after RING_DELAY_MS so quick taps never see it
    setTimeout(() => {
      if (!this._pressing) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
      this._pressRing = svg;
      svg.setAttribute('viewBox', '0 0 36 36');
      svg.setAttribute('width', '42');
      svg.setAttribute('height', '42');
      (svg as unknown as HTMLElement).style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:1;';
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '18'); circle.setAttribute('cy', '18');
      circle.setAttribute('r', '16'); circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'rgba(255,255,255,0.7)');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('stroke-dasharray', '100.5');
      circle.setAttribute('stroke-dashoffset', '100.5');
      circle.setAttribute('stroke-linecap', 'round');
      circle.style.cssText = `transform-origin:18px 18px;transform:rotate(-90deg);transition:stroke-dashoffset ${RING_ANIM_MS}ms linear;`;
      svg.appendChild(circle);
      this.el.appendChild(svg);
      requestAnimationFrame(() => { circle.setAttribute('stroke-dashoffset', '0'); });
    }, RING_DELAY_MS);
  }

  private _endPress(onShortClick: () => void) {
    if (!this._pressing) return;
    this._pressing = false;
    clearTimeout(this._pressTimer!);
    this._pressTimer = null;
    if (this._pressRing) { this._pressRing.remove(); this._pressRing = null; }
    onShortClick();
  }

  private _cancel() {
    this._pressing = false;
    if (this._pressTimer) { clearTimeout(this._pressTimer); this._pressTimer = null; }
    if (this._pressRing) { this._pressRing.remove(); this._pressRing = null; }
  }

  updatePosition(worldPos: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    const p = worldPos.clone().project(camera);
    if (p.z >= 1 || this.conditionHidden) { this.el.style.display = 'none'; return; }
    this.el.style.display = 'flex';
    this.el.style.left = `${((p.x + 1) / 2) * w}px`;
    this.el.style.top = `${((-p.y + 1) / 2) * h}px`;
  }

  updateState(on: boolean, color: THREE.Color, labelText: string) {
    const haIcon = this.el.querySelector('ha-icon') as HTMLElement | null;
    const path = !haIcon ? (this.el.querySelector('path,circle,rect') as SVGElement | null) : null;
    if (on) {
      const hex = `#${color.getHexString()}`;
      if (haIcon) haIcon.style.color = hex;
      else if (path) path.style.fill = hex;
      this.el.style.boxShadow = `0 0 14px 3px ${hex}99, 0 2px 8px rgba(0,0,0,0.5)`;
      this.el.style.borderColor = `${hex}55`;
    } else {
      if (haIcon) haIcon.style.color = '#555';
      else if (path) path.style.fill = '#555';
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
  conditionHidden = false;

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
    if (p.z >= 1 || this.conditionHidden) { this.el.style.display = 'none'; return; }
    this.el.style.display = 'block';
    this.el.style.left = `${((p.x + 1) / 2) * w}px`;
    this.el.style.top = `${((-p.y + 1) / 2) * h}px`;
  }

  destroy() {
    this.el.remove();
  }
}

// ── Cluster overlay — groups nearby anchors into a radial menu ──────────────

const CLUSTER_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/>
  <circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/>
</svg>`;

export class ClusterOverlay {
  readonly el: HTMLDivElement;
  private _badge: HTMLSpanElement;
  private _menu: HTMLDivElement | null = null;
  private _backdrop: HTMLDivElement | null = null;
  private _items: ClusterItem[] = [];
  private _container: HTMLElement;

  constructor(container: HTMLElement) {
    this._container = container;

    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      'width:42px', 'height:42px',
      'border-radius:50%',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer', 'z-index:5',
      'background:rgba(15,15,25,0.75)',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'border:1.5px solid rgba(255,255,255,0.18)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
      'transition:transform .15s ease, box-shadow .3s ease',
      'user-select:none', '-webkit-user-select:none', 'pointer-events:auto',
      'color:#fff',
    ].join(';');

    this.el.innerHTML = CLUSTER_ICON;

    this._badge = document.createElement('span');
    this._badge.style.cssText = [
      'position:absolute', 'top:-4px', 'right:-4px',
      'background:#1a6bff', 'color:#fff',
      'font-size:10px', 'font-weight:700',
      'font-family:var(--primary-font-family,sans-serif)',
      'width:16px', 'height:16px', 'border-radius:50%',
      'display:flex', 'align-items:center', 'justify-content:center',
      'pointer-events:none',
    ].join(';');
    this.el.appendChild(this._badge);

    this.el.addEventListener('mouseenter', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1.15)';
    });
    this.el.addEventListener('mouseleave', () => {
      if (!this._menu) this.el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.el.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMenu(); });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    container.appendChild(this.el);
  }

  update(items: ClusterItem[]) {
    this._items = items;
    this._badge.textContent = String(items.length);

    const onItems = items.filter(i => i.on);
    if (onItems.length > 0) {
      const hex = `#${onItems[0].color.getHexString()}`;
      this.el.style.boxShadow = `0 0 14px 3px ${hex}88, 0 2px 8px rgba(0,0,0,0.5)`;
      this.el.style.borderColor = `${hex}44`;
    } else {
      this.el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
      this.el.style.borderColor = 'rgba(255,255,255,0.18)';
    }

    if (this._menu) this._rebuildMenu();
  }

  updatePosition(x: number, y: number) {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  show() { this.el.style.display = 'flex'; }

  hide() {
    this.el.style.display = 'none';
    this._closeMenu();
  }

  destroy() {
    this._closeMenu();
    this.el.remove();
  }

  private _toggleMenu() {
    this._menu ? this._closeMenu() : this._openMenu();
  }

  private _openMenu() {
    this.el.style.transform = 'translate(-50%,-50%) scale(1.1)';

    // Backdrop — closes menu when clicking elsewhere.
    // Delayed by one tick so the opening click doesn't immediately close it.
    this._backdrop = document.createElement('div');
    this._backdrop.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:auto;';
    setTimeout(() => {
      this._backdrop?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._closeMenu();
      });
    }, 0);
    this._container.appendChild(this._backdrop);

    this._rebuildMenu();
  }

  private _closeMenu() {
    this.el.style.transform = 'translate(-50%,-50%) scale(1)';
    this._menu?.remove();
    this._menu = null;
    this._backdrop?.remove();
    this._backdrop = null;
  }

  private _rebuildMenu() {
    this._menu?.remove();

    const menu = document.createElement('div');
    menu.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;';

    const n = this._items.length;
    const radius = n <= 3 ? 68 : 80;

    this._items.forEach((item, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      const ox = Math.cos(angle) * radius;
      const oy = Math.sin(angle) * radius;
      menu.appendChild(this._makeMenuItem(item, ox, oy, i));
    });

    this.el.appendChild(menu);
    this._menu = menu;
  }

  private _makeMenuItem(item: ClusterItem, ox: number, oy: number, idx: number): HTMLDivElement {
    const color = item.on ? `#${item.color.getHexString()}` : '#666';
    const base = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;

    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%) scale(0)',
      'opacity:0',
      'transition:transform 0.18s ease, opacity 0.18s ease, box-shadow 0.3s ease',
      'width:38px', 'height:38px', 'border-radius:50%',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer', 'pointer-events:auto',
      'background:rgba(15,15,25,0.88)',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      `border:1.5px solid ${item.on ? color + '55' : 'rgba(255,255,255,0.12)'}`,
      `box-shadow:${item.on ? `0 0 12px 2px ${color}77,` : ''} 0 2px 8px rgba(0,0,0,0.5)`,
      'user-select:none', '-webkit-user-select:none',
    ].join(';');

    el.innerHTML = getIcon(item.domain);
    const path = el.querySelector('path,circle,rect') as SVGElement | null;
    if (path) path.style.fill = color;

    const label = document.createElement('div');
    label.textContent = item.label;
    label.style.cssText = [
      'position:absolute', 'bottom:calc(100% + 6px)', 'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.85)', 'color:#fff',
      'font-size:10px', 'font-family:var(--primary-font-family,sans-serif)',
      'padding:2px 6px', 'border-radius:4px',
      'white-space:nowrap', 'pointer-events:none',
      'opacity:0', 'transition:opacity .15s',
    ].join(';');
    el.appendChild(label);

    el.addEventListener('mouseenter', () => {
      el.style.transform = `${base} scale(1.2)`;
      label.style.opacity = '1';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = `${base} scale(1)`;
      label.style.opacity = '0';
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      item.onShortClick();
      this._closeMenu();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      item.onLongPress();
      this._closeMenu();
    });

    setTimeout(() => {
      el.style.transform = `${base} scale(1)`;
      el.style.opacity = '1';
    }, idx * 35);

    return el;
  }
}
