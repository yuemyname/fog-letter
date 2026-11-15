const clamp = n => Math.max(0, Math.min(1, n));
export function lipShape(landmarks, categories, width, height) {
  if (!landmarks || landmarks.length < 468 || !width || !height) return null;
  const lips = [61,291,13,14].map(i => landmarks[i]);
  if (lips.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
  const p = i => ({x: landmarks[i].x * width, y: landmarks[i].y * height, z: (landmarks[i].z || 0) * width});
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const lipWidth = distance(p(61),p(291)), eyeSpan = distance(p(33),p(263));
  if (lipWidth < 3 || eyeSpan < 15) return null;
  const scores = Object.fromEntries((categories || []).map(c => [c.categoryName,c.score]));
  const pucker = scores.mouthPucker || 0, funnel = scores.mouthFunnel || 0;
  const aperture = distance(p(13),p(14)) / lipWidth;
  const smile = Math.max(scores.mouthSmileLeft || 0,scores.mouthSmileRight || 0);
  // Both the learned expression and a small rounded opening must agree.
  const blowing = (pucker > .55 || funnel > .6) && aperture > .06 && aperture < .7
    && lipWidth / eyeSpan < .6 && smile < .25 && (scores.jawOpen || 0) < .45;
  const strength = blowing ? .4 + clamp((Math.max(pucker,funnel)-.5)/.5)*.8 : 0;
  return {blowing,strength,center:{x:lips.reduce((n,p)=>n+p.x,0)/4,y:lips.reduce((n,p)=>n+p.y,0)/4}};
}
export class MouthGesture {
  constructor() { this.reset(); }
  reset() { this.held = 0; this.level = 0; }
  update(shape, dt) {
    dt = Math.max(0,Math.min(.12,dt));
    // A relaxed mouth, missing face or missing expression scores never emits fog.
    if (!shape?.blowing) { this.reset(); return 0; }
    this.held += dt;
    const target = this.held >= .25 ? shape.strength : 0;
    this.level += (target-this.level)*(1-Math.exp(-dt*12));
    return this.level;
  }
}
