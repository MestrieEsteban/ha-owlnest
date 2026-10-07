/**
 * main.ts — point d'entrée de la démo en ligne.
 *
 * Monte la vraie carte Owlnest, celle qu'installe HACS, sur un Home Assistant
 * simulé (fake-hass.ts). Les quelques éléments du frontend HA que la carte
 * utilise (`ha-icon`, `ha-card`) sont remplacés par des équivalents minimaux.
 */

import demoModelUrl from '../custom_components/owlnest/frontend/demo.glb?url';
import logoUrl from '../assets/logo.svg?url';
import { FakeHass, type DemoLang } from './fake-hass';
import { scenario } from './scenario';
import { sunAt } from './demo-scene';
import { Tour, type TourEvent } from './tour';

document.querySelectorAll<HTMLImageElement | HTMLLinkElement>('[data-logo]').forEach((el) => {
  if (el instanceof HTMLImageElement) el.src = logoUrl; else el.href = logoUrl;
});

// ── Éléments du frontend HA ──────────────────────────────────────────────

class DemoIcon extends HTMLElement {
  static observedAttributes = ['icon'];
  private _icon = '';
  set icon(v: string) { this._icon = v; this.render(); }
  get icon() { return this._icon; }
  attributeChangedCallback(_n: string, _o: string, v: string) { this.icon = v; }
  connectedCallback() { this.render(); }
  private render() {
    const name = (this._icon || this.getAttribute('icon') || '').replace(/^mdi:/, '');
    this.style.cssText ||= 'display:inline-flex;align-items:center;justify-content:center;line-height:1;';
    this.innerHTML = name ? `<span class="mdi mdi-${name}" style="font-size:var(--mdc-icon-size,24px)"></span>` : '';
  }
}
if (!customElements.get('ha-icon')) customElements.define('ha-icon', DemoIcon);
if (!customElements.get('ha-card')) {
  customElements.define('ha-card', class extends HTMLElement {
    connectedCallback() { this.style.display ||= 'block'; }
  });
}

// ── Langue ───────────────────────────────────────────────────────────────

const TEXT: Record<DemoLang, Record<string, string>> = {
  en: {
    tagline: 'live demo',
    install: 'Install it',
    moreInfo: 'In Home Assistant, this opens the details of',
  },
  fr: {
    tagline: 'démo en direct',
    install: "L'installer",
    moreInfo: 'Dans Home Assistant, ceci ouvre la fiche de',
  },
};

function pickLang(): DemoLang {
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'fr' || asked === 'en') return asked;
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const lang = pickLang();
document.documentElement.lang = lang;
document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
  const text = TEXT[lang][el.dataset.i18n!];
  if (text) el.textContent = text;
});

// ── Carte ────────────────────────────────────────────────────────────────

await import('../src/ha-3d-floorplan');

// Chaque visite repart de la vue d'ensemble : la carte mémorise sinon le
// dernier point de vue (et la dernière scène) dans le navigateur.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('ha-3d-floorplan:') || key === 'owlnest_scene_id') localStorage.removeItem(key);
  }
} catch { /* stockage indisponible : rien à nettoyer */ }

const fake = new FakeHass(lang, new URL(demoModelUrl, location.href).href);
const stage = document.getElementById('stage')!;
const card = document.createElement('ha-3d-floorplan') as HTMLElement & {
  setConfig(c: Record<string, unknown>): void;
  hass: unknown;
};
card.setConfig({ type: 'custom:ha-3d-floorplan', scene_id: 'main', height: 'fill' });
card.hass = fake.hass;
stage.prepend(card);
fake.onChange((h) => { card.hass = h; });

// Un appui long ouvre normalement la fiche de l'entité dans HA.
const toast = document.getElementById('toast')!;
let toastTimer = 0;
card.addEventListener('hass-more-info', (e) => {
  const id = (e as CustomEvent<{ entityId?: string }>).detail?.entityId;
  if (!id) return;
  const name = (fake.hass.states[id]?.attributes as { friendly_name?: string } | undefined)?.friendly_name ?? id;
  toast.textContent = `${TEXT[lang].moreInfo} « ${name} ».`;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.style.opacity = '0'; }, 2500);
});

// ── Langue ───────────────────────────────────────────────────────────────

const langSelect = document.getElementById('lang') as HTMLSelectElement;
langSelect.value = lang;
langSelect.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('lang', langSelect.value);
  location.href = url.toString();
});

// ── Guide ────────────────────────────────────────────────────────────────

const INSTALL_URL = 'https://github.com/MestrieEsteban/ha-owlnest#installation';
type CardInternals = {
  anchors: Map<string, { entityId?: string }>;
  overlays: Map<string, { el?: HTMLElement }>;
  _requestRender?: () => void;
};

/**
 * L'ancre d'une entité, telle que la carte l'affiche.
 *
 * La carte ne redessine que quand quelque chose change : on lui demande une
 * image, sinon l'ancre garde la position calculée avant que la carte ait pris
 * sa taille, et le guide s'y accroche.
 */
const anchorOf = (entityId: string) => {
  const c = card as unknown as CardInternals;
  c._requestRender?.();
  for (const [key, entry] of c.anchors) {
    if (entry.entityId === entityId) return c.overlays.get(key)?.el;
  }
  return null;
};
const buttonOf = (match: (b: HTMLButtonElement) => boolean) => Array.from(card.querySelectorAll('button')).find(match);

/** Les onglets de l'éditeur, reconnus à leur icône. */
const TABS = { anchors: '⊕', parts: '🚪', rules: '⚡', camera: '◎', weather: '☁' } as const;
const tabOf = (icon: string) => buttonOf((b) => b.textContent?.trim() === icon);

const ctx = {
  goView: (id: string) => {
    (card as unknown as { _executeAction?: (a: unknown) => void })._executeAction?.({ type: 'go_to_view', view_id: id });
  },
  setHour: (hour: number) => {
    const sun = sunAt(hour);
    fake.set('sun.sun', sun.elevation > 0 ? 'above_horizon' : 'below_horizon', sun);
  },
  setState: (entityId: string, on: boolean) => fake.setOn(entityId, on),
  // L'éditeur est ouvert quand ses onglets sont là ; le crayon l'ouvre, « Terminé » le ferme.
  setEditor: (open: boolean) => {
    const isOpen = !!tabOf(TABS.anchors);
    if (open === isOpen) return;
    const toggle = open
      ? buttonOf((b) => b.textContent?.includes('✏') ?? false)
      : buttonOf((b) => /^(Terminé|Done)$/.test(b.textContent?.trim() ?? ''));
    toggle?.click();
  },
};

const tour = new Tour(stage, lang, scenario(ctx), {
  lamp: () => anchorOf('light.chevet'),
  sensor: () => anchorOf('sensor.temperature_salon'),
  door: () => anchorOf('binary_sensor.porte_entree'),
  views: () => buttonOf((b) => b.textContent?.trim() === fake.firstViewLabel)?.parentElement,
  pencil: () => buttonOf((b) => b.textContent?.includes('✏') ?? false),
  tabAnchors: () => tabOf(TABS.anchors),
  tabParts: () => tabOf(TABS.parts),
  tabRules: () => tabOf(TABS.rules),
  tabWeather: () => tabOf(TABS.weather),
}, { install: INSTALL_URL, logo: logoUrl });

// Ce que fait le visiteur, tel que le voit la maison simulée.
fake.onService((domain, _service, ids) => {
  if (domain === 'light') tour.notify('light');
  if (ids.includes('binary_sensor.porte_entree')) tour.notify('door');
});

// Et dans la carte : la barre des vues, le crayon, puis les onglets.
card.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('button');
  const text = button?.textContent?.trim() ?? '';
  if (fake.viewLabels.includes(text)) tour.notify('view');
  if (text.includes('✏')) tour.notify('edit');
  for (const [id, icon] of Object.entries(TABS)) {
    if (text === icon) tour.notify(`tab:${id}` as TourEvent);
  }
}, true);

// Un glissé d'au moins 40 px sur la maison compte comme « tourner autour ».
let dragFrom: { x: number; y: number } | null = null;
card.addEventListener('pointerdown', (e) => { dragFrom = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { dragFrom = null; });
card.addEventListener('pointermove', (e) => {
  if (dragFrom && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 40) {
    dragFrom = null;
    tour.notify('orbit');
  }
});
card.addEventListener('wheel', () => tour.notify('orbit'), { passive: true });

// La visite pilote la caméra : elle attend que la maison soit chargée.
const startWhenLoaded = () => {
  if ((card as unknown as { modelLoaded?: boolean }).modelLoaded) setTimeout(() => tour.start(), 400);
  else setTimeout(startWhenLoaded, 200);
};
startWhenLoaded();

// Accès depuis la console du navigateur, pour régler la démo.
(globalThis as { __demo?: unknown }).__demo = { card, fake, tour };
