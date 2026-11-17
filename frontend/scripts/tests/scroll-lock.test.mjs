// The app-wide scroll lock (services/scrollLock.ts): the page behind sheets and panels.
// Bug of 17.11.2026: disclaimer + welcome tour open together, closed in the other
// order → the page stayed locked and could not be scrolled at all.
import test from 'node:test';
import assert from 'node:assert/strict';

const style = { position: '', top: '', width: '', overflow: '' };
const scrolls = [];
globalThis.document = { body: { style } };
globalThis.window = { scrollY: 0, scrollTo: (x, y) => { scrolls.push(y); globalThis.window.scrollY = y; } };

const { lockScroll, scrollLocked } = await import('../../services/scrollLock.ts');

const reset = () => { Object.assign(style, { position: '', top: '', width: '' }); scrolls.length = 0; window.scrollY = 0; };

test('one sheet: page pinned at its offset, released and scrolled back on close', () => {
  reset();
  window.scrollY = 640;
  const release = lockScroll();
  assert.deepEqual({ ...style }, { position: 'fixed', top: '-640px', width: '100%', overflow: '' });
  assert.equal(scrollLocked(), true);
  release();
  assert.deepEqual({ ...style }, { position: '', top: '', width: '', overflow: '' });
  assert.deepEqual(scrolls, [640]);
  assert.equal(scrollLocked(), false);
});

test('disclaimer + welcome tour closed in the other order leave the page free', () => {
  reset();
  const disclaimer = lockScroll();
  const tour = lockScroll();
  disclaimer();                                    // accepted first …
  assert.equal(style.position, 'fixed');           // … the tour is still open: still pinned
  tour();
  assert.equal(style.position, '');                // last one out releases
  assert.equal(scrollLocked(), false);
});

test('three panels, any closing order, and a double release does not unlock someone else', () => {
  reset();
  window.scrollY = 300;
  const a = lockScroll(), b = lockScroll(), c = lockScroll();
  assert.equal(style.top, '-300px');               // only the first holder records the offset
  b(); b(); b();                                   // released three times by mistake: counts once
  assert.equal(scrollLocked(), true);
  a();
  assert.equal(style.position, 'fixed');
  c();
  assert.equal(style.position, '');
  assert.deepEqual(scrolls, [300]);
});

test('a style the page had before the lock is put back', () => {
  reset();
  style.width = '90%';
  const release = lockScroll();
  assert.equal(style.width, '100%');
  release();
  assert.equal(style.width, '90%');
});
