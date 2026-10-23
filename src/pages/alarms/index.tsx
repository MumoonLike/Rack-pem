import { CheckOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, Col, Descriptions, Drawer, Grid, Input, Row, Segmented, Select, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { LevelTag, MiniStat, PageHead, Panel } from '@/components/ui';
import { LEVEL_META, type Alarm, type AlarmCategory, type AlarmLevel } from '@/core/alarms';
import { engine, useTelemetry } from '@/core/engine';
import { dur, fx, tstr } from '@/core/format';
import { PALETTE, hexA } from '@/theme';

const CATS: AlarmCategory[] = ['电参', '环境', '温升', '设备', '安防'];

function alarmSeries(a: Alarm): { key: string; unit: string } | null {
  if (a.key.startsWith('load:')) return { key: `${a.target}.load`, unit: 'kW' };
  if (a.key.startsWith('cur:')) return { key: `${a.rack}.${a.target.endsWith('A') ? 'ia' : 'ib'}`, unit: 'A' };
  if (/^(tin|tout|rise):/.test(a.key)) return { key: `${a.target.slice(0, 3)}.${a.target.slice(4)}`, unit: '℃' };
  if (a.key.startsWith('rh:')) return { key: `${a.rack}.rhF`, unit: '%RH' };
  if (a.key.startsWith('dew:')) return { key: `${a.rack}.dew`, unit: '℃' };
  if (a.key.startsWith('sup:')) return { key: `${a.target}.sup`, unit: '℃' };
  return null;
}

export default function Alarms() {
  useTelemetry();
  const { message } = App.useApp();
  const now = engine.snapshot.t;
  const log = engine.alarms.log;
  const [status, setStatus] = useState<'active' | 'recovered' | 'all'>('all');
  const [levels, setLevels] = useState<AlarmLevel[]>([]);
  const [cats, setCats] = useState<AlarmCategory[]>([]);
  const [kw, setKw] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Alarm | null>(null);
  const screens = Grid.useBreakpoint();

  const data = log.filter(
    (a) =>
      (status === 'all' || a.status === status) &&
      (!levels.length || levels.includes(a.level)) &&
      (!cats.length || cats.includes(a.category)) &&
      (!kw || `${a.target}${a.title}${a.id}`.toLowerCase().includes(kw.toLowerCase())),
  );
  const active = log.filter((a) => a.status === 'active');
  const unacked = active.filter((a) => !a.ackTime);
  const rec = log.filter((a) => a.status === 'recovered' && a.end);
  const mttr = rec.length ? rec.reduce((s, a) => s + (a.end! - a.start), 0) / rec.length : 0;

  const ack = (ids: string[]) => {
    engine.alarms.ack(ids);
    engine.touch();
    setSelected([]);
    message.success(`已确认 ${ids.length} 条告警`);
  };

  const trendOpt = useMemo(() => {
    const bucket = 5 * 60_000;
    const end = Math.ceil(now / bucket) * bucket;
    const start = end - 12 * bucket;
    const xs = Array.from({ length: 12 }, (_, i) => start + i * bucket);
    return {
      grid: { left: 36, right: 12, top: 40, bottom: 24 },
      legend: legendTopRight,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: xs.map((x) => tstr(x, 'HH:mm')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: ([1, 2, 3, 4] as AlarmLevel[]).map((l) => ({
        name: LEVEL_META[l].label,
        type: 'bar',
        stack: 'n',
        barWidth: '55%',
        color: LEVEL_META[l].color,
        data: xs.map((x) => log.filter((a) => a.level === l && a.start >= x && a.start < x + bucket).length),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(now / 10000), log.length]);

  const catOpt = useMemo(
    () => ({
      grid: { left: 40, right: 16, top: 28, bottom: 24 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: CATS },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          type: 'bar',
          barWidth: '45%',
          data: CATS.map((c, i) => ({
            value: log.filter((a) => a.category === c).length,
            itemStyle: { color: [PALETTE.blue, PALETTE.cyan, PALETTE.orange, PALETTE.purple, PALETTE.slate][i], borderRadius: [4, 4, 0, 0] },
          })),
          label: { show: true, position: 'top', fontSize: 11 },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log.length],
  );

  const pieOpt = {
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 6, top: 'middle', itemWidth: 10, itemHeight: 10 },
    series: [
      {
        type: 'pie',
        radius: ['50%', '75%'],
        center: ['38%', '50%'],
        itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: 'transparent' },
        label: { show: false },
        data: ([1, 2, 3, 4] as AlarmLevel[]).map((l) => ({ name: LEVEL_META[l].label, value: log.filter((a) => a.level === l).length, itemStyle: { color: LEVEL_META[l].color } })),
      },
    ],
  };

  const detailOpt = useMemo(() => {
    if (!detail) return null;
    const m = alarmSeries(detail);
    if (!m) return null;
    const pairs = engine.history.pairs(m.key);
    return {
      grid: { left: 44, right: 16, top: 30, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true, name: m.unit },
      series: [
        {
          type: 'line',
          showSymbol: false,
          data: pairs,
          color: LEVEL_META[detail.level].color,
          areaStyle: { color: hexA(LEVEL_META[detail.level].color, 0.12) },
          markLine: detail.unit && !detail.key.startsWith('rise:')
            ? { silent: true, symbol: 'none', data: [{ yAxis: detail.threshold }], lineStyle: { color: PALETTE.red, type: 'dashed' }, label: { formatter: '阈值', color: PALETTE.red, position: 'insideEndTop' } }
            : undefined,
          markArea: {
            silent: true,
            itemStyle: { color: hexA(LEVEL_META[detail.level].color, 0.1) },
            data: [[{ xAxis: detail.start }, { xAxis: detail.end ?? now }]],
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, Math.floor(now / 4000)]);

  return (
    <div>
      <PageHead
        module="运维管理"
        title="告警中心"
        desc="汇聚电参、环境、温升、设备与安防告警，支持分级过滤、批量确认与告警时序追溯"
        extra={
          <Button type="primary" icon={<CheckOutlined />} disabled={!unacked.length} onClick={() => ack(unacked.map((a) => a.id))}>
            全部确认（{unacked.length}）
          </Button>
        }
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
            <MiniStat label="活动告警" value={active.length} unit="条" color={active.length ? PALETTE.red : PALETTE.green} />
            <MiniStat label="未确认" value={unacked.length} unit="条" color={unacked.length ? PALETTE.amber : undefined} />
            <MiniStat label="紧急 / 重要" value={`${active.filter((a) => a.level === 1).length} / ${active.filter((a) => a.level === 2).length}`} />
            <MiniStat label="近 1 小时累计" value={log.filter((a) => a.start > now - 3600_000).length} unit="条" />
            <MiniStat label="已恢复" value={rec.length} unit="条" />
            <MiniStat label="平均恢复时长" value={mttr ? dur(mttr) : '--'} />
          </div>
        </Col>
        <Col xs={24} xl={10}>
          <Panel title="告警趋势" sub="5 分钟粒度">
            <EChart option={trendOpt} height={220} />
          </Panel>
        </Col>
        <Col xs={24} md={12} xl={7}>
          <Panel title="级别分布">
            <EChart option={pieOpt} height={220} />
          </Panel>
        </Col>
        <Col xs={24} md={12} xl={7}>
          <Panel title="类别分布">
            <EChart option={catOpt} height={220} />
          </Panel>
        </Col>
        <Col span={24}>
          <Panel
            title="告警列表"
            sub={`${data.length} 条`}
            extra={
              <Space wrap>
                <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="对象 / 内容 / 编号" value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 180 }} />
                <Select
                  size="small"
                  mode="multiple"
                  allowClear
                  placeholder="级别"
                  value={levels}
                  onChange={setLevels}
                  style={{ minWidth: 120 }}
                  options={([1, 2, 3, 4] as AlarmLevel[]).map((l) => ({ value: l, label: LEVEL_META[l].label }))}
                />
                <Select size="small" mode="multiple" allowClear placeholder="类别" value={cats} onChange={setCats} style={{ minWidth: 120 }} options={CATS.map((c) => ({ value: c, label: c }))} />
                <Segmented
                  size="small"
                  value={status}
                  onChange={(v) => setStatus(v as typeof status)}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '活动', value: 'active' },
                    { label: '已恢复', value: 'recovered' },
                  ]}
                />
                <Button size="small" disabled={!selected.length} onClick={() => ack(selected)}>
                  批量确认
                </Button>
              </Space>
            }
            flush
          >
            <Table
              size="small"
              rowKey="id"
              dataSource={data}
              pagination={{ pageSize: 12, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (k) => setSelected(k as string[]),
                getCheckboxProps: (a) => ({ disabled: !!a.ackTime }),
              }}
              onRow={(a) => ({ onClick: () => setDetail(a), style: { cursor: 'pointer' } })}
              columns={[
                { title: '级别', dataIndex: 'level', width: 70, render: (l: AlarmLevel) => <LevelTag level={l} /> },
                { title: '编号', dataIndex: 'id', width: 100, render: (v) => <span className="num muted">{v}</span> },
                { title: '对象', dataIndex: 'target', width: 120, render: (v) => <b>{v}</b> },
                { title: '类别', dataIndex: 'category', width: 70 },
                { title: '告警内容', dataIndex: 'title' },
                {
                  title: '当前 / 峰值',
                  key: 'v',
                  align: 'right',
                  render: (_, a) =>
                    a.unit ? (
                      <span className="num">
                        {fx(a.value, a.unit === '℃/min' ? 2 : 1)} / {fx(a.peak, a.unit === '℃/min' ? 2 : 1)} {a.unit}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    ),
                },
                { title: '发生时间', dataIndex: 'start', width: 100, render: (v: number) => <span className="num">{tstr(v)}</span> },
                { title: '持续', key: 'd', width: 110, render: (_, a) => <span className="num">{dur((a.end ?? now) - a.start)}</span> },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => (v === 'active' ? <Tag color="error">活动</Tag> : <Tag>已恢复</Tag>),
                },
                {
                  title: '确认',
                  key: 'ack',
                  width: 120,
                  render: (_, a) =>
                    a.ackTime ? (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {a.ackBy} {tstr(a.ackTime, 'HH:mm')}
                      </span>
                    ) : (
                      <Button
                        size="small"
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          ack([a.id]);
                        }}
                      >
                        确认
                      </Button>
                    ),
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
      <Drawer open={!!detail} onClose={() => setDetail(null)} width={screens.md ? 620 : '100%'} title={detail && `${detail.target} · ${detail.title}`}>
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
              <Descriptions.Item label="告警编号">{detail.id}</Descriptions.Item>
              <Descriptions.Item label="级别">
                <LevelTag level={detail.level} />
              </Descriptions.Item>
              <Descriptions.Item label="类别">{detail.category}</Descriptions.Item>
              <Descriptions.Item label="对象">{detail.target}</Descriptions.Item>
              <Descriptions.Item label="发生时间">{tstr(detail.start, 'MM-DD HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="恢复时间">{detail.end ? tstr(detail.end, 'MM-DD HH:mm:ss') : '—'}</Descriptions.Item>
              <Descriptions.Item label="持续时长">{dur((detail.end ?? now) - detail.start)}</Descriptions.Item>
              <Descriptions.Item label="状态">{detail.status === 'active' ? <Tag color="error">活动</Tag> : <Tag>已恢复</Tag>}</Descriptions.Item>
              <Descriptions.Item label="告警描述" span={2}>
                {detail.detail}
              </Descriptions.Item>
              <Descriptions.Item label="确认信息" span={2}>
                {detail.ackTime ? `${detail.ackBy} 于 ${tstr(detail.ackTime, 'MM-DD HH:mm:ss')} 确认` : '未确认'}
              </Descriptions.Item>
            </Descriptions>
            {detailOpt && (
              <Panel title="测点时序追溯" sub="阴影为告警持续区间">
                <EChart option={detailOpt} height={240} />
              </Panel>
            )}
            {!detail.ackTime && (
              <Button
                type="primary"
                block
                icon={<CheckOutlined />}
                onClick={() => {
                  ack([detail.id]);
                  setDetail({ ...detail, ackTime: Date.now(), ackBy: '值班工程师' });
                }}
              >
                确认告警
              </Button>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
