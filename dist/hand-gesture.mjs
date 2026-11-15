const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function jointAngle(a, b, c) {
  const u = {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  const v = {x: c.x - b.x, y: c.y - b.y, z: c.z - b.z};
  const length = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (length < 1e-8) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / length))) * 180 / Math.PI;
}
// Ambiguous poses do nothing. Only a fully folded fist may use the wide eraser.
export function handMode(landmarks, width, height) {
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
  if (fingers[0].extended && fingers.slice(1).every(f => f.folded)) return 'write';
  if (fingers.every(f => f.folded)) return 'erase';
  return 'none';
}
export class HandGesture {
  constructor() { this.reset(); }
  reset() { this.candidate = 'none'; this.since = 0; }
  update(mode, time) {
    if (mode === 'none') { this.reset(); return 'none'; }
    if (mode !== this.candidate) { this.candidate = mode; this.since = time; return 'none'; }
    // A deliberate fist must settle longer than a writing gesture.
    return time - this.since >= (mode === 'erase' ? 180 : 80) ? mode : 'none';
  }
}
