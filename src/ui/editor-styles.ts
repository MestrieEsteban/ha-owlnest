/**
 * L'habillage de l'éditeur (ancres, ouvrants, règles, ambiance, réglages) :
 * celui de l'éditeur de plan. Barre d'onglets en haut, panneau à droite, le
 * reste de la carte pour la 3D.
 */
import { EDITOR_VARS, FONT } from './theme';

/** Hauteur de la barre du haut, en pixels : le panneau commence dessous. */
export const BAR_H = 52;
/** Sur un téléphone, deux lignes : les onglets, puis les actions. */
export const BAR_H_PHONE = 94;
/** Largeur du panneau ancré. */
export const PANEL_W = 340;

export const EDITOR_STYLES = `
.ow-ed { ${EDITOR_VARS}; font-family: ${FONT}; color: var(--ow-text); }
.ow-ed *, .ow-ed *::before, .ow-ed *::after { box-sizing: border-box; }
.ow-edbar { position: absolute; top: 0; left: 0; right: 0; height: ${BAR_H}px; z-index: 25; pointer-events: auto; display: flex; align-items: center;
  gap: 10px; padding: 0 10px; background: var(--ow-chrome); border-bottom: 1px solid var(--ow-line); min-width: 0; }
/* La barre cède la place peu à peu : le titre d'abord, puis les libellés des onglets. */
.ow-edbar { container-type: inline-size; }
@container (max-width: 1320px) { .ow-edtitle span { display: none; } }
@container (max-width: 1080px) { .ow-tab span, .ow-steps span { display: none; } .ow-edbar .ow-tab { padding: 7px 9px; } }
.ow-edtitle { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: #7dd3fc; white-space: nowrap; flex-shrink: 0; }
.ow-tabs { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--ow-chrome2); border: 1px solid var(--ow-line);
  overflow-x: auto; scrollbar-width: none; min-width: 0; margin-inline: auto; }
.ow-tabs::-webkit-scrollbar { display: none; }
.ow-tab { display: flex; align-items: center; gap: 6px; font: 600 12.5px ${FONT}; padding: 6px 11px; border-radius: 8px; border: none;
  background: transparent; color: var(--ow-muted); cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.ow-tab:hover { color: var(--ow-text); }
.ow-tab.ow-on { background: var(--ow-acc); color: var(--ow-acc-ink); }
.ow-edact { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ow-edact .ow-ib { width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--ow-line); background: var(--ow-chrome2); }
.ow-edact .ow-ib:disabled { opacity: .35; cursor: default; }
.ow-save { font-size: 11px; white-space: nowrap; color: #22c55e; }
.ow-steps { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--ow-acc) 50%, transparent);
  background: color-mix(in srgb, var(--ow-acc) 12%, transparent); color: var(--ow-acc); font: 600 12px ${FONT}; cursor: pointer; white-space: nowrap; }
.ow-edbar.ow-narrow .ow-steps span { display: none; }
.ow-setup { width: min(330px, calc(100vw - 24px)); padding: 10px; gap: 4px; }
.ow-setup-t { font-size: 14px; font-weight: 700; padding: 2px 4px; }
.ow-setup-i { font-size: 12px; color: var(--ow-muted); padding: 0 4px 6px; line-height: 1.45; }
.ow-popmenu button.ow-setup-row { align-items: center; gap: 10px; padding: 8px; }
.ow-setup-mark { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; background: var(--ow-chrome2); color: var(--ow-muted); }
.ow-done .ow-setup-mark { background: color-mix(in srgb, #34d399 22%, transparent); color: #34d399; }
.ow-setup-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ow-setup-nm b { font-size: 13px; }
.ow-setup-nm span { font-size: 11.5px; color: var(--ow-muted); line-height: 1.35; }
.ow-done .ow-setup-nm b { text-decoration: line-through; color: var(--ow-muted); }
.ow-edpanel { position: absolute; top: ${BAR_H}px; right: 0; bottom: 0; width: ${PANEL_W}px; z-index: 15; pointer-events: auto; display: flex;
  flex-direction: column; background: var(--ow-chrome); border-left: 1px solid var(--ow-line); overflow: hidden; }
.ow-edpanel.ow-narrow { width: min(${PANEL_W}px, 92%); box-shadow: var(--ow-shadow); transform: translateX(105%); transition: transform .25s ease; }
.ow-edpanel.ow-narrow.ow-panel-open { transform: none; }
.ow-edbar .ow-only-narrow { display: none; }
.ow-edbar.ow-narrow .ow-only-narrow { display: inline-flex; }
.ow-edbar.ow-narrow .ow-tab span, .ow-edbar.ow-narrow .ow-edtitle span, .ow-edbar.ow-narrow .ow-save { display: none; }
.ow-edbar.ow-narrow .ow-tab { padding: 7px 9px; }
.ow-edbar.ow-phone { height: ${BAR_H_PHONE}px; flex-wrap: wrap; align-content: center; row-gap: 6px; }
.ow-edbar.ow-phone .ow-edtitle { display: none; }
.ow-edbar.ow-phone .ow-tabs { order: -1; flex: 1 0 100%; justify-content: space-between; }
.ow-edbar.ow-phone .ow-edact { margin-left: auto; }
.ow-ed-floors { position: absolute; left: 12px; top: calc(var(--ow-bar-h, ${BAR_H}px) + 12px); z-index: 14; pointer-events: auto; display: flex; gap: 2px;
  padding: 3px; border-radius: 11px; background: var(--ow-chrome); border: 1px solid var(--ow-line); box-shadow: var(--ow-shadow);
  max-width: calc(100% - var(--ow-dock, 0px) - 24px); overflow-x: auto; scrollbar-width: none; }
.ow-ed-floors .ow-tab { white-space: nowrap; }
.ow-floor-tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 600; vertical-align: 1px;
  background: var(--ow-chrome2); border: 1px solid var(--ow-line); color: var(--ow-muted); }
.ow-edpanel.ow-phone { top: ${BAR_H_PHONE}px; width: 100%; }

/*
 * Le contenu repris de l'ancien inspecteur était écrit pour un panneau de
 * 264 px, en 9 à 11 px. Agrandi d'un bloc plutôt que réécrit ligne à ligne.
 */
.ow-legacy { zoom: 1.18; }

/* En-tête d'un onglet */
.ow-ph { padding: 14px 14px 10px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid var(--ow-line); flex-shrink: 0; }
.ow-ph-t { display: flex; align-items: baseline; gap: 8px; }
.ow-ph-t b { font-size: 15px; }
.ow-ph-t .ow-n { font-size: 12px; color: var(--ow-muted); font-variant-numeric: tabular-nums; }
.ow-ph-t .ow-beta { font-size: 9px; font-weight: 700; color: #fbbf24; border: 1px solid rgba(251,191,36,0.35); border-radius: 4px; padding: 1px 4px; }
.ow-ph-d { font-size: 12px; color: var(--ow-muted); line-height: 1.4; margin-top: -4px; }
.ow-acts { display: flex; gap: 6px; align-items: stretch; }
.ow-modes { flex: 1; display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--ow-chrome2); border: 1px solid var(--ow-line); min-width: 0; }
.ow-mode { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 2px; border: none; border-radius: 8px;
  background: transparent; color: var(--ow-muted); font: 600 10.5px ${FONT}; cursor: pointer; min-width: 0; }
.ow-mode.ow-on { background: var(--ow-chrome); color: var(--ow-text); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.ow-mode.ow-danger.ow-on { color: #f87171; }
.ow-acts .ow-big { flex-direction: column; gap: 2px; padding: 5px 12px; font-size: 10.5px; }
.ow-acts .ow-big.ow-on { box-shadow: 0 0 0 2px var(--ow-chrome), 0 0 0 4px var(--ow-acc); }
.ow-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: 10px; background: var(--ow-chrome2);
  border: 1px solid var(--ow-line); color: var(--ow-muted); }
.ow-search input { flex: 1; min-width: 0; border: none; background: transparent; color: var(--ow-text); font: 13px ${FONT}; padding: 8px 0; outline: none; }
.ow-search .ow-ib { width: 28px; height: 28px; }

/* Liste des appareils */
.ow-list { overflow-y: auto; flex: 1; min-height: 0; padding: 4px 0 12px; }
.ow-room { padding: 12px 14px 4px; display: flex; align-items: center; gap: 7px; }
.ow-room i { width: 10px; height: 10px; border-radius: 3px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25); }
.ow-room b { font-size: 13px; }
.ow-room span { font-size: 11.5px; color: var(--ow-muted); }
.ow-dev { display: flex; align-items: center; gap: 12px; margin: 2px 8px; padding: 8px; border-radius: 12px; cursor: pointer; }
.ow-dev:hover { background: var(--ow-chrome2); }
.ow-dev.ow-on { background: color-mix(in srgb, var(--ow-acc) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ow-acc) 55%, transparent); }
.ow-dev.ow-off { opacity: .45; }
.ow-tile { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0;
  background: color-mix(in srgb, var(--tint, #64748b) 17%, var(--ow-chrome2)); color: var(--tint, var(--ow-muted)); }
.ow-tile.ow-lit { background: var(--tint, #fbbf24); color: #17120a; box-shadow: 0 0 14px color-mix(in srgb, var(--tint, #fbbf24) 45%, transparent); }
.ow-dev .ow-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ow-dev .ow-nm b { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-dev .ow-nm span { font-size: 12px; color: var(--ow-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-dev .ow-rowbtns { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
.ow-dev:hover .ow-rowbtns, .ow-dev.ow-on .ow-rowbtns, .ow-dev:focus-within .ow-rowbtns { opacity: 1; }
.ow-dev .ow-ib { width: 30px; height: 30px; color: var(--ow-muted); }
.ow-dev .ow-ib:hover { color: var(--ow-text); }
.ow-empty { padding: 24px 18px; text-align: center; color: var(--ow-muted); font-size: 12.5px; line-height: 1.6; }
.ow-empty b { display: block; color: var(--ow-text); font-size: 14px; margin-bottom: 4px; }
.ow-warn { padding: 8px 14px; font-size: 11.5px; color: #f59e0b; background: rgba(245,158,11,0.08); border-bottom: 1px solid rgba(245,158,11,0.18); line-height: 1.5; }
.ow-popmenu { position: absolute; z-index: 40; padding: 6px; min-width: 210px; display: flex; flex-direction: column; gap: 2px;
  background: var(--ow-chrome); border: 1px solid var(--ow-line); border-radius: 12px; box-shadow: var(--ow-shadow); pointer-events: auto; }
.ow-popmenu button { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: none; border-radius: 8px; background: transparent;
  color: var(--ow-text); font: 13px ${FONT}; cursor: pointer; text-align: left; }
.ow-popmenu button:hover { background: var(--ow-chrome2); }
/* Fiche d'un ouvrant, dans le panneau */
.ow-form { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; background: var(--ow-chrome); }
.ow-form-h { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--ow-line); flex-shrink: 0; }
.ow-form-b { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.ow-form-f { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--ow-line); flex-shrink: 0; }
.ow-card { border: 1px solid var(--ow-line); border-radius: 14px; background: color-mix(in srgb, var(--ow-chrome2) 55%, transparent); }
.ow-card-h { display: flex; align-items: center; gap: 8px; padding: 11px 12px; font-size: 13.5px; color: var(--ow-text); list-style: none; }
.ow-card-h::-webkit-details-marker { display: none; }
details.ow-card > .ow-card-h { cursor: pointer; }
.ow-card-h svg { color: var(--ow-acc); }
.ow-digest { flex: 1; min-width: 0; text-align: right; font-size: 12px; color: var(--ow-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-chev { width: 8px; height: 8px; border-right: 2px solid var(--ow-muted); border-bottom: 2px solid var(--ow-muted); transform: rotate(-45deg); transition: transform .15s; margin: 0 4px; flex-shrink: 0; }
details[open] > .ow-card-h .ow-chev { transform: rotate(45deg); }
.ow-card-b { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 12px; }
.ow-field { display: flex; flex-direction: column; gap: 6px; }
.ow-field > label { font-size: 12px; font-weight: 600; color: var(--ow-muted); }
.ow-row-link { display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--ow-line, rgba(148,163,184,0.3)); background: none; color: inherit; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.ow-row-link:hover { background: var(--ow-chrome2); }
.ow-styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 4px; }
.ow-style { display: flex; flex-direction: column; gap: 5px; padding: 5px 5px 7px; border-radius: 12px; border: 1px solid var(--ow-line); background: var(--ow-chrome2); color: var(--ow-text); font: 600 11.5px inherit; cursor: pointer; text-align: center; }
.ow-style:hover { border-color: var(--ow-acc); }
.ow-style-art { position: relative; display: block; height: 52px; border-radius: 8px; overflow: hidden; }
.ow-style-art i { position: absolute; display: block; }
.ow-hint-line { font-size: 11.5px; color: var(--ow-muted); line-height: 1.45; }
.ow-link { background: none; border: 0; padding: 0; margin: -6px 0 12px; font: inherit; font-size: 11.5px; color: var(--ow-accent, #7aa2ff); cursor: pointer; text-decoration: underline; }
.ow-seg { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 10px; background: var(--ow-chrome2); border: 1px solid var(--ow-line); }
.ow-seg button { flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 8px; border: none; border-radius: 8px;
  background: transparent; color: var(--ow-muted); font: 600 12px ${FONT}; cursor: pointer; min-width: 0; }
.ow-seg button.ow-on { background: var(--ow-chrome); color: var(--ow-text); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.ow-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 6px; }
.ow-tiles button { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px; border-radius: 12px; border: 1px solid var(--ow-line);
  background: var(--ow-chrome2); color: var(--ow-text); font: 600 12px ${FONT}; cursor: pointer; }
.ow-tiles button.ow-on { border-color: var(--ow-acc); background: color-mix(in srgb, var(--ow-acc) 16%, transparent); color: var(--ow-text); }
.ow-tiles button.ow-on svg { color: var(--ow-acc); }
.ow-range { display: flex; align-items: center; gap: 10px; }
.ow-range input[type=range] { flex: 1; accent-color: var(--ow-acc); min-width: 0; }
.ow-range-v { font-size: 12px; color: var(--ow-text); min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; }
.ow-big-range input[type=range] { height: 28px; }
.ow-ends { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--ow-muted); margin-top: -6px; }
.ow-readout { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; background: var(--ow-chrome); border: 1px solid var(--ow-line); font-size: 12.5px; }
.ow-readout-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ow-state { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--ow-chrome2); color: var(--ow-muted); white-space: nowrap; }
.ow-state.ow-open { background: color-mix(in srgb, #34d399 20%, transparent); color: #34d399; }
.ow-warn-t { color: #fbbf24; font-size: 12px; line-height: 1.45; }
.ow-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ow-chip2 { padding: 5px 10px; border-radius: 999px; font: 600 12px ${FONT}; cursor: pointer; background: var(--ow-chrome2); color: var(--ow-muted); border: 1px solid var(--ow-line); }
.ow-chip2.ow-on { background: color-mix(in srgb, var(--ow-acc) 16%, transparent); color: var(--ow-text); border-color: color-mix(in srgb, var(--ow-acc) 55%, transparent); }
.ow-chip2.ow-miss { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.45); }
.ow-form .ow-row-opt { padding: 2px 0; }
/* Fiche d'un appareil : elle défile dans le panneau, l'en-tête reste en haut. */
.ow-sheet-host { padding: 0 !important; }
.ow-sheet-host .ow-form-b { overflow: visible; }
.ow-sheet-h { position: sticky; top: 0; z-index: 3; background: var(--ow-chrome); }
.ow-seg.ow-seg-wrap button { flex: 1 1 40%; }
.ow-act-row { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid var(--ow-line); background: var(--ow-chrome); }
/* Règle : une phrase faite de mots et de puces. */
.ow-rule-body { display: block; }
.ow-edpanel { transition: width .2s ease; }
.ow-picker { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border-radius: 12px; border: 1px solid var(--ow-line);
  background: var(--ow-chrome); color: var(--ow-text); font: inherit; text-align: left; cursor: pointer; }
.ow-picker:hover { border-color: var(--ow-acc); }
.ow-picker .ow-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ow-picker .ow-nm b { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-picker .ow-nm span { font-size: 12px; color: var(--ow-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ow-picker-act { font-size: 12px; font-weight: 600; color: var(--ow-acc); flex-shrink: 0; }
.ow-picker.ow-empty-pick { border-style: dashed; border-color: color-mix(in srgb, var(--ow-acc) 60%, transparent); }
.ow-picker.ow-empty-pick .ow-tile { background: var(--ow-acc); color: var(--ow-acc-ink); }

.ow-keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; padding: 8px 10px; font-size: 12.5px; align-items: center; }
.ow-keys kbd { font: 600 11px ${FONT}; background: var(--ow-chrome2); border: 1px solid var(--ow-line); border-radius: 5px; padding: 2px 6px; color: var(--ow-text); justify-self: start; white-space: nowrap; }
.ow-keys span { color: var(--ow-muted); }
`;
