// A low-resolution moisture field. All rates are expressed per second.
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
export class Condensation {
  constructor(width, height, columns = 240) {
    this.width = width;
    this.height = height;
    this.columns = Math.min(columns, Math.max(80, Math.round(width / 3)));
    this.rows = Math.max(2, Math.round(this.columns * height / width));
    this.water = new Float32Array(this.columns * this.rows);
    this.next = new Float32Array(this.water.length);
    this.grain = new Float32Array(this.water.length);
    this.clouds = [];
    this.time = 0;
    let seed = 71;
    for (let i = 0; i < this.grain.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      this.grain[i] = seed / 4294967296;
    }
  }
  clear() { this.water.fill(0); this.clouds.length = 0; }
  // A short exhalation expands outward and rises even after it ends.
  breathe(x, y, strength = 1) {
    if (this.clouds.length >= 24) return;
    this.clouds.push({x, y, strength: clamp(strength, .1, 2), age: 0, seed: this.time * 1.7});
  }
  step(seconds) {
    const dt = clamp(seconds, 0, .05);
    this.time += dt;
    const {columns: w, rows: h, water: a, next: b} = this;
    const mix = dt * .32;
    const evaporation = Math.exp(-dt / 75);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const neighbors = a[y * w + Math.max(0, x - 1)] + a[y * w + Math.min(w - 1, x + 1)]
          + a[Math.max(0, y - 1) * w + x] + a[Math.min(h - 1, y + 1) * w + x];
        b[i] = clamp((a[i] + mix * (neighbors - 4 * a[i])) * evaporation);
      }
    }
    this.water = b; this.next = a;
    for (const cloud of this.clouds) {
      cloud.age += dt;
      if (cloud.age > 1.35) continue;
      const progress = cloud.age / 1.35;
      const radius = Math.min(this.width * .42, this.height * .34) * (.025 + 1.25 * progress ** .65);
      const fade = Math.sin(Math.PI * Math.min(1, progress * 1.1));
      this.deposit(cloud.x + Math.sin(cloud.seed + progress * 2) * radius * .07,
        cloud.y - radius * progress * .23, radius, radius * .7,
        dt * cloud.strength * fade * 1.9, cloud.seed);
    }
    this.clouds = this.clouds.filter(c => c.age < 1.35);
  }
  deposit(cx, cy, rx, ry, amount, phase = 0) {
    const sx = this.columns / this.width, sy = this.rows / this.height;
    const left = Math.max(0, Math.floor((cx - rx * 1.4) * sx));
    const right = Math.min(this.columns - 1, Math.ceil((cx + rx * 1.4) * sx));
    const top = Math.max(0, Math.floor((cy - ry * 1.4) * sy));
    const bottom = Math.min(this.rows - 1, Math.ceil((cy + ry * 1.4) * sy));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const dx = ((x + .5) / sx - cx) / rx, dy = ((y + .5) / sy - cy) / ry;
      const irregularity = 1 + .11 * Math.sin(dx * 9 + phase) * Math.cos(dy * 8 - phase);
      const q = (dx * dx + dy * dy) * irregularity;
      if (q > 1.8) continue;
      const i = y * this.columns + x;
      const falloff = Math.exp(-q * 2.6) * clamp((1.8 - q) / .6);
      // Condensation grows more slowly as glass approaches saturation.
      const growth = amount * falloff * (.84 + this.grain[i] * .32);
      this.water[i] = clamp(1 - (1 - this.water[i]) * Math.exp(-growth));
    }
  }
  wipe(from, to, radius, aspect = 1, angle = 0, pressure = 1) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(length / Math.max(2, radius * .3)));
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      this.wipeStamp(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
        radius, radius * aspect, angle, pressure);
    }
  }
  wipeStamp(cx, cy, rx, ry, angle, pressure) {
    const sx = this.columns / this.width, sy = this.rows / this.height;
    const reach = Math.max(rx, ry) * 1.15;
    const left = Math.max(0, Math.floor((cx - reach) * sx));
    const right = Math.min(this.columns - 1, Math.ceil((cx + reach) * sx));
    const top = Math.max(0, Math.floor((cy - reach) * sy));
    const bottom = Math.min(this.rows - 1, Math.ceil((cy + reach) * sy));
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const dx = (x + .5) / sx - cx, dy = (y + .5) / sy - cy;
      const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      const q = Math.hypot(u, v);
      if (q > 1.12) continue;
      const i = y * this.columns + x;
      // A clear contact area with a feathered wet edge, without a hard brush outline.
      const edge = clamp((1.07 - q) / .3);
      const contact = edge * edge * (3 - 2 * edge);
      this.water[i] *= 1 - contact * clamp(pressure);
    }
  }
  writeAlpha(rgba) {
    for (let i = 0; i < this.water.length; i++) {
      const moisture = this.water[i];
      const grain = .94 + this.grain[i] * .12;
      const alpha = (1 - Math.exp(-moisture * 3.8)) * grain;
      rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = Math.round(clamp(alpha, 0, .97) * 255);
    }
  }
}
