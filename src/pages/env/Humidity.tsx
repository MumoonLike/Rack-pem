import { Col, Row, Segmented, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight, line, thresholdLine } from '@/components/chartKit';
import FloorPlan, { type CellValue } from '@/components/FloorPlan';
import { useRackDrawer } from '@/components/RackDrawer';
import { HeatLegend, MiniStat, PageHead, Panel } from '@/components/ui';
import { blockMean } from '@/core/analytics';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { relHumidity } from '@/core/model';
import { ACUS, COOLING_WEIGHTS, RACKS } from '@/core/topology';
import { HEAT_COLORS, PALETTE, heatColor } from '@/theme';

type View = 'rh' | 'dew' | 'margin';

function envelope() {
  // ASHRAE 推荐区：18~27℃，露点 -9~15℃，RH ≤ 60%
  const upper: number[][] = [];
  const lower: number[][] = [];
  for (let t = 18; t <= 27.001; t += 0.5) {
    upper.push([t, Math.min(60, relHumidity(t, 15))]);
    lower.push([t, relHumidity(t, -9)]);
  }
  return [...upper, ...lower.reverse()];
}

export default function Humidity() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const drawer = useRackDrawer();
  const [view, setView] = useState<View>('rh');

  const rows = s.racks.map((r) => {
    const supply = ACUS.reduce((a, u) => a + COOLING_WEIGHTS[r.id][u.id] * s.acus.find((x) => x.id === u.id)!.supply, 0);
    const margin = supply - r.dew;
    const status = r.rhF >= 60 || r.dew >= 15 ? '偏高' : r.rhF < 20 ? '偏低' : margin < 4 ? '凝露风险' : '合规';
    return { id: r.id, tin: r.tin[1], rhF: r.rhF, rhR: r.rhR, dew: r.dew, tout: r.tout[1], margin, supply, status };
  });
  const compliant = rows.filter((x) => x.status === '合规').length;
  const maxRh = rows.reduce((a, b) => (b.rhF > a.rhF ? b : a));
  const maxDew = rows.reduce((a, b) => (b.dew > a.dew ? b : a));
  const minMargin = rows.reduce((a, b) => (b.margin < a.margin ? b : a));

  const scale = view === 'rh' ? { lo: 30, hi: 65, unit: '%' } : view === 'dew' ? { lo: 5, hi: 16, unit: '℃' } : { lo: 14, hi: 4, unit: '℃' };
  const cell = (id: string): CellValue => {
    const r = rows.find((x) => x.id === id)!;
    const v = view === 'rh' ? r.rhF : view === 'dew' ? r.dew : r.margin;
    return {
      value: view === 'rh' ? `${v.toFixed(1)}%` : `${v.toFixed(1)}℃`,
      sub: view === 'rh' ? `Td ${r.dew.toFixed(1)}℃` : `RH ${r.rhF.toFixed(0)}%`,
      color: view === 'margin' ? heatColor(v, 14, 4) : heatColor(v, scale.lo, scale.hi),
    };
  };

  const psyOpt = useMemo(() => {
    const env = envelope();
    return {
      grid: { left: 46, right: 18, top: 36, bottom: 40 },
      tooltip: { trigger: 'item', formatter: (p: { seriesName: string; data: number[] | { value: number[]; name: string } }) => {
        const d = Array.isArray(p.data) ? { value: p.data, name: '' } : p.data;
        return `${p.seriesName}${d.name ? ` · ${d.name}` : ''}<br/>温度 ${d.value[0].toFixed(1)}℃ · 湿度 ${d.value[1].toFixed(1)}%`;
      } },
      legend: legendTopRight,
      xAxis: { type: 'value', name: '干球温度 ℃', nameLocation: 'middle', nameGap: 26, min: 14, max: 30 },
      yAxis: { type: 'value', name: '相对湿度 %', min: 0, max: 80 },
      series: [
        {
          name: '推荐区',
          type: 'line',
          data: [...env, env[0]],
          showSymbol: false,
          lineStyle: { color: PALETTE.green, width: 1, type: 'dashed' },
          areaStyle: { color: 'rgba(54,198,144,0.10)', origin: 'start' },
          silent: true,
          smooth: false,
        },
        {
          name: '机柜进风',
          type: 'scatter',
          symbolSize: 9,
          data: rows.map((r) => ({ value: [r.tin, r.rhF], name: r.id })),
          itemStyle: { color: PALETTE.blue, borderColor: '#fff', borderWidth: 0.5 },
        },
        {
          name: '空调送风',
          type: 'scatter',
          symbol: 'diamond',
          symbolSize: 12,
          data: s.acus.map((a) => ({ value: [a.supply, a.supplyRh], name: a.id })),
          itemStyle: { color: PALETTE.cyan },
        },
      ],
    };
  }, [rows, s.acus]);

  const trendOpt = useMemo(() => {
    const t = h.timeline();
    const avgRow = (row: string, key: string) => {
      const ids = RACKS.filter((r) => r.row === row).map((r) => r.id);
      const ser = ids.map((id) => h.series(`${id}.${key}`));
      return blockMean(
        t.map((_, i) => ser.reduce((a, x) => a + x[i], 0) / ser.length),
        5,
      );
    };
    const tt = blockMean(t, 5);
    const pair = (v: number[]) => tt.map((x, i) => [x, v[i]]);
    return {
      grid: { left: 42, right: 42, top: 40, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(1) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: '%RH', min: 30, max: 70 },
        { type: 'value', name: '露点 ℃', scale: true, splitLine: { show: false } },
      ],
      series: [
        line('A 列进风湿度', pair(avgRow('A', 'rhF')), PALETTE.blue, { markLine: thresholdLine(60, '上限 60%', PALETTE.red) }),
        line('B 列进风湿度', pair(avgRow('B', 'rhF')), PALETTE.purple),
        line('平均露点', pair(blockMean(h.series('room.dew'), 5)), PALETTE.cyan, { yAxisIndex: 1, lineStyle: { type: 'dashed', width: 1.4 } }),
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t]);

  return (
    <div>
      <PageHead
        module="环境联测模块"
        title="湿度监测"
        desc="机柜前后门温湿度测点实时监测，计算露点与凝露裕度，对照 GB 50174 A 级机房环境要求评估合规性"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
            <MiniStat label="平均进风湿度" value={fx(s.room.rhAvg, 1)} unit="%RH" />
            <MiniStat label={`最高湿度（${maxRh.id}）`} value={fx(maxRh.rhF, 1)} unit="%RH" color={maxRh.rhF >= 60 ? PALETTE.orange : undefined} />
            <MiniStat label="平均露点" value={fx(s.room.dewAvg, 1)} unit="℃" />
            <MiniStat label={`最高露点（${maxDew.id}）`} value={fx(maxDew.dew, 1)} unit="℃" color={maxDew.dew >= 15 ? PALETTE.red : undefined} />
            <MiniStat label={`最小凝露裕度（${minMargin.id}）`} value={fx(minMargin.margin, 1)} unit="℃" />
            <MiniStat label="合规机柜" value={`${compliant}`} unit="/ 20" color={compliant < 20 ? PALETTE.amber : PALETTE.green} />
          </div>
        </Col>
        <Col xs={24} xxl={14}>
          <Panel
            title="湿度分布"
            extra={
              <Space>
                <HeatLegend lo={scale.lo} hi={scale.hi} unit={scale.unit} colors={HEAT_COLORS} />
                <Segmented
                  size="small"
                  value={view}
                  onChange={(v) => setView(v as View)}
                  options={[
                    { label: '相对湿度', value: 'rh' },
                    { label: '露点', value: 'dew' },
                    { label: '凝露裕度', value: 'margin' },
                  ]}
                />
              </Space>
            }
          >
            <FloorPlan snap={s} cell={cell} onSelect={(id) => drawer.open(id)} showAlarms={false} />
            <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
              <MiniStat label="A 列平均湿度" value={fx(rows.filter((r) => r.id.startsWith('A')).reduce((a, r) => a + r.rhF, 0) / 10, 1)} unit="%RH" />
              <MiniStat label="B 列平均湿度" value={fx(rows.filter((r) => r.id.startsWith('B')).reduce((a, r) => a + r.rhF, 0) / 10, 1)} unit="%RH" />
              <MiniStat label="空调回风湿度" value={fx(s.acus.reduce((a, x) => a + x.returnRh, 0) / s.acus.length, 1)} unit="%RH" />
              <MiniStat label="热通道平均湿度" value={fx(rows.reduce((a, r) => a + r.rhR, 0) / rows.length, 1)} unit="%RH" />
            </div>
          </Panel>
        </Col>
        <Col xs={24} lg={12} xxl={10}>
          <Panel title="焓湿工况分布" sub="ASHRAE 推荐区">
            <EChart option={psyOpt} height={392} />
          </Panel>
        </Col>
        <Col xs={24} lg={12} xxl={10}>
          <Panel title="湿度与露点趋势" sub="近 60 分钟">
            <EChart option={trendOpt} height={330} />
          </Panel>
        </Col>
        <Col xs={24} xxl={14}>
          <Panel title="测点明细" flush>
            <Table
              size="small"
              rowKey="id"
              dataSource={rows}
              pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
              onRow={(r) => ({ onClick: () => drawer.open(r.id), style: { cursor: 'pointer' } })}
              columns={[
                { title: '机柜', dataIndex: 'id', render: (v) => <b>{v}</b> },
                { title: '进风温度', dataIndex: 'tin', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                { title: '进风湿度', dataIndex: 'rhF', align: 'right', sorter: (a, b) => a.rhF - b.rhF, render: (v: number) => <span className="num" style={{ color: v >= 60 ? PALETTE.orange : undefined }}>{fx(v, 1)}%</span> },
                { title: '出风湿度', dataIndex: 'rhR', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}%</span> },
                { title: '露点', dataIndex: 'dew', align: 'right', sorter: (a, b) => a.dew - b.dew, render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                { title: '送风温度', dataIndex: 'supply', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                { title: '凝露裕度', dataIndex: 'margin', align: 'right', sorter: (a, b) => a.margin - b.margin, render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                {
                  title: '评估',
                  dataIndex: 'status',
                  render: (v: string) => <Tag color={v === '合规' ? 'success' : v === '凝露风险' ? 'warning' : 'error'}>{v}</Tag>,
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
