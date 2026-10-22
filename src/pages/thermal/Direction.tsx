import { Col, Empty, Row, Segmented, Space, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { HeatLegend, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { blockMean } from '@/core/analytics';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { propagation, type PropagationEdge } from '@/core/thermal';
import { ACUS, RACKS, ROW_SLOTS } from '@/core/topology';
import { HEAT_COLORS, PALETTE, heatColor, hexA } from '@/theme';

type Lv = 0 | 1 | 2;

const CW = 64;
const PAD = 16;
const Y = { HA: 16, A: 60, CA: 136, B: 188, HB: 264 };
const RH = 70;
const W = ROW_SLOTS * CW + PAD * 2;
const H = 312;

function cx(slot: number) {
  return PAD + slot * CW + CW / 2;
}

export default function Direction() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const [lv, setLv] = useState<Lv>(2);
  const edges = useAnalysis('prop', () => propagation(h), 30);
  const [selEdge, setSelEdge] = useState<number>(0);
  const edge: PropagationEdge | undefined = edges[selEdge] ?? edges[0];

  const temps = Object.fromEntries(s.racks.map((r) => [r.id, r.tout[lv]]));
  const lo = 28;
  const hi = 46;

  // 列内横向温差
  const lateral: { from: string; to: string; d: number; y: number; x1: number; x2: number }[] = [];
  for (const row of ['A', 'B'] as const) {
    const list = RACKS.filter((r) => r.row === row).sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (b.slot - a.slot !== 1) continue;
      const d = temps[a.id] - temps[b.id];
      if (Math.abs(d) < 0.8) continue;
      const [src, dst] = d > 0 ? [a, b] : [b, a];
      lateral.push({ from: src.id, to: dst.id, d: Math.abs(d), y: (row === 'A' ? Y.A : Y.B) + RH / 2, x1: cx(src.slot), x2: cx(dst.slot) });
    }
  }

  const strat = s.racks.map((r) => ({ id: r.id, inS: r.tin[2] - r.tin[0], outS: r.tout[2] - r.tout[0], dT: r.tout[1] - r.tin[1] }));
  const stratOpt = {
    grid: { left: 40, right: 40, top: 40, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v?.toFixed?.(2)}℃` },
    legend: legendTopRight,
    xAxis: { type: 'category', data: strat.map((x) => x.id), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '℃' },
      { type: 'value', name: 'ΔT ℃', splitLine: { show: false } },
    ],
    series: [
      { name: '进风上下温差', type: 'bar', data: strat.map((x) => x.inS), color: PALETTE.cyan, barGap: '10%', itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '出风上下温差', type: 'bar', data: strat.map((x) => x.outS), color: PALETTE.orange, itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '进出风温升', type: 'line', yAxisIndex: 1, data: strat.map((x) => x.dT), color: PALETTE.purple, symbol: 'circle', symbolSize: 5 },
    ],
  };

  const pairOpt = useMemo(() => {
    if (!edge) return null;
    const [srcRack] = edge.from.split('.');
    const [dstRack] = edge.to.split('.');
    const n = 900;
    const t = blockMean(h.timeline(n), 5);
    const diff = (k1: string, k2: string) => {
      const x = h.series(k1, n);
      const y = h.series(k2, n);
      return blockMean(
        x.map((v, i) => v - y[i]),
        5,
      );
    };
    const a = diff(`${srcRack}.R-M`, `${srcRack}.F-M`);
    const b = diff(`${dstRack}.F-T`, `${dstRack}.F-B`);
    const norm = (x: number[]) => {
      const m = x.reduce((p, q) => p + q, 0) / x.length;
      const sd = Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / x.length) || 1;
      return x.map((v) => (v - m) / sd);
    };
    const na = norm(a);
    const nb = norm(b);
    return {
      grid: { left: 36, right: 12, top: 36, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '标准化' },
      series: [
        { name: `${srcRack} 发热（出入风温差）`, type: 'line', showSymbol: false, data: t.map((x, i) => [x, na[i]]), color: PALETTE.orange },
        { name: `${dstRack} 受热（进风上下温差）`, type: 'line', showSymbol: false, data: t.map((x, i) => [x, nb[i]]), color: PALETTE.cyan },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge?.from, edge?.to, Math.floor(s.t / 10000)]);

  const maxLat = lateral.reduce((m, x) => Math.max(m, x.d), 0);
  const avgStrat = strat.reduce((a, x) => a + x.inS, 0) / strat.length;

  return (
    <div>
      <PageHead
        module="温升识别模块"
        title="热向分析"
        desc="基于楼面温度场梯度与节点时序因果滞后，识别热量在列内的横向扩散、垂直分层及排风回流方向"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="识别传播路径" value={edges.length} unit="条" />
            <MiniStat label="列内横向扩散" value={edges.filter((e) => e.kind === '列内横向').length} unit="条" />
            <MiniStat label="排风回流" value={edges.filter((e) => e.kind === '出风回流').length} unit="条" />
            <MiniStat label="最大横向温差" value={fx(maxLat, 1)} unit="℃" color={maxLat > 4 ? PALETTE.orange : undefined} />
            <MiniStat label="平均进风分层" value={fx(avgStrat, 2)} unit="℃" />
          </div>
        </Col>
        <Col xs={24} xl={16}>
          <Panel
            title="楼面热向图"
            sub="箭头由高温指向低温，粗细表示温差"
            extra={
              <Space>
                <HeatLegend lo={lo} hi={hi} unit="℃" colors={HEAT_COLORS} />
                <Segmented
                  size="small"
                  value={lv}
                  onChange={(v) => setLv(v as Lv)}
                  options={[
                    { label: '出风·上', value: 2 },
                    { label: '出风·中', value: 1 },
                    { label: '出风·下', value: 0 },
                  ]}
                />
              </Space>
            }
          >
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
              <defs>
                <marker id="arr-o" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={PALETTE.orange} />
                </marker>
                <marker id="arr-r" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={PALETTE.red} />
                </marker>
                <marker id="arr-p" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={PALETTE.purple} />
                </marker>
              </defs>
              {/* 通道 */}
              <rect x={PAD} y={Y.HA + 4} width={W - PAD * 2} height={34} rx={8} fill={hexA(PALETTE.orange, 0.07)} stroke={hexA(PALETTE.orange, 0.3)} strokeDasharray="4 4" />
              <rect x={PAD} y={Y.CA} width={W - PAD * 2} height={46} rx={8} fill={hexA(PALETTE.cyan, 0.07)} stroke={hexA(PALETTE.cyan, 0.35)} strokeDasharray="4 4" />
              <rect x={PAD} y={Y.HB} width={W - PAD * 2} height={34} rx={8} fill={hexA(PALETTE.orange, 0.07)} stroke={hexA(PALETTE.orange, 0.3)} strokeDasharray="4 4" />
              <text x={W / 2} y={Y.HA + 25} textAnchor="middle" className="svg-text" style={{ letterSpacing: 6 }}>
                热通道 A
              </text>
              <text x={W / 2} y={Y.CA + 28} textAnchor="middle" className="svg-text" style={{ letterSpacing: 6 }}>
                封闭冷通道
              </text>
              <text x={W / 2} y={Y.HB + 25} textAnchor="middle" className="svg-text" style={{ letterSpacing: 6 }}>
                热通道 B
              </text>
              {/* 排风方向 */}
              {RACKS.map((r) => {
                const x = cx(r.slot);
                const w = 1 + s.rackMap[r.id].load / 3;
                return r.row === 'A' ? (
                  <line key={`d${r.id}`} x1={x} y1={Y.A + 2} x2={x} y2={Y.HA + 30} stroke={hexA(PALETTE.orange, 0.55)} strokeWidth={w} markerEnd="url(#arr-o)" />
                ) : (
                  <line key={`d${r.id}`} x1={x} y1={Y.B + RH - 2} x2={x} y2={Y.HB + 10} stroke={hexA(PALETTE.orange, 0.55)} strokeWidth={w} markerEnd="url(#arr-o)" />
                );
              })}
              {/* 机柜 */}
              {RACKS.map((r) => {
                const t = temps[r.id];
                const c = heatColor(t, lo, hi);
                const y = r.row === 'A' ? Y.A : Y.B;
                return (
                  <g key={r.id}>
                    <rect x={PAD + r.slot * CW + 3} y={y} width={CW - 6} height={RH} rx={7} fill={hexA(c, 0.85)} stroke={c} />
                    <text x={cx(r.slot)} y={y + 26} textAnchor="middle" fill="#fff" style={{ fontSize: 12, fontWeight: 600 }}>
                      {r.id}
                    </text>
                    <text x={cx(r.slot)} y={y + 46} textAnchor="middle" fill="#fff" className="num" style={{ fontSize: 13, fontWeight: 600 }}>
                      {t.toFixed(1)}℃
                    </text>
                  </g>
                );
              })}
              {ACUS.map((a) => {
                const y = a.row === 'A' ? Y.A : Y.B;
                const as = s.acus.find((x) => x.id === a.id)!;
                return (
                  <g key={a.id}>
                    <rect x={PAD + a.slot * CW + 3} y={y} width={CW - 6} height={RH} rx={7} fill={hexA(PALETTE.cyan, 0.12)} stroke={PALETTE.cyan} strokeDasharray="3 3" />
                    <text x={cx(a.slot)} y={y + 26} textAnchor="middle" fill={PALETTE.cyan} style={{ fontSize: 11, fontWeight: 600 }}>
                      {a.id.replace('ACU-', '空调')}
                    </text>
                    <text x={cx(a.slot)} y={y + 46} textAnchor="middle" fill={PALETTE.cyan} className="num" style={{ fontSize: 12 }}>
                      {as.ret.toFixed(1)}℃
                    </text>
                  </g>
                );
              })}
              {[
                { row: 'A', y: Y.A },
                { row: 'B', y: Y.B },
              ].map((p) => (
                <g key={p.row}>
                  <rect x={PAD + 3} y={p.y} width={CW - 6} height={RH} rx={7} fill="var(--panel-2)" stroke={hexA(PALETTE.amber, 0.5)} />
                  <text x={cx(0)} y={p.y + 40} textAnchor="middle" fill={PALETTE.amber} style={{ fontSize: 11 }}>
                    列头柜
                  </text>
                </g>
              ))}
              {/* 横向扩散箭头 */}
              {lateral.map((l) => {
                const mid = (l.x1 + l.x2) / 2;
                const dir = l.x2 > l.x1 ? 1 : -1;
                return (
                  <line
                    key={`${l.from}-${l.to}`}
                    x1={mid - 13 * dir}
                    y1={l.y + 24}
                    x2={mid + 11 * dir}
                    y2={l.y + 24}
                    stroke={PALETTE.red}
                    strokeWidth={Math.min(6, 1.2 + l.d * 0.7)}
                    markerEnd="url(#arr-r)"
                    strokeLinecap="round"
                  />
                );
              })}
              {/* 时序传播 */}
              {edges
                .filter((e) => e.kind === '列内横向')
                .slice(0, 8)
                .map((e) => {
                  const a = RACKS.find((r) => r.id === e.from.slice(0, 3))!;
                  const b = RACKS.find((r) => r.id === e.to.slice(0, 3))!;
                  const yb = a.row === 'A' ? Y.HA + 22 : Y.HB + 12;
                  const x1 = cx(a.slot);
                  const x2 = cx(b.slot);
                  const bend = a.row === 'A' ? -16 : 16;
                  return (
                    <g key={`${e.from}-${e.to}`} opacity={0.4 + 0.6 * Math.min(1, e.r)}>
                      <path d={`M${x1},${yb} Q${(x1 + x2) / 2},${yb + bend} ${x2},${yb}`} fill="none" stroke={PALETTE.purple} strokeWidth={1.8} strokeDasharray="4 3" markerEnd="url(#arr-p)" />
                      <text x={(x1 + x2) / 2} y={yb + bend + (a.row === 'A' ? -2 : 10)} textAnchor="middle" fill={PALETTE.purple} style={{ fontSize: 10 }}>
                        {e.lagSec}s
                      </text>
                    </g>
                  );
                })}
            </svg>
            <div style={{ display: 'flex', gap: 18, fontSize: 12, marginTop: 8 }} className="muted">
              <span>
                <span style={{ display: 'inline-block', width: 18, height: 3, background: PALETTE.orange, verticalAlign: 'middle', marginRight: 6 }} />
                排风方向（粗细∝负载）
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 18, height: 3, background: PALETTE.red, verticalAlign: 'middle', marginRight: 6 }} />
                横向温差扩散
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 18, height: 0, borderTop: `2px dashed ${PALETTE.purple}`, verticalAlign: 'middle', marginRight: 6 }} />
                时序传播（标注滞后）
              </span>
            </div>
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Panel title="传播路径" sub="因果滞后互相关" bodyStyle={{ maxHeight: 420, overflowY: 'auto' }}>
            {edges.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="窗口内未识别到显著传播" />
            ) : (
              edges.slice(0, 12).map((e, i) => (
                <div
                  key={`${e.from}-${e.to}`}
                  className="list-row"
                  style={{ cursor: 'pointer', background: i === selEdge ? 'var(--primary-soft)' : undefined, borderRadius: 8, padding: '8px 8px' }}
                  onClick={() => setSelEdge(i)}
                >
                  <SoftTag color={e.kind === '列内横向' ? PALETTE.purple : PALETTE.red}>{e.kind}</SoftTag>
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {e.from.slice(0, 3)} <span className="muted">发热</span> ➜ {e.to.slice(0, 3)} <span className="muted">进风·上</span>
                  </span>
                  <span className="num text-2" style={{ fontSize: 12, width: 92, textAlign: 'right' }}>
                    {e.lagSec}s · r {e.r.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </Col>
        <Col xs={24} xl={12}>
          <Panel title="传播时序对比" sub={edge ? `${edge.from.slice(0, 3)} ➜ ${edge.to.slice(0, 3)}` : undefined} extra={edge && <Tag color="purple">滞后 {edge.lagSec} s</Tag>}>
            {pairOpt ? <EChart option={pairOpt} height={260} /> : <Empty />}
          </Panel>
        </Col>
        <Col xs={24} xl={12}>
          <Panel title="垂直热分层与进出风温升">
            <EChart option={stratOpt} height={260} />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
