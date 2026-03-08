import type { Hass, CardConfig } from './types';

class Ha3dFloorplanEditor extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;
  private _rendered = false;

  set hass(hass: Hass) {
    this._hass = hass;
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
      .field input[type="color"] {
        width: 44px; height: 34px; padding: 2px 3px; cursor: pointer;
        border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
        border-radius: 4px; background: transparent;
      }
      .toggle-row {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 5px 0; font-size: 13px;
        color: var(--primary-text-color);
        cursor: pointer;
      }
      .toggle-row input[type="checkbox"] { cursor: pointer; width: 16px; height: 16px; }
      .ac-wrap { position: relative; }
      .ac-list {
        position: absolute; top: 100%; left: 0; right: 0; z-index: 9999;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
        border-top: none; border-radius: 0 0 4px 4px;
        max-height: 200px; overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.18);
      }
      .ac-item {
        padding: 6px 10px; font-size: 12px; cursor: pointer;
        color: var(--primary-text-color); line-height: 1.4;
        border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.06));
      }
      .ac-item:hover { background: var(--secondary-background-color, #f5f5f5); }
      .ac-sub { font-size: 10px; color: var(--secondary-text-color, #888); }
      .hint { font-size: 11px; color: var(--secondary-text-color, #888); margin-top: 3px; }
      .required { color: var(--error-color, #f44336); }
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

    const colorInput = (val: string | undefined, def: string, onChange: (v: string) => void): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'color';
      el.value = val ?? def;
      el.title = `Défaut : ${def}`;
      el.addEventListener('input', () => onChange(el.value));
      return el;
    };

    const toggle = (parent: HTMLElement, label: string, val: boolean, onChange: (v: boolean) => void): void => {
      const lbl = document.createElement('label');
      lbl.className = 'toggle-row';
      const span = document.createElement('span');
      span.textContent = label;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = val;
      cb.addEventListener('change', () => onChange(cb.checked));
      lbl.appendChild(span);
      lbl.appendChild(cb);
      parent.appendChild(lbl);
    };

    const entityInput = (val: string | undefined, placeholder: string, domainPrefix: string | null, onChange: (v: string) => void): HTMLDivElement => {
      const wrap = document.createElement('div');
      wrap.className = 'ac-wrap field';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = val ?? '';
      input.placeholder = placeholder;

      let list: HTMLDivElement | null = null;

      const showList = (q: string) => {
        list?.remove(); list = null;
        if (!this._hass || !q) return;
        const lq = q.toLowerCase();
        const matches = Object.entries(this._hass.states)
          .filter(([id]) => !domainPrefix || id.startsWith(domainPrefix + '.'))
          .filter(([id, s]) => {
            const fn = (s.attributes.friendly_name as string ?? '').toLowerCase();
            return id.includes(lq) || fn.includes(lq);
          })
          .slice(0, 12);
        if (!matches.length) return;
        list = document.createElement('div');
        list.className = 'ac-list';
        for (const [id, s] of matches) {
          const fn = s.attributes.friendly_name as string ?? '';
          const item = document.createElement('div');
          item.className = 'ac-item';
          item.innerHTML = `<span>${id}</span>${fn ? `<br><span class="ac-sub">${fn}</span>` : ''}`;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = id;
            list?.remove(); list = null;
            onChange(id);
          });
          list.appendChild(item);
        }
        wrap.appendChild(list);
      };

      input.addEventListener('input', () => showList(input.value));
      input.addEventListener('blur', () => setTimeout(() => { list?.remove(); list = null; }, 200));
      input.addEventListener('change', () => onChange(input.value.trim()));
      wrap.appendChild(input);
      return wrap;
    };

    // ── GÉNÉRAL ──────────────────────────────────────────────────────────

    const genSec = sec('Général');

    field(
      row(genSec),
      'URL du modèle 3D (.glb) <span class="required">*</span>',
      textInput(c.model_url, '/local/floorplan.glb', v => this._patch({ model_url: v })),
      'Chemin relatif dans config/www/',
    );

    const r2 = row(genSec);
    field(r2, 'Hauteur (px)', numInput(c.height, '75% largeur', v => this._patch({ height: v })));
    field(r2, 'Échelle lumières', numInput(c.intensity_scale, '1.0', v => this._patch({ intensity_scale: v })));
    field(r2, 'Seuil clusters (px)', numInput(c.cluster_threshold, 'désactivé', v => this._patch({ cluster_threshold: v })), 'Regroupe les ancres proches');

    toggle(genSec, 'Tap pour masquer / afficher les overlays', c.tap_to_toggle ?? false, v => this._patch({ tap_to_toggle: v }));

    // ── ENTITÉS ──────────────────────────────────────────────────────────

    const entSec = sec('Entités HA');

    const re1 = row(entSec);
    const sunWrap = entityInput(c.sun_entity, 'sun.sun', 'sun', v => this._patch({ sun_entity: v || undefined }));
    const sunLbl = document.createElement('label');
    sunLbl.textContent = 'Entité soleil';
    sunWrap.prepend(sunLbl);
    re1.appendChild(sunWrap);

    const re2 = row(entSec);
    const wthWrap = entityInput(c.weather_entity, 'weather.ma_ville', 'weather', v => this._patch({ weather_entity: v || undefined }));
    const wthLbl = document.createElement('label');
    wthLbl.textContent = 'Entité météo';
    wthWrap.prepend(wthLbl);
    re2.appendChild(wthWrap);

    // ── ORBITE ──────────────────────────────────────────────────────────

    const orbSec = sec('Caméra / Orbite');
    const orb = c.orbit ?? {};

    const ro1 = row(orbSec);
    field(ro1, 'Zoom min', numInput(orb.min_distance, '1', v => this._patch({ orbit: { ...orb, min_distance: v } })));
    field(ro1, 'Zoom max', numInput(orb.max_distance, '100', v => this._patch({ orbit: { ...orb, max_distance: v } })));
    field(ro1, 'Angle max (°)', numInput(orb.max_polar_angle, '86.4', v => this._patch({ orbit: { ...orb, max_polar_angle: v } })), 'Empêche de passer sous le sol');

    // ── LUMIÈRES ─────────────────────────────────────────────────────────

    const ltsSec = sec('Lumières des entités');
    const lc = c.lights ?? {};

    const rl1 = row(ltsSec);
    field(rl1, 'Portée (m)', numInput(lc.distance, '6', v => this._patch({ lights: { ...lc, distance: v } })));
    field(rl1, 'Decay', numInput(lc.decay, '2', v => this._patch({ lights: { ...lc, decay: v } })));
    field(rl1, 'Transition (s)', numInput(lc.transition, '0.5', v => this._patch({ lights: { ...lc, transition: v } })));

    // ── RENDU ────────────────────────────────────────────────────────────

    const rndSec = sec('Rendu');
    const rl = c.rendering ?? {};

    const rr1 = row(rndSec);
    field(rr1, 'Exposition', numInput(rl.exposure, '1.4', v => this._patch({ rendering: { ...rl, exposure: v } })));
    field(rr1, 'Intensité soleil', numInput(rl.sun_intensity, '0.8', v => this._patch({ rendering: { ...rl, sun_intensity: v } })));
    field(rr1, 'Ambiance', numInput(rl.ambient_intensity, '0.7', v => this._patch({ rendering: { ...rl, ambient_intensity: v } })));

    const rr2 = row(rndSec);
    field(rr2, 'Densité brouillard', numInput(rl.fog_density, '0.018', v => this._patch({ rendering: { ...rl, fog_density: v } })));
    field(rr2, 'Élévation soleil défaut (°)', numInput(rl.sky_elevation, '60', v => this._patch({ rendering: { ...rl, sky_elevation: v } })));

    toggle(rndSec, 'Ciel procédural (Rayleigh)', rl.sky !== false, v => this._patch({ rendering: { ...rl, sky: v } }));
    toggle(rndSec, 'Ombres douces', rl.shadows !== false, v => this._patch({ rendering: { ...rl, shadows: v } }));

    const rr3 = row(rndSec);
    field(rr3, 'Couleur sol', colorInput(rl.ground_color, '#4a6741', v => this._patch({ rendering: { ...rl, ground_color: v } })));
    field(rr3, 'Fond (sky:false)', colorInput(rl.background_color, '#0d1117', v => this._patch({ rendering: { ...rl, background_color: v } })));
  }
}

customElements.define('ha-3d-floorplan-editor', Ha3dFloorplanEditor);
