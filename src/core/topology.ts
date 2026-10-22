// 机房静态拓扑：微模块双列布局，封闭冷通道，列间空调，2N 供电（列头柜 PDC-1 / PDC-2）

export type RackKind = 'compute' | 'storage' | 'network' | 'gpu';
export type RowId = 'A' | 'B';
export type Phase = 'L1' | 'L2' | 'L3';
export type DeviceKind = 'server' | 'gpu' | 'storage' | 'switch' | 'patch' | 'kvm' | 'firewall' | 'blank';

export interface DeviceDef {
  u: number; // 起始 U 位（自下而上）
  height: number;
  name: string;
  model: string;
  kind: DeviceKind;
  ratedW: number;
}

export interface RackDef {
  id: string;
  row: RowId;
  index: number; // 列内编号 1..10
  slot: number; // 列内物理位置 0..12
  kind: RackKind;
  ratedKw: number;
  baseKw: number;
  phase: Phase;
  breakerA: number; // PDU 额定电流
  seed: number;
  kThermal: number; // 进出风温差系数 °C/kW
  tau: number; // 热惯性时间常数 s
  deadTime: number; // 传输滞后 s
  diurnalAmp: number;
  jobPeriod: number;
  jobAmp: number;
  splitA: number; // A 路分担比例
  devices: DeviceDef[];
  energy0: number;
}

export interface AcuDef {
  id: string;
  row: RowId;
  slot: number;
  capacityKw: number;
  setpoint: number;
  seed: number;
}

export interface UpsDef {
  id: string;
  ratedKva: number;
  feeds: string; // 所带列头柜
}

export interface PdcDef {
  id: string;
  row: RowId;
  slot: number;
  path: 'A' | 'B';
  ups: string;
}

export const ROW_SLOTS = 13;

export const KIND_LABEL: Record<RackKind, string> = {
  compute: '通用计算',
  storage: '存储',
  network: '网络',
  gpu: '高密算力',
};

export const PHASES: Phase[] = ['L1', 'L2', 'L3'];

const RACK_PLAN: Array<[string, RackKind, number]> = [
  ['A01', 'network', 3.2],
  ['A02', 'compute', 5.5],
  ['A03', 'compute', 6.0],
  ['A04', 'storage', 4.2],
  ['A05', 'gpu', 9.8],
  ['A06', 'gpu', 10.2],
  ['A07', 'compute', 6.4],
  ['A08', 'compute', 5.8],
  ['A09', 'storage', 4.0],
  ['A10', 'network', 2.8],
  ['B01', 'network', 3.0],
  ['B02', 'compute', 5.2],
  ['B03', 'compute', 6.2],
  ['B04', 'storage', 4.5],
  ['B05', 'compute', 6.0],
  ['B06', 'compute', 5.6],
  ['B07', 'gpu', 9.8],
  ['B08', 'compute', 5.0],
  ['B09', 'storage', 3.8],
  ['B10', 'compute', 4.6],
];

// 列内物理排布：0 列头柜，4 / 9 列间空调
const SLOT_OF_INDEX = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12];

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

function buildDevices(id: string, kind: RackKind, seed: number): DeviceDef[] {
  const list: DeviceDef[] = [];
  const add = (u: number, height: number, name: string, model: string, k: DeviceKind, ratedW: number) =>
    list.push({ u, height, name, model, kind: k, ratedW });
  add(42, 1, '配线架', 'PP-48C6', 'patch', 0);
  if (kind === 'network') {
    add(40, 1, `${id} 管理交换机`, 'MS-5848', 'switch', 180);
    add(26, 13, `${id} 核心交换机`, 'CX-12808', 'switch', 2600);
    add(22, 2, `${id} 防火墙-1`, 'FW-6620', 'firewall', 450);
    add(19, 2, `${id} 防火墙-2`, 'FW-6620', 'firewall', 450);
    add(16, 1, `${id} 汇聚交换机-1`, 'AS-6857', 'switch', 320);
    add(15, 1, `${id} 汇聚交换机-2`, 'AS-6857', 'switch', 320);
    add(12, 1, 'KVM 切换器', 'KVM-1716', 'kvm', 30);
    add(4, 1, '光纤配线箱', 'ODF-96', 'patch', 0);
    return list;
  }
  add(41, 1, `TOR-${id}-1`, 'AS-6857-48Y', 'switch', 320);
  add(40, 1, `TOR-${id}-2`, 'AS-6857-48Y', 'switch', 320);
  if (kind === 'gpu') {
    let n = 1;
    for (let u = 3; u + 6 <= 36; u += 8) {
      add(u, 6, `GN-${id}${pad(n)}`, 'G8-HGX', 'gpu', 2900);
      n += 1;
    }
    add(37, 1, 'KVM 切换器', 'KVM-1716', 'kvm', 30);
    return list;
  }
  if (kind === 'storage') {
    add(34, 2, `SC-${id}-A`, 'SC-5600', 'storage', 650);
    add(32, 2, `SC-${id}-B`, 'SC-5600', 'storage', 650);
    let n = 1;
    for (let u = 4; u + 4 <= 30; u += 4) {
      add(u, 4, `DE-${id}${pad(n)}`, 'DE-4U60', 'storage', 520);
      n += 1;
    }
    return list;
  }
  // compute
  const count = 14 + Math.floor((seed % 7) / 3);
  let n = 1;
  for (let u = 2; n <= count && u + 2 <= 39; u += 2) {
    if (u === 20) {
      add(u, 1, 'KVM 切换器', 'KVM-1716', 'kvm', 30);
      u -= 1;
      continue;
    }
    add(u, 2, `CN-${id}${pad(n)}`, 'CS-2288', 'server', 520);
    n += 1;
  }
  return list;
}

const KIND_THERMAL: Record<RackKind, number> = { compute: 1.92, storage: 2.15, network: 2.55, gpu: 1.24 };
const KIND_TAU: Record<RackKind, number> = { compute: 110, storage: 160, network: 140, gpu: 85 };

export const RACKS: RackDef[] = RACK_PLAN.map(([id, kind, baseKw], i) => {
  const row = id[0] as RowId;
  const index = Number(id.slice(1));
  const seed = 1000 + i * 37;
  return {
    id,
    row,
    index,
    slot: SLOT_OF_INDEX[index],
    kind,
    ratedKw: kind === 'gpu' ? 15 : kind === 'network' ? 6 : kind === 'storage' ? 8 : 10,
    baseKw,
    phase: PHASES[(index - 1) % 3],
    breakerA: kind === 'gpu' ? 63 : 32,
    seed,
    kThermal: KIND_THERMAL[kind] * (0.95 + ((seed * 13) % 10) / 100),
    tau: KIND_TAU[kind] * (0.9 + ((seed * 7) % 20) / 100),
    deadTime: kind === 'gpu' ? 15 : 25,
    diurnalAmp: kind === 'network' ? 0.05 : kind === 'storage' ? 0.08 : 0.12,
    jobPeriod: kind === 'compute' ? 540 + (i % 4) * 90 : kind === 'gpu' ? 780 : 0,
    jobAmp: kind === 'compute' ? 0.2 : kind === 'gpu' ? 0.12 : 0,
    splitA: 0.47 + ((seed * 3) % 7) / 100,
    devices: buildDevices(id, kind, seed),
    energy0: 18000 + i * 1530,
  };
});

export const RACK_MAP: Record<string, RackDef> = Object.fromEntries(RACKS.map((r) => [r.id, r]));

export const ACUS: AcuDef[] = [
  { id: 'ACU-A1', row: 'A', slot: 4, capacityKw: 40, setpoint: 21, seed: 501 },
  { id: 'ACU-A2', row: 'A', slot: 9, capacityKw: 40, setpoint: 21, seed: 502 },
  { id: 'ACU-B1', row: 'B', slot: 4, capacityKw: 40, setpoint: 21, seed: 503 },
  { id: 'ACU-B2', row: 'B', slot: 9, capacityKw: 40, setpoint: 21, seed: 504 },
];

export const UPSES: UpsDef[] = [
  { id: 'UPS-1', ratedKva: 200, feeds: 'PDC-1' },
  { id: 'UPS-2', ratedKva: 200, feeds: 'PDC-2' },
];

export const PDCS: PdcDef[] = [
  { id: 'PDC-1', row: 'A', slot: 0, path: 'A', ups: 'UPS-1' },
  { id: 'PDC-2', row: 'B', slot: 0, path: 'B', ups: 'UPS-2' },
];

// 机柜对各空调的冷量归属权重（同列近距离权重更高）
export const COOLING_WEIGHTS: Record<string, Record<string, number>> = (() => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of RACKS) {
    const raw = ACUS.map((a) => Math.exp(-Math.abs(a.slot - r.slot) / 2.6) * (a.row === r.row ? 1 : 0.42));
    const sum = raw.reduce((s, v) => s + v, 0);
    out[r.id] = Object.fromEntries(ACUS.map((a, i) => [a.id, raw[i] / sum]));
  }
  return out;
})();

// 同列相邻机柜
export function neighbors(rackId: string): string[] {
  const r = RACK_MAP[rackId];
  return RACKS.filter((x) => x.row === r.row && Math.abs(x.index - r.index) === 1).map((x) => x.id);
}

// 温度测点：前门（进风）/后门（出风） × 上中下
export type Side = 'F' | 'R';
export type Level = 'T' | 'M' | 'B';
export const LEVELS: Level[] = ['B', 'M', 'T'];
export const LEVEL_U: Record<Level, number> = { B: 6, M: 21, T: 37 };
export const LEVEL_LABEL: Record<Level, string> = { T: '上', M: '中', B: '下' };
export const SIDE_LABEL: Record<Side, string> = { F: '进风', R: '出风' };

export interface ThermalNode {
  id: string; // A06-R-T
  rack: string;
  side: Side;
  level: Level;
  label: string;
}

export const THERMAL_NODES: ThermalNode[] = RACKS.flatMap((r) =>
  (['F', 'R'] as Side[]).flatMap((side) =>
    (['T', 'M', 'B'] as Level[]).map((level) => ({
      id: `${r.id}-${side}-${level}`,
      rack: r.id,
      side,
      level,
      label: `${r.id} ${SIDE_LABEL[side]}·${LEVEL_LABEL[level]}`,
    })),
  ),
);

export const SITE = {
  name: '中心机房 · 一体化微模块 M01',
  building: '数据中心 3F',
};
