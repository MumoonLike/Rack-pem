import { Col, Row, Segmented, Select, Space, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { blockMean, crossCorrelation, linreg, pearson } from '@/core/analytics';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { ACUS, COOLING_WEIGHTS, RACKS } from '@/core/topology';
import { PALETTE, useChartTokens } from '@/theme';

interface Var {
  key: string;
  label: string;
  unit: string;
}

const ROOM_VARS: Var[] = [
  { key: 'room.it', label: 'IT 负载', unit: 'kW' },
  { key: 'room.cool', label: '制冷功耗', unit: 'kW' },
  { key: 'room.pue', label: 'PUE', unit: '' },
  { key: 'room.tin', label: '平均进风', unit: '℃' },
  { key: 'room.tinMax', label: '最高进风', unit: '℃' },
  { key: 'room.tout', label: '平均出风', unit: '℃' },
  { key: 'room.rh', label: '平均湿度', unit: '%' },
  { key: 'room.dew', label: '平均露点', unit: '℃' },
  { key: 'ACU-A2.sup', label: 'A2 送风', unit: '℃' },
  { key: 'ACU-A2.fan', label: 'A2 风机', unit: '%' },
];

function rackVars(id: string): Var[] {
  const acu = ACUS.slice().sort((a, b) => COOLING_WEIGHTS[id][b.id] - COOLING_WEIGHTS[id][a.id])[0].id;
  return [
    { key: `${id}.load`, label: 'IT 负载', unit: 'kW' },
    { key: `${id}.ia`, label: 'A 路电流', unit: 'A' },
    { key: `${id}.thdi`, label: '电流谐波', unit: '%' },
    { key: `${id}.F-T`, label: '进风·上', unit: '℃' },
    { key: `${id}.F-B`, label: '进风·下', unit: '℃' },
    { key: `${id}.R-T`, label: '出风·上', unit: '℃' },
    { key: `${id}.rhF`, label: '进风湿度', unit: '%' },
    { key: `${id}.dew`, label: '露点', unit: '℃' },
    { key: `${acu}.sup`, label: `${acu.slice(4)} 送风`, unit: '℃' },
    { key: `${acu}.fan`, label: `${acu.slice(4)} 风机`, unit: '%' },
  ];
}

const BLOCK = 15; // 30 s

function describe(r: number) {
  const a = Math.abs(r);
  const s = a >= 0.8 ? '强' : a >= 0.5 ? '中等' : a >= 0.3 ? '弱' : '无明显';
  return `${s}${a >= 0.3 ? (r > 0 ? '正' : '负') : ''}相关`;
}

export default function Correlation() {
  useTelemetry();
  const h = engine.history;
  const tk = useChartTokens();
  const [scope, setScope] = useState<'room' | 'rack'>('room');
  const [rack, setRack] = useState('A06');
  const vars = scope === 'room' ? ROOM_VARS : rackVars(rack);
  const [pair, setPair] = useState<[number, number]>([0, 5]);

  const data = useAnalysis(
    `corr:${scope}:${rack}`,
    () => {
      const series = vars.map((v) => blockMean(h.series(v.key), BLOCK));
      const m = vars.map((_, i) => vars.map((__, j) => (i === j ? 1 : pearson(series[i], series[j]))));
      return { series, m, t: blockMean(h.timeline(), BLOCK) };
    },
    5,
  );

  const [i, j] = pair;
  const x = data.series[i] ?? [];
  const y = data.series[j] ?? [];
  const reg = linreg(x, y);
  const cc = crossCorrelation(x, y, 10);
  const best = cc.reduce((b, c) => (Math.abs(c.r) > Math.abs(b.r) ? c : b), cc[0]);

  const heatOpt = useMemo(
    () => ({
      grid: { left: 76, right: 20, top: 10, bottom: 76 },
      tooltip: {
        formatter: (p: { data: number[] }) => `${vars[p.data[1]].label} × ${vars[p.data[0]].label}<br/>r = ${p.data[2].toFixed(3)}`,
      },
      xAxis: { type: 'category', data: vars.map((v) => v.label), axisLabel: { rotate: 40, fontSize: 11 }, splitArea: { show: false } },
      yAxis: { type: 'category', data: vars.map((v) => v.label), axisLabel: { fontSize: 11 } },
      visualMap: {
        min: -1,
        max: 1,
        calculable: false,
        show: false,
        inRange: { color: ['#2F6BFF', '#6F9BF2', tk.mode === 'dark' ? '#26314A' : '#EEF2F8', '#F29A6B', '#FF4D4F'] },
      },
      series: [
        {
          type: 'heatmap',
          data: data.m.flatMap((row, a) => row.map((v, b) => [b, a, v])),
          label: { show: true, fontSize: 10, formatter: (p: { data: number[] }) => p.data[2].toFixed(2), color: tk.text },
          itemStyle: { borderColor: 'rgba(0,0,0,0.25)', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } },
        },
      ],
    }),
    [data, vars, tk],
  );

  const scatterOpt = useMemo(() => {
    const [lo, hi] = [Math.min(...x), Math.max(...x)];
    return {
      grid: { left: 52, right: 20, top: 30, bottom: 44 },
      tooltip: { trigger: 'item', formatter: (p: { data: number[] }) => `${vars[i].label} ${p.data[0]?.toFixed(2)}<br/>${vars[j].label} ${p.data[1]?.toFixed(2)}` },
      xAxis: { type: 'value', scale: true, name: `${vars[i].label} ${vars[i].unit}`, nameLocation: 'middle', nameGap: 28 },
      yAxis: { type: 'value', scale: true, name: `${vars[j].label} ${vars[j].unit}` },
      series: [
        {
          type: 'scatter',
          symbolSize: 6,
          data: x.map((v, k) => [v, y[k]]),
          itemStyle: { color: PALETTE.blue, opacity: 0.75 },
        },
        {
          type: 'line',
          showSymbol: false,
          data: [
            [lo, reg.intercept + reg.slope * lo],
            [hi, reg.intercept + reg.slope * hi],
          ],
          lineStyle: { color: PALETTE.orange, width: 2 },
          tooltip: { show: false },
        },
      ],
    };
  }, [x, y, reg, vars, i, j]);

  const ccOpt = useMemo(
    () => ({
      grid: { left: 44, right: 16, top: 24, bottom: 36 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(3) },
      xAxis: { type: 'category', data: cc.map((c) => `${(c.lag * BLOCK * 2) / 60}`), name: 'min', nameGap: 4 },
      yAxis: { type: 'value', min: -1, max: 1 },
      series: [
        {
          type: 'bar',
          data: cc.map((c) => ({ value: c.r, itemStyle: { color: c.lag === best.lag ? PALETTE.orange : c.r >= 0 ? PALETTE.blue : PALETTE.purple, borderRadius: 2 } })),
          barWidth: '60%',
        },
      ],
    }),
    [cc, best],
  );

  // 强相关对
  const pairs: { a: number; b: number; r: number }[] = [];
  for (let a = 0; a < vars.length; a++) for (let b = a + 1; b < vars.length; b++) pairs.push({ a, b, r: data.m[a][b] });
  const top = pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r)).slice(0, 6);

  return (
    <div>
      <PageHead
        module="环境联测模块"
        title="关联分析"
        desc="对电参、温度、湿度与制冷参数进行 Pearson 相关与时滞互相关分析，揭示负载—热量—环境之间的耦合关系"
        extra={
          <Space>
            <Segmented
              value={scope}
              onChange={(v) => {
                setScope(v as 'room' | 'rack');
                setPair([0, 5]);
              }}
              options={[
                { label: '机房级', value: 'room' },
                { label: '机柜级', value: 'rack' },
              ]}
            />
            {scope === 'rack' && <Select value={rack} onChange={setRack} style={{ width: 100 }} options={RACKS.map((r) => ({ value: r.id, label: r.id }))} />}
          </Space>
        }
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} xl={11}>
          <Panel title="相关系数矩阵" sub="点击单元格查看变量对" extra={<span className="muted" style={{ fontSize: 12 }}>窗口 60 min · 30 s 均值</span>}>
            <EChart
              option={heatOpt}
              height={640}
              onClick={(p: { data: number[] }) => {
                if (p.data[0] !== p.data[1]) setPair([p.data[0], p.data[1]]);
              }}
            />
          </Panel>
        </Col>
        <Col xs={24} xl={13}>
          <Row gutter={[14, 14]}>
            <Col span={24}>
              <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
                <MiniStat label="变量对" value={`${vars[i].label} × ${vars[j].label}`} style={{ gridColumn: 'span 1' }} />
                <MiniStat label="Pearson r" value={fx(data.m[i][j], 3)} color={Math.abs(data.m[i][j]) > 0.8 ? PALETTE.orange : undefined} />
                <MiniStat label="线性斜率" value={fx(reg.slope, 3)} unit={vars[j].unit && vars[i].unit ? `${vars[j].unit}/${vars[i].unit}` : ''} />
                <MiniStat label="最优时滞" value={fx((best.lag * BLOCK * 2) / 60, 1)} unit={`min · r=${fx(best.r, 2)}`} />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <Panel title="散点与回归" sub={`R² = ${fx(reg.r2, 3)}`}>
                <EChart option={scatterOpt} height={250} />
              </Panel>
            </Col>
            <Col xs={24} md={12}>
              <Panel title="时滞互相关" sub="正值表示后者滞后">
                <EChart option={ccOpt} height={250} />
              </Panel>
            </Col>
            <Col span={24}>
              <Panel title="关联发现">
                {top.map((p) => {
                  const cl = crossCorrelation(data.series[p.a], data.series[p.b], 10);
                  const bl = cl.reduce((b, c) => (Math.abs(c.r) > Math.abs(b.r) ? c : b), cl[0]);
                  const lagMin = (bl.lag * BLOCK * 2) / 60;
                  return (
                    <div key={`${p.a}-${p.b}`} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setPair([p.a, p.b])}>
                      <SoftTag color={p.r > 0 ? PALETTE.orange : PALETTE.blue}>{fx(p.r, 2)}</SoftTag>
                      <span style={{ flex: 1 }}>
                        <b>{vars[p.a].label}</b> 与 <b>{vars[p.b].label}</b> 呈{describe(p.r)}
                        {lagMin !== 0 && (
                          <span className="muted">
                            ，{lagMin > 0 ? vars[p.b].label : vars[p.a].label} 滞后约 {Math.abs(lagMin).toFixed(1)} min
                          </span>
                        )}
                      </span>
                      {i === p.a && j === p.b && <Tag color="blue">当前</Tag>}
                    </div>
                  );
                })}
              </Panel>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
}
