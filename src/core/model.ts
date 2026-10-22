// 机房动力与环境过程模型：负载 → 电参 → 热量 → 气流 → 温湿度 → 制冷能耗
import {
  ACUS,
  COOLING_WEIGHTS,
  PDCS,
  PHASES,
  RACKS,
  RACK_MAP,
  UPSES,
  type AcuDef,
  type Phase,
  type RackDef,
} from './topology';
import { clamp, fbm, hash, jitter, trapezoid, vnoise } from './noise';

export interface ChannelSample {
  id: string;
  rack: string;
  path: 'A' | 'B';
  phase: Phase;
  v: number;
  i: number;
  p: number;
  q: number;
  s: number;
  pf: number;
  f: number;
  thdu: number;
  thdi: number;
  e: number;
  breakerA: number;
  online: boolean;
}

export interface RackSample {
  id: string;
  load: number;
  loadS: number;
  ratio: number;
  tin: [number, number, number]; // 下 中 上
  tout: [number, number, number];
  rhF: number;
  rhR: number;
  dew: number;
  pa: ChannelSample;
  pb: ChannelSample;
}

export interface AcuSample {
  id: string;
  setpoint: number;
  supply: number;
  ret: number;
  supplyRh: number;
  returnRh: number;
  fan: number;
  heat: number;
  power: number;
  cop: number;
  capacity: number;
  compressor: number;
}

export interface PdcPhase {
  phase: Phase;
  v: number;
  i: number;
  p: number;
  pf: number;
}

export interface PdcSample {
  id: string;
  path: 'A' | 'B';
  phases: PdcPhase[];
  kw: number;
  f: number;
  thdu: number;
  unbalance: number;
}

export interface UpsSample {
  id: string;
  inV: number[];
  outV: number[];
  outKw: number;
  loadPct: number;
  eff: number;
  loss: number;
  soc: number;
  battT: number;
  backupMin: number;
  mode: string;
}

export interface RoomSample {
  it: number;
  cooling: number;
  upsLoss: number;
  distLoss: number;
  other: number;
  total: number;
  pue: number;
  tinAvg: number;
  tinMax: number;
  toutAvg: number;
  toutMax: number;
  rhAvg: number;
  dewAvg: number;
  frontDoor: boolean;
  rearDoor: boolean;
  leak: boolean;
  smoke: boolean;
}

export interface Snapshot {
  t: number; // ms
  racks: RackSample[];
  rackMap: Record<string, RackSample>;
  acus: AcuSample[];
  pdcs: PdcSample[];
  ups: UpsSample[];
  room: RoomSample;
}

const EPOCH = 1767225600; // 2026-01-01T00:00:00Z

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

// ---------- 工况进程 ----------

/** A05/A06 训练集群周期性满载，0..1 */
export function gpuSurge(ts: number) {
  return trapezoid(mod(ts, 2400), 120, 1380, 360, 300);
}

/** ACU-A2 制冷能力衰减，0..1 */
export function acuA2Degrade(ts: number) {
  return trapezoid(mod(ts, 2700), 1500, 2350, 200, 150);
}

/** B 列加湿过量，0..1 */
export function humidExcess(ts: number) {
  return trapezoid(mod(ts, 3000), 600, 1700, 300, 400);
}

/** A03 中部服务器散热异常，0..1 */
export function a03FanFault(ts: number) {
  return trapezoid(mod(ts, 1800), 900, 1500, 60, 120);
}

/** B03 顶部热回流强度 */
export function b03Recirc(ts: number) {
  return 0.33 + 0.1 * fbm(311, ts / 520);
}

export function pduOffline(rackId: string, path: 'A' | 'B', ts: number) {
  return rackId === 'B09' && path === 'B' && mod(ts, 1500) >= 700 && mod(ts, 1500) < 780;
}

function frontDoorOpen(ts: number) {
  const p = mod(ts, 3600);
  return p >= 300 && p < 420;
}

// ---------- 负载 ----------

function batchJob(r: RackDef, ts: number) {
  if (!r.jobAmp) return 0;
  const P = r.jobPeriod;
  const k = Math.floor(ts / P);
  let v = 0;
  for (const kk of [k - 1, k]) {
    if (hash(r.seed + 101, kk) > 0.72) continue;
    const start = kk * P + hash(r.seed + 102, kk) * P * 0.45;
    const dur = 150 + hash(r.seed + 103, kk) * 230;
    const amp = r.jobAmp * (0.6 + 0.4 * hash(r.seed + 104, kk));
    v += amp * trapezoid(ts, start, start + dur, 10, 14);
  }
  return v;
}

function episodeLoad(r: RackDef, ts: number) {
  if (r.id === 'A06') return 0.3 * gpuSurge(ts);
  if (r.id === 'A05') return 0.1 * gpuSurge(ts);
  return 0;
}

export function rackLoadRaw(r: RackDef, ts: number) {
  const day = mod(ts + 8 * 3600, 86400) / 86400;
  const diurnal = r.diurnalAmp * Math.sin(2 * Math.PI * (day - 0.375));
  const slow = 0.055 * fbm(r.seed, ts / 300);
  const mid = 0.028 * vnoise(r.seed + 7, ts / 40);
  return r.baseKw * (1 + diurnal + slow + mid + batchJob(r, ts) + episodeLoad(r, ts));
}

const GRID = 10;
const TAPS = 40;
const loadCache = new Map<string, Map<number, number>>();
const smoothCache = new Map<string, Map<number, number>>();
const tapWeights = new Map<string, Float64Array>();

function cacheOf(store: Map<string, Map<number, number>>, id: string) {
  let m = store.get(id);
  if (!m) {
    m = new Map();
    store.set(id, m);
  }
  if (m.size > 60000) m.clear();
  return m;
}

function loadAtGrid(r: RackDef, tk: number) {
  const m = cacheOf(loadCache, r.id);
  let v = m.get(tk);
  if (v === undefined) {
    v = rackLoadRaw(r, tk);
    m.set(tk, v);
  }
  return v;
}

function weightsOf(r: RackDef) {
  let w = tapWeights.get(r.id);
  if (!w) {
    w = new Float64Array(TAPS);
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      w[k] = Math.exp((-k * GRID) / r.tau);
      sum += w[k];
    }
    for (let k = 0; k < TAPS; k++) w[k] /= sum;
    tapWeights.set(r.id, w);
  }
  return w;
}

function smoothAtGrid(r: RackDef, base: number) {
  const m = cacheOf(smoothCache, r.id);
  let v = m.get(base);
  if (v === undefined) {
    const w = weightsOf(r);
    v = 0;
    for (let k = 0; k < TAPS; k++) v += w[k] * loadAtGrid(r, base - k * GRID);
    m.set(base, v);
  }
  return v;
}

/** 一阶惯性 + 纯滞后：机柜热负荷对电负荷的响应 */
export function rackLoadSmooth(r: RackDef, ts: number) {
  const t0 = ts - r.deadTime;
  const base = Math.floor(t0 / GRID) * GRID;
  const f = (t0 - base) / GRID;
  return smoothAtGrid(r, base) * (1 - f) + smoothAtGrid(r, base + GRID) * f;
}

export function rackLoad(r: RackDef, ts: number) {
  return rackLoadRaw(r, ts) * (1 + 0.008 * jitter(r.seed + 3, ts));
}

// ---------- 湿度 ----------

export function satVapor(t: number) {
  return 6.112 * Math.exp((17.62 * t) / (243.12 + t));
}

export function relHumidity(t: number, dew: number) {
  return clamp((100 * satVapor(dew)) / satVapor(t), 1, 100);
}

export function dewPoint(t: number, rh: number) {
  const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
  return (243.12 * g) / (17.62 - g);
}

function roomDew(ts: number) {
  return 10.3 + 1.1 * fbm(77, ts / 2400) + 0.12 * vnoise(78, ts / 30);
}

function rackDew(r: RackDef, ts: number, base: number) {
  const w = r.row === 'B' ? (r.index <= 5 ? 1 : 0.6) : 0.12;
  return base + 3.7 * humidExcess(ts) * w;
}

// ---------- 制冷 ----------

export function acuSupply(a: AcuDef, ts: number) {
  let v = a.setpoint + 0.22 * vnoise(a.seed, ts / 50) + 0.06 * jitter(a.seed + 1, ts);
  if (a.id === 'ACU-A2') v += 3.0 * acuA2Degrade(ts);
  return v;
}

// ---------- 电参 ----------

function phaseVoltage(pdcIdx: number, ph: number, ts: number) {
  return 220.6 + 0.9 * vnoise(900 + pdcIdx * 10 + ph, ts / 90) + 0.12 * jitter(950 + pdcIdx * 10 + ph, ts);
}

function channelSample(r: RackDef, path: 'A' | 'B', load: number, phaseV: number, ts: number): ChannelSample {
  const share = path === 'A' ? r.splitA : 1 - r.splitA;
  const sd = r.seed + (path === 'A' ? 11 : 17);
  const p = load * share * (1 + 0.004 * jitter(sd, ts));
  const ratio = load / r.ratedKw;
  const pf = clamp(0.989 - 0.055 * Math.pow(1 - ratio, 2) + 0.0025 * jitter(sd + 1, ts), 0.9, 0.999);
  const v = phaseV - 0.11 * p + 0.15 * jitter(sd + 2, ts);
  const s = p / pf;
  const q = Math.sqrt(Math.max(0, s * s - p * p));
  const i = (s * 1000) / v;
  const thdi = 3.1 + 9.5 * Math.pow(clamp(1 - ratio, 0, 1), 1.6) + (r.kind === 'gpu' ? 1.9 : 0) + 0.25 * jitter(sd + 3, ts);
  const thdu = 1.3 + 0.45 * ratio + 0.12 * vnoise(sd + 4, ts / 60);
  const hours = (ts - EPOCH) / 3600;
  const e = r.energy0 * share + r.baseKw * share * hours;
  return {
    id: `${r.id}-PDU-${path}`,
    rack: r.id,
    path,
    phase: r.phase,
    v,
    i,
    p,
    q,
    s,
    pf,
    f: 50 + 0.018 * vnoise(9, ts / 20),
    thdu,
    thdi,
    e,
    breakerA: r.breakerA,
    online: !pduOffline(r.id, path, ts),
  };
}

// ---------- 整体采样 ----------

const HEIGHT_OFFSET = [0, 0.32, 0.72];
const RECIRC_LAG = 40;
// 回风混合损失（含冷旁通），ACU-B2 区域线缆开孔未封堵
const RETURN_MIX_LOSS: Record<string, number> = { 'ACU-A1': 1.1, 'ACU-A2': 1.3, 'ACU-B1': 1.2, 'ACU-B2': 2.5 };
const SIDES: Record<string, [RackDef | undefined, RackDef | undefined]> = Object.fromEntries(
  RACKS.map((r) => [
    r.id,
    [RACK_MAP[`${r.row}${String(r.index - 1).padStart(2, '0')}`], RACK_MAP[`${r.row}${String(r.index + 1).padStart(2, '0')}`]],
  ]),
);
const BASE_RECIRC = [0.02, 0.05, 0.1];
const OUT_SHAPE = [0.92, 1.0, 1.08];

export function computeSnapshot(tMs: number): Snapshot {
  const ts = tMs / 1000;
  const surge = gpuSurge(ts);
  const b03 = b03Recirc(ts);
  const fan = a03FanFault(ts);

  const supply: Record<string, number> = {};
  for (const a of ACUS) supply[a.id] = acuSupply(a, ts);

  const loads: Record<string, number> = {};
  const loadS: Record<string, number> = {};
  const dT: Record<string, number> = {};
  const dTlag: Record<string, number> = {}; // 热风越流/回流的输运滞后
  for (const r of RACKS) {
    loads[r.id] = rackLoad(r, ts);
    loadS[r.id] = rackLoadSmooth(r, ts);
    dT[r.id] = r.kThermal * loadS[r.id];
    dTlag[r.id] = r.kThermal * rackLoadSmooth(r, ts - RECIRC_LAG);
  }

  const pv = PDCS.map((_, pi) => PHASES.map((__, ph) => phaseVoltage(pi, ph, ts)));
  const baseDew = roomDew(ts);

  const racks: RackSample[] = RACKS.map((r) => {
    const mix = ACUS.reduce((s, a) => s + COOLING_WEIGHTS[r.id][a.id] * supply[a.id], 0);
    const [left, right] = SIDES[r.id];
    const own = dTlag[r.id];
    const local = 0.5 * own + 0.25 * (left ? dTlag[left.id] : own * 0.6) + 0.25 * (right ? dTlag[right.id] : own * 0.6);
    const recirc = BASE_RECIRC.slice();
    if (r.id === 'B03') {
      recirc[2] += b03;
      recirc[1] += b03 * 0.25;
    }
    if (r.id === 'B04' || r.id === 'B02') recirc[2] += b03 * 0.22;
    if (r.id === 'A06') {
      recirc[2] += 0.12 * surge;
      recirc[1] += 0.04 * surge;
    }
    if (r.id === 'A05' || r.id === 'A07') recirc[2] += 0.07 * surge;

    const tin = [0, 1, 2].map(
      (h) => mix + HEIGHT_OFFSET[h] + recirc[h] * local + 0.1 * jitter(r.seed + 20 + h, ts),
    ) as [number, number, number];
    const tout = [0, 1, 2].map(
      (h) => tin[h] + dT[r.id] * OUT_SHAPE[h] + 0.14 * jitter(r.seed + 30 + h, ts),
    ) as [number, number, number];
    if (r.id === 'A03') {
      tout[1] += 4.6 * fan;
      tout[2] += 1.2 * fan;
    }
    const dew = rackDew(r, ts, baseDew);
    const pi = 0;
    const pa = channelSample(r, 'A', loads[r.id], pv[pi][PHASES.indexOf(r.phase)], ts);
    const pb = channelSample(r, 'B', loads[r.id], pv[1][PHASES.indexOf(r.phase)], ts);
    return {
      id: r.id,
      load: loads[r.id],
      loadS: loadS[r.id],
      ratio: loads[r.id] / r.ratedKw,
      tin,
      tout,
      rhF: relHumidity(tin[1], dew) + 0.45 * jitter(r.seed + 40, ts),
      rhR: relHumidity(tout[1], dew) + 0.45 * jitter(r.seed + 41, ts),
      dew,
      pa,
      pb,
    };
  });
  const rackMap = Object.fromEntries(racks.map((x) => [x.id, x]));

  const acus: AcuSample[] = ACUS.map((a) => {
    let heat = 0;
    let wsum = 0;
    let tret = 0;
    let dsum = 0;
    for (const r of RACKS) {
      const w = COOLING_WEIGHTS[r.id][a.id];
      heat += w * rackMap[r.id].load;
      const tr = rackMap[r.id].tout;
      tret += w * (tr[0] + tr[1] + tr[2]) / 3;
      dsum += w * rackMap[r.id].dew;
      wsum += w;
    }
    tret = tret / wsum - RETURN_MIX_LOSS[a.id] + 0.08 * jitter(a.seed + 5, ts);
    const dew = dsum / wsum;
    const deg = a.id === 'ACU-A2' ? acuA2Degrade(ts) : 0;
    const fanPct = clamp(36 + (52 * heat) / a.capacityKw + 14 * deg + 0.6 * jitter(a.seed + 6, ts), 20, 100);
    const cop = (3.55 + 0.11 * (supply[a.id] - 21)) * (1 - 0.2 * deg) + 0.03 * vnoise(a.seed + 7, ts / 80);
    const fanKw = 0.35 + 1.5 * Math.pow(fanPct / 100, 3);
    return {
      id: a.id,
      setpoint: a.setpoint,
      supply: supply[a.id],
      ret: tret,
      supplyRh: relHumidity(supply[a.id], dew),
      returnRh: relHumidity(tret, dew),
      fan: fanPct,
      heat,
      power: heat / cop + fanKw,
      cop,
      capacity: a.capacityKw,
      compressor: clamp((heat / a.capacityKw) * 100 * (1 + 0.25 * deg), 0, 100),
    };
  });

  const pdcs: PdcSample[] = PDCS.map((p, pi) => {
    const phases: PdcPhase[] = PHASES.map((ph, phi) => {
      let i = 0;
      let kw = 0;
      let s = 0;
      for (const r of RACKS) {
        if (r.phase !== ph) continue;
        const c = p.path === 'A' ? rackMap[r.id].pa : rackMap[r.id].pb;
        i += c.i;
        kw += c.p;
        s += c.s;
      }
      return { phase: ph, v: pv[pi][phi] - 0.004 * i, i, p: kw, pf: s ? kw / s : 1 };
    });
    const iavg = phases.reduce((s, x) => s + x.i, 0) / 3;
    const imax = Math.max(...phases.map((x) => x.i));
    return {
      id: p.id,
      path: p.path,
      phases,
      kw: phases.reduce((s, x) => s + x.p, 0),
      f: 50 + 0.018 * vnoise(9, ts / 20),
      thdu: 1.6 + 0.15 * vnoise(980 + pi, ts / 70),
      unbalance: ((imax - iavg) / iavg) * 100,
    };
  });

  const ups: UpsSample[] = UPSES.map((u, ui) => {
    const out = pdcs[ui].kw;
    const loadPct = (out / (u.ratedKva * 0.9)) * 100;
    const eff = 0.962 - 0.08 * Math.pow(0.55 - loadPct / 100, 2) + 0.001 * vnoise(700 + ui, ts / 120);
    return {
      id: u.id,
      inV: [0, 1, 2].map((k) => 221.5 + 2.2 * vnoise(710 + ui * 3 + k, ts / 200)),
      outV: pdcs[ui].phases.map((x) => x.v + 0.3),
      outKw: out,
      loadPct,
      eff,
      loss: out * (1 / eff - 1),
      soc: 100,
      battT: 24.6 + 0.4 * vnoise(720 + ui, ts / 900),
      backupMin: 30 * Math.pow(50 / loadPct, 1.1),
      mode: '双变换在线',
    };
  });

  const it = racks.reduce((s, r) => s + r.load, 0);
  const cooling = acus.reduce((s, a) => s + a.power, 0);
  const upsLoss = ups.reduce((s, u) => s + u.loss, 0);
  const distLoss = it * 0.006;
  const other = 1.6 + 0.05 * vnoise(990, ts / 600);
  const total = it + cooling + upsLoss + distLoss + other;
  const allIn = racks.flatMap((r) => r.tin);
  const allOut = racks.flatMap((r) => r.tout);
  const room: RoomSample = {
    it,
    cooling,
    upsLoss,
    distLoss,
    other,
    total,
    pue: total / it,
    tinAvg: allIn.reduce((s, v) => s + v, 0) / allIn.length,
    tinMax: Math.max(...allIn),
    toutAvg: allOut.reduce((s, v) => s + v, 0) / allOut.length,
    toutMax: Math.max(...allOut),
    rhAvg: racks.reduce((s, r) => s + r.rhF, 0) / racks.length,
    dewAvg: racks.reduce((s, r) => s + r.dew, 0) / racks.length,
    frontDoor: frontDoorOpen(ts),
    rearDoor: false,
    leak: false,
    smoke: false,
  };

  return { t: tMs, racks, rackMap, acus, pdcs, ups, room };
}

// ---------- 时序测点表 ----------

type Getter = (s: Snapshot) => number;
const SERIES: Array<[string, Getter]> = [];
RACKS.forEach((r, i) => {
  const R = (s: Snapshot) => s.racks[i];
  SERIES.push(
    [`${r.id}.load`, (s) => R(s).load],
    [`${r.id}.loadS`, (s) => R(s).loadS],
    [`${r.id}.F-B`, (s) => R(s).tin[0]],
    [`${r.id}.F-M`, (s) => R(s).tin[1]],
    [`${r.id}.F-T`, (s) => R(s).tin[2]],
    [`${r.id}.R-B`, (s) => R(s).tout[0]],
    [`${r.id}.R-M`, (s) => R(s).tout[1]],
    [`${r.id}.R-T`, (s) => R(s).tout[2]],
    [`${r.id}.rhF`, (s) => R(s).rhF],
    [`${r.id}.rhR`, (s) => R(s).rhR],
    [`${r.id}.dew`, (s) => R(s).dew],
    [`${r.id}.ia`, (s) => R(s).pa.i],
    [`${r.id}.ib`, (s) => R(s).pb.i],
    [`${r.id}.va`, (s) => R(s).pa.v],
    [`${r.id}.vb`, (s) => R(s).pb.v],
    [`${r.id}.pa`, (s) => R(s).pa.p],
    [`${r.id}.pb`, (s) => R(s).pb.p],
    [`${r.id}.pf`, (s) => (R(s).pa.pf + R(s).pb.pf) / 2],
    [`${r.id}.thdi`, (s) => (R(s).pa.thdi + R(s).pb.thdi) / 2],
  );
});
ACUS.forEach((a, i) => {
  const A = (s: Snapshot) => s.acus[i];
  SERIES.push(
    [`${a.id}.sup`, (s) => A(s).supply],
    [`${a.id}.ret`, (s) => A(s).ret],
    [`${a.id}.fan`, (s) => A(s).fan],
    [`${a.id}.heat`, (s) => A(s).heat],
    [`${a.id}.pwr`, (s) => A(s).power],
    [`${a.id}.cop`, (s) => A(s).cop],
    [`${a.id}.rh`, (s) => A(s).returnRh],
  );
});
PDCS.forEach((p, i) => {
  PHASES.forEach((ph, k) => {
    SERIES.push([`${p.id}.${ph}.v`, (s) => s.pdcs[i].phases[k].v], [`${p.id}.${ph}.i`, (s) => s.pdcs[i].phases[k].i]);
  });
  SERIES.push([`${p.id}.kw`, (s) => s.pdcs[i].kw]);
});
UPSES.forEach((u, i) => {
  SERIES.push([`${u.id}.load`, (s) => s.ups[i].loadPct], [`${u.id}.eff`, (s) => s.ups[i].eff * 100]);
});
SERIES.push(
  ['room.it', (s) => s.room.it],
  ['room.cool', (s) => s.room.cooling],
  ['room.total', (s) => s.room.total],
  ['room.pue', (s) => s.room.pue],
  ['room.tin', (s) => s.room.tinAvg],
  ['room.tinMax', (s) => s.room.tinMax],
  ['room.tout', (s) => s.room.toutAvg],
  ['room.rh', (s) => s.room.rhAvg],
  ['room.dew', (s) => s.room.dewAvg],
);

export const SERIES_KEYS = SERIES.map(([k]) => k);

/** 将采样按测点表顺序写入行缓冲 */
export function writeRow(s: Snapshot, row: Float64Array) {
  for (let i = 0; i < SERIES.length; i++) row[i] = SERIES[i][1](s);
  return row;
}

export function nodeKey(nodeId: string) {
  // A06-R-T -> A06.R-T
  return `${nodeId.slice(0, 3)}.${nodeId.slice(4)}`;
}
