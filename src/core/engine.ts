// 采集引擎：周期采集 → 写入时序库 → 告警判定 → 通知订阅方
import { useSyncExternalStore } from 'react';
import { AlarmCenter } from './alarms';
import { History } from './history';
import { computeSnapshot, SERIES_KEYS, writeRow, type Snapshot } from './model';

export const TICK_MS = 2000;
export const HISTORY_LEN = 1800; // 60 min @ 2s

class TelemetryEngine {
  history = new History(SERIES_KEYS, HISTORY_LEN);
  alarms = new AlarmCenter();
  snapshot: Snapshot;
  version = 0;
  startedAt = Date.now();
  samples = 0;
  private lastT = 0;
  private row = new Float64Array(SERIES_KEYS.length);
  private timer: number | undefined;
  private listeners = new Set<() => void>();

  constructor() {
    const now = Math.floor(Date.now() / TICK_MS) * TICK_MS;
    this.snapshot = computeSnapshot(now);
    this.ingestRange(now - (HISTORY_LEN - 1) * TICK_MS, now);
  }

  private ingest(t: number) {
    const s = computeSnapshot(t);
    this.history.push(t, writeRow(s, this.row));
    this.alarms.evaluate(s, this.history);
    this.snapshot = s;
    this.lastT = t;
    this.samples += 1;
  }

  private ingestRange(from: number, to: number) {
    const start = Math.max(from, to - (HISTORY_LEN - 1) * TICK_MS);
    for (let t = start; t <= to; t += TICK_MS) this.ingest(t);
  }

  start() {
    if (this.timer !== undefined) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const t = Math.floor(Date.now() / TICK_MS) * TICK_MS;
    if (t <= this.lastT) return;
    this.ingestRange(this.lastT + TICK_MS, t);
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  /** 人工确认等操作后主动刷新订阅方 */
  touch() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;
}

export const engine = new TelemetryEngine();

/** 订阅实时数据，返回递增版本号 */
export function useTelemetry() {
  return useSyncExternalStore(engine.subscribe, engine.getVersion);
}

/** 以较低频率刷新的版本号，用于计算量较大的分析视图 */
export function useSlowVersion(every = 5) {
  const v = useTelemetry();
  return Math.floor(v / every);
}
