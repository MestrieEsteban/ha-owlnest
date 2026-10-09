/**
 * Ce qui flotte sur la carte en dehors de l'édition : des modules (la barre
 * d'outils, les vues enregistrées, l'état de la maison) posés dans six
 * emplacements, et le panneau qui permet de les déplacer et de changer de
 * thème.
 *
 * La carte fournit les boutons et les données ; ce module ne connaît ni
 * Three.js ni Home Assistant.
 */
import { t, type StringKey } from '../i18n';
import { icon, iconHtml } from '../ui/icons';
import {
  ACCENTS, MODULES, SKINS, SLOTS, applyTheme, uiPrefs,
  type ModuleId, type Skin, type Slot, type UiPrefs,
} from '../ui/theme';

export interface DockButton {
  id: string;
  icon: string;
  /** Texte à la place de l'icône (icônes personnalisées du YAML). */
  text?: string;
  label: () => string;
  onClick: (btn: HTMLButtonElement) => void;
  visible?: () => boolean;
  active?: () => boolean;
  alert?: () => boolean;
  /** Un trait de séparation avant ce bouton. */
  sepBefore?: boolean;
}

export interface HudView { id: string; label: string }

/** Une pièce du plan, et le nombre de lampes allumées dedans. */
export interface HudRoom { id: string; name: string; lit: number }

export interface HudStatus {
  /** Température extérieure, déjà formatée. */
  temp?: string;
  /** Météo en clair. */
  weather?: string;
  lightsOn: number;
}

const SKIN_LABEL: Record<Skin, StringKey> = { night: 'uiSkinNight', paper: 'uiSkinPaper', glass: 'uiSkinGlass', ha: 'uiSkinHa' };
const SKIN_SWATCH: Record<Skin, string> = { night: '#0b1220', paper: '#fbfaf7', glass: 'rgba(10,16,30,0.42)', ha: '#ffffff' };
const MODULE_LABEL: Record<ModuleId, StringKey> = { rooms: 'uiModRooms', views: 'uiModViews', status: 'uiModStatus', dock: 'uiModDock' };
type Toggleable = 'rooms' | 'views' | 'status';

export class CardHud {
  prefs: UiPrefs;
  private slots = new Map<Slot, HTMLDivElement>();
  private dockEl: HTMLDivElement | null = null;
  private viewsEl: HTMLDivElement | null = null;
  private roomsEl: HTMLDivElement | null = null;
  private activeRoom: string | null = null;
  private lastRooms = '';
  private statusEl: HTMLDivElement | null = null;
  private sheet: HTMLElement | null = null;
  private helloEl: HTMLDivElement | null = null;
  private visible = true;
  private hidden = false;
  private activeView: string | null = null;
  private lastStatus = '';
  /** Disposition : le module saisi (toucher puis case), et le glisser en cours. */
  private picked: ModuleId | null = null;
  private drag: { k: ModuleId; x: number; y: number; ghost: HTMLElement | null } | null = null;

  constructor(
    private host: HTMLElement,
    saved: Partial<UiPrefs> | undefined,
    private buttons: DockButton[],
    private opts: {
      getViews: () => HudView[];
      flyTo: (id: string) => void;
      /** Les pièces du plan (vide sans plan). */
      getRooms: () => HudRoom[];
      /** Va dans une pièce ; `null` revient à toute la maison. */
      flyToRoom: (id: string | null) => void;
      getStatus: () => HudStatus | null;
      onPrefs: (p: UiPrefs) => void;
      /** Pour les messages d'aide : la carte affiche-t-elle un plan ? */
      startTour: () => void;
    },
  ) {
    this.prefs = uiPrefs(saved);
    host.classList.add('ow-ui');
    applyTheme(host, this.prefs.skin, this.prefs.accent);
    for (const s of SLOTS) {
      const el = document.createElement('div');
      el.className = 'ow-slot ow-fade';
      el.dataset.slot = s;
      host.appendChild(el);
      this.slots.set(s, el);
    }
    this.render();
  }

  /** Les préférences ont changé ailleurs (rechargement de la scène). */
  setPrefs(saved: Partial<UiPrefs> | undefined) {
    this.prefs = uiPrefs(saved);
    applyTheme(this.host, this.prefs.skin, this.prefs.accent);
    this.render();
    if (this.sheet) this.renderSheet();
  }

  /** Tout masquer (édition, éditeur de plan). */
  setHidden(on: boolean) {
    this.hidden = on;
    this.applyVisibility();
    if (on) { this.closeSheet(); this.hideHello(); }
  }

  /** Les outils au repos : s'effacent seulement si l'utilisateur l'a choisi. */
  setIdle(idle: boolean) {
    this.visible = !idle;
    this.applyVisibility();
  }

  get isHidden() { return this.hidden; }

  private applyVisibility() {
    for (const [, el] of this.slots) {
      const hasDock = !!this.dockEl && el.contains(this.dockEl);
      const fade = this.hidden || (hasDock && this.prefs.autohide && !this.visible && !this.sheet?.classList.contains('ow-open'));
      el.classList.toggle('ow-hidden', fade);
    }
  }

  /** Repeint la barre d'outils (un état a changé). */
  refreshDock() { this.renderDock(); this.applyVisibility(); }

  /** Les vues enregistrées ont changé. */
  refreshViews() { this.renderViews(); }

  /** La pièce montrée (ou aucune) : un clic sur une vue l'efface, et réciproquement. */
  setActiveRoom(id: string | null) {
    this.activeRoom = id;
    this.roomsEl?.querySelectorAll<HTMLButtonElement>('.ow-chip').forEach((b) => b.classList.toggle('ow-on', (b.dataset.room || null) === id));
  }

  /** Les pièces ou leurs lampes ont pu changer : ne repeint que si quelque chose a bougé. */
  refreshRooms() {
    const rooms = this.prefs.show.rooms ? this.opts.getRooms() : [];
    const key = JSON.stringify(rooms);
    if (key === this.lastRooms) return;
    this.lastRooms = key;
    this.renderRooms(rooms);
  }

  get roomsModule() { return this.roomsEl; }
  get activeRoomId() { return this.activeRoom; }

  setActiveView(id: string | null) {
    this.activeView = id;
    if (id) this.setActiveRoom(null);
    this.viewsEl?.querySelectorAll<HTMLButtonElement>('.ow-chip').forEach((b) => b.classList.toggle('ow-on', b.dataset.view === id));
  }

  /** L'état de la maison a pu changer : ne repeint que si le texte change. */
  refreshStatus() {
    const s = this.prefs.show.status ? this.opts.getStatus() : null;
    const key = JSON.stringify(s);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.renderStatus();
  }

  dockButton(id: string): HTMLButtonElement | null {
    return this.dockEl?.querySelector<HTMLButtonElement>(`[data-dock="${id}"]`) ?? null;
  }

  get dock() { return this.dockEl; }
  get viewsModule() { return this.viewsEl; }

  // ── Rendu ────────────────────────────────────────────────────────────────

  private render() {
    this.host.classList.toggle('ow-names', this.prefs.show.names);
    for (const [, el] of this.slots) el.innerHTML = '';
    this.dockEl = this.viewsEl = this.statusEl = this.roomsEl = null;
    this.renderDock();
    this.lastRooms = '';
    this.refreshRooms();
    this.renderViews();
    this.lastStatus = '';
    this.refreshStatus();
    this.applyVisibility();
  }

  private place(k: ModuleId, el: HTMLElement) {
    const slot = this.slots.get(this.prefs.slots[k])!;
    // Ordre stable dans un emplacement partagé : barre d'outils, vues, état.
    el.dataset.module = k;
    const order = MODULES.indexOf(k);
    const after = Array.from(slot.children).find((c) => MODULES.indexOf((c as HTMLElement).dataset.module as ModuleId) > order);
    slot.insertBefore(el, after ?? null);
  }

  private renderDock() {
    const el = this.dockEl ?? document.createElement('div');
    if (!this.dockEl) {
      el.className = 'ow-surface ow-dock';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', t('uiModDock'));
      this.dockEl = el;
      this.place('dock', el);
    }
    el.innerHTML = '';
    let first = true;
    for (const b of this.buttons) {
      if (b.visible && !b.visible()) continue;
      if (b.sepBefore && !first) el.append(Object.assign(document.createElement('span'), { className: 'ow-sepv' }));
      first = false;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ow-ib';
      btn.dataset.dock = b.id;
      btn.classList.toggle('ow-on', !!b.active?.());
      btn.classList.toggle('ow-alert', !!b.alert?.());
      const label = b.label();
      btn.title = label;
      btn.setAttribute('aria-label', label);
      if (b.text) btn.textContent = b.text;
      else btn.append(icon(b.icon, 20));
      btn.addEventListener('click', (e) => { e.stopPropagation(); b.onClick(btn); });
      el.append(btn);
    }
  }

  private renderRooms(rooms: HudRoom[]) {
    // Une seule pièce : le bouton « Maison » suffit, le module ne sert à rien.
    if (rooms.length < 2) { this.roomsEl?.remove(); this.roomsEl = null; return; }
    if (!this.roomsEl) {
      const el = document.createElement('div');
      el.className = 'ow-surface ow-rooms';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', t('uiModRooms'));
      this.roomsEl = el;
      this.place('rooms', el);
    }
    this.roomsEl.innerHTML = '';
    const chip = (id: string, label: string, lit: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ow-chip';
      b.dataset.room = id;
      b.textContent = label;
      if (lit > 0) {
        const badge = document.createElement('i');
        badge.textContent = String(lit);
        badge.title = lit > 1 ? `${lit} ${t('uiLightsOnMany')}` : `${lit} ${t('uiLightsOn')}`;
        b.append(badge);
      }
      b.classList.toggle('ow-on', (id || null) === this.activeRoom);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setActiveRoom(id || null);
        this.setActiveView(null);
        this.opts.flyToRoom(id || null);
      });
      this.roomsEl!.append(b);
    };
    chip('', t('uiRoomsHome'), rooms.reduce((n, r) => n + r.lit, 0));
    for (const r of rooms) chip(r.id, r.name, r.lit);
  }

  private renderViews() {
    const views = this.prefs.show.views ? this.opts.getViews() : [];
    if (!views.length) { this.viewsEl?.remove(); this.viewsEl = null; return; }
    if (!this.viewsEl) {
      const el = document.createElement('div');
      el.className = 'ow-surface ow-views';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', t('uiModViews'));
      this.viewsEl = el;
      this.place('views', el);
    }
    this.viewsEl.innerHTML = '';
    for (const v of views) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ow-chip';
      b.dataset.view = v.id;
      b.textContent = v.label;
      b.classList.toggle('ow-on', v.id === this.activeView);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setActiveView(v.id); this.opts.flyTo(v.id); });
      this.viewsEl.append(b);
    }
  }

  private renderStatus() {
    const s = this.prefs.show.status ? this.opts.getStatus() : null;
    if (!s) { this.statusEl?.remove(); this.statusEl = null; return; }
    if (!this.statusEl) {
      const el = document.createElement('div');
      el.className = 'ow-surface ow-status';
      this.statusEl = el;
      this.place('status', el);
    }
    const parts: string[] = [];
    if (s.temp || s.weather) {
      parts.push(`${iconHtml('sun', 17)}${s.temp ? `<b>${s.temp}</b>` : ''}${s.weather ? `<span class="ow-muted">${escapeHtml(s.weather)}</span>` : ''}`);
    }
    parts.push(`${iconHtml('bulb', 17)}<b>${s.lightsOn}</b><span class="ow-muted">${s.lightsOn > 1 ? t('uiLightsOnMany') : t('uiLightsOn')}</span>`);
    this.statusEl.innerHTML = parts.join('<span class="ow-sep"></span>');
  }

  // ── Invitation au tutoriel ───────────────────────────────────────────────

  showHello() {
    if (this.helloEl || this.hidden) return;
    const el = document.createElement('div');
    el.className = 'ow-surface ow-pill';
    el.style.top = '12px';
    el.innerHTML = `<span>${t('uiHello')}</span>`;
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'ow-btn ow-primary ow-small';
    go.style.borderRadius = '999px';
    go.textContent = t('uiHelloGo');
    go.addEventListener('click', (e) => { e.stopPropagation(); this.hideHello(); this.opts.startTour(); });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ow-ib';
    x.style.cssText = 'width:28px;height:28px;';
    x.setAttribute('aria-label', t('tourClose'));
    x.append(icon('close', 15));
    x.addEventListener('click', (e) => { e.stopPropagation(); this.hideHello(true); });
    el.append(go, x);
    this.host.appendChild(el);
    this.helloEl = el;
  }

  /** `dismissed` : l'utilisateur l'a fermée, elle ne revient plus. */
  hideHello(dismissed = false) {
    this.helloEl?.remove();
    this.helloEl = null;
    if (dismissed) this.onHelloDismissed?.();
  }
  onHelloDismissed?: () => void;

  // ── Personnaliser ────────────────────────────────────────────────────────

  get customizing() { return !!this.sheet?.classList.contains('ow-open'); }

  toggleSheet() { if (this.customizing) this.closeSheet(); else this.openSheet(); }

  openSheet() {
    this.hideHello();
    if (!this.sheet) {
      const sheet = document.createElement('aside');
      sheet.className = 'ow-surface ow-sheet';
      sheet.setAttribute('aria-label', t('uiCustomize'));
      sheet.addEventListener('click', this.onSheetClick);
      sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.host.appendChild(sheet);
      this.sheet = sheet;
      document.addEventListener('pointerdown', this.onDown, true);
      document.addEventListener('pointermove', this.onMove, true);
      document.addEventListener('pointerup', this.onUp, true);
    }
    this.renderSheet();
    requestAnimationFrame(() => { this.sheet?.classList.add('ow-open'); this.applyVisibility(); });
    this.refreshDock();
  }

  closeSheet() {
    const sheet = this.sheet;
    if (!sheet) return;
    this.sheet = null;
    this.picked = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('pointermove', this.onMove, true);
    document.removeEventListener('pointerup', this.onUp, true);
    sheet.classList.remove('ow-open');
    setTimeout(() => sheet.remove(), 320);
    this.refreshDock();
  }

  private save() {
    applyTheme(this.host, this.prefs.skin, this.prefs.accent);
    this.opts.onPrefs(this.prefs);
  }

  private renderSheet() {
    const sh = this.sheet;
    if (!sh) return;
    const p = this.prefs;
    const cells = SLOTS.map((c) => `<div class="ow-cell" data-cell="${c}">${MODULES.filter((k) => p.slots[k] === c).map((k) =>
      `<button type="button" class="ow-mchip${this.picked === k ? ' ow-sel' : ''}${k !== 'dock' && !p.show[k as Toggleable] ? ' ow-off' : ''}" data-m="${k}">${t(MODULE_LABEL[k])}</button>`).join('')}</div>`).join('');
    const sw = (on: boolean, key: string, label: string) =>
      `<div class="ow-row-opt"><span>${label}</span><button type="button" class="ow-switch${on ? ' ow-on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-opt="${key}"></button></div>`;
    sh.innerHTML = `
      <header><span>${t('uiCustomize')}</span><button type="button" class="ow-ib" data-act="close" aria-label="${t('tourClose')}">${iconHtml('close', 18)}</button></header>
      <div class="ow-body">
        <div><div class="ow-h5">${t('uiLayout')}</div><div class="ow-map${this.picked ? ' ow-placing' : ''}">${cells}</div>
          <div class="ow-hint" style="margin-top:8px">${iconHtml('move', 16)}<span>${t('uiLayoutHint')}</span></div></div>
        <div><div class="ow-h5">${t('uiTheme')}</div><div class="ow-skins">${SKINS.map((s) =>
          `<button type="button" class="ow-skin${s === p.skin ? ' ow-on' : ''}" data-skin="${s}" style="--sw:${SKIN_SWATCH[s]}"><i></i>${t(SKIN_LABEL[s])}</button>`).join('')}</div></div>
        <div><div class="ow-h5">${t('uiAccent')}</div><div class="ow-accents">${ACCENTS.map((a) =>
          `<button type="button" class="ow-acc${a === p.accent ? ' ow-on' : ''}" data-acc="${a}" style="--sw:${a === 'auto' ? 'conic-gradient(#38bdf8,#34d399,#fbbf24,#f472b6,#a78bfa,#38bdf8)' : a}" aria-label="${a === 'auto' ? t('uiAccentAuto') : a}">${a === 'auto' ? 'A' : ''}</button>`).join('')}</div></div>
        <div><div class="ow-h5">${t('uiModules')}</div>
          ${sw(p.show.rooms, 'rooms', t('uiModRooms'))}
          ${sw(p.show.views, 'views', t('uiModViews'))}
          ${sw(p.show.status, 'status', t('uiModStatus'))}
          ${sw(p.show.names, 'names', t('uiNames'))}
          ${sw(p.autohide, 'autohide', t('uiAutohide'))}</div>
      </div>
      <footer><button type="button" class="ow-btn ow-ghost" data-act="reset">${t('uiReset')}</button><button type="button" class="ow-btn ow-primary" data-act="close">${t('planDone')}</button></footer>`;
  }

  private onSheetClick = (e: Event) => {
    e.stopPropagation();
    if (this.suppressClick) return;
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('.ow-mchip');
    if (chip) { this.picked = this.picked === chip.dataset.m ? null : chip.dataset.m as ModuleId; this.renderSheet(); return; }
    const cell = target.closest<HTMLElement>('.ow-cell');
    if (cell) { if (this.picked) this.move(this.picked, cell.dataset.cell as Slot); return; }
    const b = target.closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.skin) { this.prefs.skin = b.dataset.skin as Skin; this.save(); this.renderSheet(); return; }
    if (b.dataset.acc) { this.prefs.accent = b.dataset.acc; this.save(); this.renderSheet(); return; }
    if (b.dataset.opt) {
      const k = b.dataset.opt;
      if (k === 'autohide') this.prefs.autohide = !this.prefs.autohide;
      else if (k === 'names') this.prefs.show.names = !this.prefs.show.names;
      else this.prefs.show[k as Toggleable] = !this.prefs.show[k as Toggleable];
      this.save(); this.render(); this.renderSheet(); return;
    }
    if (b.dataset.act === 'close') { this.closeSheet(); return; }
    if (b.dataset.act === 'reset') { this.prefs = uiPrefs(null); this.save(); this.render(); this.renderSheet(); }
  };

  private move(k: ModuleId, cell: Slot) {
    this.prefs.slots[k] = cell;
    this.picked = null;
    this.save();
    this.render();
    this.renderSheet();
  }

  // Glisser une étiquette du mini-plan, au doigt comme à la souris.
  private suppressClick = false;
  private onDown = (e: PointerEvent) => {
    const chip = (e.composedPath()[0] as HTMLElement | undefined)?.closest?.('.ow-mchip') as HTMLElement | null;
    if (!chip || !this.sheet?.contains(chip)) return;
    this.drag = { k: chip.dataset.m as ModuleId, x: e.clientX, y: e.clientY, ghost: null };
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.ghost = document.createElement('div');
      d.ghost.className = 'ow-mchip ow-drag-ghost';
      d.ghost.textContent = t(MODULE_LABEL[d.k]);
      this.host.appendChild(d.ghost);
    }
    if (!d.ghost) return;
    e.preventDefault();
    d.ghost.style.left = `${e.clientX}px`;
    d.ghost.style.top = `${e.clientY}px`;
    const hit = this.cellAt(e.clientX, e.clientY);
    this.sheet?.querySelectorAll('.ow-cell').forEach((c) => c.classList.toggle('ow-hot', c === hit));
  };
  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d?.ghost) return;
    d.ghost.remove();
    const hit = this.cellAt(e.clientX, e.clientY);
    this.suppressClick = true;
    setTimeout(() => { this.suppressClick = false; }, 0);
    if (hit) this.move(d.k, hit.dataset.cell as Slot);
    else this.renderSheet();
  };
  private cellAt(x: number, y: number): HTMLElement | null {
    for (const c of Array.from(this.sheet?.querySelectorAll<HTMLElement>('.ow-cell') ?? [])) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
    }
    return null;
  }

  destroy() {
    this.closeSheet();
    this.hideHello();
    for (const [, el] of this.slots) el.remove();
    this.slots.clear();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
