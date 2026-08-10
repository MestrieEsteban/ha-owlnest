import * as THREE from 'three';
import type { EntityDomain } from './types';

export interface ClusterItem {
  domain: EntityDomain;
  label: string;
  on: boolean;
  color: THREE.Color;
  /** Icône MDI refletant l'état, issue du descripteur d'entité. */
  icon?: string;
  onShortClick: () => void;
  onLongPress: () => void;
  /**
   * Valeur a afficher a la place de l'icone (capteurs). Une temperature se lit,
   * elle ne se symbolise pas.
   */
  value?: string;
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
  /** Conteneur de l'icône, séparé du libellé pour pouvoir la remplacer seule. */
  private _iconEl: HTMLSpanElement;
  private _iconKey = '';
  /** Icône imposée par l'utilisateur — prioritaire sur celle de l'état. */
  private _iconOverride?: string;
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

    this._iconOverride = icon;
    this._iconEl = document.createElement('span');
    this._iconEl.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;';
    this._iconKey = icon ?? `domain:${domain}`;
    this._iconEl.innerHTML = renderIconHTML(domain, icon);
    this.el.appendChild(this._iconEl);

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

  /**
   * Remplace l'icône si l'état l'exige (porte ouverte ↔ fermée).
   * Une icône choisie explicitement par l'utilisateur reste prioritaire.
   */
  setStateIcon(mdi: string | undefined, domain: EntityDomain) {
    if (this._iconOverride) return;
    const key = mdi ?? `domain:${domain}`;
    if (key === this._iconKey) return; // évite de reconstruire le DOM à chaque frame
    this._iconKey = key;
    this._iconEl.innerHTML = renderIconHTML(domain, mdi);
  }

  updateState(on: boolean, color: THREE.Color, labelText: string) {
    const haIcon = this._iconEl.querySelector('ha-icon') as HTMLElement | null;
    const path = !haIcon ? (this._iconEl.querySelector('path,circle,rect') as SVGElement | null) : null;
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

/**
 * Options d'un ClusterOverlay. Sans elles, il se comporte comme un regroupement
 * automatique ; avec, il sert de roue d'actions pour une ancre `menu`.
 */
export interface ClusterOptions {
  /** Icone MDI du bouton central (defaut : l'icone de regroupement). */
  icon?: string;
  /** Libelle au survol du bouton central. */
  title?: string;
}

export class ClusterOverlay {
  /**
   * Masquage par condition (`visibleIf`). Inutile pour un regroupement
   * automatique, mais une ancre `menu` s'appuie dessus comme les autres.
   */
  conditionHidden = false;
  readonly el: HTMLDivElement;
  private _badge: HTMLSpanElement;
  private _menu: HTMLDivElement | null = null;
  private _backdrop: HTMLDivElement | null = null;
  private _items: ClusterItem[] = [];
  private _container: HTMLElement;

  constructor(container: HTMLElement, opts: ClusterOptions = {}) {
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

    this.el.innerHTML = opts.icon ? renderIconHTML('', opts.icon) : CLUSTER_ICON;
    if (opts.title) this.el.title = opts.title;

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

    if (item.value !== undefined) {
      const val = document.createElement('span');
      val.textContent = item.value;
      val.style.cssText = [
        'font-size:11px', 'font-weight:700', 'line-height:1',
        'font-family:var(--primary-font-family,sans-serif)',
        `color:${color}`, 'pointer-events:none', 'text-align:center',
        'padding:0 2px', 'white-space:nowrap',
      ].join(';');
      el.appendChild(val);
    } else {
      el.innerHTML = renderIconHTML(item.domain, item.icon);
      const haIcon = el.querySelector('ha-icon') as HTMLElement | null;
      if (haIcon) haIcon.style.color = color;
      const path = !haIcon ? (el.querySelector('path,circle,rect') as SVGElement | null) : null;
      if (path) path.style.fill = color;
    }

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

// ── Étiquette — texte ancré dans l'espace, sans entité ──────────────────────

/**
 * Nature `label` : annote un lieu (« Garage », « Chaufferie ») sans être liée à
 * une entité. C'est ce que faisait la carte 3D `info`, mais en DOM — donc du
 * texte net à toute distance, sans texture à téléverser.
 */
export class LabelOverlay {
  readonly el: HTMLDivElement;
  conditionHidden = false;
  private _text: HTMLSpanElement;

  constructor(container: HTMLElement, text: string, icon?: string, color?: string) {
    const tint = color || 'rgba(255,255,255,0.82)';

    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      'display:flex', 'align-items:center', 'gap:5px',
      'padding:3px 9px', 'border-radius:11px',
      'background:rgba(12,16,28,0.62)',
      'backdrop-filter:blur(5px)', '-webkit-backdrop-filter:blur(5px)',
      'border:1px solid rgba(255,255,255,0.09)',
      `color:${tint}`,
      'font-size:11px', 'font-weight:600', 'letter-spacing:.02em',
      'font-family:var(--primary-font-family,sans-serif)',
      'white-space:nowrap',
      // Purement informative : ne capte pas le pointeur, pour ne pas gêner
      // l'orbite ni masquer une ancre interactive placée derrière.
      'pointer-events:none',
      'user-select:none', '-webkit-user-select:none',
    ].join(';');

    if (icon) {
      const ic = document.createElement('span');
      ic.style.cssText = 'display:flex;align-items:center;';
      ic.innerHTML = renderIconHTML('', icon);
      this.el.appendChild(ic);
    }

    this._text = document.createElement('span');
    this._text.textContent = text;
    this.el.appendChild(this._text);

    container.appendChild(this.el);
  }

  updateText(text: string) {
    if (this._text.textContent !== text) this._text.textContent = text;
  }

  destroy() {
    this.el.remove();
  }
}

// ── Vignette de caméra ──────────────────────────────────────────────────────

/**
 * Affiche l'image d'une caméra à son emplacement dans la scène.
 *
 * L'URL vient de `attributes.entity_picture`, que HA fournit déjà signée par un
 * token : une balise <img> suffit, sans en-tête d'authentification. Le token est
 * renouvelé par HA, donc l'URL change au fil des mises à jour d'état.
 *
 * Toutes les caméras ne répondent pas : une caméra à l'arrêt renvoie une erreur
 * HTTP. On retombe alors sur un cadre discret plutôt qu'une image cassée.
 */
export class CameraOverlay {
  readonly el: HTMLDivElement;
  conditionHidden = false;

  private _img: HTMLImageElement;
  private _placeholder: HTMLDivElement;
  private _label: HTMLDivElement;
  private _dot: HTMLSpanElement;
  /** Dernière URL demandée, token exclu — évite de recharger pour rien. */
  private _lastPath = '';
  private _failed = false;
  private _widthPx = 132;

  constructor(
    container: HTMLElement,
    labelText: string,
    onClick: () => void,
    unavailableText: string,
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      // La taille est recalculee a chaque image par setPixelWidth().
      'width:132px', 'height:74px',
      'border-radius:8px', 'overflow:hidden',
      'background:rgba(10,14,24,0.85)',
      'border:1.5px solid rgba(255,255,255,0.14)',
      'box-shadow:0 3px 12px rgba(0,0,0,0.6)',
      'cursor:pointer', 'z-index:5',
      'display:flex', 'align-items:center', 'justify-content:center',
      'pointer-events:auto',
      'user-select:none', '-webkit-user-select:none',
      'transition:transform .15s ease, box-shadow .3s ease',
    ].join(';');

    this._img = document.createElement('img');
    this._img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;pointer-events:none;';
    this._img.addEventListener('load', () => {
      this._failed = false;
      this._img.style.display = 'block';
      this._placeholder.style.display = 'none';
    });
    this._img.addEventListener('error', () => {
      this._failed = true;
      this._img.style.display = 'none';
      this._placeholder.style.display = 'flex';
    });
    this.el.appendChild(this._img);

    this._placeholder = document.createElement('div');
    this._placeholder.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center', 'gap:2px',
      'color:rgba(255,255,255,0.34)', 'font-size:8px',
      'font-family:var(--primary-font-family,sans-serif)',
      'pointer-events:none', 'text-align:center', 'padding:0 4px',
    ].join(';');
    this._placeholder.innerHTML =
      renderIconHTML('', 'mdi:cctv') + `<span>${unavailableText}</span>`;
    this.el.appendChild(this._placeholder);

    // Bandeau bas : nom et point d'état.
    this._label = document.createElement('div');
    this._label.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'bottom:0',
      'padding:2px 5px',
      'background:linear-gradient(transparent,rgba(0,0,0,0.78))',
      'color:#fff', 'font-size:8px', 'font-weight:600',
      'font-family:var(--primary-font-family,sans-serif)',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      'pointer-events:none',
      'display:flex', 'align-items:center', 'gap:3px',
    ].join(';');
    this._dot = document.createElement('span');
    this._dot.style.cssText = 'width:5px;height:5px;border-radius:50%;background:#555;flex:0 0 auto;';
    const name = document.createElement('span');
    name.textContent = labelText;
    name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
    this._label.append(this._dot, name);
    this.el.appendChild(this._label);

    this.el.addEventListener('mouseenter', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1.08)';
    });
    this.el.addEventListener('mouseleave', () => {
      this.el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    // Comme les autres overlays : on empêche OrbitControls de consommer le geste.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });

    container.appendChild(this.el);
  }

  /** Rapport hauteur/largeur des vignettes. */
  static readonly ASPECT = 9 / 16;

  /**
   * Largeur en pixels, calculee par le composant a partir de la distance : une
   * camera doit grossir quand on s'en approche, comme un ecran accroche au mur.
   * Le libelle suit, sinon il devient illisible sur une petite vignette.
   */
  setPixelWidth(px: number) {
    if (Math.abs(px - this._widthPx) < 0.5) return;
    this._widthPx = px;
    this.el.style.width = `${Math.round(px)}px`;
    this.el.style.height = `${Math.round(px * CameraOverlay.ASPECT)}px`;
    // Sous 90 px le bandeau mange l'image sans etre lisible : on le retire.
    const compact = px < 90;
    this._label.style.display = compact ? 'none' : 'flex';
    this._label.style.fontSize = `${Math.max(8, Math.min(12, px * 0.075))}px`;
    this.el.style.borderRadius = `${Math.max(5, Math.min(12, px * 0.07))}px`;
  }

  /** Nom et point d'état (vert quand la caméra diffuse). */
  updateState(active: boolean, labelText: string) {
    this._dot.style.background = active ? '#4ade80' : '#555';
    const name = this._label.lastElementChild;
    if (name && name.textContent !== labelText) name.textContent = labelText;
  }

  /**
   * Demande l'image. `entity_picture` porte un token qui change : on ne recharge
   * que si le chemin a change, ou si `force` le demande (rafraichissement
   * periodique).
   */
  setPicture(entityPicture: string | undefined, force = false) {
    if (!entityPicture) {
      this._img.style.display = 'none';
      this._placeholder.style.display = 'flex';
      return;
    }
    const path = entityPicture.split('?')[0];
    if (!force && path === this._lastPath && !this._failed) return;
    this._lastPath = path;
    // Le navigateur mettrait l'URL en cache : un marqueur temporel force la
    // recuperation d'une image fraiche.
    const sep = entityPicture.includes('?') ? '&' : '?';
    this._img.src = `${entityPicture}${sep}_owl=${Date.now()}`;
  }

  destroy() {
    // Coupe un telechargement en cours avant de detacher l'element.
    this._img.src = '';
    this.el.remove();
  }
}

// ── Mise en évidence ────────────────────────────────────────────────────────

let _pulseStyleInjected = false;

/**
 * Fait pulser un overlay pour attirer l'œil.
 *
 * Déplacer la caméra dit « regarde par là » ; ceci dit « regarde ça ». Générique
 * pour s'appliquer à une pastille comme à une vignette de caméra.
 */
export function pulseOverlay(el: HTMLElement, color = '#ef4444', durationMs = 6000): void {
  if (!_pulseStyleInjected) {
    const style = document.createElement('style');
    style.textContent = `@keyframes owlnest-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--owl-pulse), 0 2px 8px rgba(0,0,0,0.5); }
      50%      { box-shadow: 0 0 18px 7px var(--owl-pulse), 0 2px 8px rgba(0,0,0,0.5); }
    }`;
    document.head.appendChild(style);
    _pulseStyleInjected = true;
  }

  el.style.setProperty('--owl-pulse', color);
  // Redémarre l'animation même si elle tourne déjà.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'owlnest-pulse 1.1s ease-in-out infinite';

  window.setTimeout(() => {
    el.style.animation = '';
    el.style.removeProperty('--owl-pulse');
  }, durationMs);
}
