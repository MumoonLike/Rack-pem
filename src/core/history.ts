// 环形时序库：固定测点表，按列存储最近一段时间的全量数据

export class History {
  readonly capacity: number;
  readonly keys: string[];
  private index = new Map<string, number>();
  private times: Float64Array;
  private cols: Float32Array[];
  private head = 0;
  size = 0;

  constructor(keys: string[], capacity: number) {
    this.capacity = capacity;
    this.keys = keys;
    keys.forEach((k, i) => this.index.set(k, i));
    this.times = new Float64Array(capacity);
    this.cols = keys.map(() => new Float32Array(capacity));
  }

  push(t: number, row: ArrayLike<number>) {
    const idx = this.head;
    this.times[idx] = t;
    for (let i = 0; i < this.cols.length; i++) this.cols[i][idx] = row[i];
    this.head = (idx + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  col(key: string) {
    return this.index.get(key) ?? -1;
  }

  private from(count: number) {
    return (this.head - count + this.capacity) % this.capacity;
  }

  timeline(n = this.size): number[] {
    const count = Math.min(n, this.size);
    const from = this.from(count);
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.times[(from + i) % this.capacity];
    return out;
  }

  series(key: string, n = this.size): number[] {
    const count = Math.min(n, this.size);
    const ci = this.col(key);
    const out = new Array<number>(count);
    if (ci < 0) return out.fill(NaN);
    const arr = this.cols[ci];
    const from = this.from(count);
    for (let i = 0; i < count; i++) out[i] = arr[(from + i) % this.capacity];
    return out;
  }

  /** 截至第 back 个历史点（不含更新的点）的 n 个值，按时间顺序 */
  range(key: string, back: number, n: number): number[] {
    const ci = this.col(key);
    const end = this.size - back;
    const start = Math.max(0, end - n);
    const count = Math.max(0, end - start);
    const out = new Array<number>(count);
    if (ci < 0) return out.fill(NaN);
    const arr = this.cols[ci];
    const from = this.from(this.size);
    for (let i = 0; i < count; i++) out[i] = arr[(from + start + i) % this.capacity];
    return out;
  }

  /** 第 back 个历史值（0 为最新） */
  atCol(ci: number, back: number): number {
    if (ci < 0 || back >= this.size) return NaN;
    return this.cols[ci][(this.head - 1 - back + this.capacity * 2) % this.capacity];
  }

  at(key: string, back: number) {
    return this.atCol(this.col(key), back);
  }

  meanCol(ci: number, back: number, n: number): number {
    let s = 0;
    let c = 0;
    const end = Math.min(back + n, this.size);
    const arr = this.cols[ci];
    for (let i = back; i < end; i++) {
      s += arr[(this.head - 1 - i + this.capacity * 2) % this.capacity];
      c += 1;
    }
    return c ? s / c : NaN;
  }

  mean(key: string, back: number, n: number) {
    const ci = this.col(key);
    return ci < 0 ? NaN : this.meanCol(ci, back, n);
  }

  pairs(key: string, n = this.size): [number, number][] {
    const t = this.timeline(n);
    const v = this.series(key, n);
    return t.map((x, i) => [x, v[i]]);
  }

  timeAt(back: number) {
    return this.times[(this.head - 1 - back + this.capacity * 2) % this.capacity];
  }
}
