// 确定性随机源：同一时刻、同一对象的扰动可复现，便于历史回溯与序列重建

export function hash(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(i | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(f: number) {
  return f * f * (3 - 2 * f);
}

// 一维值噪声，返回 [-1, 1]
export function vnoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(seed, i);
  const b = hash(seed, i + 1);
  return (a + (b - a) * smooth(f)) * 2 - 1;
}

export function fbm(seed: number, x: number, octaves = 3): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(seed + o * 131, x * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// 采样级白噪声（以 2s 为粒度）
export function jitter(seed: number, ts: number, step = 2): number {
  return hash(seed, Math.floor(ts / step)) * 2 - 1;
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function trapezoid(t: number, start: number, end: number, rampUp: number, rampDown = rampUp) {
  if (t <= start || t >= end) return 0;
  return Math.min(1, (t - start) / rampUp, (end - t) / rampDown);
}
