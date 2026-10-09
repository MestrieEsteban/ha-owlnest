/**
 * Les visites guidées : un projecteur sur ce dont on parle, une bulle à côté,
 * et une petite animation qui montre le geste plutôt que de le décrire.
 *
 * Tout est en CSS (aucune image) : une animation pèse quelques lignes et
 * s'arrête d'elle-même quand l'utilisateur demande moins de mouvement.
 */
import { t, type StringKey } from '../i18n';
import { iconHtml } from './icons';
import { FONT } from './theme';

export type TourAnim = 'orbit' | 'tap' | 'walls' | 'views' | 'layout' | 'full' | 'add' | 'rule' | 'plan' | 'door' | 'sun' | 'gear';

export interface TourStep {
  /** Ce qu'on montre ; rien (ou introuvable) : la bulle se centre. */
  target?: () => Element | null | undefined;
  title: StringKey;
  text: StringKey;
  anim: TourAnim;
}

const CURSOR = `<div class="owt-cur"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 3l15 7-6.5 2L10 19z" fill="#fff" stroke="#0b1220" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`;
const BOX = `<div class="owt-b3d"><i class="f"></i><i class="w n"></i><i class="w s"></i><i class="w e"></i><i class="w o"></i></div>`;

const ANIMS: Record<TourAnim, () => string> = {
  orbit: () => `<div class="owt-anim owt-orbit"><div class="owt-stage">${BOX}</div>${CURSOR}</div>`,
  walls: () => `<div class="owt-anim owt-walls"><div class="owt-stage">${BOX}</div></div>`,
  tap: () => `<div class="owt-anim owt-tap"><div class="owt-ring"></div><div class="owt-dot">${iconHtml('bulb', 16)}</div>${CURSOR}</div>`,
  views: () => `<div class="owt-anim owt-views"><div class="owt-chips"><i></i><i class="on"></i><i></i></div><div class="owt-scene"></div>${CURSOR}</div>`,
  layout: () => `<div class="owt-anim owt-layout"><div class="owt-mini"><i style="left:6px;top:6px"></i><i style="right:6px;top:6px"></i><i style="left:6px;bottom:6px"></i><i style="right:6px;bottom:6px"></i><b></b></div>${CURSOR}</div>`,
  full: () => `<div class="owt-anim owt-full"><div class="owt-grow"></div></div>`,
  add: () => `<div class="owt-anim owt-add"><div class="owt-plus">${iconHtml('plus', 16)}</div><div class="owt-pop">${iconHtml('bulb', 14)}</div>${CURSOR}</div>`,
  rule: () => `<div class="owt-anim owt-rule"><div class="owt-ln"><span class="k">${t('tourRuleWhen')}</span><span>${iconHtml('door', 14)}</span><span class="k">${t('tourRuleOpens')}</span></div><div class="owt-ln"><span class="k">${t('tourRuleThen')}</span><span>${iconHtml('camera', 14)}</span></div></div>`,
  plan: () => `<div class="owt-anim owt-plan"><div class="owt-rect"></div>${CURSOR}</div>`,
  door: () => `<div class="owt-anim owt-door"><div class="owt-frame"><div class="owt-leaf"></div></div><div class="owt-dot sm">${iconHtml('sensor', 13)}</div></div>`,
  sun: () => `<div class="owt-anim owt-sun"><div class="owt-arc"></div><div class="owt-ball"></div><div class="owt-ground"></div></div>`,
  gear: () => `<div class="owt-anim owt-gear"><div class="owt-spin">${iconHtml('gear', 44)}</div></div>`,
};

const STYLES = `
.owt { position: absolute; inset: 0; z-index: 400; pointer-events: auto; font-family: ${FONT}; }
.owt-hole { position: absolute; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(3,7,15,0.62); transition: all .35s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.owt-hole::after { content: ""; position: absolute; inset: -4px; border-radius: 16px; border: 2px solid #38bdf8; animation: owt-pulse 1.6s ease-out infinite; }
.owt-hole.owt-none::after { display: none; }
@keyframes owt-pulse { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.08); } }
.owt-coach { position: absolute; width: min(300px, calc(100% - 24px)); padding: 12px; display: flex; flex-direction: column; gap: 10px;
  background: #0b1220; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; box-shadow: 0 14px 40px rgba(0,0,0,0.5);
  transition: left .35s, top .35s; }
.owt-coach h4 { margin: 0; font-size: 14px; padding-right: 30px; }
.owt-coach p { margin: 0; font-size: 12.5px; color: #94a3b8; line-height: 1.45; }
.owt-foot { display: flex; align-items: center; gap: 6px; }
.owt-dots { display: flex; gap: 5px; margin-right: auto; }
.owt-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.15); }
.owt-dots i.on { background: #38bdf8; width: 16px; border-radius: 3px; }
.owt-btn { font: 600 12.5px ${FONT}; padding: 7px 13px; border-radius: 10px; border: none; cursor: pointer; background: transparent; color: #94a3b8; }
.owt-btn.primary { background: #0ea5e9; color: #fff; }
.owt-x { position: absolute; top: 16px; right: 16px; z-index: 4; width: 28px; height: 28px; border-radius: 8px; border: none; background: #0b1220; color: #e2e8f0; cursor: pointer; display: grid; place-items: center; }
.owt-anim { height: 108px; border-radius: 10px; background: #111a2e; position: relative; overflow: hidden; }
.owt-cur { position: absolute; z-index: 3; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
.owt-stage { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px; perspective: 400px; }
.owt-b3d { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(58deg) rotateZ(30deg); }
.owt-b3d .f { position: absolute; inset: 0; background: #c9a77c; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15); }
.owt-b3d .w { position: absolute; background: #e8e2d6; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); }
.owt-b3d .n { left: 0; top: 0; width: 64px; height: 24px; transform-origin: top; transform: rotateX(-90deg); }
.owt-b3d .s { left: 0; bottom: 0; width: 64px; height: 24px; transform-origin: bottom; transform: rotateX(90deg); }
.owt-b3d .e { right: 0; top: 0; width: 24px; height: 64px; transform-origin: right; transform: rotateY(-90deg); }
.owt-b3d .o { left: 0; top: 0; width: 24px; height: 64px; transform-origin: left; transform: rotateY(90deg); }
.owt-orbit .owt-b3d { animation: owt-spin 5s ease-in-out infinite; }
@keyframes owt-spin { 0%, 10% { transform: rotateX(58deg) rotateZ(30deg); } 50%, 60% { transform: rotateX(58deg) rotateZ(120deg); } 100% { transform: rotateX(58deg) rotateZ(30deg); } }
.owt-orbit .owt-cur { top: 70%; animation: owt-drag 5s ease-in-out infinite; }
@keyframes owt-drag { 0%, 10% { left: 30%; } 50%, 60% { left: 64%; } 100% { left: 30%; } }
.owt-walls .owt-b3d { transform: rotateX(58deg) rotateZ(35deg); }
.owt-walls .s { animation: owt-cuty 3.2s ease-in-out infinite; }
.owt-walls .o { animation: owt-cutx 3.2s ease-in-out infinite; }
@keyframes owt-cuty { 0%, 15% { transform: rotateX(90deg) scale(1); } 45%, 80% { transform: rotateX(90deg) scale(1, 0.22); } 100% { transform: rotateX(90deg) scale(1); } }
@keyframes owt-cutx { 0%, 15% { transform: rotateY(90deg) scale(1); } 45%, 80% { transform: rotateY(90deg) scale(0.22, 1); } 100% { transform: rotateY(90deg) scale(1); } }
.owt-dot { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px; border-radius: 50%; background: #0b1220; display: grid; place-items: center; color: #94a3b8; }
.owt-tap .owt-dot { animation: owt-lamp 3s infinite; }
@keyframes owt-lamp { 0%, 45% { background: #0b1220; color: #94a3b8; box-shadow: none; } 50%, 100% { background: #fbbf24; color: #3b2a05; box-shadow: 0 0 0 5px rgba(251,191,36,.25), 0 0 22px rgba(251,191,36,.8); } }
.owt-tap .owt-cur { animation: owt-tapmove 3s ease-in-out infinite; }
@keyframes owt-tapmove { 0% { left: 80%; top: 85%; } 40%, 100% { left: calc(50% + 2px); top: calc(50% + 2px); } }
.owt-ring { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px; border-radius: 50%; border: 2px solid #38bdf8; opacity: 0; animation: owt-ringk 3s infinite; }
@keyframes owt-ringk { 0%, 44% { opacity: 0; transform: scale(1); } 46% { opacity: 1; } 70%, 100% { opacity: 0; transform: scale(2.2); } }
.owt-views .owt-chips { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: #0b1220; }
.owt-views .owt-chips i { width: 30px; height: 12px; border-radius: 999px; background: #1e293b; }
.owt-views .owt-chips i.on { background: #0ea5e9; animation: owt-blink 3s infinite; }
@keyframes owt-blink { 0%, 30% { background: #1e293b; } 35%, 100% { background: #0ea5e9; } }
.owt-views .owt-scene { position: absolute; left: 50%; top: 14px; width: 90px; height: 54px; margin-left: -45px; border-radius: 6px;
  background: linear-gradient(135deg, #c9a77c 0 45%, #e8e2d6 45% 55%, #9fb7c9 55%); animation: owt-zoom 3s ease-in-out infinite; transform-origin: 70% 40%; }
@keyframes owt-zoom { 0%, 35% { transform: scale(1); } 70%, 100% { transform: scale(1.7); } }
.owt-views .owt-cur { animation: owt-viewc 3s ease-in-out infinite; }
@keyframes owt-viewc { 0% { left: 75%; top: 50%; } 30%, 100% { left: calc(50% + 2px); top: calc(100% - 22px); } }
.owt-mini { position: absolute; inset: 12px 30px; border-radius: 8px; background: linear-gradient(135deg, #5b7f5f, #3d5e43); }
.owt-mini i { position: absolute; width: 34px; height: 14px; border-radius: 4px; border: 1.5px dashed rgba(255,255,255,0.5); }
.owt-mini b { position: absolute; width: 34px; height: 14px; border-radius: 4px; background: #0ea5e9; animation: owt-move 3.6s ease-in-out infinite; }
@keyframes owt-move { 0%, 15% { left: 6px; top: 6px; } 55%, 100% { left: calc(100% - 40px); top: calc(100% - 20px); } }
.owt-layout .owt-cur { animation: owt-movec 3.6s ease-in-out infinite; }
@keyframes owt-movec { 0%, 15% { left: 60px; top: 26px; } 55%, 100% { left: calc(100% - 52px); top: calc(100% - 26px); } }
.owt-grow { position: absolute; left: 50%; top: 50%; border-radius: 6px; background: #0ea5e9; transform: translate(-50%, -50%); animation: owt-growk 2.6s ease-in-out infinite; }
@keyframes owt-growk { 0%, 20% { width: 46px; height: 30px; } 55%, 85% { width: calc(100% - 16px); height: calc(100% - 16px); } 100% { width: 46px; height: 30px; } }
.owt-add { background: linear-gradient(135deg, #5b7f5f, #3d5e43); }
.owt-plus { position: absolute; left: 8px; top: 8px; width: 28px; height: 28px; border-radius: 8px; background: #0b1220; color: #e2e8f0; display: grid; place-items: center; animation: owt-pluson 3.4s infinite; }
@keyframes owt-pluson { 0%, 18% { background: #0b1220; } 22%, 60% { background: #0ea5e9; color: #fff; } 61%, 100% { background: #0b1220; color: #e2e8f0; } }
.owt-pop { position: absolute; left: 58%; top: 46%; width: 26px; height: 26px; margin: -13px; border-radius: 50%; background: #0ea5e9; color: #fff; display: grid; place-items: center; animation: owt-popk 3.4s infinite; }
@keyframes owt-popk { 0%, 55% { transform: scale(0); } 65% { transform: scale(1.25); } 72%, 100% { transform: scale(1); } }
.owt-add .owt-cur { animation: owt-addc 3.4s ease-in-out infinite; }
@keyframes owt-addc { 0% { left: 70%; top: 80%; } 18%, 25% { left: 20px; top: 20px; } 52%, 100% { left: calc(58% + 2px); top: calc(46% + 2px); } }
.owt-rule { display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 0 14px; font-size: 12px; }
.owt-ln { display: flex; gap: 6px; align-items: center; opacity: 0; animation: owt-in 4s infinite; }
.owt-ln:nth-child(2) { animation-delay: .9s; }
.owt-ln span { padding: 3px 8px; border-radius: 7px; background: #0b1220; border: 1px solid rgba(255,255,255,0.1); display: inline-flex; font-weight: 600; }
.owt-ln span.k { background: transparent; border: none; color: #94a3b8; padding: 3px 0; font-weight: 500; }
@keyframes owt-in { 0% { opacity: 0; transform: translateY(6px); } 15%, 85% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.owt-plan { background-color: #f6f4ef; background-image: linear-gradient(#e4e0d6 1px, transparent 1px), linear-gradient(90deg, #e4e0d6 1px, transparent 1px); background-size: 14px 14px; }
.owt-rect { position: absolute; left: 22%; top: 22%; border: 3px solid #2f343b; background: rgba(216,195,165,.6); animation: owt-draw 3s ease-in-out infinite; }
@keyframes owt-draw { 0%, 10% { width: 0; height: 0; } 60%, 100% { width: 46%; height: 54%; } }
.owt-plan .owt-cur { animation: owt-drawc 3s ease-in-out infinite; }
@keyframes owt-drawc { 0%, 10% { left: 22%; top: 22%; } 60%, 100% { left: 68%; top: 76%; } }
.owt-frame { position: absolute; left: 50%; top: 50%; width: 46px; height: 70px; margin: -35px -23px; border: 3px solid #e8e2d6; border-bottom: none; perspective: 200px; }
.owt-leaf { position: absolute; inset: 0; background: #a0703c; transform-origin: left; animation: owt-swing 3s ease-in-out infinite; }
@keyframes owt-swing { 0%, 20% { transform: rotateY(0); } 50%, 80% { transform: rotateY(-70deg); } 100% { transform: rotateY(0); } }
.owt-dot.sm { left: 78%; top: 30%; width: 28px; height: 28px; margin: -14px; animation: owt-sens 3s infinite; }
@keyframes owt-sens { 0%, 18% { background: #0b1220; color: #94a3b8; } 22%, 80% { background: #34d399; color: #052e16; } 100% { background: #0b1220; } }
.owt-arc { position: absolute; left: 20%; right: 20%; top: 26px; height: 140px; border: 1.5px dashed rgba(255,255,255,0.2); border-radius: 50%; }
.owt-ball { position: absolute; width: 18px; height: 18px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 18px rgba(251,191,36,.8); animation: owt-sunk 4s ease-in-out infinite; }
@keyframes owt-sunk { 0% { left: 18%; top: 80px; } 50% { left: calc(50% - 9px); top: 18px; } 100% { left: calc(82% - 18px); top: 80px; } }
.owt-ground { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; background: #3d5e43; }
.owt-spin { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #38bdf8; animation: owt-rot 6s linear infinite; }
@keyframes owt-rot { from { transform: translate(-50%, -50%) rotate(0); } to { transform: translate(-50%, -50%) rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .owt *, .owt *::after { animation: none !important; } .owt-ln { opacity: 1; } }
`;

export class Tour {
  private root: HTMLDivElement | null = null;
  private steps: TourStep[] = [];
  private i = 0;
  private onEnd?: () => void;
  private resize = new ResizeObserver(() => this.place());

  constructor(private host: HTMLElement) {}

  get active() { return !!this.root; }

  start(steps: TourStep[], onEnd?: () => void) {
    this.end();
    if (!steps.length) return;
    this.steps = steps;
    this.i = 0;
    this.onEnd = onEnd;
    const root = document.createElement('div');
    root.className = 'owt';
    root.innerHTML = `<style>${STYLES}</style><div class="owt-hole"></div><div class="owt-coach" role="dialog" aria-live="polite"></div>`;
    root.addEventListener('click', this.onClick);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.host.appendChild(root);
    this.root = root;
    this.resize.observe(this.host);
    window.addEventListener('keydown', this.onKey, true);
    this.place();
  }

  end() {
    if (!this.root) return;
    this.resize.disconnect();
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    this.root = null;
    const cb = this.onEnd;
    this.onEnd = undefined;
    cb?.();
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.root) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.go(-1); }
  };

  private onClick = (e: Event) => {
    e.stopPropagation();
    const act = (e.target as HTMLElement).closest('[data-owt]')?.getAttribute('data-owt');
    if (act === 'next') this.go(1);
    else if (act === 'prev') this.go(-1);
    else if (act === 'end') this.end();
  };

  private go(d: number) {
    const n = this.i + d;
    if (n < 0) return;
    if (n >= this.steps.length) { this.end(); return; }
    this.i = n;
    this.place();
  }

  private place() {
    const root = this.root;
    if (!root) return;
    const st = this.steps[this.i];
    const hole = root.querySelector('.owt-hole') as HTMLDivElement;
    const coach = root.querySelector('.owt-coach') as HTMLDivElement;
    const o = this.host.getBoundingClientRect();
    const target = st.target?.();
    let r = { x: o.width / 2, y: o.height / 2, w: 0, h: 0 };
    if (target instanceof HTMLElement || target instanceof SVGElement) {
      const b = target.getBoundingClientRect();
      if (b.width || b.height) r = { x: b.left - o.left - 6, y: b.top - o.top - 6, w: b.width + 12, h: b.height + 12 };
    }
    Object.assign(hole.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    hole.classList.toggle('owt-none', !r.w);
    const n = this.steps.length, last = this.i === n - 1;
    coach.innerHTML = `<button type="button" class="owt-x" data-owt="end" aria-label="${t('tourClose')}">${iconHtml('close', 16)}</button>`
      + ANIMS[st.anim]()
      + `<h4>${t(st.title)}</h4><p>${t(st.text)}</p>`
      + `<div class="owt-foot"><div class="owt-dots">${this.steps.map((_, k) => `<i class="${k === this.i ? 'on' : ''}"></i>`).join('')}</div>`
      + (this.i ? `<button type="button" class="owt-btn" data-owt="prev">${t('tourPrev')}</button>` : `<button type="button" class="owt-btn" data-owt="end">${t('tourSkip')}</button>`)
      + `<button type="button" class="owt-btn primary" data-owt="next">${last ? t('tourDone') : t('tourNext')}</button></div>`;
    const cw = coach.offsetWidth, ch = coach.offsetHeight, W = o.width, H = o.height;
    let x: number, y: number;
    if (!r.w) { x = (W - cw) / 2; y = (H - ch) / 2; }
    else {
      x = Math.min(Math.max(12, r.x + r.w / 2 - cw / 2), W - cw - 12);
      y = r.y + r.h + 12 + ch < H ? r.y + r.h + 12 : r.y - ch - 12;
      if (y < 12) {
        y = Math.min(Math.max(12, r.y), H - ch - 12);
        x = r.x + r.w + 12 + cw < W ? r.x + r.w + 12 : Math.max(12, r.x - cw - 12);
      }
    }
    coach.style.left = `${Math.max(12, x)}px`;
    coach.style.top = `${Math.max(12, y)}px`;
    (coach.querySelector('[data-owt="next"]') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }
}

/** L'invitation est déjà passée sur cet appareil ? */
const SEEN_KEY = 'owlnest_tour_seen';
export function tourSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
export function markTourSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* stockage bloqué */ }
}

