import test from 'node:test';
import assert from 'node:assert/strict';
import {handMode, HandGesture, writingPoint} from '../dist/hand-gesture.mjs';
function pose(extended, {angle = 0, width = 1280, height = 720, mirror = false} = {}) {
  const point = (x, y) => ({x: .5 + (x * Math.cos(angle) - y * Math.sin(angle)) / width * (mirror ? -1 : 1),
    y: .3 + (x * Math.sin(angle) + y * Math.cos(angle)) / height, z: 0});
  const hand = Array.from({length: 21}, () => point(0, 140)); hand[0] = point(0, 200);
  [5, 9, 13, 17].forEach((base, finger) => {
    const x = -45 + finger * 30;
    hand[base] = point(x, 100); hand[base + 1] = point(x, 60);
    hand[base + 2] = extended[finger] ? point(x, 30) : point(x + 12, 72);
    hand[base + 3] = extended[finger] ? point(x, 0) : point(x + 8, 110);
  });
  return hand;
}
function pinch(options = {}, gapRatio = .08) {
  const hand = pose([true, false, false, false], options);
  const width = options.width || 1280;
  hand[4] = {...hand[8], x: hand[8].x + 90 * gapRatio / width};
  return hand;
}
test('pinched thumb and index write; a lone pointed index does nothing', () => {
  assert.equal(handMode(pinch(), 1280, 720), 'write');
  assert.equal(handMode(pose([true, false, false, false]), 1280, 720), 'none');
});
test('pinch hysteresis tolerates small jitter but stops after release', () => {
  assert.equal(handMode(pinch({}, .4), 1280, 720, false), 'none');
  assert.equal(handMode(pinch({}, .4), 1280, 720, true), 'write');
  assert.equal(handMode(pinch({}, .6), 1280, 720, true), 'none');
});
test('contact point is between the two fingertips', () => {
  const points = Array.from({length:21}, () => ({x:0,y:0}));
  points[4] = {x:100,y:200}; points[8] = {x:110,y:210};
  assert.deepEqual(writingPoint(points), {x:105,y:205});
});
test('a thumb touching a folded index inside a fist does not start writing', () => {
  const hand = pose([false,false,false,false]); hand[4] = {...hand[8]};
  assert.equal(handMode(hand, 1280, 720), 'erase');
});
test('a fully folded fist selects wiping', () => {
  assert.equal(handMode(pose([false, false, false, false]), 1280, 720), 'erase');
});
test('open palms, peace signs and other extended fingers do nothing', () => {
  for (const fingers of [[true,true,true,true], [true,true,false,false], [false,true,false,false], [true,false,false,true]])
    assert.equal(handMode(pose(fingers), 1280, 720), 'none');
});
test('writing and fist recognition survive rotation, mirroring and portrait video', () => {
  for (const angle of [-.8, 0, .8]) for (const mirror of [false, true]) {
    const options = {width: 720, height: 1280, angle, mirror};
    assert.equal(handMode(pinch(options), 720, 1280), 'write');
    assert.equal(handMode(pose([false,false,false,false], options), 720, 1280), 'erase');
  }
});
test('invalid or degenerate landmarks do not erase', () => {
  assert.equal(handMode(null, 1280, 720), 'none');
  assert.equal(handMode(Array(21).fill({x:.5,y:.5,z:0}), 1280, 720), 'none');
});
test('brief accidental fists do not erase and changing modes stops immediately', () => {
  const gesture = new HandGesture();
  assert.equal(gesture.update('write', 100), 'none');
  assert.equal(gesture.update('write', 200), 'write');
  assert.equal(gesture.update('erase', 250), 'none');
  assert.equal(gesture.update('erase', 350), 'none');
  assert.equal(gesture.update('write', 400), 'none');
  assert.equal(gesture.update('write', 500), 'write');
  assert.equal(gesture.update('erase', 600), 'none');
  assert.equal(gesture.update('erase', 800), 'erase');
  assert.equal(gesture.update('none', 850), 'none');
  assert.equal(gesture.update('erase', 900), 'none');
});

test('a naturally bent pinching index near the palm is accepted', () => {
  const hand = pose([false,false,false,false]);
  hand[8].x -= 40 / 1280; hand[4] = {...hand[8]};
  assert.equal(handMode(hand,1280,720), 'write');
});
test('overlapping fingertips still pinch with noisy depth estimates', () => {
  const hand = pinch(); hand[4].z = .12;
  assert.equal(handMode(hand,1280,720), 'write');
});
