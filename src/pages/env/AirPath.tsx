import { Col, Progress, Row, Segmented, Table, Tabs } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { airMetrics, identifyPaths, type AirPath, type PathType } from '@/core/airflow';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { ACUS, RACKS } from '@/core/topology';
import { PALETTE, heatColor, useChartTokens } from '@/theme';

const TYPE_COLOR: Record<PathType, string> = {
  主送风路径: PALETTE.cyan,
  热回流路径: PALETTE.red,
  冷旁通路径: PALETTE.purple,
  供冷不足路径: PALETTE.orange,
};

const SX = 74;
const SEGS = [
  { id: 'W', name: '西段', x: 2, slots: [0, 1, 2, 3, 4] },
  { id: 'M', name: '中段', x: 6.5, slots: [5, 6, 7, 8] },
  { id: 'E', name: '东段', x: 10.8, slots: [9, 10, 11, 12] },
];
const segOf = (slot: number) => SEGS.find((s) => s.slots.includes(slot))!;
const Y = { HA: 0, A: 95, CA: 190, B: 285, HB: 380 };

export default function AirPathPage() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const tk = useChartTokens();
  const paths = useAnalysis('airpaths', () => identifyPaths(engine.snapshot, h), 5);
  const metrics = useAnalysis('airmetrics', () => airMetrics(engine.snapshot, h), 5);
  const [filter, setFilter] = useState<'abn' | 'all'>('abn');
  const [focus, setFocus] = useState<string | null>(null);
  const shown = paths.filter((p) => filter === 'all' || p.type !== '主送风路径');
  const focused: AirPath | undefined = paths.find((p) => p.id === focus);

  const option = useMemo(() => {
    const nodes: Record<string, unknown>[] = [];
    const links: Record<string, unknown>[] = [];
    const focusSet = new Set<string>();
    const dim = (ids: string[]) => (focused ? (ids.some((x) => focusSet.has(x)) ? 1 : 0.15) : 1);
    if (focused) {
      focused.racks.forEach((r) => focusSet.add(r));
      if (focused.acu) focusSet.add(focused.acu);
      if (focused.type === '主送风路径' && focused.acu) {
        const a = ACUS.find((x) => x.id === focused.acu)!;
        focusSet.add(`CA-${segOf(a.slot).id}`);
        focusSet.add(`H${a.row}-${segOf(a.slot).id}`);
      }
      if (focused.type === '冷旁通路径' && focused.acu) {
        const a = ACUS.find((x) => x.id === focused.acu)!;
        focusSet.add(`CA-${segOf(a.slot).id}`);
        focusSet.add(`H${a.row}-${segOf(a.slot).id}`);
      }
      if (focused.type === '热回流路径') {
        const r = RACKS.find((x) => x.id === focused.racks[0])!;
        focusSet.add(`H${r.row}-${segOf(r.slot).id}`);
      }
    }
    // 通道节点
    for (const seg of SEGS) {
      for (const [k, y, label, color] of [
        [`HA-${seg.id}`, Y.HA, `热通道 A · ${seg.name}`, PALETTE.orange],
        [`CA-${seg.id}`, Y.CA, `冷通道 · ${seg.name}`, PALETTE.cyan],
        [`HB-${seg.id}`, Y.HB, `热通道 B · ${seg.name}`, PALETTE.orange],
      ] as [string, number, string, string][]) {
        nodes.push({
          id: k,
          name: label,
          x: seg.x * SX,
          y,
          symbol: 'roundRect',
          symbolSize: [seg.slots.length * SX - 20, 20],
          itemStyle: { color: tk.mode === 'dark' ? 'rgba(20,32,54,0.9)' : '#F1F5FA', borderColor: color, borderWidth: 1, borderType: 'dashed', opacity: dim([k]) },
          label: { show: true, color, fontSize: 11 },
        });
      }
    }
    for (const r of RACKS) {
      const rs = s.rackMap[r.id];
      const c = heatColor(rs.tin[2], 19, 28);
      nodes.push({
        id: r.id,
        name: r.id,
        x: r.slot * SX,
        y: r.row === 'A' ? Y.A : Y.B,
        symbol: 'roundRect',
        symbolSize: [56, 34],
        value: rs.tin[2],
        itemStyle: { color: c, opacity: dim([r.id]), shadowBlur: focusSet.has(r.id) ? 16 : 0, shadowColor: c },
        label: { show: true, formatter: `{a|${r.id}}\n{b|${rs.tin[2].toFixed(1)}℃}`, rich: { a: { fontSize: 11, fontWeight: 600, color: '#fff' }, b: { fontSize: 10, color: '#fff' } } },
      });
    }
    for (const a of ACUS) {
      const as = s.acus.find((x) => x.id === a.id)!;
      const warn = as.supply - as.setpoint > 1.2;
      nodes.push({
        id: a.id,
        name: a.id,
        x: a.slot * SX,
        y: a.row === 'A' ? Y.A : Y.B,
        symbol: 'roundRect',
        symbolSize: [60, 34],
        itemStyle: { color: warn ? PALETTE.orange : PALETTE.cyan, opacity: dim([a.id]), shadowBlur: focusSet.has(a.id) ? 16 : 0, shadowColor: PALETTE.cyan },
        label: { show: true, formatter: `{a|${a.id.replace('ACU-', '空调')}}\n{b|${as.supply.toFixed(1)}℃}`, rich: { a: { fontSize: 11, fontWeight: 600, color: '#08131f' }, b: { fontSize: 10, color: '#08131f' } } },
      });
    }

    const base = { lineStyle: { color: tk.axis, width: 1, opacity: focused ? 0.12 : 0.55, curveness: 0 } };
    // 送风：空调 → 冷通道段 → 机柜
    for (const a of ACUS) {
      const segs = SEGS.filter((g) => Math.abs(g.x - a.slot) < 5);
      for (const g of segs) links.push({ source: a.id, target: `CA-${g.id}`, ...base, lineStyle: { ...base.lineStyle, color: PALETTE.cyan } });
    }
    for (const r of RACKS) {
      const g = segOf(r.slot);
      const w = 0.8 + s.rackMap[r.id].load / 4;
      links.push({ source: `CA-${g.id}`, target: r.id, ...base, lineStyle: { ...base.lineStyle, color: PALETTE.cyan, width: w } });
      links.push({ source: r.id, target: `H${r.row}-${g.id}`, ...base, lineStyle: { ...base.lineStyle, color: PALETTE.orange, width: w } });
    }
    for (const a of ACUS) {
      const g = segOf(a.slot);
      links.push({ source: `H${a.row}-${g.id}`, target: a.id, ...base, lineStyle: { ...base.lineStyle, color: PALETTE.orange, type: 'dashed' } });
    }
    // 异常路径
    for (const p of paths) {
      if (p.type === '主送风路径') continue;
      const hl = !focused || focused.id === p.id;
      const op = hl ? 0.95 : 0.1;
      if (p.type === '热回流路径') {
        const r = RACKS.find((x) => x.id === p.racks[0])!;
        links.push({
          source: `H${r.row}-${segOf(r.slot).id}`,
          target: r.id,
          lineStyle: { color: PALETTE.red, width: 2 + p.intensity * 5, curveness: 0.45, opacity: op },
          symbol: ['none', 'arrow'],
          symbolSize: 10,
        });
      } else if (p.type === '冷旁通路径' && p.acu) {
        const a = ACUS.find((x) => x.id === p.acu)!;
        links.push({
          source: `CA-${segOf(a.slot).id}`,
          target: `H${a.row}-${segOf(a.slot).id}`,
          lineStyle: { color: PALETTE.purple, width: 2 + p.intensity * 4, curveness: 0.35, type: 'dashed', opacity: op },
          symbol: ['none', 'arrow'],
          symbolSize: 10,
        });
      } else if (p.type === '供冷不足路径' && p.acu) {
        for (const r of p.racks) {
          links.push({
            source: p.acu,
            target: r,
            lineStyle: { color: PALETTE.orange, width: 1.5 + p.intensity * 3, curveness: 0.25, opacity: op },
            symbol: ['none', 'arrow'],
            symbolSize: 8,
          });
        }
      }
    }
    return {
      tooltip: {
        formatter: (p: { dataType: string; data: { name?: string; value?: number; source?: string; target?: string } }) =>
          p.dataType === 'node' ? `${p.data.name}${p.data.value ? ` · 进风·上 ${p.data.value.toFixed(1)}℃` : ''}` : `${p.data.source} → ${p.data.target}`,
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          roam: true,
          data: nodes,
          links,
          edgeSymbol: ['none', 'none'],
          nodeScaleRatio: 0,
          lineStyle: { opacity: 0.6 },
          emphasis: { disabled: true },
          animation: false,
          left: 40,
          right: 40,
          top: 20,
          bottom: 20,
        },
      ],
    };
  }, [s, paths, focused, tk]);

  const counts = (t: PathType) => paths.filter((p) => p.type === t).length;

  return (
    <div>
      <PageHead
        module="环境联测模块"
        title="路径识别"
        desc="依据送回风温度场与测点时序相关性，识别主送风路径及热回流、冷旁通、供冷不足等异常气流路径"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="主送风路径" value={counts('主送风路径')} unit="条" color={PALETTE.cyan} />
            <MiniStat label="热回流路径" value={counts('热回流路径')} unit="条" color={counts('热回流路径') ? PALETTE.red : undefined} />
            <MiniStat label="冷旁通路径" value={counts('冷旁通路径')} unit="条" color={counts('冷旁通路径') ? PALETTE.purple : undefined} />
            <MiniStat label="供冷不足路径" value={counts('供冷不足路径')} unit="条" color={counts('供冷不足路径') ? PALETTE.orange : undefined} />
            <MiniStat label="平均回流指数" value={fx((metrics.racks.reduce((a, r) => a + r.rci, 0) / metrics.racks.length) * 100, 1)} unit="%" />
          </div>
        </Col>
        <Col xs={24} xl={16}>
          <Panel
            title="气流路径拓扑"
            sub={focused ? `聚焦：${focused.chain[0]} ➜ ${focused.chain[focused.chain.length - 1]}` : '支持拖拽缩放'}
            extra={
              <div style={{ display: 'flex', gap: 12, fontSize: 12 }} className="muted">
                {(Object.keys(TYPE_COLOR) as PathType[]).map((t) => (
                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 14, height: 3, background: TYPE_COLOR[t], borderRadius: 2 }} />
                    {t.replace('路径', '')}
                  </span>
                ))}
              </div>
            }
          >
            <EChart option={option} height={470} notMerge />
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Panel
            title="识别结果"
            extra={
              <Segmented
                size="small"
                value={filter}
                onChange={(v) => setFilter(v as 'abn' | 'all')}
                options={[
                  { label: '异常路径', value: 'abn' },
                  { label: '全部', value: 'all' },
                ]}
              />
            }
            bodyStyle={{ maxHeight: 488, overflowY: 'auto' }}
          >
            {shown.map((p) => (
              <div
                key={p.id}
                onClick={() => setFocus(focus === p.id ? null : p.id)}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  marginBottom: 8,
                  cursor: 'pointer',
                  border: `1px solid ${focus === p.id ? TYPE_COLOR[p.type] : 'var(--line)'}`,
                  background: focus === p.id ? 'var(--primary-soft)' : 'var(--panel-2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <SoftTag color={TYPE_COLOR[p.type]}>{p.type}</SoftTag>
                  <span className="muted" style={{ fontSize: 12 }}>
                    置信度 <span className="num text-2">{fx(p.confidence * 100, 0)}%</span>
                  </span>
                </div>
                <div style={{ fontSize: 12.5, marginBottom: 6 }}>{p.metric}</div>
                <Progress percent={+(p.intensity * 100).toFixed(0)} size="small" showInfo={false} strokeColor={TYPE_COLOR[p.type]} />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {p.chain.join(' ➜ ')}
                </div>
              </div>
            ))}
          </Panel>
        </Col>
        <Col span={24}>
          <Panel title="气流指标明细">
            <Tabs
              items={[
                {
                  key: 'rack',
                  label: '机柜进风',
                  children: (
                    <Table
                      size="small"
                      rowKey="rack"
                      pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                      dataSource={metrics.racks.slice().sort((a, b) => b.rci - a.rci)}
                      columns={[
                        { title: '机柜', dataIndex: 'rack', render: (v) => <b>{v}</b> },
                        { title: '混合送风温度', dataIndex: 'supplyMix', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)}℃</span> },
                        {
                          title: '回流指数 RCI',
                          dataIndex: 'rci',
                          width: 220,
                          render: (v: number) => (
                            <Progress percent={+(v * 100).toFixed(1)} size="small" strokeColor={v > 0.2 ? PALETTE.red : v > 0.12 ? PALETTE.orange : PALETTE.green} format={(p) => `${p}%`} />
                          ),
                        },
                        { title: '进风上下温差', dataIndex: 'strat', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)}℃</span> },
                        { title: '进风·上 / 出风·上 相关性', dataIndex: 'corr', align: 'right', render: (v: number) => <span className="num">{fx(v, 3)}</span> },
                        { title: '进风偏移（较基线）', dataIndex: 'supplyDev', align: 'right', render: (v: number) => <span className="num" style={{ color: v > 0.8 ? PALETTE.orange : undefined }}>{v > 0 ? '+' : ''}{fx(v, 2)}℃</span> },
                      ]}
                    />
                  ),
                },
                {
                  key: 'acu',
                  label: '空调回风',
                  children: (
                    <Table
                      size="small"
                      rowKey="acu"
                      pagination={false}
                      dataSource={metrics.acus}
                      columns={[
                        { title: '空调', dataIndex: 'acu', render: (v) => <b>{v}</b> },
                        { title: '区域柜后排风', dataIndex: 'exhaust', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)}℃</span> },
                        { title: '回风温度', key: 'ret', align: 'right', render: (_, r) => <span className="num">{fx(s.acus.find((a) => a.id === r.acu)!.ret, 2)}℃</span> },
                        {
                          title: '旁通率',
                          dataIndex: 'bypass',
                          width: 220,
                          render: (v: number) => <Progress percent={+(v * 100).toFixed(1)} size="small" strokeColor={v > 0.15 ? PALETTE.purple : PALETTE.green} format={(p) => `${p}%`} />,
                        },
                        { title: '送风偏离', dataIndex: 'supplyDev', align: 'right', render: (v: number) => <span className="num" style={{ color: v > 1.2 ? PALETTE.orange : undefined }}>{v > 0 ? '+' : ''}{fx(v, 2)}℃</span> },
                        { title: '承担热负荷', dataIndex: 'heat', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)} kW</span> },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}

