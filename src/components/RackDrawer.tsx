import { Col, Descriptions, Drawer, Empty, Grid, Row, Space, Table, Tag } from 'antd';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { engine, useTelemetry } from '@/core/engine';
import { fx, tstr } from '@/core/format';
import { KIND_LABEL, RACK_MAP } from '@/core/topology';
import { PALETTE } from '@/theme';
import EChart from './EChart';
import RackElevation from './RackElevation';
import { Bar, LevelTag, MiniStat, Panel } from './ui';

const Ctx = createContext<{ open: (id: string) => void }>({ open: () => {} });

export function useRackDrawer() {
  return useContext(Ctx);
}

function RackDetail({ id }: { id: string }) {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const def = RACK_MAP[id];
  const rs = s.rackMap[id];
  const n = 900;
  const alarms = engine.alarms.log.filter((a) => a.rack === id).slice(0, 8);

  const option = useMemo(
    () => ({
      grid: { left: 44, right: 44, top: 34, bottom: 26 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: 'kW', scale: true },
        { type: 'value', name: '℃', scale: true, splitLine: { show: false } },
      ],
      series: [
        { name: 'IT 负载', type: 'line', showSymbol: false, data: h.pairs(`${id}.load`, n), areaStyle: { opacity: 0.12 } },
        { name: '出风·上', type: 'line', yAxisIndex: 1, showSymbol: false, data: h.pairs(`${id}.R-T`, n) },
        { name: '进风·上', type: 'line', yAxisIndex: 1, showSymbol: false, data: h.pairs(`${id}.F-T`, n) },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.t, id],
  );

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9}>
        <Panel title="机柜立面" sub={`${def.devices.filter((d) => d.ratedW > 0).length} 台设备`}>
          <RackElevation rackId={id} snap={s} rowH={12} />
        </Panel>
      </Col>
      <Col xs={24} lg={15}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <MiniStat label="IT 负载" value={fx(rs.load, 2)} unit="kW" />
            <MiniStat label="负载率" value={fx(rs.ratio * 100, 1)} unit="%" color={rs.ratio > 0.9 ? PALETTE.red : undefined} />
            <MiniStat label="进风最高" value={fx(Math.max(...rs.tin), 1)} unit="℃" />
            <MiniStat label="出风最高" value={fx(Math.max(...rs.tout), 1)} unit="℃" />
            <MiniStat label="进风湿度" value={fx(rs.rhF, 1)} unit="%RH" />
            <MiniStat label="露点" value={fx(rs.dew, 1)} unit="℃" />
            <MiniStat label="A 路电流" value={fx(rs.pa.i, 1)} unit="A" />
            <MiniStat label="B 路电流" value={fx(rs.pb.i, 1)} unit="A" />
          </div>
          <Panel title="近 30 分钟趋势">
            <EChart option={option} height={220} />
          </Panel>
          <Panel title="PDU 电参" flush>
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={[rs.pa, rs.pb]}
              columns={[
                { title: '通道', dataIndex: 'id' },
                { title: '相别', dataIndex: 'phase' },
                { title: '电压 V', dataIndex: 'v', render: (v: number) => <span className="num">{fx(v, 1)}</span> },
                { title: '电流 A', dataIndex: 'i', render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '有功 kW', dataIndex: 'p', render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: 'PF', dataIndex: 'pf', render: (v: number) => <span className="num">{fx(v, 3)}</span> },
                {
                  title: '电流负载率',
                  key: 'r',
                  width: 140,
                  render: (_, c) => <Bar value={c.i / c.breakerA} color={c.i / c.breakerA > 0.8 ? PALETTE.red : PALETTE.blue} />,
                },
                { title: '状态', key: 's', render: (_, c) => (c.online ? <Tag color="success">在线</Tag> : <Tag color="error">中断</Tag>) },
              ]}
            />
          </Panel>
          <Panel title="相关告警" flush>
            {alarms.length ? (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={alarms}
                columns={[
                  { title: '级别', dataIndex: 'level', width: 70, render: (l) => <LevelTag level={l} /> },
                  { title: '告警', dataIndex: 'title' },
                  { title: '发生时间', dataIndex: 'start', render: (v: number) => <span className="num">{tstr(v)}</span> },
                  { title: '状态', dataIndex: 'status', render: (v: string) => (v === 'active' ? <Tag color="error">活动</Tag> : <Tag>已恢复</Tag>) },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="近 1 小时无告警" style={{ padding: 16 }} />
            )}
          </Panel>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
            <Descriptions.Item label="类型">{KIND_LABEL[def.kind]}</Descriptions.Item>
            <Descriptions.Item label="额定功率">{def.ratedKw} kW</Descriptions.Item>
            <Descriptions.Item label="PDU 规格">{def.breakerA} A × 2</Descriptions.Item>
            <Descriptions.Item label="供电相别">{def.phase}</Descriptions.Item>
            <Descriptions.Item label="位置">
              {def.row} 列 第 {def.index} 柜
            </Descriptions.Item>
            <Descriptions.Item label="A/B 分担">
              {(def.splitA * 100).toFixed(0)}% / {((1 - def.splitA) * 100).toFixed(0)}%
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Col>
    </Row>
  );
}

export function RackDrawerProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const screens = Grid.useBreakpoint();
  const open = useCallback((x: string) => setId(x), []);
  const value = useMemo(() => ({ open }), [open]);
  const def = id ? RACK_MAP[id] : null;
  return (
    <Ctx.Provider value={value}>
      {children}
      <Drawer
        open={!!id}
        onClose={() => setId(null)}
        width={screens.lg ? 1080 : '100%'}
        destroyOnClose
        title={
          def && (
            <Space>
              <span style={{ fontSize: 16 }}>机柜 {def.id}</span>
              <Tag color="blue" bordered={false}>
                {KIND_LABEL[def.kind]}
              </Tag>
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {def.row} 列 · 第 {def.index} 柜 · 额定 {def.ratedKw} kW
              </span>
            </Space>
          )
        }
      >
        {id && <RackDetail id={id} />}
      </Drawer>
    </Ctx.Provider>
  );
}
