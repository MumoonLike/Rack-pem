import { hexA } from '@/theme';

/** 纵向渐变面积填充 */
export function grad(color: string, top = 0.28, bottom = 0.01) {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: hexA(color, top) },
      { offset: 1, color: hexA(color, bottom) },
    ],
  };
}

export function line(name: string, data: unknown[], color?: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'line',
    showSymbol: false,
    data,
    ...(color ? { color } : {}),
    ...extra,
  };
}

export function area(name: string, data: unknown[], color: string, extra: Record<string, unknown> = {}) {
  return line(name, data, color, { areaStyle: { color: grad(color) }, ...extra });
}

export function thresholdLine(value: number, label: string, color: string) {
  return {
    silent: true,
    symbol: 'none',
    data: [{ yAxis: value }],
    lineStyle: { color, type: 'dashed', width: 1 },
    label: { formatter: label, color, position: 'insideEndTop', fontSize: 11 },
  };
}

export const legendTopRight = { top: 0, right: 0, itemWidth: 12, itemHeight: 8, itemGap: 14 };
