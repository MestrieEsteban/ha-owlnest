/**
 * L'habillage de la carte : quatre thèmes, une couleur d'accent, et la
 * disposition des modules. Le tout est rangé dans les réglages de la scène
 * (`settings.ui`), donc suit la carte d'un appareil à l'autre.
 *
 * Les couleurs passent par des variables CSS posées sur le calque de la carte :
 * changer de thème ne reconstruit rien, la feuille de styles suit.
 */

export type Skin = 'night' | 'paper' | 'glass' | 'ha';
export const SKINS: Skin[] = ['night', 'paper', 'glass', 'ha'];

/** `auto` : la couleur du thème choisi (celle de Home Assistant pour le thème HA). */
export const ACCENTS = ['auto', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'] as const;
export type Accent = typeof ACCENTS[number] | string;

/** Les six emplacements de la carte. */
export type Slot = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export const SLOTS: Slot[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

/** Les modules qu'on peut placer. La barre d'outils ne se cache pas. */
// Les vues enregistrées vivent dans la barre des pièces : un seul endroit
// pour aller quelque part dans la maison.
export type ModuleId = 'rooms' | 'status' | 'dock';
export const MODULES: ModuleId[] = ['rooms', 'status', 'dock'];

export interface UiPrefs {
  skin: Skin;
  accent: Accent;
  slots: Record<ModuleId, Slot>;
  /** Modules affichés (la barre d'outils l'est toujours) ; `views` : les vues enregistrées dans la barre des pièces. */
  show: { rooms: boolean; views: boolean; status: boolean; names: boolean };
  /** Les outils s'effacent quand on ne touche pas la carte. */
  autohide: boolean;
}

export const DEFAULT_UI: UiPrefs = {
  skin: 'night',
  accent: 'auto',
  slots: { rooms: 'tl', status: 'tr', dock: 'br' },
  show: { rooms: true, views: true, status: true, names: false },
  autohide: true,
};

/** Les préférences enregistrées, complétées par les valeurs par défaut. */
export function uiPrefs(saved?: Partial<UiPrefs> | null): UiPrefs {
  const s = saved ?? {};
  // Seuls les modules d'aujourd'hui : une place enregistrée pour l'ancien module Vues est oubliée.
  const placed = (s.slots ?? {}) as Partial<Record<ModuleId, Slot>>;
  const slots = { ...DEFAULT_UI.slots };
  for (const k of MODULES) if (placed[k] && SLOTS.includes(placed[k]!)) slots[k] = placed[k]!;
  return {
    skin: SKINS.includes(s.skin as Skin) ? (s.skin as Skin) : DEFAULT_UI.skin,
    accent: typeof s.accent === 'string' && s.accent ? s.accent : DEFAULT_UI.accent,
    slots,
    show: { ...DEFAULT_UI.show, ...(s.show ?? {}) },
    autohide: s.autohide ?? DEFAULT_UI.autohide,
  };
}

interface Palette {
  chrome: string; chrome2: string; line: string; text: string; muted: string;
  acc: string; blur: string; shadow: string;
}

const PALETTES: Record<Skin, Palette> = {
  night: {
    chrome: 'rgba(11,18,32,0.94)', chrome2: '#16213a', line: 'rgba(255,255,255,0.09)',
    text: '#e2e8f0', muted: '#94a3b8', acc: '#38bdf8', blur: 'blur(10px)', shadow: '0 8px 24px rgba(0,0,0,0.35)',
  },
  paper: {
    chrome: 'rgba(251,250,247,0.97)', chrome2: '#efece5', line: 'rgba(31,41,51,0.1)',
    text: '#1f2933', muted: '#6b7280', acc: '#0284c7', blur: 'none', shadow: '0 6px 20px rgba(31,41,51,0.18)',
  },
  glass: {
    chrome: 'rgba(10,16,30,0.42)', chrome2: 'rgba(255,255,255,0.12)', line: 'rgba(255,255,255,0.16)',
    text: '#f8fafc', muted: '#cbd5e1', acc: '#7dd3fc', blur: 'blur(14px) saturate(1.3)', shadow: '0 8px 24px rgba(0,0,0,0.25)',
  },
  ha: {
    chrome: 'var(--ha-card-background, var(--card-background-color, #ffffff))',
    chrome2: 'var(--secondary-background-color, #f2f4f7)',
    line: 'var(--divider-color, rgba(0,0,0,0.12))',
    text: 'var(--primary-text-color, #212121)',
    muted: 'var(--secondary-text-color, #727272)',
    acc: 'var(--primary-color, #03a9f4)', blur: 'none', shadow: '0 2px 8px rgba(0,0,0,0.16)',
  },
};

/** Lisible sur l'accent : sombre sur les couleurs claires, blanc sinon. */
function inkOn(accent: string): string {
  return accent === '#fbbf24' || accent === '#34d399' ? '#0b1220' : '#ffffff';
}

/** Les variables d'un thème, à poser sur un élément. */
export function applyTheme(el: HTMLElement, skin: Skin, accent: Accent) {
  const p = PALETTES[skin];
  const acc = accent === 'auto' ? p.acc : accent;
  const vars: Record<string, string> = {
    '--ow-chrome': p.chrome, '--ow-chrome2': p.chrome2, '--ow-line': p.line, '--ow-text': p.text,
    '--ow-muted': p.muted, '--ow-acc': acc, '--ow-acc-ink': accent === 'auto' ? '#ffffff' : inkOn(acc),
    '--ow-blur': p.blur, '--ow-shadow': p.shadow,
  };
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset.owSkin = skin;
}

/** L'éditeur garde l'habillage sombre de l'éditeur de plan, quel que soit le thème. */
export const EDITOR_VARS = [
  '--ow-chrome:#0b1220', '--ow-chrome2:#111a2e', '--ow-line:rgba(255,255,255,0.08)', '--ow-text:#e2e8f0',
  '--ow-muted:#94a3b8', '--ow-acc:#0ea5e9', '--ow-acc-ink:#ffffff', '--ow-blur:none', '--ow-shadow:0 10px 30px rgba(0,0,0,0.4)',
].join(';');

export const FONT = 'var(--primary-font-family, Inter, system-ui, sans-serif)';

/**
 * La feuille de styles commune, posée une fois dans la carte. Préfixe `ow-`
 * partout : la carte vit dans la page de Home Assistant.
 */
export const STYLES = `
.ow-ui { font-family: ${FONT}; color: var(--ow-text); -webkit-tap-highlight-color: transparent; }
.ow-ui *, .ow-ui *::before, .ow-ui *::after { box-sizing: border-box; }
.ow-ui button { font-family: inherit; }
.ow-ui button:focus-visible, .ow-ui input:focus-visible, .ow-ui select:focus-visible { outline: 2px solid var(--ow-acc); outline-offset: 2px; }
.ow-surface { background: var(--ow-chrome); border: 1px solid var(--ow-line); border-radius: 14px; box-shadow: var(--ow-shadow);
  backdrop-filter: var(--ow-blur); -webkit-backdrop-filter: var(--ow-blur); color: var(--ow-text); }

/* La carte s'adapte à sa largeur : deux modules face à face se partagent la ligne. */
.ow-ui { container-type: inline-size; }
.ow-ui:has(> .ow-slot[data-slot="tr"]:not(:empty)) > .ow-slot[data-slot="tl"],
.ow-ui:has(> .ow-slot[data-slot="tl"]:not(:empty)) > .ow-slot[data-slot="tr"] { max-width: calc(62% - 18px); }
.ow-ui:has(> .ow-slot[data-slot="br"]:not(:empty)) > .ow-slot[data-slot="bl"],
.ow-ui:has(> .ow-slot[data-slot="bl"]:not(:empty)) > .ow-slot[data-slot="br"] { max-width: calc(100% - 24px); }
@container (max-width: 640px) {
  .ow-status .ow-muted { display: none; }
  .ow-ui .ow-status { gap: 6px; padding: 7px 10px; }
  .ow-ui:has(> .ow-slot[data-slot="tr"]:not(:empty)) > .ow-slot[data-slot="tl"] { max-width: calc(100% - 128px); }
  .ow-ui:has(> .ow-slot[data-slot="tl"]:not(:empty)) > .ow-slot[data-slot="tr"] { max-width: 110px; }
  /* Les vues du bas passent au-dessus des coins plutôt que de les chevaucher. */
  /* Préfixé : les règles de base des emplacements viennent plus bas et gagneraient sinon. */
  .ow-ui > .ow-slot[data-slot="bc"] { bottom: 62px; max-width: calc(100% - 24px); }
}

/* Emplacements des modules */
.ow-slot { position: absolute; z-index: 10; display: flex; gap: 8px; pointer-events: none; max-width: calc(100% - 24px); }
.ow-slot > * { pointer-events: auto; }
.ow-slot[data-slot="tl"] { top: 12px; left: 12px; flex-direction: column; align-items: flex-start; }
.ow-slot[data-slot="tr"] { top: 12px; right: 12px; flex-direction: column; align-items: flex-end; }
.ow-slot[data-slot="bl"] { bottom: 12px; left: 12px; flex-direction: column-reverse; align-items: flex-start; }
.ow-slot[data-slot="br"] { bottom: 12px; right: 12px; flex-direction: column-reverse; align-items: flex-end; }
.ow-slot[data-slot="tc"] { top: 12px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.ow-slot[data-slot="bc"] { bottom: 12px; left: 50%; transform: translateX(-50%); flex-direction: column-reverse; align-items: center; }
.ow-fade { transition: opacity .25s ease; }
/* « Noms des pastilles » : chaque pastille montre son nom en permanence. */
.ow-names .ow-pin-label { opacity: 1 !important; }
.ow-fade.ow-hidden { opacity: 0; pointer-events: none !important; }
.ow-fade.ow-hidden * { pointer-events: none !important; }

/* Barre d'outils */
.ow-dock { display: flex; align-items: center; gap: 2px; padding: 4px; }
.ow-ib { position: relative; width: 36px; height: 36px; border-radius: 10px; border: none; background: transparent; color: var(--ow-text);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; font-size: 16px; line-height: 1; }
.ow-ib:hover { background: var(--ow-chrome2); }
.ow-ib.ow-on { background: var(--ow-acc); color: var(--ow-acc-ink); }
.ow-ib.ow-alert { box-shadow: inset 0 0 0 2px #ef4444; }
.ow-sepv { width: 1px; align-self: stretch; margin: 6px 3px; background: var(--ow-line); }

/* Vues enregistrées */
.ow-chip { font: 600 12px ${FONT}; padding: 6px 11px; border-radius: 999px; border: none; background: transparent; color: var(--ow-muted);
  cursor: pointer; white-space: nowrap; transition: background .15s, color .15s; }
.ow-chip:hover { color: var(--ow-text); background: var(--ow-chrome2); }
.ow-chip.ow-on { background: var(--ow-acc); color: var(--ow-acc-ink); }
.ow-chip i { font-style: normal; display: inline-flex; align-items: center; gap: 2px; margin-left: 6px; padding: 1px 6px; border-radius: 999px;
  background: #fbbf24; color: #3b2a05; font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ow-chip small { font-size: 11px; font-weight: 600; margin-left: 6px; opacity: .75; font-variant-numeric: tabular-nums; }
.ow-roompanel { width: min(290px, calc(100vw - 24px)); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ow-rp-h { display: flex; align-items: center; gap: 8px; padding: 2px 4px 4px; }
.ow-rp-h b { font-size: 14px; }
.ow-rp-temp { display: inline-flex; align-items: center; gap: 3px; font-size: 12.5px; color: var(--ow-muted); font-variant-numeric: tabular-nums; }
.ow-rp-list { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; }
.ow-rp-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 6px; border: none; border-radius: 10px; background: transparent;
  color: var(--ow-text); font: inherit; text-align: left; cursor: pointer; }
.ow-rp-row:hover { background: var(--ow-chrome2); }
.ow-rp-tile { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--ow-chrome2); color: var(--ow-muted); flex-shrink: 0; }
.ow-rp-tile.ow-on { background: #fbbf24; color: #3b2a05; }
.ow-rp-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ow-rp-nm b { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-rp-nm span { font-size: 11.5px; color: var(--ow-muted); }
.ow-rp-empty { font-size: 12.5px; color: var(--ow-muted); padding: 6px 4px; line-height: 1.45; }
.ow-rooms { display: flex; align-items: center; padding: 4px; max-width: min(620px, 100%); min-width: 0; }
.ow-rooms-track { display: flex; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.ow-rooms-track::-webkit-scrollbar { display: none; }
.ow-floors { display: flex; gap: 2px; padding-right: 4px; margin-right: 4px; border-right: 1px solid var(--ow-line); flex: none; }
.ow-rooms-track { --fl: 0px; --fr: 0px;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--fl), #000 calc(100% - var(--fr)), transparent);
  mask-image: linear-gradient(to right, transparent, #000 var(--fl), #000 calc(100% - var(--fr)), transparent); }
.ow-rooms-track.ow-more { --fr: 36px; }
.ow-rooms-track.ow-less { --fl: 28px; }
.ow-floor.ow-on { background: var(--ow-text); color: var(--ow-chrome); }
.ow-rooms .ow-sep { flex: none; width: 1px; margin: 4px 3px; background: var(--ow-line); }
.ow-chip.ow-view { display: inline-flex; align-items: center; gap: 5px; }
.ow-chip.ow-view svg { flex: none; opacity: .7; }
.ow-chip.ow-view.ow-on svg { opacity: 1; }

/* État */
.ow-status { display: flex; align-items: center; gap: 10px; padding: 7px 12px; font-size: 12px; white-space: nowrap; }
.ow-status b { font-size: 14px; font-variant-numeric: tabular-nums; }
.ow-status .ow-muted { color: var(--ow-muted); }
.ow-status .ow-sep { width: 1px; height: 16px; background: var(--ow-line); }

/* Menus et bulles */
.ow-menu { position: absolute; z-index: 60; padding: 6px; min-width: 230px; display: flex; flex-direction: column; gap: 2px; pointer-events: auto; }
.ow-menu-title { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ow-muted); padding: 4px 8px 6px; }
.ow-menu-item { display: flex; gap: 10px; align-items: center; text-align: left; padding: 8px 10px; border: none; border-radius: 9px;
  background: transparent; color: var(--ow-text); font: inherit; cursor: pointer; }
.ow-menu-item:hover { background: var(--ow-chrome2); }
.ow-menu-item.ow-on { background: color-mix(in srgb, var(--ow-acc) 18%, transparent); }
.ow-menu-item strong { display: block; font-size: 13px; }
.ow-menu-item small { display: block; color: var(--ow-muted); font-size: 11px; line-height: 1.3; }
.ow-toast { position: absolute; top: calc(var(--ow-bar-h, 0px) + 12px); left: calc(50% - var(--ow-dock, 0px) / 2); transform: translateX(-50%); z-index: 200; padding: 7px 16px; border-radius: 999px;
  font: 600 12px ${FONT}; color: #fff; pointer-events: none; transition: opacity .3s ease; backdrop-filter: blur(8px); white-space: nowrap; }
.ow-pill { position: absolute; left: 50%; transform: translateX(-50%); z-index: 40; display: flex; align-items: center; gap: 10px;
  padding: 6px 6px 6px 14px; border-radius: 999px; font-size: 12.5px; pointer-events: auto; max-width: calc(100% - 24px); }
.ow-pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Une bulle qui porte aussi .ow-ui ne doit pas être un conteneur : sa largeur
   viendrait plus de son contenu (22 px, texte écrasé). */
.ow-ui.ow-pill { container-type: normal; }
/* Rangée dans un emplacement, la bulle prend la largeur de l'emplacement : un
   max-width en % se calculerait sur sa propre largeur et rognerait le texte. */
.ow-slot > .ow-pill { max-width: none; }

/* Boutons */
.ow-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: 600 12.5px ${FONT}; padding: 8px 14px;
  border-radius: 10px; border: 1px solid var(--ow-line); background: var(--ow-chrome2); color: var(--ow-text); cursor: pointer; white-space: nowrap; }
.ow-btn:hover { filter: brightness(1.08); }
.ow-btn.ow-primary { background: var(--ow-acc); border-color: transparent; color: var(--ow-acc-ink); }
.ow-btn.ow-ghost { background: transparent; border-color: transparent; color: var(--ow-muted); }
.ow-btn.ow-danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.45); color: #fca5a5; }
.ow-btn.ow-small { padding: 5px 10px; font-size: 12px; }

/* Interrupteur */
.ow-switch { width: 36px; height: 20px; border-radius: 999px; border: none; background: var(--ow-chrome2); position: relative; cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--ow-line); flex-shrink: 0; }
.ow-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--ow-muted);
  transition: transform .2s, background .2s; }
.ow-switch.ow-on { background: var(--ow-acc); }
.ow-switch.ow-on::after { transform: translateX(16px); background: #fff; }

/* Fenêtre au centre */
.ow-scrim { position: absolute; inset: 0; z-index: 150; background: rgba(4,8,16,0.5); display: grid; place-items: center; padding: 16px; pointer-events: auto; }
.ow-dialog { width: min(360px, 100%); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.ow-dialog h4 { margin: 0; font-size: 15px; }
.ow-dialog p { margin: 0; font-size: 12.5px; color: var(--ow-muted); line-height: 1.45; }
.ow-dialog .ow-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ow-ask-grow { position: absolute; left: 50%; top: 50%; border-radius: 6px; background: var(--ow-acc); transform: translate(-50%, -50%); animation: ow-grow 2.6s ease-in-out infinite; }
@keyframes ow-grow { 0%, 20% { width: 46px; height: 30px; } 55%, 85% { width: calc(100% - 16px); height: calc(100% - 16px); } 100% { width: 46px; height: 30px; } }
@media (prefers-reduced-motion: reduce) { .ow-ask-grow { animation: none; width: 60%; height: 60%; } }
.ow-dialog label { font-size: 12px; color: var(--ow-muted); display: flex; gap: 6px; align-items: center; cursor: pointer; }

/* Panneau Personnaliser */
.ow-sheet { position: absolute; top: 0; right: 0; bottom: 0; width: min(310px, 100%); z-index: 70; display: flex; flex-direction: column;
  border-radius: 0; border-width: 0 0 0 1px; pointer-events: auto; transform: translateX(105%); transition: transform .3s cubic-bezier(.2,.8,.2,1); }
.ow-sheet.ow-open { transform: none; }
.ow-sheet header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--ow-line); font-weight: 700; font-size: 14px; }
.ow-sheet .ow-body { flex: 1; overflow: auto; padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 18px; }
.ow-sheet footer { padding: 10px 14px; border-top: 1px solid var(--ow-line); display: flex; gap: 8px; justify-content: flex-end; }
.ow-h5 { margin: 0 0 8px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--ow-muted); }
.ow-skins { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ow-skin { border: 2px solid transparent; border-radius: 12px; padding: 6px; background: var(--ow-chrome2); cursor: pointer; text-align: left;
  color: var(--ow-text); font: 600 12px ${FONT}; display: flex; flex-direction: column; gap: 6px; }
.ow-skin.ow-on { border-color: var(--ow-acc); }
.ow-skin i { display: block; height: 34px; border-radius: 8px; position: relative; overflow: hidden; background: linear-gradient(135deg, #5b7f5f, #3d5e43); }
.ow-skin i::after { content: ""; position: absolute; right: 6px; bottom: 6px; width: 48%; height: 12px; border-radius: 5px; background: var(--sw); }
.ow-accents { display: flex; gap: 8px; flex-wrap: wrap; }
.ow-acc { width: 28px; height: 28px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; background: var(--sw);
  display: grid; place-items: center; color: #fff; font-size: 10px; font-weight: 700; }
.ow-acc.ow-on { border-color: var(--ow-text); }
.ow-map { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 1fr 1fr; gap: 6px; padding: 6px; border-radius: 12px;
  background: linear-gradient(135deg, #5b7f5f, #3d5e43); aspect-ratio: 16 / 10; }
.ow-cell { border: 1.5px dashed rgba(255,255,255,0.45); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 4px;
  min-width: 0; cursor: pointer; transition: background .15s; }
.ow-cell[data-cell^="b"] { justify-content: flex-end; }
.ow-cell.ow-hot, .ow-map.ow-placing .ow-cell:hover { background: rgba(255,255,255,0.22); border-color: #fff; }
.ow-mchip { font: 600 10.5px ${FONT}; padding: 4px 6px; border-radius: 6px; border: none; background: #0b1220; color: #e2e8f0; cursor: grab;
  line-height: 1.25; overflow-wrap: anywhere; touch-action: none; text-align: left; }
.ow-mchip.ow-sel { background: var(--ow-acc); color: var(--ow-acc-ink); }
.ow-mchip.ow-off { opacity: .45; text-decoration: line-through; }
.ow-drag-ghost { position: fixed; z-index: 100000; pointer-events: none; transform: translate(-50%, -50%) rotate(-3deg); box-shadow: 0 6px 16px rgba(0,0,0,0.35); }
.ow-row-opt { display: flex; align-items: center; gap: 10px; padding: 7px 2px; font-size: 13px; }
.ow-row-opt span { flex: 1; }
.ow-hint { font-size: 12px; color: var(--ow-muted); background: var(--ow-chrome2); border-radius: 10px; padding: 9px 11px; display: flex; gap: 8px; line-height: 1.4; }
`;
