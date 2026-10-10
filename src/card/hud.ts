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

/** Une pièce du plan, ses lampes allumées et sa température si un capteur y est posé. */
export interface HudRoom { id: string; name: string; lit: number; temp?: string }

/** Un appareil posé dans une pièce, pour le panneau de la pièce. */
export interface HudDevice {
  id: string;
  name: string;
  state: string;
  on: boolean;
  icon: string;
  /** Se bascule d'un geste (lampe, prise…) ; sinon, toucher ouvre ses détails. */
  toggle: boolean;
}

export interface HudStatus {
  /** Température extérieure, déjà formatée. */
  temp?: string;
  /** Météo en clair. */
  weather?: string;
  lightsOn: number;
}

const SKIN_LABEL: Record<Skin, StringKey> = { night: 'uiSkinNight', paper: 'uiSkinPaper', glass: 'uiSkinGlass', ha: 'uiSkinHa' };
const SKIN_SWATCH: Record<Skin, string> = { night: '#0b1220', paper: '#fbfaf7', glass: 'rgba(10,16,30,0.42)', ha: '#ffffff' };
const MODULE_LABEL: Record<ModuleId, StringKey> = { rooms: 'uiModRooms', status: 'uiModStatus', dock: 'uiModDock' };
type Toggleable = 'rooms' | 'views' | 'status';

export class CardHud {
  prefs: UiPrefs;
  private slots = new Map<Slot, HTMLDivElement>();
  private dockEl: HTMLDivElement | null = null;
  private roomsEl: HTMLDivElement | null = null;
  private roomPanel: HTMLDivElement | null = null;
  private activeRoom: string | null = null;
  private lastRooms = '';
  private lastPanel = '';
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
      /** Les niveaux du logement (un seul : pas de choix d'étage). */
      getFloors: () => { index: number; name: string }[];
      getActiveFloor: () => number;
      setFloor: (index: number) => void;
      /** Les pièces de l'étage montré (vide sans plan). */
      getRooms: () => HudRoom[];
      /** Va dans une pièce ; `null` revient à toute la maison. */
      flyToRoom: (id: string | null) => void;
      /** Les appareils posés dans une pièce. */
      getRoomDevices: (roomId: string) => HudDevice[];
      toggleDevice: (entityId: string) => void;
      moreInfo: (entityId: string) => void;
      roomAllOff: (roomId: string) => void;
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
    this.lastPanel = '';
    this.renderRoomPanel();
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
  refreshViews() { this.lastRooms = ''; this.refreshRooms(); }

  /** La pièce montrée (ou aucune) : un clic sur une vue l'efface, et réciproquement. */
  setActiveRoom(id: string | null) {
    this.activeRoom = id;
    // Une vue choisie : aucune pièce n'est allumée, pas même « Maison ».
    this.roomsEl?.querySelectorAll<HTMLButtonElement>('.ow-chip[data-room]').forEach((b) =>
      b.classList.toggle('ow-on', !this.activeView && (b.dataset.room || null) === id));
    this.lastPanel = '';
    this.renderRoomPanel();
  }

  /**
   * Le panneau de la pièce montrée : ses appareils, un interrupteur pour ce
   * qui se bascule, et « Tout éteindre ». Sur une tablette murale, c'est plus
   * rapide que de chercher chaque pastille.
   */
  private renderRoomPanel() {
    const id = this.activeRoom;
    const room = id && this.prefs.show.rooms && !this.hidden ? this.opts.getRooms().find((r) => r.id === id) : null;
    const devices = room ? this.opts.getRoomDevices(room.id) : [];
    if (!room || !this.roomsEl) { this.roomPanel?.remove(); this.roomPanel = null; this.lastPanel = ''; return; }
    const key = JSON.stringify([room, devices]);
    if (key === this.lastPanel && this.roomPanel) return;
    this.lastPanel = key;
    if (!this.roomPanel) {
      const el = document.createElement('div');
      el.className = 'ow-surface ow-roompanel';
      el.setAttribute('role', 'region');
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.roomPanel = el;
    }
    // Juste sous (ou au-dessus de) la barre des pièces, dans le même emplacement.
    if (this.roomPanel.previousElementSibling !== this.roomsEl) this.roomsEl.after(this.roomPanel);
    const el = this.roomPanel;
    el.setAttribute('aria-label', room.name);
    el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ow-rp-h';
    const title = document.createElement('b');
    title.textContent = room.name;
    head.appendChild(title);
    if (room.temp) {
      const temp = document.createElement('span');
      temp.className = 'ow-rp-temp';
      temp.append(icon('temp', 15), document.createTextNode(room.temp));
      head.appendChild(temp);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ow-ib';
    close.style.cssText = 'width:28px;height:28px;margin-left:auto;';
    close.setAttribute('aria-label', t('tourClose'));
    close.append(icon('close', 15));
    close.addEventListener('click', (e) => { e.stopPropagation(); this.setActiveRoom(null); this.opts.flyToRoom(null); });
    head.appendChild(close);
    el.appendChild(head);

    const list = document.createElement('div');
    list.className = 'ow-rp-list';
    if (!devices.length) {
      const empty = document.createElement('div');
      empty.className = 'ow-rp-empty';
      empty.textContent = t('uiRoomEmpty');
      list.appendChild(empty);
    }
    for (const d of devices) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ow-rp-row';
      const tileEl = document.createElement('span');
      tileEl.className = `ow-rp-tile${d.on ? ' ow-on' : ''}`;
      tileEl.append(icon(d.icon, 17));
      const col = document.createElement('span');
      col.className = 'ow-rp-nm';
      const nm = document.createElement('b');
      nm.textContent = d.name;
      const st = document.createElement('span');
      st.textContent = d.state;
      col.append(nm, st);
      row.append(tileEl, col);
      if (d.toggle) {
        const sw = document.createElement('span');
        sw.className = `ow-switch${d.on ? ' ow-on' : ''}`;
        sw.setAttribute('aria-hidden', 'true');
        row.appendChild(sw);
        row.setAttribute('role', 'switch');
        row.setAttribute('aria-checked', String(d.on));
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (d.toggle) this.opts.toggleDevice(d.id); else this.opts.moreInfo(d.id);
      });
      list.appendChild(row);
    }
    el.appendChild(list);
    if (room.lit > 0) {
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'ow-btn ow-small';
      off.style.cssText = 'width:100%;';
      off.append(icon('moon', 15), document.createTextNode(t('uiRoomAllOff')));
      off.addEventListener('click', (e) => { e.stopPropagation(); this.opts.roomAllOff(room.id); });
      el.appendChild(off);
    }
  }

  /** Les pièces ou leurs lampes ont pu changer : ne repeint que si quelque chose a bougé. */
  refreshRooms() {
    const rooms = this.prefs.show.rooms ? this.opts.getRooms() : [];
    const views = this.prefs.show.views ? this.opts.getViews() : [];
    const key = JSON.stringify([rooms, views, this.opts.getFloors(), this.opts.getActiveFloor()]);
    if (key !== this.lastRooms) {
      this.lastRooms = key;
      this.renderRooms(rooms, views);
    }
    this.renderRoomPanel();
  }

  /** L'étage a changé : la barre des pièces se repeint. */
  refreshFloors() {
    this.lastRooms = '';
    this.refreshRooms();
  }

  get roomsModule() { return this.roomsEl; }
  get activeRoomId() { return this.activeRoom; }

  setActiveView(id: string | null) {
    this.activeView = id;
    if (id) this.setActiveRoom(null);
    this.roomsEl?.querySelectorAll<HTMLButtonElement>('.ow-chip[data-view]').forEach((b) => b.classList.toggle('ow-on', b.dataset.view === id));
    if (id) this.revealActiveChip();
    if (!id) this.setActiveRoom(this.activeRoom);
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

  // ── Rendu ────────────────────────────────────────────────────────────────

  private render() {
    this.host.classList.toggle('ow-names', this.prefs.show.names);
    for (const [, el] of this.slots) el.innerHTML = '';
    this.roomPanel?.remove();
    this.roomPanel = null;
    this.lastPanel = '';
    this.dockEl = this.statusEl = this.roomsEl = null;
    this.renderDock();
    this.lastRooms = '';
    this.refreshRooms();
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

  private renderRooms(rooms: HudRoom[], views: HudView[]) {
    const floors = this.prefs.show.rooms ? this.opts.getFloors() : [];
    // Une seule pièce, un seul niveau et aucune vue : le module ne sert à rien.
    if (rooms.length < 2) rooms = [];
    if (!rooms.length && floors.length < 2 && !views.length) { this.roomsEl?.remove(); this.roomsEl = null; return; }
    if (!this.roomsEl) {
      const el = document.createElement('div');
      el.className = 'ow-surface ow-rooms';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', t('uiModRooms'));
      this.roomsEl = el;
      this.place('rooms', el);
    }
    this.roomsEl.innerHTML = '';
    if (floors.length > 1) {
      const active = this.opts.getActiveFloor();
      const seg = document.createElement('div');
      seg.className = 'ow-floors';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', t('uiFloors'));
      for (const f of floors) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ow-chip ow-floor';
        b.dataset.floor = String(f.index);
        b.textContent = f.name;
        b.classList.toggle('ow-on', f.index === active);
        b.setAttribute('aria-pressed', String(f.index === active));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (f.index !== this.opts.getActiveFloor()) this.opts.setFloor(f.index);
        });
        seg.append(b);
      }
      this.roomsEl.append(seg);
    }
    // Les pièces et les vues défilent seules ; le choix d'étage reste en place.
    // Sur une carte étroite, un fondu dit qu'il y a la suite.
    const track = document.createElement('div');
    track.className = 'ow-rooms-track';
    track.addEventListener('scroll', () => this.paintRoomsMore(), { passive: true });
    this.roomsEl.append(track);
    const chip = (id: string, label: string, lit: number, temp?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ow-chip';
      b.dataset.room = id;
      b.textContent = label;
      if (temp) {
        const tEl = document.createElement('small');
        tEl.textContent = temp;
        b.append(tEl);
      }
      if (lit > 0) {
        const badge = document.createElement('i');
        badge.textContent = String(lit);
        badge.title = lit > 1 ? `${lit} ${t('uiLightsOnMany')}` : `${lit} ${t('uiLightsOn')}`;
        b.append(badge);
      }
      b.classList.toggle('ow-on', !this.activeView && (id || null) === this.activeRoom);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeView = null;
        this.setActiveView(null);
        this.setActiveRoom(id || null);
        this.opts.flyToRoom(id || null);
      });
      track.append(b);
    };
    if (rooms.length) {
      chip('', t('uiRoomsHome'), rooms.reduce((n, r) => n + r.lit, 0));
      for (const r of rooms) chip(r.id, r.name, r.lit, r.temp);
    }
    // Les vues enregistrées, après les pièces : une caméra les distingue.
    if (views.length && (rooms.length || floors.length > 1)) {
      const sep = document.createElement('span');
      sep.className = 'ow-sep';
      track.append(sep);
    }
    for (const v of views) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ow-chip ow-view';
      b.dataset.view = v.id;
      b.title = t('uiModViews');
      b.append(icon('camera', 14), document.createTextNode(v.label));
      b.classList.toggle('ow-on', v.id === this.activeView);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setActiveView(v.id); this.opts.flyTo(v.id); });
      track.append(b);
    }
    requestAnimationFrame(() => { this.paintRoomsMore(); this.revealActiveChip(); });
  }

  /** Le fondu du bord droit, tant que la barre a encore des choix cachés. */
  private paintRoomsMore() {
    const el = this.roomsEl?.querySelector<HTMLElement>('.ow-rooms-track');
    if (!el) return;
    el.classList.toggle('ow-more', el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    el.classList.toggle('ow-less', el.scrollLeft > 4);
  }

  /** La puce choisie (pièce ou vue) amenée dans la partie visible de la barre. */
  private revealActiveChip() {
    const el = this.roomsEl?.querySelector<HTMLElement>('.ow-rooms-track');
    const on = el?.querySelector<HTMLElement>('.ow-chip.ow-on');
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    const x = on.offsetLeft - el.offsetLeft;
    const left = x - 8, right = x + on.offsetWidth - el.clientWidth + 8;
    if (el.scrollLeft > left) el.scrollTo({ left, behavior: 'smooth' });
    else if (el.scrollLeft < right) el.scrollTo({ left: right, behavior: 'smooth' });
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
    // Dans une place libre, pour ne jamais recouvrir un module (en bas au centre d'abord).
    const free = (['bc', 'tc', 'bl', 'tl', 'tr', 'br'] as Slot[]).map((k) => this.slots.get(k)).find((c) => c && !c.children.length);
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
    if (free) { el.style.position = 'static'; el.style.transform = 'none'; free.appendChild(el); } else { el.style.top = '12px'; this.host.appendChild(el); }
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
