/**
 * draggable.ts — déplacer une fenêtre par son en-tête.
 *
 * Une fenêtre d'édition centrée cache précisément ce qu'on règle : le modèle.
 * Pouvoir la pousser de côté n'est pas un confort, c'est ce qui permet de voir
 * l'effet d'un réglage pendant qu'on le fait.
 */

export interface WindowPos {
  left: number;
  top: number;
}

/** Mémoire de position, pour retrouver la fenêtre là où on l'avait laissée. */
export interface PosMemory {
  get(): WindowPos | null;
  set(pos: WindowPos): void;
}

/** Part de la fenêtre qui doit rester attrapable, en pixels. */
const KEEP_VISIBLE = 80;

/** Un clic sur ces éléments pilote le contrôle, pas la fenêtre. */
const CONTROLS = 'input,button,select,textarea,a,summary,[contenteditable]';

/**
 * Rend `win` déplaçable en tirant sur `handle`.
 *
 * La fenêtre est contrainte à rester rattrapable : on peut la pousser hors de
 * l'écran, mais jamais au point de ne plus pouvoir la ramener.
 */
export function makeDraggable(win: HTMLElement, handle: HTMLElement, memory?: PosMemory): void {
  handle.style.cursor = 'move';
  handle.style.userSelect = 'none';
  handle.style.touchAction = 'none';

  const placeAt = (left: number, top: number) => {
    const r = win.getBoundingClientRect();
    const edge = Math.min(r.width, KEEP_VISIBLE);
    // On garde au moins l'en-tête à l'écran, sinon plus moyen de le rattraper.
    const x = Math.max(edge - r.width, Math.min(left, window.innerWidth - edge));
    const y = Math.max(0, Math.min(top, window.innerHeight - handle.offsetHeight));
    // Le centrage d'origine passe par `transform` : il doit céder la place.
    win.style.transform = 'none';
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    memory?.set({ left: x, top: y });
  };

  let drag: { dx: number; dy: number; id: number } | null = null;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Un champ de recherche dans l'en-tête doit rester utilisable.
    if ((e.target as HTMLElement | null)?.closest(CONTROLS)) return;
    const r = win.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    placeAt(e.clientX - drag.dx, e.clientY - drag.dy);
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  const remembered = memory?.get();
  if (remembered) placeAt(remembered.left, remembered.top);
}
