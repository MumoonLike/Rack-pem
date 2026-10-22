import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons';
import { Col, Descriptions, Row, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { useRackDrawer } from '@/components/RackDrawer';
import { Bar, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { rackFeatures, rankNodes, type RackFeatures } from '@/core/anomaly';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx, signed } from '@/core/format';
import { KIND_LABEL, RACK_MAP } from '@/core/topology';
import { PALETTE } from '@/theme';

const SUB = [
  { key: 'E', label: '电参偏离', w: 0.3, color: PALETTE.blue },
  { key: 'T', label: '温升异常', w: 0.32, color: PALETTE.orange },
  { key: 'H', label: '环境越限', w: 0.2, color: PALETTE.cyan },
  { key: 'C', label: '分布偏移', w: 0.18, color: PALETTE.purple },
] as const;

const LEVEL_COLOR = { 异常: PALETTE.red, 关注: PALETTE.amber, 正常: PALETTE.green };

export default function Ranking() {
  useTelemetry();
  const h = engine.history;
  const drawer = useRackDrawer();
  const ranks = useAnalysis('rank', () => rankNodes(h), 5);
  const prev = useAnalysis('rank-prev', () => rankNodes(h, 150), 15);
  const [sel, setSel] = useState<string | null>(null);
  const cur: RackFeatures = ranks.find((r) => r.rack === sel) ?? ranks[0];

  const prevPos = new Map(prev.map((r, i) => [r.rack, i]));
  const counts = { 异常: 0, 关注: 0, 正常: 0 };
  ranks.forEach((r) => (counts[r.level] += 1));

  const barOpt = useMemo(() => {
    const list = ranks.slice().reverse();
    return {
      grid: { left: 48, right: 40, top: 36, bottom: 20 },
      legend: legendTopRight,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => v?.toFixed?.(1) },
      xAxis: { type: 'value', max: 100, name: '评分' },
      yAxis: { type: 'category', data: list.map((r) => r.rack), axisLabel: { fontSize: 11 } },
      series: [
        ...SUB.map((sb) => ({
          name: sb.label,
          type: 'bar',
          stack: 'score',
          barWidth: 12,
          color: sb.color,
          data: list.map((r) => {
            const joint = Object.values(r.sub).filter((v) => v > 0.35).length >= 2 ? 1.18 : 1;
            return +(100 * joint * sb.w * r.sub[sb.key]).toFixed(2);
          }),
        })),
        {
          name: '阈值',
          type: 'line',
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { xAxis: 22, lineStyle: { color: PALETTE.amber, type: 'dashed' }, label: { formatter: '关注', color: PALETTE.amber } },
              { xAxis: 40, lineStyle: { color: PALETTE.red, type: 'dashed' }, label: { formatter: '异常', color: PALETTE.red } },
            ],
          },
        },
      ],
    };
  }, [ranks]);

  const radarOpt = {
    radar: {
      indicator: SUB.map((s) => ({ name: s.label, max: 1 })),
      radius: '64%',
      splitNumber: 4,
      axisName: { fontSize: 11 },
      splitArea: { areaStyle: { color: ['transparent'] } },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 5,
        data: [
          { value: SUB.map((s) => +cur.sub[s.key].toFixed(3)), name: cur.rack, areaStyle: { color: 'rgba(255,90,95,0.25)' }, lineStyle: { color: PALETTE.red }, itemStyle: { color: PALETTE.red } },
        ],
      },
    ],
    tooltip: {},
  };

  const trend = useAnalysis(
    `rank-trend:${cur.rack}`,
    () => {
      const pts: [number, number][] = [];
      for (let back = Math.min(h.size - 420, 900); back >= 0; back -= 45) pts.push([h.timeAt(back), rackFeatures(h, cur.rack, back).score]);
      return pts;
    },
    15,
  );
  const trendOpt = {
    grid: { left: 36, right: 12, top: 16, bottom: 22 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(1) },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', min: 0, max: 100 },
    series: [
      {
        type: 'line',
        data: trend,
        showSymbol: false,
        smooth: true,
        color: LEVEL_COLOR[cur.level],
        areaStyle: { opacity: 0.15 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: 40 }, { yAxis: 22 }],
          lineStyle: { type: 'dashed', color: PALETTE.slate },
          label: { show: false },
        },
      },
    ],
  };

  return (
    <div>
      <PageHead
        module="异常联判模块"
        title="节点排序分析"
        desc="以机柜为节点，融合电参偏离、温升异常、环境越限与分布偏移四类证据加权评分，多源证据同时成立时联合加权，输出异常节点排序"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="评估节点" value={ranks.length} unit="个机柜" />
            <MiniStat label="异常节点" value={counts.异常} unit="个" color={counts.异常 ? PALETTE.red : undefined} />
            <MiniStat label="关注节点" value={counts.关注} unit="个" color={counts.关注 ? PALETTE.amber : undefined} />
            <MiniStat label={`最高评分 · ${ranks[0].rack}`} value={fx(ranks[0].score, 1)} />
            <MiniStat label="证据权重 E/T/H/C" value="0.30 / 0.32 / 0.20 / 0.18" />
          </div>
        </Col>
        <Col xs={24} xl={14}>
          <Panel title="节点异常评分排序" sub="堆叠显示各证据贡献，点击条目查看详情">
            <EChart option={barOpt} height={560} onClick={(p: { name: string }) => p.name && setSel(p.name)} />
          </Panel>
        </Col>
        <Col xs={24} xl={10}>
          <Panel
            title="节点画像"
            sub={`${cur.rack} · ${KIND_LABEL[RACK_MAP[cur.rack].kind]}`}
            extra={<SoftTag color={LEVEL_COLOR[cur.level]}>{cur.level} · {cur.score.toFixed(1)}</SoftTag>}
          >
            <Row gutter={12}>
              <Col span={12}>
                <EChart option={radarOpt} height={210} />
              </Col>
              <Col span={12}>
                {SUB.map((s) => (
                  <div key={s.key} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span className="text-2">{s.label}</span>
                      <span className="num">{(cur.sub[s.key] * 100).toFixed(0)}</span>
                    </div>
                    <Bar value={cur.sub[s.key]} color={s.color} />
                  </div>
                ))}
              </Col>
            </Row>
            <Descriptions size="small" column={2} style={{ marginTop: 4 }} bordered>
              <Descriptions.Item label="负载率">{fx(cur.loadRatio * 100, 1)}%</Descriptions.Item>
              <Descriptions.Item label="负载变化">{signed(cur.loadDev * 100, 1)}%</Descriptions.Item>
              <Descriptions.Item label="电流偏离">{fx(cur.curZ, 1)}σ</Descriptions.Item>
              <Descriptions.Item label="最大温升">{fx(cur.riseMax, 2)}℃/min</Descriptions.Item>
              <Descriptions.Item label="温度偏离">{fx(cur.tempZ, 1)}σ</Descriptions.Item>
              <Descriptions.Item label="偏离节点">{cur.tempNode.slice(4)}</Descriptions.Item>
              <Descriptions.Item label="进风湿度">{fx(cur.rh, 1)}%</Descriptions.Item>
              <Descriptions.Item label="分布 JS">{fx(cur.jsd, 3)}</Descriptions.Item>
            </Descriptions>
            <div className="muted" style={{ fontSize: 12, margin: '12px 0 4px' }}>
              近 30 分钟评分走势
            </div>
            <EChart option={trendOpt} height={130} />
          </Panel>
        </Col>
        <Col span={24}>
          <Panel title="排序明细" flush>
            <Table
              size="small"
              rowKey="rack"
              dataSource={ranks}
              pagination={false}
              onRow={(r) => ({ onClick: () => setSel(r.rack), style: { cursor: 'pointer', background: r.rack === cur.rack ? 'var(--primary-soft)' : undefined } })}
              columns={[
                {
                  title: '排名',
                  key: 'rank',
                  width: 90,
                  render: (_, r, i) => {
                    const p = prevPos.get(r.rack) ?? i;
                    const d = p - i;
                    return (
                      <span className="num">
                        {i + 1}{' '}
                        {d > 0 ? (
                          <span style={{ color: PALETTE.red, fontSize: 11 }}>
                            <ArrowUpOutlined /> {d}
                          </span>
                        ) : d < 0 ? (
                          <span style={{ color: PALETTE.green, fontSize: 11 }}>
                            <ArrowDownOutlined /> {-d}
                          </span>
                        ) : (
                          <MinusOutlined className="muted" style={{ fontSize: 10 }} />
                        )}
                      </span>
                    );
                  },
                },
                {
                  title: '节点',
                  dataIndex: 'rack',
                  render: (v: string) => (
                    <a
                      onClick={(e) => {
                        e.stopPropagation();
                        drawer.open(v);
                      }}
                    >
                      {v}
                    </a>
                  ),
                },
                { title: '类型', key: 'k', render: (_, r) => <span className="text-2">{KIND_LABEL[RACK_MAP[r.rack].kind]}</span> },
                { title: '评分', dataIndex: 'score', align: 'right', render: (v: number) => <b className="num">{fx(v, 1)}</b> },
                { title: '等级', dataIndex: 'level', render: (v: keyof typeof LEVEL_COLOR) => <Tag color={v === '异常' ? 'error' : v === '关注' ? 'warning' : 'success'}>{v}</Tag> },
                ...SUB.map((s) => ({
                  title: s.label,
                  key: s.key,
                  width: 120,
                  render: (_: unknown, r: RackFeatures) => <Bar value={r.sub[s.key]} color={s.color} />,
                })),
                { title: '负载变化', dataIndex: 'loadDev', align: 'right' as const, render: (v: number) => <span className="num">{signed(v * 100, 1)}%</span> },
                { title: '最大温升', dataIndex: 'riseMax', align: 'right' as const, render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '进风·上', dataIndex: 'tinTop', align: 'right' as const, render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
