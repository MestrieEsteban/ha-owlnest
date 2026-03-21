import type { CardConfig } from './types';
type Hass = import('./types').Hass;

class Ha3dFloorplanEditor extends HTMLElement {
  private _config: CardConfig | null = null;
  private _rendered = false;

  set hass(_hass: Hass) {
    if (!this._rendered) this._render();
  }

  setConfig(config: CardConfig) {
    this._config = { ...config };
    if (!this._rendered) this._render();
  }

  // ── Config change dispatch ─────────────────────────────────────────────

  private _fire(config: CardConfig) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      bubbles: true, composed: true,
      detail: { config },
    }));
  }

  private _patch(patch: Partial<CardConfig>) {
    if (!this._config) return;
    this._config = { ...this._config, ...patch };
    this._fire(this._config);
  }

  // ── Render ────────────────────────────────────────────────────────────

  private _render() {
    if (!this._config) return;
    this._rendered = true;
    const c = this._config;

    this.innerHTML = '';
    this.style.display = 'block';

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      .owlnest-editor { padding: 4px 0; }
      .section { margin-bottom: 20px; }
      .section-title {
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--secondary-text-color, #888);
        margin-bottom: 10px; padding-bottom: 5px;
        border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
      }
      .row { display: flex; gap: 10px; margin-bottom: 10px; align-items: flex-end; }
      .row > * { flex: 1; min-width: 0; }
      .field label {
        display: block; font-size: 12px; margin-bottom: 3px;
        color: var(--secondary-text-color, #888);
      }
      .field input[type="text"], .field input[type="number"] {
        width: 100%; box-sizing: border-box;
        background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
        border: 1px solid var(--input-ink-color, var(--divider-color, rgba(0,0,0,0.2)));
        border-radius: 4px; padding: 7px 10px;
        font-size: 13px; color: var(--primary-text-color);
        outline: none; font-family: inherit; transition: border-color .15s;
      }
      .field input[type="text"]:focus, .field input[type="number"]:focus {
        border-color: var(--primary-color, #1a6bff);
      }
      .hint { font-size: 11px; color: var(--secondary-text-color, #888); margin-top: 3px; }
      .required { color: var(--error-color, #f44336); }
      .info-box {
        background: var(--secondary-background-color, #f5f5f5);
        border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        border-radius: 6px; padding: 10px 12px;
        font-size: 12px; color: var(--secondary-text-color, #888);
        line-height: 1.6;
      }
    `;
    this.appendChild(style);

    const root = document.createElement('div');
    root.className = 'owlnest-editor';
    this.appendChild(root);

    // ── Helpers ──────────────────────────────────────────────────────────

    const sec = (title: string): HTMLDivElement => {
      const s = document.createElement('div');
      s.className = 'section';
      const t = document.createElement('div');
      t.className = 'section-title';
      t.textContent = title;
      s.appendChild(t);
      root.appendChild(s);
      return s;
    };

    const row = (parent: HTMLElement): HTMLDivElement => {
      const r = document.createElement('div');
      r.className = 'row';
      parent.appendChild(r);
      return r;
    };

    const field = (parent: HTMLElement, label: string, input: HTMLElement, hint?: string): void => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.innerHTML = label;
      wrap.appendChild(lbl);
      wrap.appendChild(input);
      if (hint) {
        const h = document.createElement('div');
        h.className = 'hint';
        h.textContent = hint;
        wrap.appendChild(h);
      }
      parent.appendChild(wrap);
    };

    const textInput = (val: string | undefined, placeholder: string, onChange: (v: string) => void): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'text';
      el.value = val ?? '';
      el.placeholder = placeholder;
      el.addEventListener('change', () => onChange(el.value.trim()));
      return el;
    };

    const numInput = (val: number | undefined, placeholder: string, onChange: (v: number | undefined) => void): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'number';
      el.value = val !== undefined ? String(val) : '';
      el.placeholder = placeholder;
      el.addEventListener('change', () => {
        const v = el.value === '' ? undefined : parseFloat(el.value);
        if (el.value === '' || !isNaN(v!)) onChange(v);
      });
      return el;
    };

    // ── GÉNÉRAL ──────────────────────────────────────────────────────────

    const genSec = sec('General');

    field(
      row(genSec),
      '3D Model URL (.glb) <span class="required">*</span>',
      textInput(c.model_url, '/local/floorplan.glb', v => this._patch({ model_url: v })),
      'Relative path in config/www/ (e.g. /local/model.glb)',
    );

    field(
      row(genSec),
      'Height (px)',
      numInput(c.height, '75% of width', v => this._patch({ height: v })),
      'Leave empty for automatic',
    );

    // ── INFO ─────────────────────────────────────────────────────────────

    const infoSec = sec('Advanced settings');
    const infoBox = document.createElement('div');
    infoBox.className = 'info-box';
    infoBox.innerHTML = [
      'Other settings (lights, camera, rendering, weather, clustering…)',
      'can be configured directly in the <strong>3D edit panel</strong>',
      'by clicking the ✏️ icon on the card.',
      '<br><br>',
      'Active scene: <strong>' + (c.scene_id ? `<code>${c.scene_id}</code>` : '(none — set via the startup overlay)') + '</strong>',
    ].join(' ');
    infoSec.appendChild(infoBox);
  }
}

customElements.define('ha-3d-floorplan-editor', Ha3dFloorplanEditor);
