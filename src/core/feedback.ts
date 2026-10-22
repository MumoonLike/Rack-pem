// 结果反馈：路径链组提取、负载响应分析、能效路径筛选
import { blockMean, mean, quantile } from './analytics';
import { buildFusion, type FusionPath } from './anomaly';
import { airMetrics } from './airflow';
import type { History } from './history';
import type { Snapshot } from './model';
import { RACKS, RACK_MAP } from './topology';

// ---------- 路径链组提取 ----------

export interface ChainEpisode {
  start: number;
  end: number;
  peak: number;
  conf: number;
}

export interface ChainItem {
  key: string;
  rack: string;
  cause: string;
  category: FusionPath['category'];
  steps: string[];
  episodes: ChainEpisode[];
  occurrences: number;
  active: boolean;
  lastPath: FusionPath;
}

export interface ChainGroup {
  id: string;
  category: FusionPath['category'];
  pattern: string[];
  chains: ChainItem[];
  members: string[];
  episodes: number;
  totalSec: number;
  first: number;
  last: number;
  peak: number;
  active: boolean;
  support: number;
}

function genericStep(label: string) {
  return label.replace(/^(ACU-[AB]\d|[AB]\d{2})(-[FR]-[TMB])?\s*/, '').replace(/[AB]\s?列/, '');
}

export function extractChains(h: History, stepSamples = 60) {
  const evals: { t: number; paths: FusionPath[] }[] = [];
  for (let b = 0; b <= h.size - 420; b += stepSamples) evals.push({ t: h.timeAt(b), paths: buildFusion(h, b, false) });
  return extractChainsFrom(evals.reverse(), stepSamples * 2000);
}

/** 由按时间排列的融合路径评估结果提取路径链与链组 */
export function extractChainsFrom(evals: { t: number; paths: FusionPath[] }[], stepMs: number): { groups: ChainGroup[]; evaluations: number; times: number[] } {
  const items = new Map<string, ChainItem>();
  const times: number[] = [];
  const gap = stepMs * 1.5;
  evals.forEach(({ t, paths }, idx) => {
    times.push(t);
    for (const p of paths) {
      if (p.score < 20) continue;
      const steps = Array.from(new Set(p.evidence.map((e) => `${e.source}·${genericStep(e.label)}`)));
      const key = `${p.category}|${p.rack}`;
      let it = items.get(key);
      if (!it) {
        it = { key, rack: p.rack, cause: p.cause, category: p.category, steps, episodes: [], occurrences: 0, active: false, lastPath: p };
        items.set(key, it);
      }
      it.occurrences += 1;
      it.lastPath = p;
      if (steps.length > it.steps.length) it.steps = steps;
      const ep = it.episodes[it.episodes.length - 1];
      if (ep && t - ep.end <= gap) {
        ep.end = t;
        ep.peak = Math.max(ep.peak, p.score);
        ep.conf = Math.max(ep.conf, p.confidence);
      } else {
        it.episodes.push({ start: t, end: t, peak: p.score, conf: p.confidence });
      }
      if (idx === evals.length - 1) it.active = true;
    }
  });

  const groups = new Map<string, ChainGroup>();
  for (const it of items.values()) {
    const g = groups.get(it.category) ?? {
      id: `G-${groups.size + 1}`,
      category: it.category,
      pattern: [],
      chains: [],
      members: [],
      episodes: 0,
      totalSec: 0,
      first: Infinity,
      last: 0,
      peak: 0,
      active: false,
      support: 0,
    };
    g.chains.push(it);
    g.members.push(it.rack);
    g.episodes += it.episodes.length;
    for (const e of it.episodes) {
      g.totalSec += (e.end - e.start + stepMs) / 1000;
      g.first = Math.min(g.first, e.start);
      g.last = Math.max(g.last, e.end);
      g.peak = Math.max(g.peak, e.peak);
    }
    g.active = g.active || it.active;
    groups.set(it.category, g);
  }
  // 公共模式：链中出现频次 ≥ 半数的步骤
  for (const g of groups.values()) {
    const cnt = new Map<string, number>();
    g.chains.forEach((c) => c.steps.forEach((s) => cnt.set(s, (cnt.get(s) ?? 0) + 1)));
    const half = Math.max(1, Math.ceil(g.chains.length / 2));
    const order = ['电参', '制冷', '温升', '环境'];
    g.pattern = Array.from(cnt.entries())
      .filter(([, n]) => n >= half)
      .map(([s]) => s)
      .sort((a, b) => order.indexOf(a.split('·')[0]) - order.indexOf(b.split('·')[0]));
    g.support = g.chains.reduce((s, c) => s + c.occurrences, 0) / Math.max(1, evals.length);
    g.chains.sort((a, b) => b.occurrences - a.occurrences);
  }
  return {
    groups: Array.from(groups.values()).sort((a, b) => Number(b.active) - Number(a.active) || b.last - a.last),
    evaluations: evals.length,
    times,
  };
}

// ---------- 负载响应分析 ----------

export interface ResponseFit {
  K: number; // ℃/kW
  tau: number; // s
  theta: number; // s
  r2: number;
}

function simulate(x: number[], dt: number, tau: number, theta: number) {
  const shift = Math.round(theta / dt);
  const a = Math.exp(-dt / tau);
  const y = new Array<number>(x.length).fill(0);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = i - shift >= 0 ? x[i - shift] : 0;
    s = a * s + (1 - a) * xi;
    y[i] = s;
  }
  return y;
}

/** 一阶惯性加纯滞后（FOPDT）辨识：网格搜索 τ、θ，最小二乘求 K（含偏置，前段作为预热不计误差） */
export function fitFopdt(load: number[], resp: number[], dt: number, burn = Math.min(30, Math.floor(load.length / 4))): ResponseFit & { fitted: number[] } {
  const x0 = load[0];
  const y0 = resp[0];
  const x = load.map((v) => v - x0);
  const y = resp.map((v) => v - y0);
  const n = x.length - burn;
  let best = { K: 0, c: 0, tau: 60, theta: 0, sse: Infinity, m: [] as number[] };
  for (let theta = 0; theta <= 60; theta += 5) {
    for (let tau = 30; tau <= 330; tau += 10) {
      const m = simulate(x, dt, tau, theta);
      let sm = 0;
      let sy = 0;
      let smm = 0;
      let smy = 0;
      for (let i = burn; i < m.length; i++) {
        sm += m[i];
        sy += y[i];
        smm += m[i] * m[i];
        smy += m[i] * y[i];
      }
      const d = n * smm - sm * sm;
      const K = Math.abs(d) > 1e-9 ? (n * smy - sm * sy) / d : 0;
      const c = (sy - K * sm) / n;
      let sse = 0;
      for (let i = burn; i < m.length; i++) sse += (y[i] - K * m[i] - c) ** 2;
      if (sse < best.sse) best = { K, c, tau, theta, sse, m };
    }
  }
  const ys = y.slice(burn);
  const my = mean(ys);
  const sst = ys.reduce((s, v) => s + (v - my) ** 2, 0) || 1;
  return {
    K: best.K,
    tau: best.tau,
    theta: best.theta,
    r2: Math.max(0, 1 - best.sse / sst),
    fitted: best.m.map((v) => v * best.K + best.c + y0),
  };
}

export interface StepEvent {
  rack: string;
  t: number;
  index: number;
  dL: number;
  dir: '升' | '降';
}

/** 阶跃事件检测：10 s 均值序列前后窗口差分 */
export function detectSteps(h: History, rack: string): StepEvent[] {
  const load = blockMean(h.series(`${rack}.load`), 5);
  const t = blockMean(h.timeline(), 5);
  const base = RACK_MAP[rack].baseKw;
  const out: StepEvent[] = [];
  let i = 4;
  while (i < load.length - 4) {
    const pre = (load[i - 1] + load[i - 2] + load[i - 3]) / 3;
    const post = (load[i + 1] + load[i + 2] + load[i + 3]) / 3;
    const d = post - pre;
    if (Math.abs(d) > base * 0.1) {
      // 取局部最大差分
      let j = i;
      let bestD = d;
      for (let k = i + 1; k < Math.min(load.length - 4, i + 6); k++) {
        const dd = (load[k + 1] + load[k + 2] + load[k + 3]) / 3 - (load[k - 1] + load[k - 2] + load[k - 3]) / 3;
        if (Math.abs(dd) > Math.abs(bestD)) {
          bestD = dd;
          j = k;
        }
      }
      out.push({ rack, t: t[j], index: j * 5, dL: bestD, dir: bestD > 0 ? '升' : '降' });
      i = j + 18; // 3 min 间隔
    } else i++;
  }
  return out;
}

export interface RackResponse extends ResponseFit {
  rack: string;
  events: StepEvent[];
  gainRatio: number; // 相对同类中位
}

/** 全时段辨识：机柜出入风温差对负载的响应 */
export function rackResponse(h: History, rack: string): RackResponse & { fitted: number[]; load: number[]; resp: number[]; t: number[] } {
  const load = blockMean(h.series(`${rack}.load`), 5);
  const tout = blockMean(h.series(`${rack}.R-M`), 5);
  const tin = blockMean(h.series(`${rack}.F-M`), 5);
  const resp = tout.map((v, i) => v - tin[i]);
  const fit = fitFopdt(load, resp, 10);
  return { rack, ...fit, events: detectSteps(h, rack), gainRatio: 1, load, resp, t: blockMean(h.timeline(), 5) };
}

export function allResponses(h: History) {
  const res = RACKS.map((r) => {
    const x = rackResponse(h, r.id);
    return { rack: x.rack, K: x.K, tau: x.tau, theta: x.theta, r2: x.r2, events: x.events, gainRatio: 1 };
  });
  for (const kind of ['compute', 'storage', 'network', 'gpu']) {
    const grp = res.filter((x) => RACK_MAP[x.rack].kind === kind);
    const med = quantile(
      grp.map((x) => x.K),
      0.5,
    );
    grp.forEach((x) => (x.gainRatio = med ? x.K / med : 1));
  }
  return res;
}

/** 单次阶跃事件的局部辨识 */
export function eventResponse(h: History, ev: StepEvent) {
  const all = h.series(`${ev.rack}.load`);
  const from = Math.max(0, ev.index - 30);
  const to = Math.min(all.length, ev.index + 180);
  const load = all.slice(from, to);
  const tout = h.series(`${ev.rack}.R-M`).slice(from, to);
  const tin = h.series(`${ev.rack}.F-M`).slice(from, to);
  const resp = tout.map((v, i) => v - tin[i]);
  const t = h.timeline().slice(from, to);
  const fit = fitFopdt(load, resp, 2, 0);
  return { ...fit, load, resp, t };
}

// ---------- 能效路径筛选 ----------

export type EffCategory = '制冷优化' | '气流优化' | '负载调度' | '供电优化';

export interface Constraint {
  label: string;
  ok: boolean;
  detail: string;
}

export interface EffPath {
  id: string;
  name: string;
  category: EffCategory;
  steps: string[];
  savingKw: number;
  annualMWh: number;
  dPue: number;
  pueAfter: number;
  risk: number;
  cost: '低' | '中' | '高';
  effort: string;
  constraints: Constraint[];
  feasible: boolean;
  maxInletAfter: number;
  confidence: number;
  pareto?: boolean;
}

export function efficiencyPaths(s: Snapshot, h: History): EffPath[] {
  const it = s.room.it;
  const tinMax = s.room.tinMax;
  const { racks: air, acus: acuAir } = airMetrics(s, h);
  const coolSaving = (dSup: number, filter?: (id: string) => boolean) =>
    s.acus.filter((a) => !filter || filter(a.id)).reduce((acc, a) => acc + (a.heat / a.cop - a.heat / (a.cop + 0.11 * dSup)), 0);
  const fanKw = (a: { fan: number }) => 0.35 + 1.5 * Math.pow(a.fan / 100, 3);
  const make = (p: Omit<EffPath, 'annualMWh' | 'dPue' | 'pueAfter' | 'feasible'>): EffPath => {
    const feasible = p.constraints.every((c) => c.ok);
    return {
      ...p,
      annualMWh: (p.savingKw * 8760) / 1000,
      dPue: -p.savingKw / it,
      pueAfter: (s.room.total - p.savingKw) / it,
      feasible,
    };
  };
  const inletLimit = 27;
  const out: EffPath[] = [];

  const b03 = air.find((x) => x.rack === 'B03')!;
  const recircDrop = Math.max(0, (b03.rci - 0.08) * (s.rackMap.B03.tout[2] - b03.supplyMix));
  const worstRack = s.racks.reduce((a, b) => (Math.max(...b.tin) > Math.max(...a.tin) ? b : a));
  const tinMaxAfterSeal = Math.max(
    ...s.racks.flatMap((r) => (r.id === 'B03' ? [r.tin[0], r.tin[1], r.tin[2] - recircDrop] : r.tin)),
  );

  for (const d of [1, 2]) {
    const after = tinMax + d;
    out.push(
      make({
        id: `SUP+${d}`,
        name: `全局送风温度上调 ${d}℃`,
        category: '制冷优化',
        steps: [`ACU 设定 ${21}→${21 + d}℃`, '压缩机负荷下降', `COP +${(0.11 * d).toFixed(2)}`, '制冷功耗降低'],
        savingKw: coolSaving(d),
        risk: Math.min(1, Math.max(0.05, (after - 23.5) / 4)),
        cost: '低',
        effort: '远程下发，即时生效',
        constraints: [
          { label: '进风温度 ≤ 27℃', ok: after <= inletLimit, detail: `预测最高 ${after.toFixed(1)}℃（${worstRack.id}）` },
          { label: '露点 ≤ 15℃', ok: s.room.dewAvg < 15, detail: `当前平均露点 ${s.room.dewAvg.toFixed(1)}℃` },
        ],
        maxInletAfter: after,
        confidence: 0.9,
      }),
    );
  }

  // 分区调温：选择进风裕度更大的一列
  const rowMax = (row: string) => Math.max(...s.racks.filter((r) => r.id.startsWith(row)).flatMap((r) => r.tin));
  const bestRow = rowMax('A') < rowMax('B') ? 'A' : 'B';
  out.push(
    make({
      id: `ZONE-${bestRow}`,
      name: `${bestRow} 列分区送风上调 1.5℃`,
      category: '制冷优化',
      steps: [`${bestRow} 列空调分区控制`, `送风 21→22.5℃`, '保持另一列设定', '制冷功耗降低'],
      savingKw: coolSaving(1.5, (id) => id.startsWith(`ACU-${bestRow}`)),
      risk: Math.min(1, Math.max(0.05, (rowMax(bestRow) + 1.5 - 23.5) / 4)),
      cost: '低',
      effort: '远程下发，即时生效',
      constraints: [{ label: '进风温度 ≤ 27℃', ok: rowMax(bestRow) + 1.5 <= inletLimit, detail: `预测最高 ${(rowMax(bestRow) + 1.5).toFixed(1)}℃` }],
      maxInletAfter: Math.max(tinMax, rowMax(bestRow) + 1.5),
      confidence: 0.86,
    }),
  );

  out.push(
    make({
      id: 'SEAL-B03',
      name: 'B03 盲板封堵 + 送风上调 1℃',
      category: '气流优化',
      steps: ['B03 空余 U 位加装盲板', `顶部回流降低 ${recircDrop.toFixed(1)}℃`, '进风裕度释放', '送风上调 1℃'],
      savingKw: coolSaving(1) + 0.15,
      risk: Math.min(1, Math.max(0.04, (tinMaxAfterSeal + 1 - 24) / 4)),
      cost: '低',
      effort: '现场施工约 0.5 h',
      constraints: [{ label: '进风温度 ≤ 27℃', ok: tinMaxAfterSeal + 1 <= inletLimit, detail: `预测最高 ${(tinMaxAfterSeal + 1).toFixed(1)}℃` }],
      maxInletAfter: tinMaxAfterSeal + 1,
      confidence: 0.82,
    }),
  );

  const fanSave = s.acus.reduce((acc, a) => acc + fanKw(a) * (1 - 0.9 ** 3), 0);
  const maxUtil = Math.max(...s.acus.map((a) => a.heat / a.capacity));
  out.push(
    make({
      id: 'FAN-10',
      name: '空调群控风机降速 10%',
      category: '气流优化',
      steps: ['群控策略切换', '风机转速 -10%', '风机功耗按立方律下降', '维持冷通道正压'],
      savingKw: fanSave,
      risk: Math.min(1, 0.15 + Math.max(0, maxUtil - 0.6)),
      cost: '低',
      effort: '远程下发，即时生效',
      constraints: [
        { label: '空调负载率 ≤ 85%', ok: maxUtil <= 0.85, detail: `最大负载率 ${(maxUtil * 100).toFixed(0)}%` },
        { label: '冷通道无热回流', ok: b03.rci < 0.3, detail: `B03 回流指数 ${(b03.rci * 100).toFixed(0)}%` },
      ],
      maxInletAfter: tinMax + 0.3,
      confidence: 0.8,
    }),
  );

  const bp = acuAir.find((x) => x.acu === 'ACU-B2')!;
  const b2 = s.acus.find((a) => a.id === 'ACU-B2')!;
  out.push(
    make({
      id: 'BYPASS-B2',
      name: 'ACU-B2 区域开孔封堵',
      category: '气流优化',
      steps: ['线缆开孔加装封堵毛刷', `旁通率 ${(bp.bypass * 100).toFixed(0)}%→8%`, '回风温度提升', 'COP 提升'],
      savingKw: b2.power * Math.max(0, bp.bypass - 0.08) * 0.45,
      risk: 0.06,
      cost: '低',
      effort: '现场施工约 1 h',
      constraints: [{ label: '施工不影响运行', ok: true, detail: '冷通道外侧作业' }],
      maxInletAfter: tinMax,
      confidence: 0.78,
    }),
  );

  const a2 = s.acus.find((a) => a.id === 'ACU-A2')!;
  if (a2.supply - a2.setpoint > 1) {
    const nominal = a2.heat / (3.55 + 0.11 * (a2.supply - 21)) + fanKw({ fan: a2.fan - 10 });
    out.push(
      make({
        id: 'FIX-A2',
        name: 'ACU-A2 制冷回路检修',
        category: '制冷优化',
        steps: ['派单检修 ACU-A2', '恢复额定 COP', '送风回到设定值', 'A 列东段进风回落'],
        savingKw: Math.max(0.2, a2.power - nominal),
        risk: 0.2,
        cost: '中',
        effort: '现场维修约 2 h',
        constraints: [{ label: '冗余空调可接管', ok: s.acus.filter((a) => a.id !== 'ACU-A2').every((a) => a.heat / a.capacity < 0.9), detail: 'N+1 冗余满足' }],
        maxInletAfter: tinMax - 1,
        confidence: 0.88,
      }),
    );
  }

  // 负载迁移：最高负载率机柜 → 低负载同类机柜
  const hot = s.racks.slice().sort((a, b) => b.ratio - a.ratio)[0];
  const hotDef = RACK_MAP[hot.id];
  const target = s.racks
    .filter((r) => r.id !== hot.id && RACK_MAP[r.id].kind === hotDef.kind)
    .sort((a, b) => a.ratio - b.ratio)[0];
  if (target) {
    const move = Math.max(0.8, (hot.ratio - 0.7) * hotDef.ratedKw);
    const tRatio = (target.load + move) / RACK_MAP[target.id].ratedKw;
    out.push(
      make({
        id: `MOVE-${hot.id}`,
        name: `${hot.id} → ${target.id} 负载迁移 ${move.toFixed(1)} kW`,
        category: '负载调度',
        steps: [`${hot.id} 迁出业务 ${move.toFixed(1)} kW`, `${target.id} 承接`, '热点消减', '局部送风需求下降'],
        savingKw: move * 0.06 + 0.2,
        risk: 0.45,
        cost: '中',
        effort: '业务窗口内迁移',
        constraints: [
          { label: '目标负载率 ≤ 80%', ok: tRatio <= 0.8, detail: `${target.id} 迁移后 ${(tRatio * 100).toFixed(0)}%` },
          { label: '同类资源池', ok: true, detail: `均为${hotDef.kind === 'gpu' ? '高密算力' : '同类'}机柜` },
        ],
        maxInletAfter: tinMax - 0.3,
        confidence: 0.72,
      }),
    );
  }

  const upsSave = s.ups.reduce((acc, u) => acc + (u.loss - u.outKw * (1 / 0.985 - 1)), 0);
  out.push(
    make({
      id: 'UPS-ECO',
      name: 'UPS 智能在线（高效）模式',
      category: '供电优化',
      steps: ['市电质量评估', '切换智能在线模式', `效率 ${(s.ups[0].eff * 100).toFixed(1)}%→98.5%`, '供电损耗降低'],
      savingKw: upsSave,
      risk: 0.55,
      cost: '低',
      effort: '变更窗口内切换',
      constraints: [
        { label: '市电 THDu ≤ 3%', ok: s.pdcs.every((p) => p.thdu < 3), detail: `当前 ${s.pdcs[0].thdu.toFixed(1)}%` },
        { label: '2N 冗余在线', ok: true, detail: 'UPS-1 / UPS-2 均正常' },
      ],
      maxInletAfter: tinMax,
      confidence: 0.84,
    }),
  );

  out.push(
    make({
      id: 'COMBO',
      name: '气流封堵 + 送风上调 2℃ + 风机降速',
      category: '气流优化',
      steps: ['B03 盲板 / B2 开孔封堵', '送风 21→23℃', '风机 -10%', '综合能效提升'],
      savingKw: coolSaving(2) + fanSave * 0.8 + b2.power * Math.max(0, bp.bypass - 0.08) * 0.45,
      risk: Math.min(1, Math.max(0.1, (tinMaxAfterSeal + 2.3 - 23.5) / 4)),
      cost: '中',
      effort: '施工 + 远程下发',
      constraints: [
        { label: '进风温度 ≤ 27℃', ok: tinMaxAfterSeal + 2.3 <= inletLimit, detail: `预测最高 ${(tinMaxAfterSeal + 2.3).toFixed(1)}℃` },
        { label: '空调负载率 ≤ 85%', ok: maxUtil <= 0.85, detail: `最大负载率 ${(maxUtil * 100).toFixed(0)}%` },
      ],
      maxInletAfter: tinMaxAfterSeal + 2.3,
      confidence: 0.74,
    }),
  );

  // Pareto 前沿：节能更多且风险更低者不被支配
  for (const p of out) {
    p.pareto = !out.some((q) => q !== p && q.savingKw >= p.savingKw && q.risk <= p.risk && (q.savingKw > p.savingKw || q.risk < p.risk));
  }
  return out.sort((a, b) => b.savingKw - a.savingKw);
}
