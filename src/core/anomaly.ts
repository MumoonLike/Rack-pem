// 异常联判：节点评分排序、分布一致性计算、多源证据融合路径
import { blockMean, crossCorrelation, histogram, jsDivergence, klDivergence, ksPValue, ksStatistic, mean, minmax, psi, quantile, std } from './analytics';
import type { History } from './history';
import { COOLING_WEIGHTS, RACKS, RACK_MAP, neighbors } from './topology';

const POS = ['F-B', 'F-M', 'F-T', 'R-B', 'R-M', 'R-T'];

function slice(h: History, key: string, back: number, n: number) {
  return h.range(key, back, n);
}

function robustStats(src: number[]) {
  // 抽样至 ≤ 160 点以控制排序开销
  const step = Math.max(1, Math.floor(src.length / 160));
  const a = step > 1 ? src.filter((_, i) => i % step === 0) : src;
  const m = quantile(a, 0.5);
  const mad = quantile(
    a.map((v) => Math.abs(v - m)),
    0.5,
  );
  return { m, s: Math.max(mad * 1.4826, 1e-3) };
}

export interface RackFeatures {
  rack: string;
  loadRatio: number;
  loadDev: number; // 相对基线负载变化率
  curZ: number;
  riseMax: number;
  riseNode: string;
  tempZ: number;
  tempNode: string;
  tinTop: number;
  spatialZ: number; // 进风·上相对同列的空间偏离
  rh: number;
  rhZ: number;
  jsd: number;
  sub: { E: number; T: number; H: number; C: number };
  score: number;
  level: '正常' | '关注' | '异常';
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 在 back（采样点）时刻计算机柜节点特征 */
export function rackFeatures(h: History, rackId: string, back = 0): RackFeatures {
  const def = RACK_MAP[rackId];
  const span = Math.min(h.size - back, 1800);
  const recentN = 30;
  const baseLoad = slice(h, `${rackId}.load`, back + 150, span - 150);
  const recentLoad = slice(h, `${rackId}.load`, back, recentN);
  const lb = robustStats(baseLoad);
  const lr = mean(recentLoad);
  const loadDev = (lr - lb.m) / lb.m;

  let curZ = 0;
  for (const k of ['ia', 'ib']) {
    const b = robustStats(slice(h, `${rackId}.${k}`, back + 150, span - 150));
    const r = mean(slice(h, `${rackId}.${k}`, back, recentN));
    curZ = Math.max(curZ, (r - b.m) / Math.max(b.s, b.m * 0.03));
  }

  let riseMax = -Infinity;
  let riseNode = '';
  let tempZ = -Infinity;
  let tempNode = '';
  for (const p of POS) {
    const key = `${rackId}.${p}`;
    const ci = h.col(key);
    const rate = h.size - back > 170 ? (h.meanCol(ci, back, 8) - h.meanCol(ci, back + 150, 8)) / 5 : 0;
    if (rate > riseMax) {
      riseMax = rate;
      riseNode = `${rackId}-${p}`;
    }
    const b = robustStats(slice(h, key, back + 150, span - 150));
    const z = (h.meanCol(ci, back, 15) - b.m) / Math.max(b.s, 0.2);
    if (z > tempZ) {
      tempZ = z;
      tempNode = `${rackId}-${p}`;
    }
  }
  const tinTop = h.meanCol(h.col(`${rackId}.F-T`), back, 8);
  const peers = RACKS.filter((r) => r.row === def.row).map((r) => h.meanCol(h.col(`${r.id}.F-T`), back, 8));
  const ps = robustStats(peers);
  const spatialZ = (tinTop - ps.m) / Math.max(ps.s, 0.15);
  const rh = h.atCol(h.col(`${rackId}.rhF`), back);
  const rhb = robustStats(slice(h, `${rackId}.rhF`, back + 150, span - 150));
  const rhZ = (rh - rhb.m) / Math.max(rhb.s, 0.5);

  // 分布一致性：近 10 min vs 基线
  const lt = slice(h, `${rackId}.R-T`, back, 300);
  const bt = slice(h, `${rackId}.R-T`, back + 300, Math.max(60, span - 300));
  const [lo, hi] = minmax([...lt, ...bt]);
  const jsd = lt.length > 20 && bt.length > 20 ? jsDivergence(histogram(bt, lo, hi, 16), histogram(lt, lo, hi, 16)) : 0;

  const loadRatio = mean(recentLoad) / def.ratedKw;
  const E = clamp01(0.55 * clamp01((curZ - 2) / 8) + 0.45 * clamp01((loadRatio - 0.75) / 0.2));
  const T = clamp01(0.5 * clamp01(riseMax / 0.8) + 0.5 * clamp01((tempZ - 2.5) / 8));
  const H = clamp01(0.4 * clamp01((rh - 55) / 10) + 0.25 * clamp01((tinTop - 24.5) / 3) + 0.35 * clamp01((spatialZ - 2) / 6));
  const C = clamp01((jsd - 0.45) / 0.4);
  const subs = [E, T, H, C];
  const joint = subs.filter((v) => v > 0.35).length >= 2 ? 1.18 : 1;
  // 加权和体现多源综合，最大分量保证单一强证据不被稀释
  const weighted = 0.3 * E + 0.32 * T + 0.2 * H + 0.18 * C;
  const score = Math.min(100, 100 * joint * (0.6 * weighted + 0.4 * Math.max(E, T, H)));
  return {
    rack: rackId,
    loadRatio,
    loadDev,
    curZ,
    riseMax,
    riseNode,
    tempZ,
    tempNode,
    tinTop,
    spatialZ,
    rh,
    rhZ,
    jsd,
    sub: { E, T, H, C },
    score,
    level: score >= 40 ? '异常' : score >= 22 ? '关注' : '正常',
  };
}

export function rankNodes(h: History, back = 0) {
  return RACKS.map((r) => rackFeatures(h, r.id, back)).sort((a, b) => b.score - a.score);
}

// ---------- 分布一致性 ----------

export const CONSISTENCY_METRICS = [
  { key: 'load', label: 'IT 负载', unit: 'kW' },
  { key: 'ia', label: 'A 路电流', unit: 'A' },
  { key: 'F-T', label: '进风·上', unit: '℃' },
  { key: 'R-T', label: '出风·上', unit: '℃' },
  { key: 'R-M', label: '出风·中', unit: '℃' },
  { key: 'rhF', label: '进风湿度', unit: '%RH' },
] as const;

export interface ConsistencyResult {
  rack: string;
  metric: string;
  base: number[];
  recent: number[];
  edges: number[];
  baseHist: number[];
  recentHist: number[];
  js: number;
  kl: number;
  ks: number;
  p: number;
  psi: number;
  meanShift: number;
  stdRatio: number;
  verdict: '一致' | '轻微偏移' | '显著偏移';
}

export function consistency(h: History, rack: string, metric: string, recentMin = 10, bins = 20): ConsistencyResult {
  const key = `${rack}.${metric}`;
  const all = h.series(key);
  const rn = Math.round((recentMin * 60) / 2);
  const recent = all.slice(-rn);
  const base = all.slice(0, Math.max(30, all.length - rn));
  const [lo0, hi0] = minmax([...base, ...recent]);
  const pad = (hi0 - lo0) * 0.04 || 0.1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const baseHist = histogram(base, lo, hi, bins);
  const recentHist = histogram(recent, lo, hi, bins);
  const edges = Array.from({ length: bins }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / bins);
  const js = jsDivergence(baseHist, recentHist);
  const ks = ksStatistic(base, recent);
  const p = ksPValue(ks, base.length / 15, recent.length / 15); // 按自相关折算有效样本数
  const ps = psi(baseHist, recentHist);
  const mb = mean(base);
  const sb = std(base);
  const verdict = js >= 0.5 ? '显著偏移' : js >= 0.3 ? '轻微偏移' : '一致';
  return {
    rack,
    metric,
    base,
    recent,
    edges,
    baseHist,
    recentHist,
    js,
    kl: klDivergence(recentHist, baseHist),
    ks,
    p,
    psi: ps,
    meanShift: sb > 1e-6 ? (mean(recent) - mb) / sb : 0,
    stdRatio: sb > 1e-6 ? std(recent) / sb : 1,
    verdict,
  };
}

export function consistencyMatrix(h: History, recentMin = 10) {
  const out: { rack: string; metric: string; js: number; psi: number }[] = [];
  for (const r of RACKS) {
    for (const m of CONSISTENCY_METRICS) {
      const c = consistency(h, r.id, m.key, recentMin, 16);
      out.push({ rack: r.id, metric: m.key, js: c.js, psi: c.psi });
    }
  }
  return out;
}

// ---------- 融合路径 ----------

export type EvidenceSource = '电参' | '温升' | '环境' | '制冷';

export interface Evidence {
  id: string;
  source: EvidenceSource;
  label: string;
  value: string;
  strength: number; // 0..1
}

export interface FusionPath {
  id: string;
  rack: string;
  cause: string;
  category: '负载驱动' | '散热异常' | '气流组织' | '制冷衰减' | '湿度调节';
  evidence: Evidence[];
  links: { from: string; to: string; weight: number; lagSec?: number }[];
  confidence: number;
  score: number;
  suggestion: string;
}

function lagBetween(h: History, a: string, b: string, back: number) {
  const n = Math.min(h.size - back, 600);
  const x = blockMean(slice(h, a, back, n), 10);
  const y = blockMean(slice(h, b, back, n), 10);
  if (x.length < 12) return { lag: 0, r: 0 };
  const cc = crossCorrelation(x, y, 8, true).filter((c) => c.lag >= 0);
  return cc.reduce((best, c) => (c.r > best.r ? c : best), cc[0]);
}

/** 基于节点特征与空调状态构建多源证据融合路径 */
export function buildFusion(h: History, back = 0, withLag = true): FusionPath[] {
  const feats = RACKS.map((r) => rackFeatures(h, r.id, back));
  const fmap = Object.fromEntries(feats.map((f) => [f.rack, f]));
  const acuDev = ['ACU-A1', 'ACU-A2', 'ACU-B1', 'ACU-B2'].map((id) => ({
    id,
    dev: h.atCol(h.col(`${id}.sup`), back) - 21,
    fan: h.atCol(h.col(`${id}.fan`), back),
  }));
  const paths: FusionPath[] = [];
  const used = new Set<string>();

  // 1) 制冷衰减：空调送风偏离 → 下游机柜进风抬升
  for (const a of acuDev) {
    if (a.dev < 1.2) continue;
    const down = RACKS.filter((r) => COOLING_WEIGHTS[r.id][a.id] >= 0.22)
      .map((r) => fmap[r.id])
      .filter((f) => f.tempZ > 1.5 || f.tinTop > 23.5);
    const ev: Evidence[] = [
      { id: `${a.id}-sup`, source: '制冷', label: `${a.id} 送风偏离`, value: `+${a.dev.toFixed(1)}℃`, strength: Math.min(1, a.dev / 3) },
      { id: `${a.id}-fan`, source: '制冷', label: `${a.id} 风机补偿`, value: `${a.fan.toFixed(0)}%`, strength: Math.min(1, Math.max(0, (a.fan - 70) / 25)) },
    ];
    for (const f of down.slice(0, 4)) {
      ev.push({ id: `${f.rack}-tin`, source: '环境', label: `${f.rack} 进风抬升`, value: `${f.tinTop.toFixed(1)}℃`, strength: Math.min(1, Math.max(0.2, (f.tinTop - 22.5) / 3)) });
    }
    const links = ev.slice(2).map((e) => ({ from: `${a.id}-sup`, to: e.id, weight: e.strength }));
    links.push({ from: `${a.id}-sup`, to: `${a.id}-fan`, weight: 0.6 });
    const conf = Math.min(0.97, 0.55 + a.dev * 0.1 + down.length * 0.04);
    paths.push({
      id: `F-${a.id}`,
      rack: a.id,
      cause: `${a.id} 制冷能力下降`,
      category: '制冷衰减',
      evidence: ev,
      links,
      confidence: conf,
      score: Math.min(100, 45 + a.dev * 12),
      suggestion: `检查 ${a.id} 压缩机及冷凝侧换热，临时提升相邻空调出力`,
    });
    down.forEach((f) => used.add(f.rack));
  }

  for (const f of feats) {
    if (used.has(f.rack) || (f.score < 20 && !(f.tinTop > 24.5 && f.spatialZ > 4))) continue;
    const ev: Evidence[] = [];
    const links: FusionPath['links'] = [];
    const add = (e: Evidence) => ev.push(e);
    const id = f.rack;
    const loadDriven = f.sub.E > 0.25 || f.loadDev > 0.12;
    if (loadDriven) {
      add({ id: `${id}-load`, source: '电参', label: `${id} 负载攀升`, value: `+${Math.max(0, f.loadDev * 100).toFixed(0)}%`, strength: Math.max(f.sub.E, Math.min(1, f.loadDev / 0.35)) });
      if (f.curZ > 3) add({ id: `${id}-cur`, source: '电参', label: `${id} PDU 电流偏离`, value: `${f.curZ.toFixed(1)}σ`, strength: Math.min(1, f.curZ / 10) });
    }
    if (f.riseMax > 0.2 || f.tempZ > 3) {
      add({ id: `${id}-rise`, source: '温升', label: `${f.riseNode} 温升`, value: `${Math.max(0, f.riseMax).toFixed(2)}℃/min`, strength: Math.max(f.sub.T, 0.25) });
    }
    if (f.tempZ > 4 && !ev.some((e) => e.source === '温升' && e.id === `${id}-rise` && f.riseMax > 0.5))
      add({ id: `${id}-tz`, source: '温升', label: `${f.tempNode} 偏离基线`, value: `${f.tempZ.toFixed(1)}σ`, strength: Math.min(1, f.tempZ / 10) });
    if (f.tinTop > 24.5) add({ id: `${id}-tin`, source: '环境', label: `${id} 进风·上偏高`, value: `${f.tinTop.toFixed(1)}℃`, strength: Math.min(1, (f.tinTop - 23) / 4) });
    const recirc = f.tinTop > 24.5 && f.spatialZ > 4;
    if (recirc) add({ id: `${id}-sz`, source: '环境', label: `${id} 偏离同列进风`, value: `${f.spatialZ.toFixed(1)}σ`, strength: Math.min(1, f.spatialZ / 10) });
    if (f.rh > 56) add({ id: `${id}-rh`, source: '环境', label: `${id} 湿度偏高`, value: `${f.rh.toFixed(1)}%`, strength: Math.min(1, (f.rh - 50) / 15) });
    if (f.jsd > 0.5) add({ id: `${id}-dist`, source: '温升', label: `${id} 出风分布偏移`, value: `JS ${f.jsd.toFixed(2)}`, strength: Math.min(1, f.jsd / 0.8) });

    // 邻柜传播
    const nb = neighbors(id).map((n) => fmap[n]).filter((n) => n.tinTop > 23.3 && n.rack !== id);
    if (loadDriven && f.sub.T > 0.2 && nb.length) {
      for (const n of nb) add({ id: `${n.rack}-nb`, source: '环境', label: `${n.rack} 邻柜进风抬升`, value: `${n.tinTop.toFixed(1)}℃`, strength: Math.min(1, (n.tinTop - 22.5) / 3) });
    }
    if (ev.length < 2) continue;

    let category: FusionPath['category'];
    let cause: string;
    let suggestion: string;
    if (recirc && !(loadDriven && f.sub.T > 0.3)) {
      category = '气流组织';
      cause = `${id} 顶部热回流`;
      suggestion = `封堵 ${id} 空余 U 位盲板，检查冷通道顶板及柜顶密封`;
    } else if (loadDriven && f.sub.T > 0.15) {
      category = '负载驱动';
      cause = `${id} 高负载引发局部温升`;
      suggestion = `评估 ${id} 业务负载迁移，或提升对应区域空调出力`;
    } else if (f.rh > 56 && f.sub.H > 0.2) {
      category = '湿度调节';
      cause = `${RACK_MAP[id].row} 列湿度调节异常`;
      suggestion = '检查加湿器与除湿逻辑，核对湿度设定值';
    } else if (!loadDriven && Math.abs(f.loadDev) < 0.05 && f.tempZ > 4) {
      category = '散热异常';
      cause = `${id} 设备散热异常`;
      suggestion = `排查 ${f.tempNode.replace(`${id}-`, '')} 位置设备风扇及滤网`;
    } else continue;

    // 证据链：电参 → 温升 → 环境
    const order: EvidenceSource[] = ['电参', '温升', '环境', '制冷'];
    const bySrc = (s: EvidenceSource) => ev.filter((e) => e.source === s);
    for (let i = 0; i < order.length - 1; i++) {
      const from = bySrc(order[i]);
      let j = i + 1;
      while (j < order.length && !bySrc(order[j]).length) j++;
      if (j >= order.length) break;
      for (const a of from) for (const b of bySrc(order[j])) links.push({ from: a.id, to: b.id, weight: Math.min(a.strength, b.strength) });
    }
    if (withLag && category === '负载驱动') {
      const lag = lagBetween(h, `${id}.load`, `${id}.R-T`, back);
      const l = links.find((x) => x.from === `${id}-load`);
      if (l) l.lagSec = lag.lag * 20;
    }
    const meanStrength = mean(ev.map((e) => e.strength));
    const srcCount = new Set(ev.map((e) => e.source)).size;
    paths.push({
      id: `F-${id}`,
      rack: id,
      cause,
      category,
      evidence: ev,
      links,
      confidence: Math.min(0.98, 0.4 + meanStrength * 0.35 + srcCount * 0.08),
      score: f.score,
      suggestion,
    });
  }

  // 合并同列湿度路径
  const humid = paths.filter((p) => p.category === '湿度调节');
  if (humid.length > 1) {
    const keep = humid.sort((a, b) => b.score - a.score)[0];
    keep.evidence = humid.flatMap((p) => p.evidence).filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i).slice(0, 7);
    keep.links = [];
    const rhs = keep.evidence.filter((e) => e.id.endsWith('-rh'));
    const others = keep.evidence.filter((e) => !e.id.endsWith('-rh'));
    rhs.forEach((e, i) => {
      if (i > 0) keep.links.push({ from: rhs[0].id, to: e.id, weight: e.strength });
    });
    others.forEach((e) => keep.links.push({ from: rhs[0].id, to: e.id, weight: e.strength }));
    keep.rack = Array.from(new Set(humid.map((p) => p.rack))).join('/');
    keep.confidence = Math.min(0.97, keep.confidence + 0.05 * humid.length);
    return paths.filter((p) => p.category !== '湿度调节' || p === keep).sort((a, b) => b.score - a.score);
  }
  return paths.sort((a, b) => b.score - a.score);
}
