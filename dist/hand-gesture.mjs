const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function jointAngle(a, b, c) {
  const u = {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  const v = {x: c.x - b.x, y: c.y - b.y, z: c.z - b.z};
  const length = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (length < 1e-8) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / length))) * 180 / Math.PI;
}
// Ambiguous poses do nothing. Only a fully folded fist may use the wide eraser.
export function handMode(landmarks, width, height, wasPinching = false, recognition = null) {
  if (landmarks?.length !== 21 || !width || !height) return 'none';
  const points = landmarks.map(p => ({x: p.x * width, y: p.y * height, z: (p.z || 0) * width}));
  if (points.some(p => !Number.isFinite(p.x + p.y + p.z))) return 'none';
  if (distance(points[5], points[17]) < 5) return 'none';
  const fingers = [5, 9, 13, 17].map(base => {
    const [mcp, pip, dip, tip] = points.slice(base, base + 4);
    const angle = jointAngle(mcp, pip, dip), endAngle = jointAngle(pip, dip, tip);
    const reach = distance(tip, points[0]) / Math.max(1e-6, distance(pip, points[0]));
    return {extended: angle > 150 && endAngle > 145 && reach > 1.08,
      folded: angle < 140 && reach < 1.08};
  });
  // Depth estimates become noisy when fingertips overlap; judge contact in the camera plane.
  const screenDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const span = Math.max(screenDistance(points[5], points[17]), screenDistance(points[0], points[9]) * .8);
  const pinchGap = screenDistance(points[4], points[8]) / span;
  const touching = pinchGap < (wasPinching ? .5 : .35);
  // A curved index is valid. Reject only the clustered fingertips of a closed fist.
  const indexSeparate = screenDistance(points[8], points[12]) / span > .42;
  const fist = fingers.every(f => f.folded);
  // Use the trained gesture classifier for fists. A noisy landmark pose alone must not erase.
  const recognizedFist = recognition?.categoryName === 'Closed_Fist' && recognition.score >= .75;
  if (recognizedFist) return 'erase';
  if (touching && (recognition ? true : (!fist || indexSeparate))) return 'write';
  if (!recognition && fist) return 'erase';
  return 'none';
}
// Use the actual contact between thumb and index, rather than the index alone.
export function writingPoint(points) {
  return {x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2};
}
export class HandGesture {
  constructor() { this.reset(); }
  reset() { this.candidate = 'none'; this.since = 0; this.lastWriting = -Infinity; }
  update(mode, time) {
    if (mode === 'none') { this.candidate = 'none'; this.since = 0; return 'none'; }
    if (mode !== this.candidate) { this.candidate = mode; this.since = time; return 'none'; }
    // Protect a just-finished stroke while the fingers change pose.
    if (mode === 'erase' && time - this.lastWriting < 600) return 'none';
    if (time - this.since < (mode === 'erase' ? 350 : 80)) return 'none';
    if (mode === 'write') this.lastWriting = time;
    return mode;
  }
}
