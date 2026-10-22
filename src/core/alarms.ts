// 告警判定与生命周期管理（越限 + 回差 + 持续确认）
import type { History } from './history';
import type { Snapshot } from './model';
import { ACUS } from './topology';

export type AlarmLevel = 1 | 2 | 3 | 4;
export type AlarmCategory = '电参' | '环境' | '温升' | '设备' | '安防';

export const LEVEL_META: Record<AlarmLevel, { label: string; color: string }> = {
  1: { label: '紧急', color: '#ff4d4f' },
  2: { label: '重要', color: '#fa8c16' },
  3: { label: '次要', color: '#fadb14' },
  4: { label: '提示', color: '#1677ff' },
};

export interface Alarm {
  id: string;
  key: string;
  level: AlarmLevel;
  category: AlarmCategory;
  target: string;
  rack?: string;
  title: string;
  detail: string;
  value: number;
  peak: number;
  threshold: number;
  unit: string;
  start: number;
  end?: number;
  status: 'active' | 'recovered';
  ackTime?: number;
  ackBy?: string;
}

interface Condition {
  key: string;
  level: AlarmLevel;
  category: AlarmCategory;
  target: string;
  rack?: string;
  title: string;
  value: number;
  threshold: number;
  unit: string;
  higherIsWorse?: boolean;
}

const NODE_LABEL: Record<string, string> = {
  'F-B': '进风·下',
  'F-M': '进风·中',
  'F-T': '进风·上',
  'R-B': '出风·下',
  'R-M': '出风·中',
  'R-T': '出风·上',
};

const POS = ['F-B', 'F-M', 'F-T', 'R-B', 'R-M', 'R-T'] as const;

/** 节点温升速率（5 min 窗口，℃/min） */
export function riseRate(h: History, key: string, window = 150) {
  const ci = h.col(key);
  if (ci < 0 || h.size < window + 10) return 0;
  return (h.meanCol(ci, 0, 8) - h.meanCol(ci, window, 8)) / ((window * 2) / 60);
}

interface RackKeys {
  load: string;
  rh: string;
  dew: string;
  cur: [string, string];
  off: [string, string];
  tin: string[];
  tout: string[];
  rise: string[];
  series: string[];
  cols: number[];
}
const KEYS = new Map<string, RackKeys>();
function keysOf(h: History, id: string): RackKeys {
  let k = KEYS.get(id);
  if (!k) {
    k = {
      load: `load:${id}`,
      rh: `rh:${id}`,
      dew: `dew:${id}`,
      cur: [`cur:${id}-PDU-A`, `cur:${id}-PDU-B`],
      off: [`off:${id}-PDU-A`, `off:${id}-PDU-B`],
      tin: POS.slice(0, 3).map((p) => `tin:${id}-${p}`),
      tout: POS.slice(3).map((p) => `tout:${id}-${p}`),
      rise: POS.map((p) => `rise:${id}-${p}`),
      series: POS.map((p) => `${id}.${p}`),
      cols: POS.map((p) => h.col(`${id}.${p}`)),
    };
    KEYS.set(id, k);
  }
  return k;
}

function detect(s: Snapshot, h: History, active: (key: string) => boolean): Condition[] {
  const out: Condition[] = [];
  const over = (key: string, v: number, raise: number, clear: number) => v >= (active(key) ? clear : raise);

  const riseReady = h.size >= 160;
  for (const r of s.racks) {
    const K = keysOf(h, r.id);
    // 负载率
    const lk = K.load;
    if (over(lk, r.ratio, 0.9, 0.86)) {
      out.push({
        key: lk,
        level: r.ratio >= 0.97 ? 1 : 2,
        category: '电参',
        target: r.id,
        rack: r.id,
        title: '机柜负载率过高',
        value: r.ratio * 100,
        threshold: 90,
        unit: '%',
      });
    }
    // PDU
    [r.pa, r.pb].forEach((c, ci) => {
      const ck = K.cur[ci];
      if (c.online && over(ck, c.i / c.breakerA, 0.8, 0.76)) {
        out.push({
          key: ck,
          level: c.i / c.breakerA >= 0.9 ? 1 : 2,
          category: '电参',
          target: c.id,
          rack: r.id,
          title: 'PDU 电流越限',
          value: c.i,
          threshold: c.breakerA * 0.8,
          unit: 'A',
        });
      }
      if (!c.online) {
        out.push({
          key: K.off[ci],
          level: 2,
          category: '设备',
          target: c.id,
          rack: r.id,
          title: 'PDU 通讯中断',
          value: 0,
          threshold: 0,
          unit: '',
        });
      }
    });
    // 进风温度
    r.tin.forEach((v, hi) => {
      const pos = POS[hi];
      const k = K.tin[hi];
      if (over(k, v, 27, 26.5)) {
        out.push({
          key: k,
          level: v >= 30 ? 1 : 2,
          category: '环境',
          target: `${r.id}-${pos}`,
          rack: r.id,
          title: `进风温度越限（${NODE_LABEL[pos]}）`,
          value: v,
          threshold: 27,
          unit: '℃',
        });
      }
    });
    // 出风温度
    r.tout.forEach((v, hi) => {
      const pos = POS[hi + 3];
      const k = K.tout[hi];
      if (over(k, v, 45, 44)) {
        out.push({
          key: k,
          level: v >= 48 ? 2 : 3,
          category: '环境',
          target: `${r.id}-${pos}`,
          rack: r.id,
          title: `出风温度偏高（${NODE_LABEL[pos]}）`,
          value: v,
          threshold: 45,
          unit: '℃',
        });
      }
    });
    // 温升速率
    for (let pi = 0; riseReady && pi < 6; pi++) {
      const pos = POS[pi];
      const ci = K.cols[pi];
      const rate = (h.meanCol(ci, 0, 8) - h.meanCol(ci, 150, 8)) / 5;
      const k = K.rise[pi];
      if (over(k, rate, 0.55, 0.3)) {
        out.push({
          key: k,
          level: rate >= 1.0 ? 2 : 3,
          category: '温升',
          target: `${r.id}-${pos}`,
          rack: r.id,
          title: `温升速率异常（${NODE_LABEL[pos]}）`,
          value: rate,
          threshold: 0.55,
          unit: '℃/min',
        });
      }
    }
    // 湿度
    const hk = K.rh;
    if (over(hk, r.rhF, 60, 58)) {
      out.push({
        key: hk,
        level: r.rhF >= 65 ? 2 : 3,
        category: '环境',
        target: `${r.id}-F-M`,
        rack: r.id,
        title: '进风相对湿度偏高',
        value: r.rhF,
        threshold: 60,
        unit: '%RH',
      });
    }
    const dk = K.dew;
    if (over(dk, r.dew, 15, 14.6)) {
      out.push({
        key: dk,
        level: 2,
        category: '环境',
        target: r.id,
        rack: r.id,
        title: '露点温度越限',
        value: r.dew,
        threshold: 15,
        unit: '℃',
      });
    }
  }

  for (const a of s.acus) {
    const def = ACUS.find((x) => x.id === a.id)!;
    const k = `sup:${a.id}`;
    const dev = a.supply - def.setpoint;
    if (over(k, dev, 2, 1.4)) {
      out.push({
        key: k,
        level: 2,
        category: '设备',
        target: a.id,
        title: '送风温度偏离设定值',
        value: a.supply,
        threshold: def.setpoint + 2,
        unit: '℃',
      });
    }
  }

  if (s.room.frontDoor) {
    out.push({
      key: 'door:front',
      level: 4,
      category: '安防',
      target: 'M01 前门',
      title: '微模块前门开启',
      value: 1,
      threshold: 0,
      unit: '',
    });
  }
  return out;
}

function describe(c: Condition) {
  if (!c.unit) return `${c.target} ${c.title}`;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(c.unit === '℃/min' ? 2 : 1));
  return `${c.target} 当前 ${fmt(c.value)}${c.unit}，阈值 ${fmt(c.threshold)}${c.unit}`;
}

let seq = 1;

export class AlarmCenter {
  active = new Map<string, Alarm>();
  log: Alarm[] = [];
  private pending = new Map<string, number>();
  private acked = new Map<string, { time: number; by: string }>();

  evaluate(s: Snapshot, h: History) {
    const conds = detect(s, h, (k) => this.active.has(k));
    const seen = new Set<string>();
    let changed = false;
    for (const c of conds) {
      seen.add(c.key);
      const cur = this.active.get(c.key);
      if (cur) {
        cur.value = c.value;
        cur.peak = Math.max(cur.peak, c.value);
        if (c.level < cur.level) {
          cur.level = c.level;
          changed = true;
        }
        cur.detail = describe(c);
        continue;
      }
      const n = (this.pending.get(c.key) ?? 0) + 1;
      this.pending.set(c.key, n);
      if (n < 2) continue;
      const alarm: Alarm = {
        id: `AL${String(seq++).padStart(6, '0')}`,
        key: c.key,
        level: c.level,
        category: c.category,
        target: c.target,
        rack: c.rack,
        title: c.title,
        detail: describe(c),
        value: c.value,
        peak: c.value,
        threshold: c.threshold,
        unit: c.unit,
        start: s.t,
        status: 'active',
      };
      this.active.set(c.key, alarm);
      this.log.unshift(alarm);
      changed = true;
    }
    for (const k of Array.from(this.pending.keys())) if (!seen.has(k)) this.pending.delete(k);
    for (const [k, a] of this.active) {
      if (!seen.has(k)) {
        a.status = 'recovered';
        a.end = s.t;
        this.active.delete(k);
        changed = true;
      }
    }
    if (this.log.length > 800) this.log.length = 800;
    return changed;
  }

  ack(ids: string[], by = '值班工程师') {
    const now = Date.now();
    for (const a of this.log) {
      if (ids.includes(a.id) && !a.ackTime) {
        a.ackTime = now;
        a.ackBy = by;
        this.acked.set(a.id, { time: now, by });
      }
    }
  }

  activeList() {
    return Array.from(this.active.values()).sort((a, b) => a.level - b.level || b.start - a.start);
  }
}
