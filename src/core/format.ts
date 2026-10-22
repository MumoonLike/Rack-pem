import dayjs from 'dayjs';

export function fx(v: number | undefined, d = 1) {
  if (v === undefined || !Number.isFinite(v)) return '--';
  return v.toFixed(d);
}

export function fint(v: number) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('zh-CN') : '--';
}

export function tstr(t: number, f = 'HH:mm:ss') {
  return dayjs(t).format(f);
}

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

export function pct(v: number, d = 1) {
  return `${fx(v * 100, d)}%`;
}

export function signed(v: number, d = 1) {
  if (!Number.isFinite(v)) return '--';
  return `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
}
