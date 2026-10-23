// 环境联测 · 路径识别：送回风主路径、热回流、冷旁通、供冷不足
import { blockMean, pearson } from './analytics';
import type { History } from './history';
import type { Snapshot } from './model';
import { ACUS, COOLING_WEIGHTS, RACKS } from './topology';

export type PathType = '主送风路径' | '热回流路径' | '冷旁通路径' | '供冷不足路径';

export interface AirPath {
  id: string;
  type: PathType;
  chain: string[];
  racks: string[];
  acu?: string;
  intensity: number; // 0..1
  metric: string;
  confidence: number;
  desc: string;
}

export interface RackAirMetric {
  rack: string;
  supplyMix: number;
  rci: number; // 回流指数
  strat: number; // 进风上下温差
  corr: number; // 进风上部与出风的相关性
  supplyDev: number; // 进风相对基线偏移
}

export interface AcuAirMetric {
  acu: string;
  bypass: number;
  supplyDev: number;
  exhaust: number;
  heat: number;
}

function zoneSegment(slot: number) {
  return slot <= 4 ? '西段' : slot <= 8 ? '中段' : '东段';
}

export function airMetrics(s: Snapshot, h: History) {
  const n = Math.min(h.size, 900);
  const racks: RackAirMetric[] = RACKS.map((r) => {
    const rs = s.rackMap[r.id];
    const mix = ACUS.reduce((acc, a) => acc + COOLING_WEIGHTS[r.id][a.id] * s.acus.find((x) => x.id === a.id)!.supply, 0);
    const rci = Math.max(0, (rs.tin[2] - mix - 0.72) / Math.max(1, rs.tout[2] - mix));
    const strat = rs.tin[2] - rs.tin[0];
    const corr = pearson(blockMean(h.series(`${r.id}.F-T`, n), 15), blockMean(h.series(`${r.id}.R-T`, n), 15));
    const base = h.series(`${r.id}.F-M`).slice(0, Math.max(30, h.size - 300));
    const baseMean = base.reduce((a, b) => a + b, 0) / base.length;
    return { rack: r.id, supplyMix: mix, rci, strat, corr, supplyDev: rs.tin[1] - baseMean };
  });
  const acus: AcuAirMetric[] = s.acus.map((a) => {
    let exh = 0;
    let w = 0;
    for (const r of RACKS) {
      const wt = COOLING_WEIGHTS[r.id][a.id];
      const t = s.rackMap[r.id].tout;
      exh += (wt * (t[0] + t[1] + t[2])) / 3;
      w += wt;
    }
    exh /= w;
    return {
      acu: a.id,
      bypass: Math.max(0, (exh - a.ret) / Math.max(1, exh - a.supply)),
      supplyDev: a.supply - a.setpoint,
      exhaust: exh,
      heat: a.heat,
    };
  });
  return { racks, acus };
}

export function identifyPaths(s: Snapshot, h: History): AirPath[] {
  const { racks, acus } = airMetrics(s, h);
  const out: AirPath[] = [];

  // 主送风路径（每台空调）
  for (const a of ACUS) {
    const am = acus.find((x) => x.acu === a.id)!;
    const served = RACKS.filter((r) => COOLING_WEIGHTS[r.id][a.id] >= 0.22).map((r) => r.id);
    out.push({
      id: `P-${a.id}`,
      type: '主送风路径',
      chain: [`${a.id} 送风`, `冷通道${zoneSegment(a.slot)}`, served.join('/'), `热通道 ${a.row}`, `${a.id} 回风`],
      racks: served,
      acu: a.id,
      intensity: Math.min(1, am.heat / a.capacityKw),
      metric: `承担热负荷 ${am.heat.toFixed(1)} kW`,
      confidence: 0.98,
      desc: `送风 ${s.acus.find((x) => x.id === a.id)!.supply.toFixed(1)}℃，回风 ${s.acus.find((x) => x.id === a.id)!.ret.toFixed(1)}℃`,
    });
  }

  // 热回流
  for (const m of racks) {
    if (m.rci < 0.12 || m.strat < 1.4) continue;
    const r = RACKS.find((x) => x.id === m.rack)!;
    const conf = Math.min(0.99, 0.45 + m.rci * 1.2 + Math.max(0, m.corr) * 0.25);
    out.push({
      id: `R-${m.rack}`,
      type: '热回流路径',
      chain: [`${m.rack} 出风`, `热通道 ${r.row}`, `柜顶越流`, `${m.rack} 进风·上`],
      racks: [m.rack],
      intensity: Math.min(1, m.rci / 0.4),
      metric: `回流指数 ${(m.rci * 100).toFixed(0)}%，上下温差 ${m.strat.toFixed(1)}℃`,
      confidence: conf,
      desc: m.rci > 0.25 ? '顶部回流显著，建议检查盲板及柜顶封堵' : '存在轻度顶部回流',
    });
  }

  // 冷旁通
  for (const am of acus) {
    if (am.bypass < 0.15) continue;
    const a = ACUS.find((x) => x.id === am.acu)!;
    out.push({
      id: `B-${am.acu}`,
      type: '冷旁通路径',
      chain: [`${am.acu} 送风`, `冷通道${zoneSegment(a.slot)}`, '地板/线缆开孔', `热通道 ${a.row}`, `${am.acu} 回风`],
      racks: [],
      acu: am.acu,
      intensity: Math.min(1, am.bypass / 0.35),
      metric: `旁通率 ${(am.bypass * 100).toFixed(0)}%`,
      confidence: Math.min(0.97, 0.5 + am.bypass * 1.5),
      desc: '回风温度低于柜后排风，存在冷量短路',
    });
  }

  // 供冷不足
  for (const am of acus) {
    if (am.supplyDev < 1.2) continue;
    const affected = racks
      .filter((m) => COOLING_WEIGHTS[m.rack][am.acu] >= 0.2 && m.supplyDev > 0.5)
      .map((m) => m.rack);
    out.push({
      id: `S-${am.acu}`,
      type: '供冷不足路径',
      chain: [`${am.acu} 送风偏高`, '冷通道局部升温', ...(affected.length ? [affected.join('/')] : []), '进风温度抬升'],
      racks: affected,
      acu: am.acu,
      intensity: Math.min(1, am.supplyDev / 3.5),
      metric: `送风偏离 +${am.supplyDev.toFixed(1)}℃`,
      confidence: Math.min(0.98, 0.55 + am.supplyDev * 0.12),
      desc: `${affected.length} 台机柜进风同步抬升`,
    });
  }

  const order: Record<PathType, number> = { 供冷不足路径: 0, 热回流路径: 1, 冷旁通路径: 2, 主送风路径: 3 };
  return out.sort((a, b) => order[a.type] - order[b.type] || b.intensity - a.intensity);
}
