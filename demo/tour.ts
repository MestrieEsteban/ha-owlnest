/**
 * tour.ts — le moteur de la visite guidée.
 *
 * Il ne sait rien de la maison : le scénario (scenario.ts) lui fournit les
 * étapes, et la page les cibles à montrer. Chaque étape :
 *
 *  - prépare sa scène en entrant (`enter`) — point de vue, lampes, heure —,
 *    pour que ce qu'elle montre soit à l'écran et dans le bon état ;
 *  - pose l'encart à côté de ce qu'elle montre ;
 *  - attend le geste demandé (`doneOn`), puis explique ce qui vient de se
 *    passer (`success`). Elle ne saute jamais d'elle-même : on avance avec
 *    « Suivant », on revient avec « Précédent ».
 */

export type DemoLang = 'fr' | 'en';
export type Text = Record<DemoLang, string>;

export type TourEvent =
  | 'light' | 'orbit' | 'door' | 'view'
  | 'edit' | 'tab:anchors' | 'tab:parts' | 'tab:rules' | 'tab:weather';

export interface TourStep {
  title?: Text;
  text: Text;
  /** Ce qui s'affiche une fois le geste fait : ce qu'il a déclenché. */
  success?: Text;
  /** Cible : un sélecteur CSS, ou le nom d'une cible fournie par la page. */
  focus?: string;
  /**
   * Où poser l'encart : à gauche de la cible (onglets de l'éditeur, sur le
   * bord droit), ou dans son coin quand il cacherait ce qu'il faut regarder.
   */
  side?: 'left' | 'corner';
  /** Geste attendu. Sans lui, l'étape se lit et on passe. */
  doneOn?: TourEvent;
  /** Accueil et conclusion, au centre de l'écran. */
  center?: boolean;
  /** Prépare la scène en entrant dans l'étape. */
  enter?: () => void;
}

const UI: Record<DemoLang, Record<string, string>> = {
  en: {
    next: 'Next', back: 'Back', quit: 'Quit the tour', start: 'Start the tour', alone: 'Explore on my own',
    install: 'Install Owlnest', again: 'Tour', replay: 'Replay the tour', step: 'Step', of: 'of', waiting: 'Your turn',
  },
  fr: {
    next: 'Suivant', back: 'Précédent', quit: 'Quitter la visite', start: 'Commencer la visite', alone: 'Explorer seul',
    install: 'Installer Owlnest', again: 'Visite', replay: 'Revoir la visite', step: 'Étape', of: 'sur', waiting: 'À vous',
  },
};

const STYLE = `
  #tour {
    position: absolute; left: 16px; bottom: 16px; z-index: 1000; width: min(370px, calc(100vw - 32px));
    background: rgba(13, 17, 23, 0.95); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 14px;
    padding: 14px 16px 12px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px);
    transition: opacity 0.2s;
  }
  #tour.moving { opacity: 0; pointer-events: none; }
  #tour.center {
    left: 50% !important; top: 50% !important; transform: translate(-50%, -50%);
    width: min(460px, calc(100vw - 32px)); padding: 26px 26px 20px; text-align: center; transition: opacity 0.25s;
  }
  #tour.hidden { opacity: 0; pointer-events: none; }
  #tour .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
  #tour .head b { color: var(--text); font-weight: 600; }
  #tour .bar { height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); margin-bottom: 12px; overflow: hidden; }
  #tour .bar i { display: block; height: 100%; background: var(--accent); transition: width 0.3s; }
  #tour h2 { margin: 6px 0 10px; font-size: 21px; }
  #tour h3 { margin: 0 0 6px; font-size: 15px; }
  #tour .logo { width: 46px; height: 46px; filter: invert(1); }
  #tour p { margin: 0 0 12px; line-height: 1.5; }
  #tour.center p { margin-bottom: 20px; color: #cbd5e1; }
  #tour code { background: rgba(255, 255, 255, 0.08); padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
  #tour .task, #tour .done { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 9px 11px; margin-bottom: 12px; }
  #tour .task { background: rgba(108, 99, 255, 0.12); border: 1px solid rgba(108, 99, 255, 0.35); }
  #tour .done { background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.4); animation: tour-in 0.35s ease; }
  #tour .task .mdi { color: #a5a0ff; font-size: 18px; line-height: 1.2; }
  #tour .done .mdi { color: #4ade80; font-size: 18px; line-height: 1.2; }
  #tour .task p, #tour .done p { margin: 0; }
  #tour .row { display: flex; align-items: center; gap: 8px; }
  #tour.center .row { justify-content: center; flex-wrap: wrap; }
  #tour .grow { flex: 1; }
  #tour .link { background: none; border: none; color: var(--muted); padding: 5px 4px; font-size: 13px; }
  #tour .link:hover { color: var(--text); background: none; }
  #tour .primary { background: var(--accent); border-color: transparent; color: #fff; font-weight: 600; text-decoration: none; padding: 7px 14px; border-radius: 8px; }
  #tour .primary.ready { animation: tour-ready 1.6s ease-in-out infinite; }
  #tour .secondary { padding: 7px 12px; border-radius: 8px; }
  #tour.center .primary { padding: 10px 20px; }
  #tourBackdrop { position: absolute; inset: 0; z-index: 999; background: rgba(5, 8, 12, 0.55); transition: opacity 0.25s; }
  #tourBackdrop.hidden { opacity: 0; pointer-events: none; }
  #tourAgain { position: absolute; left: 16px; bottom: 16px; z-index: 998; }
  .tour-focus { outline: 3px solid var(--accent) !important; outline-offset: 4px; border-radius: 10px; animation: tour-pulse 1.4s ease-in-out infinite; }
  @keyframes tour-pulse { 50% { outline-color: rgba(108, 99, 255, 0.15); } }
  @keyframes tour-ready { 50% { box-shadow: 0 0 0 6px rgba(108, 99, 255, 0.25); } }
  @keyframes tour-in { from { opacity: 0; transform: translateY(4px); } }
`;

export class Tour {
  private index = 0;
  private done = false;
  private box: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private again: HTMLButtonElement;
  private focused: Element | null = null;
  private follow = 0;
  private lastPos = '';
  private lastTarget: number[] | null = null;
  private still = 0;

  constructor(
    private stage: HTMLElement,
    private lang: DemoLang,
    private steps: TourStep[],
    /** Cibles que seule la page sait trouver : ancres et commandes de la carte. */
    private targets: Record<string, () => Element | null | undefined>,
    private links: { install: string; logo: string },
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'tourBackdrop';
    this.backdrop.className = 'hidden';
    this.box = document.createElement('div');
    this.box.id = 'tour';
    this.box.className = 'hidden';
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-live', 'polite');
    this.again = document.createElement('button');
    this.again.id = 'tourAgain';
    this.again.type = 'button';
    this.again.innerHTML = `<span class="mdi mdi-compass-outline"></span> ${UI[lang].again}`;
    this.again.hidden = true;
    this.again.addEventListener('click', () => this.go(1));
    stage.append(this.backdrop, this.box, this.again);
    window.addEventListener('resize', () => this.place(true));
  }

  start() {
    this.go(0);
  }

  /** Signale un geste du visiteur : valide l'étape en cours s'il l'attendait. */
  notify(event: TourEvent) {
    const step = this.steps[this.index];
    if (this.box.classList.contains('hidden') || this.done || step?.doneOn !== event) return;
    this.done = true;
    this.render();
  }

  private go(index: number) {
    this.index = index;
    const step = this.steps[index];
    this.done = !step.doneOn;
    this.again.hidden = true;
    step.enter?.();
    this.render();
  }

  private close() {
    this.setFocus(null);
    this.box.classList.add('hidden');
    this.box.classList.remove('moving');
    this.backdrop.classList.add('hidden');
    this.again.hidden = false;
  }

  private render() {
    const step = this.steps[this.index];
    const ui = UI[this.lang];
    const L = this.lang;
    const last = this.steps.length - 1;
    this.box.classList.toggle('center', !!step.center);
    this.backdrop.classList.toggle('hidden', !step.center);

    if (step.center) {
      this.box.innerHTML = `
        <img class="logo" src="${this.links.logo}" alt="" />
        <h2>${step.title?.[L] ?? ''}</h2>
        <p>${step.text[L]}</p>
        <div class="row">
          ${this.index === 0
            ? `<button type="button" class="primary" data-act="next">${ui.start}</button>
               <button type="button" class="link" data-act="quit">${ui.alone}</button>`
            : `<a class="primary" href="${this.links.install}">${ui.install}</a>
               <button type="button" class="secondary" data-act="replay">${ui.replay}</button>
               <button type="button" class="link" data-act="quit">${ui.alone}</button>`}
        </div>`;
    } else {
      // L'accueil et la conclusion ne comptent pas dans la progression.
      const total = last - 1;
      const pct = Math.round((this.index / total) * 100);
      const body = step.doneOn
        ? (this.done && step.success
            ? `<div class="done"><span class="mdi mdi-check-circle"></span><p>${step.success[L]}</p></div>`
            : `<div class="task"><span class="mdi mdi-gesture-tap"></span><p>${step.text[L]}</p></div>`)
        : `<p>${step.text[L]}</p>`;
      this.box.innerHTML = `
        <div class="head"><span>${ui.step} <b>${this.index}</b> ${ui.of} ${total}</span>
          <button type="button" class="link" data-act="quit">${ui.quit}</button></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${step.title ? `<h3>${step.title[L]}</h3>` : ''}
        ${body}
        <div class="row">
          ${this.index > 1 ? `<button type="button" class="secondary" data-act="back">${ui.back}</button>` : ''}
          <span class="grow"></span>
          ${this.done
            ? `<button type="button" class="primary ${step.doneOn ? 'ready' : ''}" data-act="next">${ui.next}</button>`
            : `<span style="color:var(--muted);font-size:13px">${ui.waiting}</span>
               <button type="button" class="link" data-act="next">${ui.next} →</button>`}
        </div>`;
    }
    this.box.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'next') this.index < last ? this.go(this.index + 1) : this.close();
        else if (act === 'back') this.go(this.index - 1);
        else if (act === 'replay') this.go(1);
        else if (act === 'quit') this.close();
      });
    });
    this.box.classList.remove('hidden');
    this.setFocus(step.focus);
    this.place(true);
  }

  private setFocus(focus: string | undefined | null) {
    this.focused?.classList.remove('tour-focus');
    clearInterval(this.follow);
    this.focused = null;
    this.box.classList.remove('moving');
    if (!focus) return;
    const resolve = this.targets[focus] ?? (() => document.querySelector(focus));
    const refresh = () => {
      const el = resolve() ?? null;
      if (el !== this.focused) {
        this.focused?.classList.remove('tour-focus');
        this.focused = el;
        el?.classList.add('tour-focus');
      }
      // Tant que la cible se déplace vraiment (la caméra vole vers son point
      // de vue), l'encart s'efface plutôt que de lui courir après, et
      // réapparaît à sa place une fois la cible posée. Seuils distincts pour
      // s'effacer et réapparaître : un frémissement de quelques pixels ne doit
      // pas le faire clignoter.
      const r = el?.getBoundingClientRect();
      const pos = r ? [r.left, r.top] : null;
      const step = pos && this.lastTarget ? Math.hypot(pos[0] - this.lastTarget[0], pos[1] - this.lastTarget[1]) : 0;
      this.lastTarget = pos;
      if (step > 24) this.still = 0;
      else if (step < 4) this.still++;
      const hidden = this.box.classList.contains('moving');
      const settled = hidden ? this.still >= 3 : step <= 24;
      this.box.classList.toggle('moving', !settled);
      if (settled) this.place();
    };
    // Au départ, l'encart attend que sa cible soit posée : la caméra de
    // l'étape n'a souvent pas encore décollé, il apparaîtrait puis filerait.
    this.still = 0;
    this.lastTarget = null;
    this.box.classList.add('moving');
    refresh();
    // La cible peut bouger (caméra qui vole) ou être recréée (éditeur) : on la suit.
    this.follow = window.setInterval(refresh, 120);
  }

  /**
   * Place l'encart à côté de sa cible : dessous si elle est dans la moitié
   * haute, dessus sinon, ou à gauche du panneau pour un onglet de l'éditeur.
   * Sans cible visible, en bas à gauche. Ne bouge que pour un vrai changement,
   * pour ne pas trembler pendant que la caméra se pose.
   */
  private place(force = false) {
    const step = this.steps[this.index];
    let css = '';
    const el = this.focused;
    if (!step.center && step.side !== 'corner' && el?.isConnected) {
      const stage = this.stage.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      const cx = t.left + t.width / 2;
      const cy = t.top + t.height / 2;
      const visible = t.width > 0 && cx > 0 && cx < innerWidth && cy > 0 && cy < stage.bottom;
      if (visible) {
        const box = this.box.getBoundingClientRect();
        const gap = 16;
        const m = 12;
        let left: number;
        let top: number;
        if (step.side === 'left') {
          let panel: Element = el;
          while (panel.parentElement && panel.parentElement.getBoundingClientRect().width < stage.width * 0.6) panel = panel.parentElement;
          left = panel.getBoundingClientRect().left - gap - box.width - stage.left;
          top = cy - box.height / 2 - stage.top;
        } else {
          left = cx - box.width / 2 - stage.left;
          top = cy < stage.top + stage.height / 2 ? t.bottom + gap - stage.top : t.top - gap - box.height - stage.top;
        }
        left = Math.min(Math.max(left, m), stage.width - box.width - m);
        top = Math.min(Math.max(top, m), stage.height - box.height - m);
        css = `left:${Math.round(left)}px;top:${Math.round(top)}px;bottom:auto;`;
      }
    }
    // Un écart de quelques pixels ne vaut pas un déplacement.
    if (!force && css && this.lastPos) {
      const [a, b] = [css, this.lastPos].map((s) => (s.match(/-?\d+/g) ?? []).map(Number));
      if (Math.abs(a[0] - b[0]) < 6 && Math.abs(a[1] - b[1]) < 6) return;
    }
    this.lastPos = css;
    this.box.style.cssText = css;
  }
}
