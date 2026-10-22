import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Col, Input, Row, Segmented, Select, Space, Table, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { area, legendTopRight, line } from '@/components/chartKit';
import { useRackDrawer } from '@/components/RackDrawer';
import { Bar, Dot, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { engine, TICK_MS, useTelemetry } from '@/core/engine';
import { fx, tstr } from '@/core/format';
import { pduOffline, type ChannelSample } from '@/core/model';
import { hash } from '@/core/noise';
import { RACKS } from '@/core/topology';
import { PALETTE } from '@/theme';

const GATEWAYS = [
  { id: 'GW-01', name: 'PDU 采集网关', proto: 'Modbus-TCP', points: 40, period: 2, seed: 11 },
  { id: 'GW-02', name: '列头柜多回路电表', proto: 'Modbus-RTU · RS485', points: 6, period: 2, seed: 12 },
  { id: 'GW-03', name: 'UPS 监控卡', proto: 'SNMP v2c', points: 2, period: 2, seed: 13 },
  { id: 'GW-04', name: '精密空调控制器', proto: 'Modbus-RTU · RS485', points: 4, period: 2, seed: 14 },
  { id: 'GW-05', name: '温湿度传感总线', proto: 'Modbus-RTU · RS485', points: 160, period: 2, seed: 15 },
];

type StatusFilter = 'all' | 'online' | 'over' | 'offline';

export default function Signal() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const drawer = useRackDrawer();
  const [kw, setKw] = useState('');
  const [row, setRow] = useState<'all' | 'A' | 'B'>('all');
  const [path, setPath] = useState<'all' | 'A' | 'B'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sel, setSel] = useState('A06-PDU-A');

  const channels: ChannelSample[] = s.racks.flatMap((r) => [r.pa, r.pb]);
  const online = channels.filter((c) => c.online).length;
  const maxLoad = channels.reduce((m, c) => Math.max(m, c.i / c.breakerA), 0);

  // 近 1 小时数据完整率
  const completeness = useMemo(() => {
    const t = h.timeline();
    let miss = 0;
    for (let i = 0; i < t.length; i += 1) {
      for (const r of RACKS) {
        if (r.id !== 'B09') continue;
        if (pduOffline(r.id, 'B', t[i] / 1000)) miss += 1;
      }
    }
    return 1 - miss / (t.length * 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(s.t / 60000)]);

  const data = channels.filter((c) => {
    if (kw && !c.id.toLowerCase().includes(kw.toLowerCase())) return false;
    if (row !== 'all' && !c.rack.startsWith(row)) return false;
    if (path !== 'all' && c.path !== path) return false;
    if (status === 'online' && !c.online) return false;
    if (status === 'offline' && c.online) return false;
    if (status === 'over' && c.i / c.breakerA < 0.8) return false;
    return true;
  });

  const selRack = sel.slice(0, 3);
  const selPath = sel.endsWith('A') ? 'a' : 'b';
  const selCh = channels.find((c) => c.id === sel)!;

  const chartOpt = useMemo(() => {
    const n = 300;
    return {
      grid: { left: 44, right: 44, top: 40, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: 'A', scale: true },
        { type: 'value', name: 'V', scale: true, splitLine: { show: false } },
      ],
      series: [
        area('电流', h.pairs(`${selRack}.i${selPath}`, n), PALETTE.blue),
        line('电压', h.pairs(`${selRack}.v${selPath}`, n), PALETTE.amber, { yAxisIndex: 1 }),
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t, sel]);

  const tick = Math.floor(s.t / TICK_MS);

  return (
    <div>
      <PageHead
        module="电参采集模块"
        title="信号采集"
        desc="多协议采集网关接入 PDU、列头柜、UPS 电参信号，按 2 s 周期轮询，实时完成量程校验、越限标识与通讯状态诊断"
        extra={
          <Space>
            <SoftTag color={PALETTE.green}>
              <Dot color={PALETTE.green} pulse /> 轮询中
            </SoftTag>
            <span className="muted" style={{ fontSize: 12 }}>
              最近采集 <span className="num">{tstr(s.t)}</span>
            </span>
          </Space>
        }
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
            <MiniStat label="PDU 采集通道" value={40} unit="路" />
            <MiniStat label="在线通道" value={online} unit={`/ 40`} color={online < 40 ? PALETTE.amber : PALETTE.green} />
            <MiniStat label="本小时采样" value={(h.size * 40).toLocaleString()} unit="点" />
            <MiniStat label="数据完整率" value={fx(completeness * 100, 2)} unit="%" />
            <MiniStat label="最大电流负载率" value={fx(maxLoad * 100, 1)} unit="%" color={maxLoad > 0.8 ? PALETTE.red : undefined} />
            <MiniStat label="系统频率" value={fx(s.pdcs[0].f, 3)} unit="Hz" />
          </div>
        </Col>
        <Col xs={24} xl={16}>
          <Panel
            title="采集通道实时值"
            sub={`${data.length} 路`}
            extra={
              <Space wrap>
                <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="通道编号" style={{ width: 140 }} value={kw} onChange={(e) => setKw(e.target.value)} />
                <Select size="small" value={row} onChange={setRow} style={{ width: 92 }} options={[{ value: 'all', label: '全部列' }, { value: 'A', label: 'A 列' }, { value: 'B', label: 'B 列' }]} />
                <Select size="small" value={path} onChange={setPath} style={{ width: 92 }} options={[{ value: 'all', label: '全部路' }, { value: 'A', label: 'A 路' }, { value: 'B', label: 'B 路' }]} />
                <Segmented
                  size="small"
                  value={status}
                  onChange={(v) => setStatus(v as StatusFilter)}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '在线', value: 'online' },
                    { label: '越限', value: 'over' },
                    { label: '中断', value: 'offline' },
                  ]}
                />
              </Space>
            }
            flush
          >
            <Table
              size="small"
              rowKey="id"
              dataSource={data}
              pagination={{ pageSize: 12, size: 'small', showSizeChanger: false }}
              onRow={(r) => ({ onClick: () => setSel(r.id), style: { cursor: 'pointer', background: r.id === sel ? 'var(--primary-soft)' : undefined } })}
              columns={[
                {
                  title: '通道',
                  dataIndex: 'id',
                  render: (v: string, r) => (
                    <a
                      onClick={(e) => {
                        e.stopPropagation();
                        drawer.open(r.rack);
                      }}
                    >
                      {v}
                    </a>
                  ),
                },
                { title: '相', dataIndex: 'phase', width: 50 },
                { title: '电压 V', dataIndex: 'v', align: 'right', render: (v: number, r) => <span className="num">{r.online ? fx(v, 1) : '--'}</span> },
                { title: '电流 A', dataIndex: 'i', align: 'right', sorter: (a, b) => a.i - b.i, render: (v: number, r) => <span className="num">{r.online ? fx(v, 2) : '--'}</span> },
                { title: '有功 kW', dataIndex: 'p', align: 'right', sorter: (a, b) => a.p - b.p, render: (v: number, r) => <span className="num">{r.online ? fx(v, 2) : '--'}</span> },
                { title: '视在 kVA', dataIndex: 's', align: 'right', render: (v: number, r) => <span className="num">{r.online ? fx(v, 2) : '--'}</span> },
                { title: 'PF', dataIndex: 'pf', align: 'right', render: (v: number, r) => <span className="num">{r.online ? fx(v, 3) : '--'}</span> },
                { title: 'THDi %', dataIndex: 'thdi', align: 'right', render: (v: number, r) => <span className="num">{r.online ? fx(v, 1) : '--'}</span> },
                {
                  title: '电流负载率',
                  key: 'ratio',
                  width: 130,
                  sorter: (a, b) => a.i / a.breakerA - b.i / b.breakerA,
                  render: (_, r) => {
                    const v = r.i / r.breakerA;
                    return (
                      <Tooltip title={`${fx(v * 100, 1)}% · 额定 ${r.breakerA} A`}>
                        <div>
                          <Bar value={r.online ? v : 0} color={v > 0.8 ? PALETTE.red : v > 0.6 ? PALETTE.amber : PALETTE.blue} />
                        </div>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: '状态',
                  key: 'st',
                  width: 76,
                  render: (_, r) =>
                    !r.online ? <Tag color="error">中断</Tag> : r.i / r.breakerA >= 0.8 ? <Tag color="warning">越限</Tag> : <Tag color="success">正常</Tag>,
                },
              ]}
            />
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Panel title="通道实时曲线" sub={sel} extra={<SoftTag color={selCh.online ? PALETTE.green : PALETTE.red}>{selCh.online ? '在线' : '中断'}</SoftTag>}>
              <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 8 }}>
                <MiniStat label="电流" value={fx(selCh.i, 2)} unit="A" />
                <MiniStat label="电压" value={fx(selCh.v, 1)} unit="V" />
                <MiniStat label="有功" value={fx(selCh.p, 2)} unit="kW" />
              </div>
              <EChart option={chartOpt} height={210} />
            </Panel>
            <Panel
              title="采集网关"
              extra={
                <Button size="small" type="text" icon={<ReloadOutlined />}>
                  巡检
                </Button>
              }
            >
              {GATEWAYS.map((g) => {
                const lat = 6 + hash(g.seed, tick) * 18 + (g.proto.includes('SNMP') ? 20 : 0);
                const ok = g.id === 'GW-01' ? online === 40 : true;
                return (
                  <div key={g.id} className="list-row">
                    <Dot color={ok ? PALETTE.green : PALETTE.amber} pulse={!ok} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>
                        {g.id} · {g.name}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {g.proto} · {g.points} 点 · {g.period} s
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="num" style={{ fontSize: 13 }}>
                        {lat.toFixed(0)} ms
                      </div>
                      <div className="muted num" style={{ fontSize: 11 }}>
                        {ok ? '99.98%' : '97.50%'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Panel>
          </Space>
        </Col>
        {s.pdcs.map((p) => (
          <Col xs={24} lg={12} key={p.id}>
            <Panel title={`${p.id} 列头柜进线`} sub={`${p.path} 路 · ${s.ups[p.path === 'A' ? 0 : 1].id} 供电`} extra={<span className="muted num" style={{ fontSize: 12 }}>不平衡度 {fx(p.unbalance, 1)}%</span>}>
              <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {p.phases.map((ph, i) => (
                  <div key={ph.phase} className="mini-stat" style={{ borderTop: `2px solid ${[PALETTE.amber, PALETTE.green, PALETTE.red][i]}` }}>
                    <span className="l">{ph.phase} 相</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="v num">
                        {fx(ph.i, 1)}
                        <small>A</small>
                      </span>
                      <span className="num text-2">{fx(ph.v, 1)} V</span>
                    </div>
                    <div className="muted num" style={{ fontSize: 12 }}>
                      {fx(ph.p, 2)} kW · PF {fx(ph.pf, 3)}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </Col>
        ))}
      </Row>
    </div>
  );
}
