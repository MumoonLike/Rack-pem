import { Tag, Tooltip } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { sparkPath } from '@/core/analytics';
import { LEVEL_META, type AlarmLevel } from '@/core/alarms';
import { hexA } from '@/theme';

export function Panel({
  title,
  sub,
  extra,
  children,
  className = '',
  style,
  bodyStyle,
  flush,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  flush?: boolean;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || extra) && (
        <header className="panel-head">
          <div className="panel-title">
            <span style={{ whiteSpace: 'nowrap' }}>{title}</span>
            {sub && <span className="panel-sub">{sub}</span>}
          </div>
          {extra && <div className="panel-extra">{extra}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function PageHead({ module, title, desc, extra }: { module: string; title: string; desc?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>
          {title}
          <span className="module-chip">{module}</span>
        </h1>
        {desc && <p>{desc}</p>}
      </div>
      {extra && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}

export function Spark({ values, color, width = 90, height = 28, fill = true }: { values: number[]; color: string; width?: number; height?: number; fill?: boolean }) {
  const d = sparkPath(values, width, height - 2);
  if (!d) return null;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={hexA(color, 0.14)} stroke="none" />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function Kpi({
  label,
  value,
  unit,
  icon,
  color,
  foot,
  spark,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
  color: string;
  foot?: ReactNode;
  spark?: number[];
}) {
  return (
    <Panel className="kpi-panel" bodyStyle={{ padding: 0 }}>
      <div className="kpi">
        <div className="kpi-top">
          <span className="kpi-label">{label}</span>
          {icon && (
            <span className="kpi-icon" style={{ background: hexA(color, 0.14), color }}>
              {icon}
            </span>
          )}
        </div>
        <div className="kpi-value">
          <span className="v num">{value}</span>
          {unit && <span className="u">{unit}</span>}
          {spark && spark.length > 2 && (
            <span style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              <Spark values={spark} color={color} width={76} height={24} />
            </span>
          )}
        </div>
        <div className="kpi-foot">{foot}</div>
      </div>
    </Panel>
  );
}

export function MiniStat({ label, value, unit, color, style }: { label: ReactNode; value: ReactNode; unit?: string; color?: string; style?: CSSProperties }) {
  return (
    <div className="mini-stat" style={style}>
      <span className="l">{label}</span>
      <span className="v num" style={color ? { color } : undefined}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={`dot ${pulse ? 'pulse' : ''}`} style={{ background: color, color }} />;
}

export function LevelTag({ level }: { level: AlarmLevel }) {
  const m = LEVEL_META[level];
  return (
    <Tag bordered={false} style={{ background: hexA(m.color, 0.16), color: m.color, marginInlineEnd: 0, fontWeight: 500 }}>
      {m.label}
    </Tag>
  );
}

export function SoftTag({ color, children, style }: { color: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <Tag bordered={false} style={{ background: hexA(color, 0.15), color, marginInlineEnd: 0, ...style }}>
      {children}
    </Tag>
  );
}

export function Delta({ v, unit = '', d = 1, invert }: { v: number; unit?: string; d?: number; invert?: boolean }) {
  if (!Number.isFinite(v)) return <span>--</span>;
  const up = v > 0;
  const bad = invert ? !up : up;
  const cls = Math.abs(v) < 10 ** -d ? '' : bad ? 'delta-up' : 'delta-down';
  return (
    <span className={`num ${cls}`}>
      {up ? '▲' : v < 0 ? '▼' : ''} {Math.abs(v).toFixed(d)}
      {unit}
    </span>
  );
}

export function Bar({ value, color, height = 6, bg }: { value: number; color: string; height?: number; bg?: string }) {
  return (
    <div style={{ height, borderRadius: height, background: bg ?? 'var(--line)', overflow: 'hidden', width: '100%' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, height: '100%', background: color, borderRadius: height, transition: 'width .4s' }} />
    </div>
  );
}

export function Chain({ nodes, colors }: { nodes: string[]; colors?: string[] }) {
  return (
    <div className="chain">
      {nodes.map((n, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            className="chain-node"
            style={colors?.[i] ? { borderColor: hexA(colors[i], 0.45), background: hexA(colors[i], 0.1) } : undefined}
          >
            {n}
          </span>
          {i < nodes.length - 1 && <span className="chain-arrow">➜</span>}
        </span>
      ))}
    </div>
  );
}

export function Hint({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      <span style={{ borderBottom: '1px dashed var(--text-3)', cursor: 'help' }}>{children}</span>
    </Tooltip>
  );
}

export function HeatLegend({ lo, hi, unit, colors }: { lo: number; hi: number; unit: string; colors: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }} className="muted">
      <span className="num">
        {lo}
        {unit}
      </span>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${colors.join(',')})` }} />
      <span className="num">
        {hi}
        {unit}
      </span>
    </div>
  );
}
