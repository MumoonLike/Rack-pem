import type { Evidence, EvidenceSource, FusionPath } from '@/core/anomaly';
import { PALETTE } from '@/theme';

export const SOURCE_COLOR: Record<EvidenceSource, string> = {
  电参: PALETTE.blue,
  温升: PALETTE.orange,
  环境: PALETTE.cyan,
  制冷: PALETTE.purple,
};

export const CATEGORY_COLOR: Record<FusionPath['category'], string> = {
  负载驱动: PALETTE.red,
  散热异常: PALETTE.orange,
  气流组织: PALETTE.amber,
  制冷衰减: PALETTE.purple,
  湿度调节: PALETTE.cyan,
};

export const COL: Record<EvidenceSource, number> = { 电参: 0, 制冷: 0, 温升: 1, 环境: 2 };

/** 由证据编号推断对应时序测点 */
export function evidenceSeries(e: Evidence): string | null {
  const m = e.id.match(/^(ACU-[AB]\d|[AB]\d{2})-(\w+)$/);
  if (!m) return null;
  const [, obj, kind] = m;
  const node = e.label.split(' ')[0];
  switch (kind) {
    case 'load':
      return `${obj}.load`;
    case 'cur':
      return `${obj}.ia`;
    case 'rise':
    case 'tz':
      return /^[AB]\d{2}-[FR]-[TMB]$/.test(node) ? `${node.slice(0, 3)}.${node.slice(4)}` : `${obj}.R-T`;
    case 'tin':
    case 'nb':
    case 'sz':
      return `${obj}.F-T`;
    case 'rh':
      return `${obj}.rhF`;
    case 'dist':
      return `${obj}.R-T`;
    case 'sup':
      return `${obj}.sup`;
    case 'fan':
      return `${obj}.fan`;
  }
  return null;
}
