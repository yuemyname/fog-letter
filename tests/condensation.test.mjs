import test from 'node:test';
import assert from 'node:assert/strict';
import {Condensation} from '../dist/condensation.mjs';
const sum = field => field.water.reduce((a, b) => a + b, 0);
const at = (f, x, y) => f.water[Math.floor(y / f.height * f.rows) * f.columns + Math.floor(x / f.width * f.columns)];
const advance = (f, duration, hz = 30) => { for (let i = 0; i < duration * hz; i++) f.step(1 / hz); };
test('breath appears gradually, stays local and spreads beyond the first contact', () => {
  const f = new Condensation(900, 600);
  f.breathe(450, 350);
  assert.equal(sum(f), 0);
  advance(f, .2); const early = sum(f), earlyEdge = at(f, 570, 350);
  assert.ok(early > 0);
  advance(f, 1);
  assert.ok(sum(f) > early * 2);
  assert.ok(at(f, 570, 350) > earlyEdge);
  assert.ok(at(f, 450, 350) > .1);
  assert.equal(at(f, 10, 10), 0);
});
test('finger contact clears its path with a wet, feathered edge', () => {
  const f = new Condensation(900, 600); f.water.fill(.8);
  f.wipe({x: 200, y: 300}, {x: 650, y: 300}, 30);
  assert.ok(at(f, 420, 300) < .01);
  assert.ok(at(f, 420, 327) > .05 && at(f, 420, 327) < .8);
  assert.ok(at(f, 420, 350) > .79);
  assert.ok(at(f, 50, 300) > .79);
});
test('new breath recondenses on wiped glass without refogging remote strokes', () => {
  const f = new Condensation(900, 600); f.water.fill(.7);
  f.wipe({x: 100, y: 300}, {x: 750, y: 300}, 24);
  f.breathe(450, 300); advance(f, 1.5);
  assert.ok(at(f, 450, 300) > .1);
  assert.ok(at(f, 110, 300) < .01);
});
test('results remain consistent across 30 and 60 fps; moisture slowly evaporates', () => {
  const a = new Condensation(900, 600), b = new Condensation(900, 600);
  a.breathe(450, 350); b.breathe(450, 350);
  advance(a, 2, 30); advance(b, 2, 60);
  assert.ok(Math.abs(sum(a) - sum(b)) / sum(a) < .06);
  const wet = sum(a); advance(a, 10);
  assert.ok(sum(a) < wet && sum(a) > wet * .5 && sum(a) < wet * .7);
});
test('density and rendered opacity stay bounded, including overlapping breaths', () => {
  const f = new Condensation(900, 600);
  for (let i = 0; i < 100; i++) f.breathe(450, 350, 2);
  assert.equal(f.clouds.length, 24); advance(f, 2);
  assert.ok(f.water.every(v => v >= 0 && v <= 1 && Number.isFinite(v)));
  const rgba = new Uint8ClampedArray(f.water.length * 4); f.writeAlpha(rgba);
  assert.ok(rgba.some((v, i) => i % 4 === 3 && v > 0));
  assert.equal(rgba[3], 0);
  f.clear(); assert.equal(sum(f), 0); assert.equal(f.clouds.length, 0);
});
test('palm contact is oriented and elliptical, not a circular whole-screen eraser', () => {
  const f = new Condensation(900, 600); f.water.fill(.8);
  f.wipe({x: 450, y: 300}, {x: 450, y: 300}, 60, .5, Math.PI / 2);
  assert.ok(at(f, 450, 340) < .1);
  assert.ok(at(f, 490, 300) > .79);
  assert.ok(at(f, 100, 100) > .79);
});

test('thick writing exposes a clear core while fog slowly fades around it', () => {
  const f = new Condensation(900, 600); f.water.fill(.8);
  f.wipe({x:200,y:300}, {x:650,y:300}, 28);
  assert.ok(at(f,420,300) < .001);
  assert.ok(at(f,420,315) < .001);
  assert.ok(at(f,420,340) > .79);
  const rgba = new Uint8ClampedArray(f.water.length * 4);
  const index = Math.floor(100 / f.height * f.rows) * f.columns + Math.floor(100 / f.width * f.columns);
  f.writeAlpha(rgba); const initial = rgba[index * 4 + 3];
  advance(f,20); f.writeAlpha(rgba); const after20 = rgba[index * 4 + 3];
  advance(f,20); f.writeAlpha(rgba); const after40 = rgba[index * 4 + 3];
  assert.ok(after20 < initial * .8);
  assert.ok(after40 < after20 * .6);
});

test('fog also fades over elapsed time when a background tab resumes', () => {
  const f = new Condensation(900,600); f.water.fill(.8);
  f.step(40);
  assert.ok(at(f,100,100) < .12 && at(f,100,100) > .1);
  assert.ok(f.water.every(Number.isFinite));
});
