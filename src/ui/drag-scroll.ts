/**
 * Défilement horizontal à la souris.
 *
 * Un conteneur `overflow-x` se fait glisser au doigt, et au clavier une fois
 * le focus dessus. Le pointeur souris, lui, ne déplace rien : le navigateur
 * ne fait glisser une barre que par sa barre de défilement, ici masquée.
 * Le tactile n'est pas repris : son geste natif fonctionne déjà.
 */

const DRAG_THRESHOLD = 5;

export function enableMouseDragScroll(el: HTMLElement): void {
  let active = false;
  let moved = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;

  const root = () => el.ownerDocument?.defaultView;

  const onMove = (e: PointerEvent) => {
    if (!active || e.pointerId !== pointerId) return;
    if (e.buttons === 0) {
      end(e);
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      // Un geste surtout vertical n'est pas un défilement de la barre.
      if (Math.abs(dx) < Math.abs(dy)) {
        active = false;
        unlisten();
        return;
      }
      moved = true;
      el.classList.add('ow-dragging');
      try { el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    }
    el.scrollLeft = startScroll - dx;
    e.preventDefault();
  };

  const end = (e: PointerEvent) => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    el.classList.remove('ow-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch { /* pas capturé */ }
    unlisten();
  };

  const listen = () => {
    const w = root();
    if (!w) return;
    w.addEventListener('pointermove', onMove, { passive: false });
    w.addEventListener('pointerup', end);
    w.addEventListener('pointercancel', end);
  };

  const unlisten = () => {
    const w = root();
    if (!w) return;
    w.removeEventListener('pointermove', onMove);
    w.removeEventListener('pointerup', end);
    w.removeEventListener('pointercancel', end);
  };

  el.addEventListener('pointerdown', (e) => {
    if (active || e.button !== 0 || e.pointerType === 'touch') return;
    // Rien à faire défiler : un clic doit rester un clic.
    if (el.scrollWidth <= el.clientWidth + 1) return;
    active = true;
    moved = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startScroll = el.scrollLeft;
    listen();
  });

  // Le clic qui termine un glisser ne doit pas ouvrir la puce sous le curseur.
  el.addEventListener('click', (e) => {
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
    moved = false;
  }, true);
}
