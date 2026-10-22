// 分析结果缓存：按采集版本节流重算，多个视图共享同一结果
import { useMemo } from 'react';
import { engine, useTelemetry } from './engine';
import { buildFusion, type FusionPath } from './anomaly';
import { extractChainsFrom, type ChainGroup } from './feedback';

const cache = new Map<string, { slot: number; value: unknown }>();

export function getAnalysis<T>(key: string, fn: () => T, every = 5): T {
  const slot = Math.floor(engine.version / every);
  const c = cache.get(key);
  if (c && c.slot === slot) return c.value as T;
  const value = fn();
  cache.set(key, { slot, value });
  return value;
}

export function useAnalysis<T>(key: string, fn: () => T, every = 5): T {
  const v = useTelemetry();
  const slot = Math.floor(v / every);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getAnalysis(key, fn, every), [key, slot]);
}

// ---------- 融合路径时间序列（增量维护） ----------

const STEP_MS = 120_000;
const evaluations = new Map<number, FusionPath[]>();

/** 补齐追踪窗口内缺失的评估点（由新到旧），返回是否已全部完成 */
function syncEvaluations(limit = Infinity) {
  const h = engine.history;
  const newest = h.timeAt(0);
  const oldest = h.timeAt(h.size - 1);
  const minT = Math.ceil((oldest + 840_000) / STEP_MS) * STEP_MS;
  for (const t of Array.from(evaluations.keys())) if (t < minT) evaluations.delete(t);
  let budget = limit;
  let complete = true;
  for (let t = Math.floor(newest / STEP_MS) * STEP_MS; t >= minT; t -= STEP_MS) {
    if (evaluations.has(t)) continue;
    if (budget <= 0) {
      complete = false;
      break;
    }
    const back = Math.round((newest - t) / 2000);
    if (back < 0 || back >= h.size) continue;
    evaluations.set(t, buildFusion(h, back, false));
    budget -= 1;
  }
  return complete;
}

function evaluationList() {
  return Array.from(evaluations.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, paths]) => ({ t, paths }));
}

/** 空闲时分批预计算融合路径历史，避免阻塞首屏 */
export function warmupChains() {
  const ric = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
  const idle = (cb: () => void) => (ric ? ric.call(window, cb) : window.setTimeout(cb, 50));
  const step = () => {
    if (!syncEvaluations(2)) idle(step);
  };
  idle(step);
}

/** eager 为 false 时仅使用已完成的评估结果（总览等轻量场景） */
export function useChainGroups(eager = true): { groups: ChainGroup[]; evaluations: number; times: number[] } {
  return useAnalysis(
    eager ? 'chains' : 'chains-lite',
    () => {
      syncEvaluations(eager ? Infinity : 1);
      return extractChainsFrom(evaluationList(), STEP_MS);
    },
    eager ? 15 : 5,
  );
}
