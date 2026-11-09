// Tests for services/appReview.ts — when the app signals iOS that this is a good
// moment for a rating. Pure decision logic only (no device, no storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, migrate, POINTS_BEFORE_ASK, RE_ASK_AFTER_MS } from '../../services/appReview.ts';

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 10, 9, 0, 0);
const fresh = (now = T0) => migrate(null, now);
const use = (state, kinds, now) => kinds.reduce((acc, k) => { const r = decide(acc.state, k, now); return { state: r.state, asks: acc.asks + (r.ask ? 1 : 0) }; }, { state, asks: 0 });

test('never on the first day of use, however much is done', () => {
  const r = use(fresh(), Array(10).fill('compare'), T0 + 3600 * 1000);
  assert.equal(r.asks, 0);
  assert.ok(r.state.points >= POINTS_BEFORE_ASK);
});

test('three comparisons, or nine medicines read, or a mix — asked once, on a later day', () => {
  assert.equal(use(fresh(), ['compare', 'compare', 'compare'], T0 + DAY).asks, 1);
  assert.equal(use(fresh(), Array(8).fill('detail'), T0 + DAY).asks, 0);
  assert.equal(use(fresh(), Array(9).fill('detail'), T0 + DAY).asks, 1);
  assert.equal(use(fresh(), ['pdf', 'compare', 'detail', 'detail', 'detail'], T0 + DAY).asks, 1);
  assert.equal(use(fresh(), Array(40).fill('detail'), T0 + DAY).asks, 1);          // once, not on every further use
});

test('not again within 120 days, then at the next use', () => {
  const first = use(fresh(), Array(9).fill('detail'), T0 + DAY);
  assert.equal(use(first.state, ['compare', 'pdf', 'detail'], T0 + DAY + RE_ASK_AFTER_MS - 1000).asks, 0);
  assert.equal(use(first.state, ['detail'], T0 + DAY + RE_ASK_AFTER_MS + 1000).asks, 1);
});

test('state stored by 2.0.7 carries over: comparisons count, the last ask is respected', () => {
  const old = migrate({ compares: 2, askedAt: 0 }, T0);
  assert.deepEqual(old, { points: 6, askedAt: 0, firstDay: '2026-11-10' });
  assert.equal(use(old, ['compare'], T0).asks, 0);                                // the update day counts as the first day
  assert.equal(use(old, ['compare'], T0 + DAY).asks, 1);
  const asked = migrate({ compares: 5, askedAt: T0 - 10 * DAY }, T0);
  assert.equal(use(asked, ['compare', 'compare'], T0 + DAY).asks, 0);
  assert.deepEqual(migrate('garbage', T0), { points: 0, askedAt: 0, firstDay: '2026-11-10' });
});
