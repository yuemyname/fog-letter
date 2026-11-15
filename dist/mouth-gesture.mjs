const clamp = n => Math.max(0, Math.min(1, n));
// Scale all axes equally before measuring; portrait video must not distort lip ratios.
export function lipShape(landmarks, categories, width, height) {
  if (!landmarks || landmarks.length < 468 || !width || !height) return null;
  const p = i => ({x: landmarks[i].x * width, y: landmarks[i].y * height, z: (landmarks[i].z || 0) * width});
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const left = p(61), right = p(291), top = p(13), bottom = p(14);
  const lipWidth = dist(left, right), eyeSpan = dist(p(33), p(263));
  if (eyeSpan < 15 || lipWidth < 3) return null;
  const scores = Object.fromEntries((categories || []).map(c => [c.categoryName, c.score]));
  const aperture = dist(top, bottom) / lipWidth;
  const narrowness = lipWidth / eyeSpan;
  const pucker = scores.mouthPucker || 0, funnel = scores.mouthFunnel || 0;
  const smile = Math.max(scores.mouthSmileLeft || 0, scores.mouthSmileRight || 0);
  const jaw = scores.jawOpen || 0;
  // Require rounded/pursed lips, not merely an open mouth, smile or yawn.
  const rounded = Math.max(pucker, funnel * .9);
  const blowing = rounded > .32 && aperture > .025 && aperture < .85
    && narrowness < .66 && smile < .4 && jaw < .58;
  const strength = blowing ? .35 + clamp((rounded - .32) / .55) * .95 : 0;
  return {blowing, strength, center: {x: (left.x + right.x + top.x + bottom.x) / (4 * width),
    y: (left.y + right.y + top.y + bottom.y) / (4 * height)}};
}
export class MouthGesture {
  constructor() { this.reset(); }
  reset() { this.held = 0; this.level = 0; }
  update(shape, dt) {
    dt = Math.max(0, Math.min(.12, dt));
    if (!shape) { this.reset(); return 0; }
    this.held = shape.blowing ? this.held + dt : Math.max(0, this.held - dt * 3);
    const target = shape.blowing && this.held >= .16 ? shape.strength : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt * (target ? 12 : 18)));
    return this.level;
  }
}
