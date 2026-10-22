// 温升识别：热点节点定位、热传播方向、温升速率筛选
import { blockMean, crossCorrelation, linreg, quantile } from './analytics';
import type { History } from './history';
import type { Snapshot } from './model';
import { LEVEL_U, RACKS, RACK_MAP, THERMAL_NODES, type Level, type Side, type ThermalNode } from './topology';

const LEVEL_IDX: Record<Level, number> = { B: 0, M: 1, T: 2 };

export function nodeTemp(s: Snapshot, n: { rack: string; side: Side; level: Level }) {
  const r = s.rackMap[n.rack];
  return (n.side === 'F' ? r.tin : r.tout)[LEVEL_IDX[n.level]];
}

export function seriesKey(n: { rack: string; side: Side; level: Level }) {
  return `${n.rack}.${n.side}-${n.level}`;
}

function median(a: number[]) {
  return quantile(a, 0.5);
}

function robust(values: number[]) {
  const m = median(values);
  const mad = median(values.map((v) => Math.abs(v - m))) * 1.4826;
  return { m, s: Math.max(mad, 0.08) };
}

/** 抛物线插值估计热点 U 位 */
function peakU(vals: [number, number, number]) {
  const xs = [LEVEL_U.B, LEVEL_U.M, LEVEL_U.T];
  const [y0, y1, y2] = vals;
  const x0 = xs[0];
  const x1 = xs[1];
  const x2 = xs[2];
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  if (A >= 0) {
    // 无内部极大值，取端点
    const i = vals.indexOf(Math.max(...vals));
    return xs[i];
  }
  const u = -B / (2 * A);
  return Math.max(1, Math.min(42, u));
}

export interface HotspotResult {
  node: ThermalNode;
  temp: number;
  limit: number;
  margin: number;
  spatialZ: number;
  temporalZ: number;
  rise: number;
  score: number;
  uEst: number;
  coord: string;
  reason: string;
}

/**
 * 热点节点定位：融合绝对裕度、空间偏离（同列同位置节点）与时间偏离（自身 60 min 基线）
 */
export function locateHotspots(s: Snapshot, h: History): HotspotResult[] {
  const out: HotspotResult[] = [];
  const groups = new Map<string, number[]>();
  // 进风按同列同高度分组；出风按同类机柜分组并以单位负载温差归一
  const groupKey = (n: ThermalNode) =>
    n.side === 'F' ? `${RACK_MAP[n.rack].row}-F-${n.level}` : `${RACK_MAP[n.rack].kind}-R-${n.level}`;
  for (const n of THERMAL_NODES) {
    const key = groupKey(n);
    const arr = groups.get(key) ?? [];
    if (n.side === 'R') {
      // 出风按单位负载温差归一，消除负载差异
      const r = s.rackMap[n.rack];
      arr.push((nodeTemp(s, n) - r.tin[LEVEL_IDX[n.level]]) / Math.max(r.loadS, 0.5));
    } else arr.push(nodeTemp(s, n));
    groups.set(key, arr);
  }
  const stats = new Map<string, { m: number; s: number }>();
  for (const [k, v] of groups) stats.set(k, robust(v));

  for (const n of THERMAL_NODES) {
    const r = s.rackMap[n.rack];
    const def = RACK_MAP[n.rack];
    const temp = nodeTemp(s, n);
    const limit = n.side === 'F' ? 27 : 45;
    const st = stats.get(groupKey(n))!;
    const metric = n.side === 'R' ? (temp - r.tin[LEVEL_IDX[n.level]]) / Math.max(r.loadS, 0.5) : temp;
    const spatialZ = (metric - st.m) / st.s;
    const key = seriesKey(n);
    const hist = h.series(key);
    const base = hist.slice(0, Math.max(10, hist.length - 150));
    const rb = robust(base.filter((_, i) => i % 3 === 0));
    const temporalZ = (temp - rb.m) / Math.max(rb.s, 0.15);
    const ci = h.col(key);
    const rise = h.size > 160 ? (h.meanCol(ci, 0, 8) - h.meanCol(ci, 150, 8)) / 5 : 0;
    const margin = limit - temp;
    const sMargin = Math.max(0, 1 - margin / (n.side === 'F' ? 5 : 8));
    const score =
      100 *
      Math.min(
        1,
        0.35 * sMargin +
          0.3 * Math.min(1, Math.max(0, spatialZ - 1.5) / 4) +
          0.2 * Math.min(1, Math.max(0, temporalZ - 1.5) / 5) +
          0.15 * Math.min(1, Math.max(0, rise) / 0.8),
      );
    const vals = (n.side === 'F' ? r.tin : r.tout).slice() as [number, number, number];
    const reasons: string[] = [];
    if (margin < 2) reasons.push(`距限值 ${margin.toFixed(1)}℃`);
    if (spatialZ > 3) reasons.push(`偏离同列 ${spatialZ.toFixed(1)}σ`);
    if (temporalZ > 3) reasons.push(`偏离基线 ${temporalZ.toFixed(1)}σ`);
    if (rise > 0.3) reasons.push(`温升 ${rise.toFixed(2)}℃/min`);
    out.push({
      node: n,
      temp,
      limit,
      margin,
      spatialZ,
      temporalZ,
      rise,
      score,
      uEst: peakU(vals),
      coord: `${def.row} 列 · 第 ${def.index} 柜 · ${n.side === 'F' ? '前' : '后'}门 U${LEVEL_U[n.level]}`,
      reason: reasons.join('，') || '—',
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface PropagationEdge {
  from: string;
  to: string;
  lagSec: number;
  r: number;
  kind: '列内横向' | '出风回流';
}

function diffSeries(h: History, a: string, b: string, n: number, block: number) {
  const ref = h.series(b, n);
  return blockMean(
    h.series(a, n).map((v, i) => v - ref[i]),
    block,
  );
}

/**
 * 热传播方向：以机柜出入风温差（发热源）与进风上下温差（受热端）为信号，
 * 一阶差分互相关求最优因果滞后，扣除送风温度的公共扰动
 */
export function propagation(h: History, minutes = 40): PropagationEdge[] {
  const block = 5; // 10 s
  const n = Math.min(h.size, Math.floor((minutes * 60) / 2));
  const heat = new Map<string, number[]>();
  const inTop = new Map<string, number[]>();
  for (const r of RACKS) {
    heat.set(r.id, diffSeries(h, `${r.id}.R-M`, `${r.id}.F-M`, n, block));
    inTop.set(r.id, diffSeries(h, `${r.id}.F-T`, `${r.id}.F-B`, n, block));
  }
  const edges: PropagationEdge[] = [];
  const push = (src: string, dst: string, kind: PropagationEdge['kind']) => {
    const cc = crossCorrelation(heat.get(src)!, inTop.get(dst)!, 12, false).filter((c) => c.lag >= 0);
    let best = cc[0];
    for (const c of cc) if (c.r > best.r) best = c;
    if (best.r < 0.3) return;
    edges.push({
      from: `${src}.R-M`,
      to: `${dst}.F-T`,
      lagSec: best.lag * block * 2,
      r: best.r,
      kind,
    });
  };
  for (const r of RACKS) {
    push(r.id, r.id, '出风回流');
    for (const nb of RACKS.filter((x) => x.row === r.row && Math.abs(x.index - r.index) === 1)) push(r.id, nb.id, '列内横向');
  }
  return edges.sort((a, b) => b.r - a.r);
}

export interface RiseRow {
  node: ThermalNode;
  temp: number;
  rate: number; // ℃/min，回归斜率
  delta: number; // 窗口内变化
  peakRate: number; // 近 60 min 最大 5 min 温升速率
  overSec: number; // 近 60 min 速率超阈值累计时长
  r2: number;
  spark: number[];
}

/** 温升速率筛选：窗口线性回归 + 历史峰值 + 越限累计时长 */
export function riseScreen(h: History, windowMin: number, rateThreshold: number): RiseRow[] {
  const w = Math.min(h.size, Math.round((windowMin * 60) / 2));
  const t = h.timeline(w).map((x) => (x - h.timeAt(0)) / 60000);
  return THERMAL_NODES.map((node) => {
    const key = seriesKey(node);
    const all = h.series(key);
    const v = all.slice(all.length - w);
    const reg = linreg(t, v);
    const sm = blockMean(all, 15); // 30 s 均值
    let peak = 0;
    let over = 0;
    for (let i = 10; i < sm.length; i++) {
      const rate = (sm[i] - sm[i - 10]) / 5;
      if (rate > peak) peak = rate;
      if (rate >= rateThreshold) over += 30;
    }
    return {
      node,
      temp: all[all.length - 1],
      rate: reg.slope,
      delta: v[v.length - 1] - v[0],
      peakRate: peak,
      overSec: over,
      r2: reg.r2,
      spark: blockMean(all.slice(-600), 10),
    };
  });
}

/** 楼面温度场（插值网格），用于热向矢量 */
export function floorField(s: Snapshot, level: number) {
  // y: 0 热通道A, 1 A列出风, 2 A列进风, 3 冷通道, 4 B列进风, 5 B列出风, 6 热通道B
  const cols = 13;
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(cols).fill(NaN));
  for (const r of RACKS) {
    const rs = s.rackMap[r.id];
    if (r.row === 'A') {
      grid[1][r.slot] = rs.tout[level];
      grid[2][r.slot] = rs.tin[level];
    } else {
      grid[4][r.slot] = rs.tin[level];
      grid[5][r.slot] = rs.tout[level];
    }
  }
  for (const a of s.acus) {
    const slot = a.id.endsWith('1') ? 4 : 9;
    if (a.id.startsWith('ACU-A')) {
      grid[1][slot] = a.ret;
      grid[2][slot] = a.supply;
    } else {
      grid[4][slot] = a.supply;
      grid[5][slot] = a.ret;
    }
  }
  const fillRow = (row: number[]) => {
    for (let i = 0; i < row.length; i++) {
      if (!Number.isNaN(row[i])) continue;
      let l = i - 1;
      while (l >= 0 && Number.isNaN(row[l])) l--;
      let r = i + 1;
      while (r < row.length && Number.isNaN(row[r])) r++;
      if (l >= 0 && r < row.length) row[i] = row[l] + ((row[r] - row[l]) * (i - l)) / (r - l);
      else row[i] = l >= 0 ? row[l] : row[r];
    }
  };
  [1, 2, 4, 5].forEach((y) => fillRow(grid[y]));
  for (let x = 0; x < cols; x++) {
    grid[0][x] = grid[1][x] - 0.8;
    grid[6][x] = grid[5][x] - 0.8;
    grid[3][x] = (grid[2][x] + grid[4][x]) / 2 - 0.3;
  }
  return grid;
}
