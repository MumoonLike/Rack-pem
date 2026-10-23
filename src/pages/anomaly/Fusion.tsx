import { Col, Empty, Progress, Row, Table } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { Bar, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { blockMean, minmax } from '@/core/analytics';
import { buildFusion, type Evidence, type EvidenceSource } from '@/core/anomaly';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { PALETTE, useChartTokens } from '@/theme';
import { CATEGORY_COLOR, COL, SOURCE_COLOR, evidenceSeries } from './shared';

export default function Fusion() {
  useTelemetry();
  const h = engine.history;
  const tk = useChartTokens();
  const paths = useAnalysis('fusion', () => buildFusion(h), 5);
  const [sel, setSel] = useState<string | null>(null);
  const cur = paths.find((p) => p.id === sel) ?? paths[0];

  const graphOpt = useMemo(() => {
    const nodes: Record<string, unknown>[] = [];
    const links: Record<string, unknown>[] = [];
    const bandH = 120;
    const colX = [0, 230, 460, 720];
    paths.forEach((p, k) => {
      const yc = k * bandH;
      const dim = cur && cur.id !== p.id ? 0.25 : 1;
      const byCol: Evidence[][] = [[], [], []];
      p.evidence.forEach((e) => byCol[COL[e.source]].push(e));
      byCol.forEach((list, ci) => {
        list.forEach((e, i) => {
          const y = yc + (i - (list.length - 1) / 2) * 34;
          nodes.push({
            id: `${p.id}|${e.id}`,
            name: e.label,
            x: colX[ci],
            y,
            value: e.value,
            symbol: 'roundRect',
            symbolSize: [168, 28],
            itemStyle: { color: SOURCE_COLOR[e.source], opacity: dim * (0.45 + 0.55 * e.strength) },
            label: { show: true, color: '#fff', fontSize: 11, formatter: `${e.label} ${e.value}` },
          });
        });
      });
      nodes.push({
        id: `${p.id}|cause`,
        name: p.cause,
        x: colX[3],
        y: yc,
        symbol: 'roundRect',
        symbolSize: [190, 38],
        itemStyle: { color: CATEGORY_COLOR[p.category], opacity: dim, shadowBlur: cur?.id === p.id ? 18 : 0, shadowColor: CATEGORY_COLOR[p.category] },
        label: { show: true, color: '#fff', fontSize: 12, fontWeight: 600, formatter: `${p.cause}\n置信度 ${(p.confidence * 100).toFixed(0)}%` },
      });
      const hasOut = new Set(p.links.map((l) => l.from));
      for (const l of p.links) {
        links.push({
          source: `${p.id}|${l.from}`,
          target: `${p.id}|${l.to}`,
          value: l.weight,
          lineStyle: { width: 1 + l.weight * 4, opacity: dim * 0.8, color: tk.subtext, curveness: 0.12 },
          label: l.lagSec !== undefined ? { show: true, formatter: `滞后 ${l.lagSec}s`, fontSize: 10, color: tk.subtext } : undefined,
        });
      }
      for (const e of p.evidence) {
        if (hasOut.has(e.id) && COL[e.source] < 2) continue;
        links.push({
          source: `${p.id}|${e.id}`,
          target: `${p.id}|cause`,
          lineStyle: { width: 1 + e.strength * 3, opacity: dim * 0.7, color: CATEGORY_COLOR[p.category], curveness: 0.08, type: 'dashed' },
        });
      }
    });
    // 透明锚点固定画布范围，避免路径较少时自动放大
    const yMax = Math.max(1, paths.length) * bandH;
    nodes.push(
      { id: '__a0', name: '', x: -80, y: -bandH / 2, symbolSize: 0, label: { show: false }, tooltip: { show: false } },
      { id: '__a1', name: '', x: colX[3] + 110, y: yMax - bandH / 2, symbolSize: 0, label: { show: false }, tooltip: { show: false } },
    );
    return {
      tooltip: {
        formatter: (p: { dataType: string; data: { name?: string; value?: string } }) =>
          p.dataType === 'node' && p.data.name ? `${p.data.name}${p.data.value ? `：${p.data.value}` : ''}` : '',
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          roam: true,
          data: nodes,
          links,
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 7,
          nodeScaleRatio: 0,
          emphasis: { disabled: true },
          animation: false,
          left: 20,
          right: 20,
          top: 10,
          bottom: 10,
        },
      ],
    };
  }, [paths, cur, tk]);

  const sankeyOpt = useMemo(() => {
    const sources = Array.from(new Set(paths.flatMap((p) => p.evidence.map((e) => e.source))));
    const causes = paths.map((p) => p.cause);
    const links: { source: string; target: string; value: number }[] = [];
    for (const p of paths) {
      for (const s of sources) {
        const v = p.evidence.filter((e) => e.source === s).reduce((a, e) => a + e.strength, 0);
        if (v > 0) links.push({ source: `${s}证据`, target: p.cause, value: +v.toFixed(3) });
      }
    }
    return {
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'sankey',
          left: 10,
          right: 150,
          top: 10,
          bottom: 10,
          nodeWidth: 14,
          nodeGap: 12,
          emphasis: { focus: 'adjacency' },
          label: { color: tk.text, fontSize: 12 },
          lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
          data: [
            ...sources.map((s) => ({ name: `${s}证据`, itemStyle: { color: SOURCE_COLOR[s] } })),
            ...causes.map((c, i) => ({ name: c, itemStyle: { color: CATEGORY_COLOR[paths[i].category] } })),
          ],
          links,
        },
      ],
    };
  }, [paths, tk]);

  const evoOpt = useMemo(() => {
    if (!cur) return null;
    const n = 900;
    const t = blockMean(h.timeline(n), 5);
    const series = cur.evidence
      .map((e) => ({ e, key: evidenceSeries(e) }))
      .filter((x): x is { e: Evidence; key: string } => !!x.key)
      .filter((x, i, arr) => arr.findIndex((y) => y.key === x.key) === i)
      .slice(0, 5)
      .map(({ e, key }) => {
        const v = blockMean(h.series(key, n), 5);
        const [lo, hi] = minmax(v);
        return { name: e.label, type: 'line', showSymbol: false, data: t.map((x, i) => [x, (v[i] - lo) / (hi - lo || 1)]), color: SOURCE_COLOR[e.source] };
      });
    return {
      grid: { left: 36, right: 12, top: 44, bottom: 24 },
      legend: { ...legendTopRight, type: 'scroll', left: 0 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', min: 0, max: 1, name: '归一化' },
      series,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, Math.floor(engine.version / 5)]);

  const totalEv = paths.reduce((a, p) => a + p.evidence.length, 0);
  const srcCount = (s: EvidenceSource) => paths.reduce((a, p) => a + p.evidence.filter((e) => e.source === s).length, 0);

  return (
    <div>
      <PageHead
        module="异常联判模块"
        title="融合路径构建"
        desc="将电参、温升、环境、制冷四类证据按因果时序关联，构建由证据到异常成因的融合推理路径，并给出置信度与处置建议"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
            <MiniStat label="融合路径" value={paths.length} unit="条" color={paths.length ? PALETTE.orange : PALETTE.green} />
            <MiniStat label="关联证据" value={totalEv} unit="项" />
            <MiniStat label="电参证据" value={srcCount('电参')} unit="项" color={PALETTE.blue} />
            <MiniStat label="温升证据" value={srcCount('温升')} unit="项" color={PALETTE.orange} />
            <MiniStat label="环境证据" value={srcCount('环境')} unit="项" color={PALETTE.cyan} />
            <MiniStat label="制冷证据" value={srcCount('制冷')} unit="项" color={PALETTE.purple} />
          </div>
        </Col>
        {paths.length === 0 ? (
          <Col span={24}>
            <Panel>
              <Empty style={{ padding: 60 }} description="当前各节点证据未形成联合异常，系统持续进行多源联判" />
            </Panel>
          </Col>
        ) : (
          <>
            <Col xs={24} xl={16}>
              <Panel
                title="融合推理图"
                sub="证据 → 关联 → 成因"
                extra={
                  <div style={{ display: 'flex', gap: 10, fontSize: 12 }} className="muted">
                    {(Object.keys(SOURCE_COLOR) as EvidenceSource[]).map((s) => (
                      <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: SOURCE_COLOR[s] }} />
                        {s}
                      </span>
                    ))}
                  </div>
                }
              >
                <EChart option={graphOpt} height={Math.max(360, paths.length * 120 + 60)} notMerge onClick={(p: { data: { id?: string } }) => p.data?.id && setSel(p.data.id.split('|')[0])} />
              </Panel>
            </Col>
            <Col xs={24} xl={8}>
              <Panel title="成因路径" bodyStyle={{ maxHeight: Math.max(360, paths.length * 120 + 60) + 16, overflowY: 'auto' }}>
                {paths.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSel(p.id)}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      marginBottom: 10,
                      cursor: 'pointer',
                      border: `1px solid ${cur?.id === p.id ? CATEGORY_COLOR[p.category] : 'var(--line)'}`,
                      background: cur?.id === p.id ? 'var(--primary-soft)' : 'var(--panel-2)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b style={{ fontSize: 14 }}>{p.cause}</b>
                      <SoftTag color={CATEGORY_COLOR[p.category]}>{p.category}</SoftTag>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        置信度
                      </span>
                      <Progress percent={+(p.confidence * 100).toFixed(0)} size="small" strokeColor={CATEGORY_COLOR[p.category]} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {p.evidence.map((e) => (
                        <SoftTag key={e.id} color={SOURCE_COLOR[e.source]} style={{ fontSize: 11 }}>
                          {e.label}
                        </SoftTag>
                      ))}
                    </div>
                    <div className="text-2" style={{ fontSize: 12 }}>
                      建议：{p.suggestion}
                    </div>
                  </div>
                ))}
              </Panel>
            </Col>
            <Col xs={24} xl={9}>
              <Panel title="证据贡献流向">
                <EChart option={sankeyOpt} height={300} notMerge />
              </Panel>
            </Col>
            <Col xs={24} xl={15}>
              <Panel title="证据时序演化" sub={cur?.cause}>
                {evoOpt && <EChart option={evoOpt} height={190} notMerge />}
                <Table
                  size="small"
                  style={{ marginTop: 8 }}
                  rowKey="id"
                  pagination={false}
                  dataSource={cur?.evidence ?? []}
                  columns={[
                    { title: '证据', dataIndex: 'label' },
                    { title: '来源', dataIndex: 'source', width: 80, render: (v: EvidenceSource) => <SoftTag color={SOURCE_COLOR[v]}>{v}</SoftTag> },
                    { title: '观测值', dataIndex: 'value', render: (v) => <span className="num">{v}</span> },
                    { title: '证据强度', dataIndex: 'strength', width: 180, render: (v: number) => <Bar value={v} color={PALETTE.blue} /> },
                    { title: '', dataIndex: 'strength', width: 50, render: (v: number) => <span className="num muted">{fx(v * 100, 0)}</span> },
                  ]}
                />
              </Panel>
            </Col>
          </>
        )}
      </Row>
    </div>
  );
}
