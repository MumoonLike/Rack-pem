import { RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Dot } from '@/components/ui';
import { PALETTE, hexA } from '@/theme';

export interface SubItem {
  label: string;
  path: string;
  metric: string;
  status: 'ok' | 'warn' | 'alarm';
}

export interface ModuleCard {
  title: string;
  color: string;
  items: SubItem[];
}

const STATUS_COLOR = { ok: PALETTE.green, warn: PALETTE.amber, alarm: PALETTE.red };

function Card({ m }: { m: ModuleCard }) {
  const nav = useNavigate();
  return (
    <div
      style={{
        border: `1px solid ${hexA(m.color, 0.35)}`,
        background: `linear-gradient(180deg, ${hexA(m.color, 0.12)}, transparent 70%)`,
        borderRadius: 10,
        padding: '8px 10px',
        minWidth: 0,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600, fontSize: 13, color: m.color, cursor: 'pointer' }}
        onClick={() => nav(m.items[0].path)}
      >
        {m.title}
        <RightOutlined style={{ fontSize: 10 }} />
      </div>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {m.items.map((it) => (
          <div
            key={it.path}
            onClick={() => nav(it.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}
          >
            <Dot color={STATUS_COLOR[it.status]} pulse={it.status !== 'ok'} />
            <span className="text-2" style={{ whiteSpace: 'nowrap' }}>
              {it.label}
            </span>
            <span className="num" style={{ marginLeft: 'auto', color: it.status === 'ok' ? 'var(--text)' : STATUS_COLOR[it.status], whiteSpace: 'nowrap' }}>
              {it.metric}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ModuleHub({ top, bottom, center }: { top: ModuleCard[]; bottom: ModuleCard[]; center: { points: number; uptime: string } }) {
  const line = 'var(--line-strong)';
  return (
    <div className="module-flow" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        {top.map((m) => (
          <Card key={m.title} m={m} />
        ))}
      </div>
      <svg width="100%" height="26" viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d="M50 0 V13 H250 V0 M150 0 V26" fill="none" stroke={line} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <circle r="2.5" fill={PALETTE.cyan}>
          <animateMotion dur="2.4s" repeatCount="indefinite" path="M50 0 V13 H150 V26" />
        </circle>
        <circle r="2.5" fill={PALETTE.cyan}>
          <animateMotion dur="2.4s" begin="0.8s" repeatCount="indefinite" path="M250 0 V13 H150 V26" />
        </circle>
      </svg>
      <div
        style={{
          borderRadius: 10,
          padding: '10px 14px',
          background: 'linear-gradient(90deg, rgba(62,139,255,0.22), rgba(34,195,214,0.18))',
          border: '1px solid rgba(62,139,255,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>中心机柜动力环监一体化系统</div>
        <div className="text-2 num" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {center.points} 测点 · 已运行 {center.uptime}
        </div>
      </div>
      <svg width="100%" height="26" viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d="M150 0 V13 M75 13 H225 M75 13 V26 M225 13 V26" fill="none" stroke={line} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <circle r="2.5" fill={PALETTE.purple}>
          <animateMotion dur="2.4s" begin="0.4s" repeatCount="indefinite" path="M150 0 V13 H75 V26" />
        </circle>
        <circle r="2.5" fill={PALETTE.purple}>
          <animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" path="M150 0 V13 H225 V26" />
        </circle>
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        {bottom.map((m) => (
          <Card key={m.title} m={m} />
        ))}
      </div>
    </div>
  );
}
