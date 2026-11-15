import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lipShape, MouthGesture} from '../dist/mouth-gesture.mjs';
function face({gap=15,pucker=.8,funnel=.1,smile=0,jaw=.05,width=1280,height=720}={}) {
  const landmarks=Array.from({length:478},()=>({x:.5,y:.6,z:0}));
  const point=(x,y)=>({x:.5+x/width,y:.6+y/height,z:0});
  landmarks[33]=point(-100,-100);landmarks[263]=point(100,-100);
  landmarks[61]=point(-30,0);landmarks[291]=point(30,0);
  landmarks[13]=point(0,-gap/2);landmarks[14]=point(0,gap/2);
  const categories=Object.entries({mouthPucker:pucker,mouthFunnel:funnel,mouthSmileLeft:smile,jawOpen:jaw})
    .map(([categoryName,score])=>({categoryName,score}));
  return {landmarks,categories,shape:lipShape(landmarks,categories,width,height)};
}
test('rounded blowing mouth is located at the lip center across aspect ratios',()=>{
  for(const [width,height] of [[1280,720],[720,1280]]) {
    const {shape}=face({width,height});assert.ok(shape.blowing);
    assert.ok(Math.abs(shape.center.x-.5)<1e-6 && Math.abs(shape.center.y-.6)<1e-6);
  }
});
test('face presence, relaxed closed lips and weak pucker never generate fog',()=>{
  const gesture=new MouthGesture();
  for(const options of [{pucker:0,funnel:0},{gap:0},{pucker:.45},{smile:.7},{jaw:.8},{gap:60}]) {
    const {shape}=face(options);assert.equal(shape.blowing,false);
    for(let i=0;i<20;i++) assert.equal(gesture.update(shape,.08),0);
  }
});
test('missing expression scores cannot create fog even with visible lips',()=>{
  const {landmarks}=face();assert.equal(lipShape(landmarks,[],1280,720).blowing,false);
});
test('blowing must be held briefly; a relaxed mouth immediately stops emission',()=>{
  const gesture=new MouthGesture(),{shape}=face();
  for(let i=0;i<3;i++) assert.equal(gesture.update(shape,.08),0);
  for(let i=0;i<8;i++) gesture.update(shape,.08);
  assert.ok(gesture.level>.4);
  assert.equal(gesture.update(face({pucker:0,funnel:0}).shape,.08),0);
  assert.equal(gesture.update(shape,.08),0);
});
test('invalid or lost face stops emission',()=>{
  assert.equal(lipShape(null,[],1280,720),null);
  const {landmarks,categories,shape}=face();landmarks[13].x=NaN;
  assert.equal(lipShape(landmarks,categories,1280,720),null);
  const gesture=new MouthGesture();for(let i=0;i<8;i++)gesture.update(shape,.08);
  assert.equal(gesture.update(null,.08),0);
});
test('app uses a trained hand classifier and keeps microphone disabled',()=>{
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.ok(app.includes('audio: false'));assert.doesNotMatch(app,/AudioContext|enableMic|micStream|audioLevel/);
  assert.ok(app.includes('GestureRecognizer.createFromOptions'));
  assert.ok(app.includes('recognizeForVideo'));
});
