import test from 'node:test';
import assert from 'node:assert/strict';
import { enableMouseDragScroll } from './drag-scroll.mjs';

function harness({ scrollWidth = 800, clientWidth = 200, scrollLeft = 40 } = {}) {
  const elListeners = [];
  const winListeners = [];
  const win = {
    addEventListener(type, fn, opts) { winListeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = winListeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) winListeners.splice(i, 1);
    },
  };
  const classes = new Set();
  const el = {
    scrollLeft,
    scrollWidth,
    clientWidth,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    captured: null,
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture() { this.captured = null; },
    addEventListener(type, fn, opts) { elListeners.push({ type, fn, opts }); },
    ownerDocument: { defaultView: win },
  };
  enableMouseDragScroll(el);

  const fire = (list, type, event) => {
    for (const l of [...list]) if (l.type === type) l.fn(event);
  };
  return {
    el,
    classes,
    winListeners,
    down(partial = {}) {
      fire(elListeners, 'pointerdown', {
        button: 0, pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 50, ...partial,
      });
    },
    move(x, y = 50) {
      const event = { pointerId: 1, buttons: 1, clientX: x, clientY: y, prevented: false, preventDefault() { this.prevented = true; } };
      fire(winListeners, 'pointermove', event);
      return event;
    },
    up() { fire(winListeners, 'pointerup', { pointerId: 1 }); },
    click() {
      const event = {
        defaultPrevented: false,
        stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      fire(elListeners, 'click', event);
      return event;
    },
  };
}

test('un glisser souris fait défiler et n’active pas la puce', () => {
  const h = harness();
  h.down();
  const move = h.move(140);
  assert.equal(h.el.scrollLeft, 0);
  assert.equal(move.prevented, true);
  assert.equal(h.classes.has('ow-dragging'), true);
  h.up();
  assert.equal(h.classes.has('ow-dragging'), false);
  assert.equal(h.winListeners.length, 0);
  const click = h.click();
  assert.equal(click.stopped, true);
  assert.equal(click.defaultPrevented, true);
});

test('un clic sans déplacement ouvre la puce', () => {
  const h = harness();
  h.down();
  h.move(103);
  h.up();
  assert.equal(h.el.scrollLeft, 40);
  const click = h.click();
  assert.equal(click.stopped, false);
});

test('le doigt ne passe pas par le glisser souris', () => {
  const h = harness();
  h.down({ pointerType: 'touch' });
  assert.equal(h.winListeners.length, 0);
  h.move(160);
  assert.equal(h.el.scrollLeft, 40);
});

test('un geste vertical ne défile pas et laisse le clic', () => {
  const h = harness();
  h.down();
  h.move(102, 80);
  h.up();
  assert.equal(h.el.scrollLeft, 40);
  assert.equal(h.click().stopped, false);
});

test('sans débordement, le clic reste un clic', () => {
  const h = harness({ scrollWidth: 180, clientWidth: 200 });
  h.down();
  assert.equal(h.winListeners.length, 0);
  h.move(160);
  assert.equal(h.el.scrollLeft, 40);
  assert.equal(h.click().stopped, false);
});
