import * as THREE from 'three';

const BULB_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-1 17h2v1h-2v-1z"/>
</svg>`;

export class AnchorOverlay {
  readonly el: HTMLDivElement;
  private _label: HTMLDivElement;
  private _pressTimer: ReturnType<typeof setTimeout> | null = null;
  private _pressing = false;

  constructor(
    container: HTMLElement,
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

    this.el.innerHTML = BULB_SVG;

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

  private _startPress(onShortClick: () => void, onLongPress: () => void) {
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
    const path = this.el.querySelector('path') as SVGPathElement | null;
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
