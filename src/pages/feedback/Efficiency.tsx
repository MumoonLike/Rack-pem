import { CheckCircleFilled, CloseCircleFilled, SendOutlined } from '@ant-design/icons';
import { App, Button, Checkbox, Col, Descriptions, Empty, Popconfirm, Progress, Row, Slider, Space, Switch, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { Chain, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { efficiencyPaths, type EffCategory, type EffPath } from '@/core/feedback';
import { fx, signed, tstr } from '@/core/format';
import { hash } from '@/core/noise';
import { PALETTE } from '@/theme';

const CAT_COLOR: Record<EffCategory, string> = {
  制冷优化: PALETTE.cyan,
  气流优化: PALETTE.purple,
  负载调度: PALETTE.amber,
  供电优化: PALETTE.green,
};
const CATS = Object.keys(CAT_COLOR) as EffCategory[];

interface Order {
  id: string;
  pathId: string;
  name: string;
  category: EffCategory;
  created: number;
  savingKw: number;
  pueBefore: number;
}

const STAGES = [
  { label: '已下发', until: 20_000 },
  { label: '执行中', until: 150_000 },
  { label: '效果评估', until: 360_000 },
  { label: '已生效', until: Infinity },
];

function loadOrders(): Order[] {
  try {
    return JSON.parse(localStorage.getItem('pem.effOrders') || '[]');
  } catch {
    return [];
  }
}

export default function Efficiency() {
  useTelemetry();
  const { message } = App.useApp();
  const s = engine.snapshot;
  const h = engine.history;
  const paths = useAnalysis('eff', () => efficiencyPaths(engine.snapshot, h), 5);
  const [maxRisk, setMaxRisk] = useState(0.7);
  const [minSave, setMinSave] = useState(0);
  const [cats, setCats] = useState<EffCategory[]>(CATS);
  const [onlyFeasible, setOnlyFeasible] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>(loadOrders);

  const shown = paths.filter((p) => p.risk <= maxRisk && p.savingKw >= minSave && cats.includes(p.category) && (!onlyFeasible || p.feasible));
  const cur: EffPath | undefined = paths.find((p) => p.id === sel) ?? shown.find((p) => p.feasible && p.pareto) ?? shown[0];
  const feasible = paths.filter((p) => p.feasible);
  const best = feasible.reduce<EffPath | undefined>((a, b) => (!a || b.savingKw > a.savingKw ? b : a), undefined);

  const paretoOpt = useMemo(() => {
    const front = paths
      .filter((p) => p.pareto)
      .sort((a, b) => a.risk - b.risk)
      .map((p) => [p.risk, p.savingKw]);
    return {
      grid: { left: 48, right: 24, top: 40, bottom: 44 },
      legend: legendTopRight,
      tooltip: {
        trigger: 'item',
        formatter: (p: { data: { name: string; value: number[]; feasible: boolean } }) =>
          p.data?.name ? `${p.data.name}<br/>节能 ${p.data.value[1].toFixed(2)} kW · 风险 ${(p.data.value[0] * 100).toFixed(0)}%${p.data.feasible ? '' : '<br/>约束未满足'}` : '',
      },
      xAxis: { type: 'value', name: '实施风险', nameLocation: 'middle', nameGap: 28, min: 0, max: 1, axisLabel: { formatter: (v: number) => `${v * 100}%` } },
      yAxis: { type: 'value', name: '节能潜力 kW' },
      series: [
        ...CATS.map((c) => ({
          name: c,
          type: 'scatter',
          data: paths
            .filter((p) => p.category === c)
            .map((p) => ({
              id: p.id,
              name: p.name,
              feasible: p.feasible,
              value: [p.risk, p.savingKw],
              symbolSize: shown.includes(p) ? 16 : 9,
              itemStyle: {
                color: p.feasible ? CAT_COLOR[c] : 'transparent',
                borderColor: CAT_COLOR[c],
                borderWidth: p.feasible ? (cur?.id === p.id ? 3 : 0) : 1.5,
                borderType: p.feasible ? 'solid' : 'dashed',
                opacity: shown.includes(p) ? 1 : 0.35,
                shadowBlur: cur?.id === p.id ? 14 : 0,
                shadowColor: CAT_COLOR[c],
              },
            })),
          color: CAT_COLOR[c],
        })),
        {
          name: 'Pareto 前沿',
          type: 'line',
          data: front,
          showSymbol: false,
          smooth: false,
          lineStyle: { type: 'dashed', color: PALETTE.slate, width: 1.2 },
          tooltip: { show: false },
          z: 1,
        },
      ],
    };
  }, [paths, shown, cur]);

  const issue = (p: EffPath) => {
    const order: Order = {
      id: `EO${tstr(Date.now(), 'MMDDHHmmss')}`,
      pathId: p.id,
      name: p.name,
      category: p.category,
      created: Date.now(),
      savingKw: p.savingKw,
      pueBefore: s.room.pue,
    };
    const next = [order, ...orders].slice(0, 20);
    setOrders(next);
    try {
      localStorage.setItem('pem.effOrders', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    message.success(`策略已下发：${p.name}`);
  };

  const now = s.t;

  return (
    <div>
      <PageHead
        module="结果反馈模块"
        title="能效路径筛选"
        desc="基于实时工况推演制冷、气流、负载与供电四类优化路径的节能潜力与实施风险，经约束校验与 Pareto 筛选后下发执行并跟踪效果反馈"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="候选路径" value={paths.length} unit="条" />
            <MiniStat label="约束可行" value={feasible.length} unit="条" color={PALETTE.green} />
            <MiniStat label="Pareto 最优" value={paths.filter((p) => p.pareto).length} unit="条" />
            <MiniStat label="最大可行节能" value={best ? fx(best.savingKw, 2) : '--'} unit={best ? `kW · ${fx(best.annualMWh, 1)} MWh/年` : ''} />
            <MiniStat label="当前 / 最优 PUE" value={`${fx(s.room.pue, 3)} → ${best ? fx(best.pueAfter, 3) : '--'}`} />
          </div>
        </Col>
        <Col span={24}>
          <Panel title="筛选条件">
            <Space size={32} wrap>
              <Space>
                <span className="text-2">风险上限</span>
                <Slider min={0} max={1} step={0.05} value={maxRisk} onChange={setMaxRisk} style={{ width: 160 }} tooltip={{ formatter: (v) => `${((v ?? 0) * 100).toFixed(0)}%` }} />
                <span className="num">{(maxRisk * 100).toFixed(0)}%</span>
              </Space>
              <Space>
                <span className="text-2">节能下限</span>
                <Slider min={0} max={4} step={0.1} value={minSave} onChange={setMinSave} style={{ width: 160 }} />
                <span className="num">{minSave.toFixed(1)} kW</span>
              </Space>
              <Space>
                <span className="text-2">类别</span>
                <Checkbox.Group value={cats} onChange={(v) => setCats(v as EffCategory[])} options={CATS} />
              </Space>
              <Space>
                <span className="text-2">仅约束可行</span>
                <Switch checked={onlyFeasible} onChange={setOnlyFeasible} />
              </Space>
            </Space>
          </Panel>
        </Col>
        <Col xs={24} xl={13}>
          <Panel title="节能—风险 Pareto 分析" sub="实心为约束可行，虚线圈为约束未满足">
            <EChart option={paretoOpt} height={380} onClick={(p: { data: { id?: string } }) => p.data?.id && setSel(p.data.id)} />
          </Panel>
        </Col>
        <Col xs={24} xl={11}>
          {cur ? (
            <Panel
              title="路径详情"
              sub={cur.name}
              extra={
                <Space>
                  <SoftTag color={CAT_COLOR[cur.category]}>{cur.category}</SoftTag>
                  {cur.pareto && <SoftTag color={PALETTE.blue}>Pareto</SoftTag>}
                </Space>
              }
            >
              <Chain nodes={cur.steps} colors={cur.steps.map(() => CAT_COLOR[cur.category])} />
              <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', margin: '14px 0' }}>
                <MiniStat label="节能潜力" value={fx(cur.savingKw, 2)} unit="kW" color={PALETTE.green} />
                <MiniStat label="年节电" value={fx(cur.annualMWh, 1)} unit="MWh" />
                <MiniStat label="PUE 变化" value={signed(cur.dPue, 3)} />
                <MiniStat label="实施风险" value={fx(cur.risk * 100, 0)} unit="%" color={cur.risk > 0.6 ? PALETTE.red : cur.risk > 0.3 ? PALETTE.amber : PALETTE.green} />
              </div>
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label="实施成本">{cur.cost}</Descriptions.Item>
                <Descriptions.Item label="实施方式">{cur.effort}</Descriptions.Item>
                <Descriptions.Item label="预测最高进风">{fx(cur.maxInletAfter, 1)}℃</Descriptions.Item>
                <Descriptions.Item label="推演置信度">{fx(cur.confidence * 100, 0)}%</Descriptions.Item>
              </Descriptions>
              <div style={{ margin: '12px 0 6px', fontWeight: 500 }}>约束校验</div>
              {cur.constraints.map((c) => (
                <div key={c.label} className="list-row" style={{ padding: '6px 2px' }}>
                  {c.ok ? <CheckCircleFilled style={{ color: PALETTE.green }} /> : <CloseCircleFilled style={{ color: PALETTE.red }} />}
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {c.detail}
                  </span>
                </div>
              ))}
              <Popconfirm title="确认下发该优化策略？" description={cur.name} onConfirm={() => issue(cur)} okText="下发" cancelText="取消" disabled={!cur.feasible}>
                <Button type="primary" icon={<SendOutlined />} block style={{ marginTop: 12 }} disabled={!cur.feasible}>
                  {cur.feasible ? '下发执行' : '约束未满足，暂不可下发'}
                </Button>
              </Popconfirm>
            </Panel>
          ) : (
            <Panel>
              <Empty description="无满足条件的路径" />
            </Panel>
          )}
        </Col>
        <Col span={24}>
          <Panel title="候选路径" sub={`${shown.length} / ${paths.length}`} flush>
            <Table
              size="small"
              rowKey="id"
              dataSource={shown}
              pagination={false}
              onRow={(p) => ({ onClick: () => setSel(p.id), style: { cursor: 'pointer', background: p.id === cur?.id ? 'var(--primary-soft)' : undefined } })}
              columns={[
                { title: '路径', dataIndex: 'name', render: (v, p) => <b style={{ opacity: p.feasible ? 1 : 0.6 }}>{v}</b> },
                { title: '类别', dataIndex: 'category', render: (v: EffCategory) => <SoftTag color={CAT_COLOR[v]}>{v}</SoftTag> },
                { title: '节能 kW', dataIndex: 'savingKw', align: 'right', sorter: (a, b) => a.savingKw - b.savingKw, render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '年节电 MWh', dataIndex: 'annualMWh', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}</span> },
                { title: 'PUE 变化', dataIndex: 'dPue', align: 'right', render: (v: number) => <span className="num">{signed(v, 3)}</span> },
                {
                  title: '风险',
                  dataIndex: 'risk',
                  width: 150,
                  sorter: (a, b) => a.risk - b.risk,
                  render: (v: number) => <Progress percent={+(v * 100).toFixed(0)} size="small" strokeColor={v > 0.6 ? PALETTE.red : v > 0.3 ? PALETTE.amber : PALETTE.green} />,
                },
                { title: '成本', dataIndex: 'cost', render: (v) => <span className="text-2">{v}</span> },
                { title: '约束', dataIndex: 'feasible', render: (v: boolean) => (v ? <Tag color="success">满足</Tag> : <Tag color="error">不满足</Tag>) },
                { title: 'Pareto', dataIndex: 'pareto', render: (v: boolean) => (v ? <Tag color="blue">最优</Tag> : <span className="muted">—</span>) },
              ]}
            />
          </Panel>
        </Col>
        <Col span={24}>
          <Panel title="执行反馈" sub="策略下发后跟踪执行状态与实测节能效果" flush>
            {orders.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无下发记录，可在路径详情中下发优化策略" style={{ padding: 20 }} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                dataSource={orders}
                pagination={false}
                columns={[
                  { title: '工单号', dataIndex: 'id', render: (v) => <span className="num">{v}</span> },
                  { title: '优化策略', dataIndex: 'name' },
                  { title: '类别', dataIndex: 'category', render: (v: EffCategory) => <SoftTag color={CAT_COLOR[v]}>{v}</SoftTag> },
                  { title: '下发时间', dataIndex: 'created', render: (v: number) => <span className="num">{tstr(v, 'MM-DD HH:mm:ss')}</span> },
                  {
                    title: '执行进度',
                    key: 'st',
                    width: 220,
                    render: (_, o) => {
                      const age = now - o.created;
                      const idx = STAGES.findIndex((st) => age < st.until);
                      const pct = idx === 3 ? 100 : Math.min(99, Math.round(((idx + Math.min(1, age / STAGES[idx].until)) / 4) * 100));
                      return (
                        <Space>
                          <Progress percent={pct} size="small" style={{ width: 110 }} showInfo={false} strokeColor={idx === 3 ? PALETTE.green : PALETTE.blue} />
                          <Tag color={idx === 3 ? 'success' : 'processing'}>{STAGES[idx].label}</Tag>
                        </Space>
                      );
                    },
                  },
                  { title: '预测节能', dataIndex: 'savingKw', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)} kW</span> },
                  {
                    title: '实测节能',
                    key: 'real',
                    align: 'right',
                    render: (_, o) => {
                      if (now - o.created < STAGES[2].until) return <span className="muted">评估中</span>;
                      const f = 0.86 + hash(o.created % 100000, 7) * 0.2;
                      return <span className="num" style={{ color: PALETTE.green }}>{fx(o.savingKw * f, 2)} kW</span>;
                    },
                  },
                  {
                    title: '偏差',
                    key: 'dev',
                    align: 'right',
                    render: (_, o) => {
                      if (now - o.created < STAGES[2].until) return <span className="muted">—</span>;
                      const f = 0.86 + hash(o.created % 100000, 7) * 0.2;
                      return <span className="num">{signed((f - 1) * 100, 1)}%</span>;
                    },
                  },
                ]}
              />
            )}
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
