import { AimOutlined } from '@ant-design/icons';
import { Col, Progress, Row, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { area, legendTopRight } from '@/components/chartKit';
import RackElevation from '@/components/RackElevation';
import { MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { quantile } from '@/core/analytics';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { locateHotspots, seriesKey } from '@/core/thermal';
import { LEVEL_LABEL, LEVEL_U, RACKS, SIDE_LABEL, type Level, type Side } from '@/core/topology';
import { PALETTE, useChartTokens } from '@/theme';

const ROWS: { side: Side; level: Level }[] = [
  { side: 'F', level: 'T' },
  { side: 'F', level: 'M' },
  { side: 'F', level: 'B' },
  { side: 'R', level: 'T' },
  { side: 'R', level: 'M' },
  { side: 'R', level: 'B' },
];

export default function Locate() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const tk = useChartTokens();
  const hot = useAnalysis('hotspots', () => locateHotspots(engine.snapshot, h), 5);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = hot.find((x) => x.node.id === selId) ?? hot[0];
  const hotCount = hot.filter((x) => x.score >= 40).length;
  const maxIn = hot.filter((x) => x.node.side === 'F').reduce((a, b) => (b.temp > a.temp ? b : a));
  const maxOut = hot.filter((x) => x.node.side === 'R').reduce((a, b) => (b.temp > a.temp ? b : a));
  const maxZ = hot.reduce((a, b) => (b.spatialZ > a.spatialZ ? b : a));

  const heatOpt = useMemo(() => {
    const racks = RACKS.map((r) => r.id);
    const map = new Map(hot.map((x) => [x.node.id, x]));
    const cell = (side: Side) =>
      ROWS.filter((r) => r.side === side).flatMap((r, yi) =>
        racks.map((id, xi) => {
          const x = map.get(`${id}-${side}-${r.level}`)!;
          return { value: [xi, yi, +x.temp.toFixed(1)], node: x.node.id, score: x.score };
        }),
      );
    const yLabels = (side: Side) => ROWS.filter((r) => r.side === side).map((r) => `${SIDE_LABEL[side]}·${LEVEL_LABEL[r.level]}`);
    const mk = (gi: number, side: Side) => ({
      type: 'heatmap',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: cell(side),
      label: { show: true, fontSize: 10, color: '#fff', formatter: (p: { value: number[] }) => p.value[2].toFixed(1) },
      itemStyle: { borderColor: tk.panel, borderWidth: 2, borderRadius: 4 },
      emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } },
    });
    return {
      tooltip: {
        formatter: (p: { data: { node: string; value: number[]; score: number } }) => `${p.data.node}<br/>温度 ${p.data.value[2]}℃ · 热点评分 ${p.data.score.toFixed(0)}`,
      },
      grid: [
        { left: 64, right: 74, top: 8, height: 108 },
        { left: 64, right: 74, top: 150, height: 108 },
      ],
      xAxis: [0, 1].map((gi) => ({ type: 'category', gridIndex: gi, data: racks, axisLabel: { fontSize: 10, show: gi === 1 }, axisLine: { show: false }, splitArea: { show: false } })),
      yAxis: [0, 1].map((gi) => ({ type: 'category', gridIndex: gi, data: yLabels(gi === 0 ? 'F' : 'R'), axisLabel: { fontSize: 11 }, axisLine: { show: false } })),
      visualMap: [
        { seriesIndex: 0, min: 19, max: 28, right: 0, top: 4, itemHeight: 90, itemWidth: 10, calculable: false, text: ['28℃', '19℃'], textStyle: { fontSize: 10 }, inRange: { color: ['#2F6BFF', '#22C3D6', '#36C690', '#F5D63D', '#FF8A3D', '#FF4D4F'] } },
        { seriesIndex: 1, min: 28, max: 46, right: 0, top: 146, itemHeight: 90, itemWidth: 10, calculable: false, text: ['46℃', '28℃'], textStyle: { fontSize: 10 }, inRange: { color: ['#2F6BFF', '#22C3D6', '#36C690', '#F5D63D', '#FF8A3D', '#FF4D4F'] } },
      ],
      series: [mk(0, 'F'), mk(1, 'R')],
    };
  }, [hot, tk]);

  const trendOpt = useMemo(() => {
    const key = seriesKey(sel.node);
    const all = h.series(key);
    const base = all.slice(0, Math.max(10, all.length - 150));
    const med = quantile(base, 0.5);
    const mad = quantile(base.map((v) => Math.abs(v - med)), 0.5) * 1.4826;
    const t = h.timeline();
    return {
      grid: { left: 40, right: 16, top: 36, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true, name: '℃' },
      series: [
        area('节点温度', h.pairs(key), sel.node.side === 'F' ? PALETTE.cyan : PALETTE.orange),
        {
          name: '基线 ±3σ',
          type: 'line',
          showSymbol: false,
          data: [
            [t[0], med + 3 * mad],
            [t[t.length - 1], med + 3 * mad],
          ],
          lineStyle: { type: 'dashed', color: PALETTE.slate, width: 1 },
          markArea: { silent: true, itemStyle: { color: 'rgba(127,142,163,0.10)' }, data: [[{ yAxis: med - 3 * mad }, { yAxis: med + 3 * mad }]] },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t, sel.node.id]);

  return (
    <div>
      <PageHead
        module="温升识别模块"
        title="节点定位"
        desc="融合绝对裕度、同列空间偏离与自身时间基线偏离对 120 个温度节点评分，并通过竖向插值将热点定位至 U 位"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="温度节点" value={120} unit="个" />
            <MiniStat label="定位热点（评分≥40）" value={hotCount} unit="个" color={hotCount ? PALETTE.orange : PALETTE.green} />
            <MiniStat label={`最高进风 · ${maxIn.node.id}`} value={fx(maxIn.temp, 1)} unit="℃" color={maxIn.temp >= 27 ? PALETTE.red : undefined} />
            <MiniStat label={`最高出风 · ${maxOut.node.id}`} value={fx(maxOut.temp, 1)} unit="℃" color={maxOut.temp >= 45 ? PALETTE.red : undefined} />
            <MiniStat label={`最大空间偏离 · ${maxZ.node.id}`} value={fx(maxZ.spatialZ, 1)} unit="σ" />
          </div>
        </Col>
        <Col xs={24} xl={16}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Panel title="节点温度矩阵" sub="点击节点查看定位详情">
              <EChart
                option={heatOpt}
                height={292}
                onClick={(p: { data: { node: string } }) => p.data?.node && setSelId(p.data.node)}
              />
            </Panel>
            <Panel title="热点定位排行" flush>
              <Table
                size="small"
                rowKey={(r) => r.node.id}
                dataSource={hot.slice(0, 30)}
                pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
                onRow={(r) => ({ onClick: () => setSelId(r.node.id), style: { cursor: 'pointer', background: r.node.id === sel.node.id ? 'var(--primary-soft)' : undefined } })}
                columns={[
                  { title: '#', key: 'i', width: 44, render: (_, __, i) => <span className="num muted">{i + 1}</span> },
                  { title: '节点', key: 'n', render: (_, r) => <b>{r.node.label}</b> },
                  { title: '空间坐标', dataIndex: 'coord', render: (v) => <span className="text-2" style={{ fontSize: 12 }}>{v}</span> },
                  { title: '温度', dataIndex: 'temp', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                  { title: '空间偏离', dataIndex: 'spatialZ', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}σ</span> },
                  { title: '时间偏离', dataIndex: 'temporalZ', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}σ</span> },
                  { title: '温升', dataIndex: 'rise', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                  {
                    title: '评分',
                    dataIndex: 'score',
                    width: 140,
                    render: (v: number) => <Progress percent={+v.toFixed(0)} size="small" strokeColor={v >= 60 ? PALETTE.red : v >= 40 ? PALETTE.orange : PALETTE.blue} />,
                  },
                ]}
              />
            </Panel>
          </Space>
        </Col>
        <Col xs={24} xl={8}>
          <Panel
            title="定位详情"
            sub={sel.node.label}
            extra={<SoftTag color={sel.score >= 60 ? PALETTE.red : sel.score >= 40 ? PALETTE.orange : PALETTE.green}>评分 {sel.score.toFixed(0)}</SoftTag>}
          >
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 236, flex: 'none' }}>
                <RackElevation rackId={sel.node.rack} snap={s} rowH={10} highlight={{ side: sel.node.side, level: sel.node.level, uEst: sel.uEst }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <MiniStat label="当前温度" value={fx(sel.temp, 1)} unit="℃" />
                <MiniStat label="限值裕度" value={fx(sel.margin, 1)} unit="℃" color={sel.margin < 2 ? PALETTE.orange : undefined} />
                <MiniStat label="测点 U 位" value={`U${LEVEL_U[sel.node.level]}`} />
                <MiniStat label="估计热点 U 位" value={`U${sel.uEst.toFixed(0)}`} color={PALETTE.red} />
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AimOutlined style={{ color: PALETTE.red }} />
              <span className="text-2" style={{ fontSize: 13 }}>
                {sel.coord}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {sel.reason === '—' ? (
                <Tag color="success">节点状态正常</Tag>
              ) : (
                sel.reason.split('，').map((r) => (
                  <Tag key={r} color="orange" style={{ marginBottom: 4 }}>
                    {r}
                  </Tag>
                ))
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <EChart option={trendOpt} height={200} />
            </div>
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
