import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lipShape, MouthGesture} from '../dist/mouth-gesture.mjs';
function face({gap = 15, lipWidth = 60, pucker = .75, funnel = .1, smile = 0, jaw = .05, angle = 0, width = 1280, height = 720} = {}) {
  const landmarks = Array.from({length: 478}, () => ({x: .5, y: .5, z: 0}));
  const point = (x, y) => ({x: (.5 * width + x * Math.cos(angle) - y * Math.sin(angle)) / width,
    y: (.6 * height + x * Math.sin(angle) + y * Math.cos(angle)) / height, z: 0});
  landmarks[33] = point(-100, -130); landmarks[263] = point(100, -130);
  landmarks[61] = point(-lipWidth / 2, 0); landmarks[291] = point(lipWidth / 2, 0);
  landmarks[13] = point(0, -gap / 2); landmarks[14] = point(0, gap / 2);
  const categories = Object.entries({mouthPucker: pucker, mouthFunnel: funnel, mouthSmileLeft: smile, jawOpen: jaw})
    .map(([categoryName, score]) => ({categoryName, score}));
  return lipShape(landmarks, categories, width, height);
}
test('pursed lips produce a mouth-centered blowing gesture', () => {
  const shape = face(); assert.ok(shape.blowing && shape.strength > .5);
  assert.ok(Math.abs(shape.center.x - .5) < .0001);
  assert.ok(Math.abs(shape.center.y - .6) < .0001);
});
test('closed lips, normal open mouth, smiling and yawning do not trigger', () => {
  assert.equal(face({gap: 0}).blowing, false);
  assert.equal(face({gap: 25, pucker: .03, funnel: .02}).blowing, false);
  assert.equal(face({smile: .7}).blowing, false);
  assert.equal(face({jaw: .8, gap: 70}).blowing, false);
});
test('rounded lip shape works for tilted faces and portrait camera aspect ratios', () => {
  for (const angle of [-.4, 0, .4]) {
    const result = face({angle, width: 720, height: 1280});
    assert.ok(result.blowing); assert.ok(Math.abs(result.center.x - .5) < .0001);
  }
});
test('brief lip movement is rejected; sustained gesture starts and relaxes smoothly', () => {
  const gesture = new MouthGesture(), blowing = face();
  assert.equal(gesture.update(blowing, .08), 0);
  gesture.update(face({pucker: 0}), .08); assert.equal(gesture.level, 0);
  for (let i = 0; i < 6; i++) gesture.update(blowing, .08);
  const peak = gesture.level; assert.ok(peak > .4);
  gesture.update(face({pucker: 0}), .08); assert.ok(gesture.level < peak);
  for (let i = 0; i < 5; i++) gesture.update(face({pucker: 0}), .08);
  assert.ok(gesture.level < .005);
});
test('lost or invalid face immediately stops emission and clears stale activation', () => {
  assert.equal(lipShape(null, [], 1280, 720), null);
  const gesture = new MouthGesture();
  for (let i = 0; i < 6; i++) gesture.update(face(), .08);
  assert.equal(gesture.update(null, .08), 0); assert.equal(gesture.held, 0);
  assert.equal(gesture.update(face(), .08), 0);
});
test('camera app has no microphone capture or audio processing', () => {
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('audio: false'));
  assert.doesNotMatch(app, /AudioContext|enableMic|getFloatFrequencyData|micStream|audioLevel/);
  assert.ok(app.includes('mouthEnabled && mouth && t - mouthSeen < 220'));
});
