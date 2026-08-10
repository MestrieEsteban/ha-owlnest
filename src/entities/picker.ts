/**
 * entities/picker.ts — sélecteur d'entités.
 *
 * Conçu pour un usage précis : placer un objet physique dans un modèle 3D de la
 * maison. D'où les partis pris, tirés d'une installation réelle de 469 entités :
 *
 *   - les entités `config` et `diagnostic` sont masquées par défaut (elles
 *     représentaient un tiers du total et n'ont rien à faire sur un plan) ;
 *   - le regroupement par Étage → Pièce est la vue primaire, mais la majorité
 *     des entités n'a aucune pièce : le repli par appareil et par domaine est
 *     indispensable, pas optionnel ;
 *   - l'état courant est affiché sur chaque ligne, parce qu'identifier « quelle
 *     lampe est celle-ci » se fait en la regardant, pas en lisant son nom.
 */

import type { Hass } from '../types';
import { t, tn } from '../i18n';
import { describeEntity, fallbackIcon } from './descriptors';
import {
  loadRegistry, areaOf, deviceOf, floorOf, isTechnical, displayName,
  type Registry,
} from './registry';

export type GroupMode = 'area' | 'device' | 'domain';

export interface PickerOptions {
  container: HTMLElement;
  hass: Hass;
  /**
   * Quand fourni, un bouton propose de créer une ancre sans entité (étiquette,
   * roue d'actions, navigation) — sa nature se règle ensuite dans ses
   * propriétés.
   */
  onPickNone?: () => void;
  /** Entités déjà posées dans la scène — signalées, et masquables. */
  placed?: Set<string>;
  onPick: (entityId: string, label: string) => void;
  /**
   * Active la selection multiple. Cliquer une ligne la coche au lieu de valider,
   * et un bouton confirme l'ensemble — indispensable pour composer un groupe.
   */
  multi?: boolean;
  onPickMany?: (entityIds: string[]) => void;
  onCancel?: () => void;
}

interface Row {
  entityId: string;
  name: string;
  /** Libellé affiché en en-tête de groupe. */
  group: string;
  /** 0 = groupe nommé, 1 = fourre-tout (« Sans pièce ») — toujours en dernier. */
  rank: number;
  /** Clé de tri du groupe, distincte du libellé (étage, puis pièce). */
  sort: string;
  /** Texte concaténé sur lequel porte la recherche. */
  haystack: string;
}

const CSS = {
  panel: [
    'position:absolute', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
    'width:min(440px,92vw)', 'height:min(560px,86%)',
    'display:flex', 'flex-direction:column',
    'background:#151a27', 'border:1px solid rgba(255,255,255,0.13)',
    'border-radius:12px', 'z-index:100000', 'overflow:hidden',
    'box-shadow:0 16px 48px rgba(0,0,0,0.75)',
    'font-family:var(--primary-font-family,sans-serif)', 'color:#e2e8f0',
    'pointer-events:auto',
  ].join(';'),
  input: [
    'width:100%', 'box-sizing:border-box', 'background:rgba(255,255,255,0.05)',
    'border:1px solid rgba(255,255,255,0.12)', 'border-radius:8px',
    'color:#e2e8f0', 'padding:8px 10px', 'font-size:13px', 'outline:none',
    'font-family:inherit',
  ].join(';'),
  chip: (active: boolean) => [
    'border-radius:999px', 'padding:3px 10px', 'font-size:10px', 'cursor:pointer',
    'border:1px solid ' + (active ? 'rgba(125,209,252,0.55)' : 'rgba(255,255,255,0.12)'),
    'background:' + (active ? 'rgba(125,209,252,0.16)' : 'transparent'),
    'color:' + (active ? '#7dd3fc' : '#94a3b8'),
    'font-family:inherit', 'white-space:nowrap',
  ].join(';'),
};

export function openEntityPicker(opts: PickerOptions): () => void {
  const { container, hass, placed = new Set(), onPick, onPickNone, onCancel } = opts;
  const multi = opts.multi === true && !!opts.onPickMany;
  /** Selection en cours, en mode multiple. */
  const chosen = new Set<string>();

  let reg: Registry | null = null;
  let group: GroupMode = 'area';
  let hideTechnical = true;
  let hidePlaced = false;
  let query = '';
  let rows: Row[] = [];
  let flat: string[] = [];   // entity_ids visibles, dans l'ordre affiché
  let cursor = -1;

  // ── Structure ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText = CSS.panel;

  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:8px;';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;font-weight:600;color:#aac8e8;flex:1;';
  title.textContent = multi ? t('pickTitleMulti') : t('pickTitle');
  const count = document.createElement('div');
  count.style.cssText = 'font-size:10px;color:#64748b;';
  titleRow.append(title, count);

  const search = document.createElement('input');
  search.placeholder = t('pickSearch');
  search.style.cssText = CSS.input;

  const filters = document.createElement('div');
  filters.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center;';

  header.append(titleRow, search, filters);

  const list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0 8px;';

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:8px 14px;border-top:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;gap:8px;';
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:9px;color:#475569;';
  hint.textContent = multi ? t('pickHintMulti') : t('pickHint');
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = t('pickCancel');
  cancelBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.14);border-radius:7px;color:#94a3b8;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit;';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;align-items:center;';

  const confirmBtn = document.createElement('button');
  confirmBtn.style.cssText = 'background:rgba(74,222,128,0.14);border:1px solid rgba(74,222,128,0.4);border-radius:7px;color:#4ade80;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit;white-space:nowrap;';
  const syncConfirm = () => {
    confirmBtn.textContent = tn('pickAddN', chosen.size);
    confirmBtn.disabled = chosen.size === 0;
    confirmBtn.style.opacity = chosen.size === 0 ? '0.45' : '1';
  };
  if (multi) {
    syncConfirm();
    confirmBtn.addEventListener('click', () => {
      if (!chosen.size) return;
      const ids = [...chosen];
      close();
      opts.onPickMany?.(ids);
    });
    actions.appendChild(confirmBtn);
  }
  if (onPickNone) {
    const noneBtn = document.createElement('button');
    noneBtn.textContent = t('pickNoEntity');
    noneBtn.title = t('pickNoEntityHint');
    noneBtn.style.cssText = 'background:rgba(125,209,252,0.1);border:1px solid rgba(125,209,252,0.28);border-radius:7px;color:#7dd3fc;font-size:11px;padding:6px 11px;cursor:pointer;font-family:inherit;white-space:nowrap;';
    noneBtn.addEventListener('click', () => { close(); onPickNone(); });
    actions.appendChild(noneBtn);
  }
  actions.appendChild(cancelBtn);
  footer.append(hint, actions);

  panel.append(header, list, footer);
  container.appendChild(panel);

  // ── Fermeture ────────────────────────────────────────────────────────────
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    panel.remove();
  };
  cancelBtn.addEventListener('click', () => { close(); onCancel?.(); });

  // ── Filtres ──────────────────────────────────────────────────────────────
  const groupChip = (mode: GroupMode, label: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = CSS.chip(group === mode);
    b.addEventListener('click', () => { group = mode; rebuildFilters(); render(); });
    return b;
  };
  const toggleChip = (label: string, active: boolean, onToggle: () => void) => {
    const b = document.createElement('button');
    b.textContent = (active ? '✓ ' : '') + label;
    b.style.cssText = CSS.chip(active);
    b.addEventListener('click', () => { onToggle(); rebuildFilters(); render(); });
    return b;
  };

  function rebuildFilters() {
    filters.innerHTML = '';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:.06em;';
    lbl.textContent = t('pickGroupBy');
    filters.append(
      lbl,
      groupChip('area', t('pickGroupArea')),
      groupChip('device', t('pickGroupDevice')),
      groupChip('domain', t('pickGroupDomain')),
    );
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:14px;background:rgba(255,255,255,0.1);margin:0 2px;';
    filters.append(
      sep,
      toggleChip(t('pickHideTechnical'), hideTechnical, () => { hideTechnical = !hideTechnical; }),
      toggleChip(t('pickHidePlaced'), hidePlaced, () => { hidePlaced = !hidePlaced; }),
    );
  }

  // ── Construction des lignes ──────────────────────────────────────────────
  /**
   * Libellé, rang et clé de tri d'un groupe.
   *
   * Le libellé ne peut pas servir de clé de tri : « Sans pièce » se classerait
   * alphabétiquement au milieu des pièces réelles, et les étages seraient triés
   * par nom plutôt que par niveau. Les fourre-tout sont donc rangés à part.
   */
  function groupOf(entityId: string): { label: string; rank: number; sort: string } {
    const domain = entityId.split('.')[0];
    if (!reg?.loaded || group === 'domain') return { label: domain, rank: 0, sort: domain };

    if (group === 'device') {
      const d = deviceOf(reg, entityId);
      return d
        ? { label: d.name, rank: 0, sort: d.name.toLowerCase() }
        : { label: t('pickNoDevice'), rank: 1, sort: '' };
    }

    const a = areaOf(reg, entityId);
    if (!a) return { label: t('pickNoArea'), rank: 1, sort: '' };

    const f = floorOf(reg, a);
    // Les étages se trient par niveau (rez avant étage), pas par nom. Une pièce
    // sans étage passe après celles qui en ont un, mais avant « Sans pièce ».
    const level = String((f?.level ?? 998) + 1000);
    return {
      label: f ? `${f.name} · ${a.name}` : a.name,
      rank: 0,
      sort: `${level} ${(f?.name ?? '').toLowerCase()} ${a.name.toLowerCase()}`,
    };
  }

  function buildRows() {
    rows = [];
    if (!reg) return;
    for (const entityId of Object.keys(hass.states)) {
      const info = reg.entities.get(entityId);
      // Une entité désactivée n'a normalement pas d'état, mais on ne prend pas
      // le risque de l'afficher si elle en a un.
      if (info?.disabled || info?.hidden) continue;
      if (hideTechnical && isTechnical(reg, entityId)) continue;
      if (hidePlaced && placed.has(entityId)) continue;

      const name = displayName(reg, hass, entityId);
      const g = groupOf(entityId);
      const dev = deviceOf(reg, entityId)?.name ?? '';
      const area = areaOf(reg, entityId)?.name ?? '';
      rows.push({
        entityId,
        name,
        group: g.label,
        rank: g.rank,
        sort: g.sort,
        haystack: `${entityId} ${name} ${dev} ${area}`.toLowerCase(),
      });
    }
    rows.sort((a, b) =>
      a.rank - b.rank ||
      a.sort.localeCompare(b.sort) ||
      a.name.localeCompare(b.name),
    );
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  function render() {
    buildRows();
    const q = query.trim().toLowerCase();
    const shown = q ? rows.filter((r) => r.haystack.includes(q)) : rows;

    list.innerHTML = '';
    flat = [];
    cursor = -1;

    count.textContent = tn('pickCount', shown.length);

    if (!shown.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:28px 14px;text-align:center;color:#475569;font-size:11px;';
      empty.textContent = reg?.loaded ? t('pickNoResult') : t('pickLoading');
      list.appendChild(empty);
      return;
    }

    let current = '';
    for (const row of shown) {
      if (row.group !== current) {
        current = row.group;
        const h = document.createElement('div');
        h.style.cssText = [
          'position:sticky', 'top:0', 'z-index:1',
          'background:#151a27', 'padding:7px 14px 4px',
          'font-size:9px', 'font-weight:700', 'color:#64748b',
          'text-transform:uppercase', 'letter-spacing:.07em',
        ].join(';');
        h.textContent = current;
        list.appendChild(h);
      }
      list.appendChild(makeRow(row));
      flat.push(row.entityId);
    }
  }

  function makeRow(row: Row): HTMLElement {
    const st = hass.states[row.entityId];
    const desc = describeEntity(row.entityId);
    const on = desc.isOn(st);
    const hex = '#' + desc.color(st).toString(16).padStart(6, '0');
    const isPlaced = placed.has(row.entityId);

    const el = document.createElement('div');
    el.dataset.entity = row.entityId;
    el.style.cssText = 'display:flex;align-items:center;gap:9px;padding:6px 14px;cursor:pointer;';

    // Les descripteurs renvoient `undefined` quand l'overlay 3D utilise son SVG
    // intégré. Dans une liste, il faut malgré tout une icône.
    const mdi = desc.icon(st) ?? fallbackIcon(row.entityId.split('.')[0]);
    const icon = document.createElement('div');
    icon.style.cssText = 'width:26px;height:26px;flex:0 0 26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);';
    icon.style.color = on ? hex : '#556070';
    icon.innerHTML = mdi
      ? `<ha-icon icon="${mdi}" style="--mdi-icon-size:16px;width:16px;height:16px;"></ha-icon>`
      : `<span style="font-size:9px;">${row.entityId.split('.')[0].slice(0, 3)}</span>`;

    const texts = document.createElement('div');
    texts.style.cssText = 'flex:1;min-width:0;';
    const l1 = document.createElement('div');
    l1.style.cssText = 'font-size:12px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    l1.textContent = row.name;
    const l2 = document.createElement('div');
    l2.style.cssText = 'font-size:9px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    l2.textContent = row.entityId;
    texts.append(l1, l2);

    const state = document.createElement('div');
    state.style.cssText = `font-size:10px;color:${on ? hex : '#64748b'};flex:0 0 auto;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;`;
    state.textContent = desc.stateText(st);

    el.append(icon, texts, state);

    if (isPlaced) {
      el.style.opacity = '0.55';
      const badge = document.createElement('span');
      badge.textContent = '●';
      badge.title = t('pickPlaced');
      badge.style.cssText = 'color:#4ade80;font-size:9px;flex:0 0 auto;';
      el.appendChild(badge);
    }

    // En mode multiple, une marque remplace la validation immediate.
    const tick = document.createElement('span');
    if (multi) {
      tick.style.cssText = 'flex:0 0 auto;width:14px;text-align:center;font-size:11px;color:#4ade80;';
      const syncTick = () => {
        const sel = chosen.has(row.entityId);
        tick.textContent = sel ? '✓' : '';
        el.style.background = sel ? 'rgba(74,222,128,0.1)' : '';
      };
      syncTick();
      el.insertBefore(tick, el.firstChild);
      el.addEventListener('click', () => {
        if (chosen.has(row.entityId)) chosen.delete(row.entityId);
        else chosen.add(row.entityId);
        syncTick();
        syncConfirm();
      });
      el.addEventListener('mouseenter', () => {
        if (!chosen.has(row.entityId)) el.style.background = 'rgba(255,255,255,0.06)';
      });
      el.addEventListener('mouseleave', () => {
        if (!chosen.has(row.entityId)) el.style.background = '';
      });
      return el;
    }

    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(255,255,255,0.06)'; });
    el.addEventListener('mouseleave', () => { if (!el.dataset.active) el.style.background = ''; });
    el.addEventListener('click', () => { close(); onPick(row.entityId, row.name); });
    return el;
  }

  // ── Navigation clavier ───────────────────────────────────────────────────
  function highlight(i: number) {
    const children = Array.from(list.querySelectorAll<HTMLElement>('[data-entity]'));
    children.forEach((c) => { delete c.dataset.active; c.style.background = ''; });
    if (i < 0 || i >= children.length) return;
    const el = children[i];
    el.dataset.active = '1';
    el.style.background = 'rgba(125,209,252,0.14)';
    el.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    if (closed) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); onCancel?.(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!flat.length) return;
      cursor = e.key === 'ArrowDown'
        ? Math.min(cursor + 1, flat.length - 1)
        : Math.max(cursor - 1, 0);
      highlight(cursor);
      return;
    }
    if (e.key === 'Enter' && cursor >= 0 && cursor < flat.length) {
      e.preventDefault(); e.stopPropagation();
      const id = flat[cursor];
      if (multi) {
        // Entree coche et laisse le panneau ouvert : on compose une liste.
        const el = Array.from(list.querySelectorAll<HTMLElement>('[data-entity]'))
          .find((c) => c.dataset.entity === id);
        el?.dispatchEvent(new MouseEvent('click'));
        return;
      }
      const name = rows.find((r) => r.entityId === id)?.name ?? id;
      close();
      onPick(id, name);
    }
  }
  // En capture : le composant hôte écoute aussi les touches en mode édition.
  document.addEventListener('keydown', onKey, true);

  search.addEventListener('input', () => { query = search.value; render(); });

  // ── Démarrage ────────────────────────────────────────────────────────────
  rebuildFilters();
  render();
  setTimeout(() => search.focus(), 50);

  loadRegistry(hass).then((r) => {
    if (closed) return;
    reg = r;
    render();
  });

  return close;
}
