import {
  AlertOutlined,
  CloudOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FireOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Col, Empty, Progress, Row, Segmented, Space, Table } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EChart from '@/components/EChart';
import FloorPlan, { type CellValue } from '@/components/FloorPlan';
import { useRackDrawer } from '@/components/RackDrawer';
import { Delta, HeatLegend, Kpi, LevelTag, MiniStat, Panel } from '@/components/ui';
import { identifyPaths } from '@/core/airflow';
import { blockMean, pearson } from '@/core/analytics';
import { buildFusion, rankNodes } from '@/core/anomaly';
import { useAnalysis, useChainGroups } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { allResponses, efficiencyPaths } from '@/core/feedback';
import { fx, tstr } from '@/core/format';
import { SERIES_KEYS } from '@/core/model';
import { locateHotspots, propagation } from '@/core/thermal';
import { RACK_MAP } from '@/core/topology';
import { HEAT_COLORS, PALETTE, heatColor } from '@/theme';
import ModuleHub, { type ModuleCard } from './ModuleHub';

type Metric = 'tin' | 'tout' | 'load' | 'rh';

const METRIC_META: Record<Metric, { label: string; lo: number; hi: number; unit: string }> = {
  tin: { label: '进风温度', lo: 19, hi: 28, unit: '℃' },
  tout: { label: '出风温度', lo: 26, hi: 46, unit: '℃' },
  load: { label: '负载率', lo: 0, hi: 100, unit: '%' },
  rh: { label: '进风湿度', lo: 30, hi: 65, unit: '%' },
};

const COMMISSIONED = dayjs('2025-03-18');

export default function Overview() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const nav = useNavigate();
  const drawer = useRackDrawer();
  const [metric, setMetric] = useState<Metric>('tin');

  const n30 = 900;
  const sparkIt = blockMean(h.series('room.it', n30), 30);
  const sparkPue = blockMean(h.series('room.pue', n30), 30);
  const sparkTin = blockMean(h.series('room.tin', n30), 30);
  const sparkRh = blockMean(h.series('room.rh', n30), 30);
  const sparkCool = blockMean(h.series('room.cool', n30), 30);
  const itHourAgo = h.mean('room.it', h.size - 30, 30);
  const pueHourAgo = h.mean('room.pue', h.size - 30, 30);
  const active = engine.alarms.activeList();
  const lvlCount = [1, 2, 3, 4].map((l) => active.filter((a) => a.level === l).length);

  // 模块状态
  const ranks = useAnalysis('rank', () => rankNodes(h), 5);
  const fusion = useAnalysis('fusion', () => buildFusion(h), 5);
  const hotspots = useAnalysis('hotspots', () => locateHotspots(engine.snapshot, h), 5);
  const air = useAnalysis('airpaths', () => identifyPaths(engine.snapshot, h), 5);
  const prop = useAnalysis('prop', () => propagation(h), 30);
  const resp = useAnalysis('responses', () => allResponses(h), 30);
  const eff = useAnalysis('eff', () => efficiencyPaths(engine.snapshot, h), 5);
  const chains = useChainGroups(false);
  const corr = useAnalysis('ov-corr', () => pearson(blockMean(h.series('room.it'), 15), blockMean(h.series('room.tout'), 15)), 15);

  const online = s.racks.reduce((acc, r) => acc + Number(r.pa.online) + Number(r.pb.online), 0);
  const riseCount = hotspots.filter((x) => x.rise >= 0.55).length;
  const abnormal = ranks.filter((r) => r.level === '异常').length;
  const attention = ranks.filter((r) => r.level === '关注').length;
  const driftCount = ranks.filter((r) => r.jsd >= 0.5).length;
  const anomalyPaths = air.filter((p) => p.type !== '主送风路径').length;
  const feasible = eff.filter((e) => e.feasible);
  const tauMed = resp.slice().sort((a, b) => a.tau - b.tau)[Math.floor(resp.length / 2)]?.tau ?? 0;

  const top: ModuleCard[] = [
    {
      title: '电参采集模块',
      color: PALETTE.blue,
      items: [
        { label: '信号采集', path: '/power/signal', metric: `${online}/40 在线`, status: online < 40 ? 'warn' : 'ok' },
        { label: '波形分析', path: '/power/waveform', metric: `THDu ${fx(s.pdcs[0].thdu, 1)}%`, status: 'ok' },
        { label: '序列生成', path: '/power/sequence', metric: `${h.size} 点/h`, status: 'ok' },
      ],
    },
    {
      title: '环境联测模块',
      color: PALETTE.cyan,
      items: [
        { label: '湿度监测', path: '/env/humidity', metric: `${fx(s.room.rhAvg, 1)}%RH`, status: s.racks.some((r) => r.rhF >= 60) ? 'warn' : 'ok' },
        { label: '关联分析', path: '/env/correlation', metric: `r=${fx(corr, 2)}`, status: 'ok' },
        { label: '路径识别', path: '/env/path', metric: `${anomalyPaths} 条异常`, status: anomalyPaths > 2 ? 'warn' : 'ok' },
      ],
    },
    {
      title: '温升识别模块',
      color: PALETTE.orange,
      items: [
        { label: '节点定位', path: '/thermal/locate', metric: `${hotspots.filter((x) => x.score >= 40).length} 处热点`, status: hotspots[0]?.score >= 60 ? 'alarm' : hotspots[0]?.score >= 40 ? 'warn' : 'ok' },
        { label: '热向分析', path: '/thermal/direction', metric: `${prop.length} 条传播`, status: 'ok' },
        { label: '温升筛选', path: '/thermal/screening', metric: `${riseCount} 节点超阈`, status: riseCount ? 'warn' : 'ok' },
      ],
    },
  ];
  const bottom: ModuleCard[] = [
    {
      title: '异常联判模块',
      color: PALETTE.purple,
      items: [
        { label: '节点排序分析', path: '/anomaly/ranking', metric: `异常 ${abnormal} · 关注 ${attention}`, status: abnormal ? 'alarm' : attention ? 'warn' : 'ok' },
        { label: '分布一致性计算', path: '/anomaly/consistency', metric: `${driftCount} 柜偏移`, status: driftCount ? 'warn' : 'ok' },
        { label: '融合路径构建', path: '/anomaly/fusion', metric: `${fusion.length} 条路径`, status: fusion.length ? 'warn' : 'ok' },
      ],
    },
    {
      title: '结果反馈模块',
      color: PALETTE.green,
      items: [
        { label: '路径链组提取', path: '/feedback/chains', metric: `${chains.groups.length} 个链组`, status: 'ok' },
        { label: '负载响应分析', path: '/feedback/response', metric: `τ 中位 ${tauMed} s`, status: 'ok' },
        { label: '能效路径筛选', path: '/feedback/efficiency', metric: `${feasible.length} 条可行`, status: 'ok' },
      ],
    },
  ];

  const meta = METRIC_META[metric];
  const cell = (id: string): CellValue => {
    const r = s.rackMap[id];
    const def = RACK_MAP[id];
    let v = 0;
    let txt = '';
    let sub = '';
    if (metric === 'tin') {
      v = Math.max(...r.tin);
      txt = `${v.toFixed(1)}℃`;
      sub = `${r.load.toFixed(1)} kW`;
    } else if (metric === 'tout') {
      v = Math.max(...r.tout);
      txt = `${v.toFixed(1)}℃`;
      sub = `ΔT ${(r.tout[1] - r.tin[1]).toFixed(1)}℃`;
    } else if (metric === 'load') {
      v = r.ratio * 100;
      txt = `${v.toFixed(0)}%`;
      sub = `${r.load.toFixed(1)}/${def.ratedKw} kW`;
    } else {
      v = r.rhF;
      txt = `${v.toFixed(1)}%`;
      sub = `露点 ${r.dew.toFixed(1)}℃`;
    }
    return { value: txt, sub, color: heatColor(v, meta.lo, meta.hi), bar: r.ratio };
  };

  const powerOpt = useMemo(() => {
    const n = 1800;
    return {
      grid: { left: 42, right: 46, top: 48, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: 'kW', scale: true, nameGap: 10 },
        { type: 'value', name: 'PUE', scale: true, splitLine: { show: false }, nameGap: 10 },
      ],
      series: [
        { name: 'IT 负载', type: 'line', showSymbol: false, data: h.pairs('room.it', n), areaStyle: { opacity: 0.15 } },
        { name: '制冷功耗', type: 'line', showSymbol: false, data: h.pairs('room.cool', n), areaStyle: { opacity: 0.1 } },
        { name: 'PUE', type: 'line', yAxisIndex: 1, showSymbol: false, data: h.pairs('room.pue', n), lineStyle: { type: 'dashed', width: 1.4 } },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t]);

  const envOpt = useMemo(() => {
    const n = 1800;
    return {
      grid: { left: 42, right: 46, top: 48, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(1) },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: '℃', scale: true, nameGap: 10 },
        { type: 'value', name: '%RH', scale: true, splitLine: { show: false }, nameGap: 10 },
      ],
      series: [
        { name: '平均进风', type: 'line', showSymbol: false, data: h.pairs('room.tin', n), color: PALETTE.cyan },
        {
          name: '最高进风',
          type: 'line',
          showSymbol: false,
          data: h.pairs('room.tinMax', n),
          color: PALETTE.orange,
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: 27 }], lineStyle: { color: PALETTE.red, type: 'dashed' }, label: { formatter: '27℃', color: PALETTE.red, position: 'insideEndTop' } },
        },
        { name: '平均湿度', type: 'line', yAxisIndex: 1, showSymbol: false, data: h.pairs('room.rh', n), color: PALETTE.purple },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t]);

  const uptime = `${dayjs().diff(COMMISSIONED, 'day')} 天`;

  const energyOpt = {
    title: {
      text: s.room.total.toFixed(1),
      subtext: '总功耗 kW',
      left: '33%',
      top: '38%',
      textAlign: 'center',
      itemGap: 4,
      textStyle: { fontSize: 20, fontWeight: 600 },
      subtextStyle: { fontSize: 11 },
    },
    tooltip: { trigger: 'item', valueFormatter: (v: number) => `${v.toFixed(2)} kW` },
    legend: { orient: 'vertical', right: 0, top: 'middle', itemWidth: 10, itemHeight: 10, itemGap: 12 },
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['34%', '50%'],
        itemStyle: { borderColor: 'transparent', borderWidth: 2, borderRadius: 4 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: false },
        data: [
          { name: 'IT 设备', value: s.room.it, itemStyle: { color: PALETTE.blue } },
          { name: '制冷系统', value: s.room.cooling, itemStyle: { color: PALETTE.cyan } },
          { name: 'UPS 损耗', value: s.room.upsLoss, itemStyle: { color: PALETTE.amber } },
          { name: '配电损耗', value: s.room.distLoss, itemStyle: { color: PALETTE.purple } },
          { name: '照明及其他', value: s.room.other, itemStyle: { color: PALETTE.slate } },
        ],
      },
    ],
  };

  return (
    <div>
      <Row gutter={[14, 14]}>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="IT 总负载"
            value={fx(s.room.it, 1)}
            unit="kW"
            icon={<ThunderboltOutlined />}
            color={PALETTE.blue}
            spark={sparkIt}
            foot={
              <>
                较 1h 前 <Delta v={s.room.it - itHourAgo} unit=" kW" />
              </>
            }
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="实时 PUE"
            value={fx(s.room.pue, 3)}
            icon={<DashboardOutlined />}
            color={PALETTE.green}
            spark={sparkPue}
            foot={
              <>
                较 1h 前 <Delta v={s.room.pue - pueHourAgo} d={3} />
              </>
            }
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="平均进风温度"
            value={fx(s.room.tinAvg, 1)}
            unit="℃"
            icon={<FireOutlined />}
            color={PALETTE.orange}
            spark={sparkTin}
            foot={<>最高 <span className="num">{fx(s.room.tinMax, 1)}℃</span></>}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="平均相对湿度"
            value={fx(s.room.rhAvg, 1)}
            unit="%RH"
            icon={<CloudOutlined />}
            color={PALETTE.cyan}
            spark={sparkRh}
            foot={<>平均露点 <span className="num">{fx(s.room.dewAvg, 1)}℃</span></>}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="制冷功耗"
            value={fx(s.room.cooling, 1)}
            unit="kW"
            icon={<ExperimentOutlined />}
            color={PALETTE.purple}
            spark={sparkCool}
            foot={<>平均 COP <span className="num">{fx(s.acus.reduce((a, b) => a + b.cop, 0) / 4, 2)}</span></>}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Kpi
            label="活动告警"
            value={active.length}
            unit="条"
            icon={<AlertOutlined />}
            color={active.some((a) => a.level <= 2) ? PALETTE.red : PALETTE.amber}
            foot={
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {['紧急', '重要', '次要', '提示'].map((l, i) => (
                  <span key={l} style={{ marginRight: 8 }}>
                    {l} <span className="num text-2">{lvlCount[i]}</span>
                  </span>
                ))}
              </span>
            }
          />
        </Col>

        <Col xs={24} xxl={15}>
          <Panel
            title="微模块实时态势"
            sub="点击机柜查看详情"
            extra={
              <Space size={12}>
                <HeatLegend lo={meta.lo} hi={meta.hi} unit={meta.unit} colors={HEAT_COLORS} />
                <Segmented
                  size="small"
                  value={metric}
                  onChange={(v) => setMetric(v as Metric)}
                  options={(Object.keys(METRIC_META) as Metric[]).map((k) => ({ label: METRIC_META[k].label, value: k }))}
                />
              </Space>
            }
          >
            <FloorPlan snap={s} cell={cell} onSelect={(id) => drawer.open(id)} />
            <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))', marginTop: 12 }}>
              <MiniStat label="冷通道平均" value={fx(s.room.tinAvg, 1)} unit="℃" />
              <MiniStat label="热通道平均" value={fx(s.room.toutAvg, 1)} unit="℃" />
              <MiniStat label="供配电损耗" value={fx(s.room.upsLoss + s.room.distLoss, 2)} unit="kW" />
              <MiniStat label="总功耗" value={fx(s.room.total, 1)} unit="kW" />
              <MiniStat label="漏水 / 烟感" value={s.room.leak || s.room.smoke ? '报警' : '正常'} color={PALETTE.green} />
              <MiniStat label="前门 / 后门" value={`${s.room.frontDoor ? '开' : '关'} / ${s.room.rearDoor ? '开' : '关'}`} color={s.room.frontDoor ? PALETTE.amber : undefined} />
            </div>
          </Panel>
        </Col>
        <Col xs={24} xxl={9}>
          <Panel title="一体化运行架构" sub="模块状态实时联动">
            <ModuleHub top={top} bottom={bottom} center={{ points: SERIES_KEYS.length, uptime }} />
          </Panel>
        </Col>

        <Col xs={24} lg={12} xl={8}>
          <Panel title="功率与能效" sub="近 60 分钟">
            <EChart option={powerOpt} height={330} />
          </Panel>
        </Col>
        <Col xs={24} lg={12} xl={8}>
          <Panel title="冷通道温湿度" sub="近 60 分钟">
            <EChart option={envOpt} height={330} />
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Panel title="供配电系统" sub="2N 架构">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {s.ups.map((u) => (
                <div key={u.id} className="mini-stat" style={{ gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{u.id}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {u.mode} · 电池 {u.soc}% · 后备 {u.backupMin.toFixed(0)} min
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <Progress type="dashboard" size={64} percent={+u.loadPct.toFixed(1)} strokeColor={PALETTE.blue} format={(p) => <span className="num" style={{ fontSize: 13 }}>{p}%</span>} />
                    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, fontSize: 12 }}>
                      <div>
                        <div className="muted">输出功率</div>
                        <div className="num" style={{ fontSize: 15 }}>{u.outKw.toFixed(1)} kW</div>
                      </div>
                      <div>
                        <div className="muted">效率</div>
                        <div className="num" style={{ fontSize: 15 }}>{(u.eff * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="muted">输出电压</div>
                        <div className="num" style={{ fontSize: 15 }}>{u.outV[0].toFixed(0)} V</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {s.pdcs.map((p) => (
                  <div key={p.id} className="mini-stat">
                    <span className="l">
                      {p.id} · 三相电流 (A)
                    </span>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      {p.phases.map((ph, i) => (
                        <div key={ph.phase} style={{ flex: 1 }}>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {ph.phase}
                          </div>
                          <div className="num" style={{ fontSize: 15, color: [PALETTE.amber, PALETTE.green, PALETTE.red][i] }}>
                            {ph.i.toFixed(1)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Space>
          </Panel>
        </Col>

        <Col xs={24} xl={9}>
          <Panel
            title="最新告警"
            extra={
              <a onClick={() => nav('/alarms')} style={{ fontSize: 12 }}>
                全部告警
              </a>
            }
          >
            {engine.alarms.log.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              engine.alarms.log.slice(0, 8).map((a) => (
                <div key={a.id} className="list-row">
                  <LevelTag level={a.level} />
                  <span style={{ minWidth: 92 }} className="text-2">
                    {a.target}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
                  <span className="num muted" style={{ fontSize: 12 }}>
                    {tstr(a.start)}
                  </span>
                  <span style={{ width: 52, textAlign: 'right', fontSize: 12, color: a.status === 'active' ? PALETTE.red : 'var(--text-3)' }}>
                    {a.status === 'active' ? '活动' : '已恢复'}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </Col>
        <Col xs={24} md={10} xl={6}>
          <Panel title="能耗构成" sub="实时">
            <EChart option={energyOpt} height={200} />
            <div className="grid-auto" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
              <MiniStat label="制冷占比" value={fx((s.room.cooling / s.room.total) * 100, 1)} unit="%" />
              <MiniStat label="CLF / PLF" value={`${fx(s.room.cooling / s.room.it, 2)} / ${fx((s.room.upsLoss + s.room.distLoss) / s.room.it, 3)}`} />
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={14} xl={9}>
          <Panel title="精密空调运行" flush>
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={s.acus}
              columns={[
                { title: '设备', dataIndex: 'id', render: (v) => <b style={{ whiteSpace: 'nowrap' }}>{v}</b> },
                {
                  title: '送风 / 设定',
                  key: 'sup',
                  render: (_, a) => (
                    <span className="num" style={{ color: a.supply - a.setpoint > 2 ? PALETTE.orange : undefined }}>
                      {a.supply.toFixed(1)} / {a.setpoint.toFixed(1)}℃
                    </span>
                  ),
                },
                { title: '回风', dataIndex: 'ret', render: (v: number) => <span className="num">{v.toFixed(1)}℃</span> },
                { title: '热负荷', dataIndex: 'heat', render: (v: number) => <span className="num">{v.toFixed(1)} kW</span> },
                { title: 'COP', dataIndex: 'cop', render: (v: number) => <span className="num">{v.toFixed(2)}</span> },
                {
                  title: '风机',
                  dataIndex: 'fan',
                  width: 120,
                  render: (v: number) => <Progress percent={+v.toFixed(0)} size="small" strokeColor={v > 88 ? PALETTE.orange : PALETTE.cyan} />,
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
