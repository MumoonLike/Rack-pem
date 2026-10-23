// 通用统计与信号分析算法

export function mean(a: ArrayLike<number>) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : NaN;
}

export function std(a: ArrayLike<number>, m = mean(a)) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0;
}

export function minmax(a: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  return [lo, hi];
}

export function quantile(a: number[], q: number) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : 0;
}

export function linreg(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = Math.min(x.length, y.length);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
    syy += y[i] * y[i];
  }
  const d = n * sxx - sx * sx;
  const slope = d ? (n * sxy - sx * sy) / d : 0;
  const intercept = (sy - slope * sx) / n;
  const r = pearson(x, y);
  void syy;
  return { slope, intercept, r2: r * r };
}

/** 一阶差分后的互相关（消除共同趋势），返回各滞后步的相关系数；lag>0 表示 y 滞后于 x */
export function crossCorrelation(x: number[], y: number[], maxLag: number, diff = false) {
  const a = diff ? x.slice(1).map((v, i) => v - x[i]) : x;
  const b = diff ? y.slice(1).map((v, i) => v - y[i]) : y;
  const out: { lag: number; r: number }[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      xs.push(a[i]);
      ys.push(b[j]);
    }
    out.push({ lag, r: pearson(xs, ys) });
  }
  return out;
}

export function bestLag(cc: { lag: number; r: number }[]) {
  return cc.reduce((best, c) => (c.r > best.r ? c : best), cc[0]);
}

/** 均值滑动降采样 */
export function blockMean(a: number[], block: number) {
  const out: number[] = [];
  for (let i = 0; i + block <= a.length; i += block) {
    let s = 0;
    for (let k = 0; k < block; k++) s += a[i + k];
    out.push(s / block);
  }
  return out;
}

export function histogram(a: number[], lo: number, hi: number, bins: number) {
  const counts = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins || 1;
  for (const v of a) {
    let k = Math.floor((v - lo) / w);
    if (k < 0) k = 0;
    if (k >= bins) k = bins - 1;
    counts[k] += 1;
  }
  return counts;
}

function normalize(c: number[], eps = 1e-6) {
  const s = c.reduce((x, y) => x + y, 0) || 1;
  const p = c.map((v) => v / s + eps);
  const s2 = p.reduce((x, y) => x + y, 0);
  return p.map((v) => v / s2);
}

export function klDivergence(p: number[], q: number[]) {
  const P = normalize(p);
  const Q = normalize(q);
  return P.reduce((s, v, i) => s + v * Math.log(v / Q[i]), 0);
}

export function jsDivergence(p: number[], q: number[]) {
  const P = normalize(p);
  const Q = normalize(q);
  const M = P.map((v, i) => (v + Q[i]) / 2);
  const kl = (A: number[], B: number[]) => A.reduce((s, v, i) => s + v * Math.log2(v / B[i]), 0);
  return 0.5 * kl(P, M) + 0.5 * kl(Q, M);
}

/** 群体稳定性指标 PSI */
export function psi(expected: number[], actual: number[]) {
  const E = normalize(expected, 1e-4);
  const A = normalize(actual, 1e-4);
  return E.reduce((s, e, i) => s + (A[i] - e) * Math.log(A[i] / e), 0);
}

/** 两样本 KS 统计量 */
export function ksStatistic(a: number[], b: number[]) {
  const x = a.slice().sort((m, n) => m - n);
  const y = b.slice().sort((m, n) => m - n);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

/** KS 检验近似 p 值 */
export function ksPValue(d: number, n: number, m: number) {
  const ne = (n * m) / (n + m);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let s = 0;
  for (let k = 1; k <= 100; k++) s += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  return Math.max(0, Math.min(1, s));
}

export function zscore(v: number, m: number, s: number) {
  return s > 1e-9 ? (v - m) / s : 0;
}

/** 离散傅里叶变换求前 n 次谐波幅值 */
export function harmonics(samples: number[], cycles: number, n: number) {
  const N = samples.length;
  const out: number[] = [];
  for (let h = 1; h <= n; h++) {
    const k = h * cycles;
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const ang = (2 * Math.PI * k * i) / N;
      re += samples[i] * Math.cos(ang);
      im -= samples[i] * Math.sin(ang);
    }
    out.push((2 * Math.sqrt(re * re + im * im)) / N);
  }
  return out;
}

export function rms(a: number[]) {
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}

export function sparkPath(values: number[], w: number, h: number) {
  if (!values.length) return '';
  const [lo, hi] = minmax(values);
  const span = hi - lo || 1;
  return values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1 || 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`)
    .join(' ');
}
