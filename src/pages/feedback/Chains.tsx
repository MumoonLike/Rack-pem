import { Col, Empty, Row, Table, Tag, Timeline } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { Chain, MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { useChainGroups } from '@/core/cache';
import { useTelemetry } from '@/core/engine';
import type { ChainGroup, ChainItem } from '@/core/feedback';
import { dur, fx, tstr } from '@/core/format';
import { PALETTE, useChartTokens } from '@/theme';
import { CATEGORY_COLOR, SOURCE_COLOR } from '../anomaly/shared';

const STEP_SRC = (s: string) => s.split('·')[0] as keyof typeof SOURCE_COLOR;

export default function Chains() {
  useTelemetry();
  const tk = useChartTokens();
  const { groups, evaluations, times } = useChainGroups();
  const [sel, setSel] = useState<string | null>(null);
  const group: ChainGroup | undefined = groups.find((g) => g.id === sel) ?? groups[0];
  const [chainKey, setChainKey] = useState<string | null>(null);
  const chain: ChainItem | undefined = group?.chains.find((c) => c.key === chainKey) ?? group?.chains[0];

  const allChains = groups.flatMap((g) => g.chains);
  const episodes = allChains.reduce((a, c) => a + c.episodes.length, 0);

  const ganttOpt = useMemo(() => {
    const rows = allChains.map((c) => `${c.rack} · ${c.category}`);
    const t0 = times[0] ?? Date.now() - 3600_000;
    const t1 = times[times.length - 1] ?? Date.now();
    const data = allChains.flatMap((c, i) =>
      c.episodes.map((e) => ({
        value: [i, e.start, e.end + 120_000, e.peak],
        itemStyle: { color: CATEGORY_COLOR[c.category] },
        name: c.cause,
      })),
    );
    return {
      grid: { left: 130, right: 20, top: 10, bottom: 28 },
      tooltip: {
        formatter: (p: { name: string; value: number[] }) => `${p.name}<br/>${tstr(p.value[1], 'HH:mm')} ~ ${tstr(p.value[2], 'HH:mm')}<br/>峰值评分 ${p.value[3].toFixed(0)}`,
      },
      xAxis: { type: 'time', min: t0, max: t1 + 120_000 },
      yAxis: { type: 'category', data: rows, axisLabel: { fontSize: 11 }, inverse: true },
      series: [
        {
          type: 'custom',
          renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[]; visual: (k: string) => string }) => {
            const cat = api.value(0);
            const start = api.coord([api.value(1), cat]);
            const end = api.coord([api.value(2), cat]);
            const h = api.size([0, 1])[1] * 0.56;
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - h / 2, width: Math.max(4, end[0] - start[0]), height: h, r: 4 },
              style: { fill: api.visual('color') },
            };
          },
          encode: { x: [1, 2], y: 0 },
          data,
        },
      ],
    };
  }, [allChains, times]);

  const gh = Math.max(200, allChains.length * 30 + 40);

  return (
    <div>
      <PageHead
        module="结果反馈模块"
        title="路径链组提取"
        desc="对 60 分钟内逐 2 分钟的融合路径进行时序追踪，合并连续发生的事件片段，并按成因类别聚类为链组，提炼共性传导模式"
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="追踪评估" value={evaluations} unit="次" />
            <MiniStat label="提取链组" value={groups.length} unit="组" />
            <MiniStat label="路径链" value={allChains.length} unit="条" />
            <MiniStat label="事件片段" value={episodes} unit="段" />
            <MiniStat label="活跃链组" value={groups.filter((g) => g.active).length} unit="组" color={groups.some((g) => g.active) ? PALETTE.orange : PALETTE.green} />
          </div>
        </Col>
        {groups.length === 0 ? (
          <Col span={24}>
            <Panel>
              <Empty style={{ padding: 60 }} description="追踪窗口内未提取到路径链" />
            </Panel>
          </Col>
        ) : (
          <>
            <Col span={24}>
              <Panel title="链组概览" flush>
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={groups}
                  pagination={false}
                  onRow={(g) => ({
                    onClick: () => {
                      setSel(g.id);
                      setChainKey(null);
                    },
                    style: { cursor: 'pointer', background: g.id === group?.id ? 'var(--primary-soft)' : undefined },
                  })}
                  columns={[
                    { title: '链组', dataIndex: 'id', width: 70, render: (v) => <b className="num">{v}</b> },
                    { title: '成因类别', dataIndex: 'category', width: 110, render: (v: ChainGroup['category']) => <SoftTag color={CATEGORY_COLOR[v]}>{v}</SoftTag> },
                    {
                      title: '共性传导模式',
                      dataIndex: 'pattern',
                      render: (p: string[]) => <Chain nodes={p} colors={p.map((s) => SOURCE_COLOR[STEP_SRC(s)])} />,
                    },
                    { title: '成员', dataIndex: 'members', width: 170, render: (m: string[]) => <span className="text-2">{m.join('、')}</span> },
                    { title: '片段', dataIndex: 'episodes', width: 60, align: 'right', render: (v) => <span className="num">{v}</span> },
                    { title: '累计时长', dataIndex: 'totalSec', width: 110, align: 'right', render: (v: number) => <span className="num">{dur(v * 1000)}</span> },
                    { title: '支持度', dataIndex: 'support', width: 80, align: 'right', render: (v: number) => <span className="num">{fx(v * 100, 0)}%</span> },
                    { title: '最近出现', dataIndex: 'last', width: 90, render: (v: number) => <span className="num">{tstr(v, 'HH:mm')}</span> },
                    { title: '状态', dataIndex: 'active', width: 80, render: (v: boolean) => (v ? <Tag color="error">活跃</Tag> : <Tag>已消退</Tag>) },
                  ]}
                />
              </Panel>
            </Col>
            <Col xs={24} xl={15}>
              <Panel title="路径链时间分布" sub="色块为合并后的事件片段">
                <EChart option={ganttOpt} height={gh} notMerge onClick={(p: { value: number[] }) => {
                  const c = allChains[p.value[0]];
                  if (!c) return;
                  const g = groups.find((x) => x.chains.includes(c));
                  if (g) setSel(g.id);
                  setChainKey(c.key);
                }} />
              </Panel>
            </Col>
            <Col xs={24} xl={9}>
              <Panel
                title="链组成员"
                sub={group ? `${group.id} · ${group.category}` : undefined}
                bodyStyle={{ maxHeight: gh + 16, overflowY: 'auto' }}
              >
                {group?.chains.map((c) => (
                  <div
                    key={c.key}
                    onClick={() => setChainKey(c.key)}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      marginBottom: 10,
                      cursor: 'pointer',
                      border: `1px solid ${chain?.key === c.key ? CATEGORY_COLOR[c.category] : 'var(--line)'}`,
                      background: chain?.key === c.key ? 'var(--primary-soft)' : 'var(--panel-2)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <b>{c.cause}</b>
                      {c.active ? <Tag color="error">活跃</Tag> : <Tag>已消退</Tag>}
                    </div>
                    <Timeline
                      style={{ marginBottom: -18 }}
                      items={c.steps.map((st) => ({
                        color: SOURCE_COLOR[STEP_SRC(st)],
                        children: <span style={{ fontSize: 12.5 }}>{st.replace('·', ' · ')}</span>,
                      }))}
                    />
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      出现 {c.occurrences} 次 · {c.episodes.length} 个片段 · 最近 {tstr(c.episodes[c.episodes.length - 1].end, 'HH:mm')}
                    </div>
                  </div>
                ))}
              </Panel>
            </Col>
            {chain && (
              <Col span={24}>
                <Panel title="链路片段明细" sub={chain.cause} flush>
                  <Table
                    size="small"
                    rowKey="start"
                    pagination={false}
                    dataSource={chain.episodes.slice().reverse()}
                    columns={[
                      { title: '开始', dataIndex: 'start', render: (v: number) => <span className="num">{tstr(v, 'HH:mm:ss')}</span> },
                      { title: '结束', dataIndex: 'end', render: (v: number) => <span className="num">{tstr(v, 'HH:mm:ss')}</span> },
                      { title: '持续', key: 'd', render: (_, e) => <span className="num">{dur(e.end - e.start + 120_000)}</span> },
                      { title: '峰值评分', dataIndex: 'peak', align: 'right', render: (v: number) => <span className="num">{fx(v, 1)}</span> },
                      { title: '最高置信度', dataIndex: 'conf', align: 'right', render: (v: number) => <span className="num">{fx(v * 100, 0)}%</span> },
                      {
                        title: '证据构成',
                        key: 'ev',
                        render: () => (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {chain.lastPath.evidence.map((e) => (
                              <SoftTag key={e.id} color={SOURCE_COLOR[e.source]} style={{ fontSize: 11 }}>
                                {e.label}
                              </SoftTag>
                            ))}
                          </div>
                        ),
                      },
                    ]}
                  />
                  <div className="muted" style={{ fontSize: 12, padding: '10px 16px 14px', color: tk.subtext }}>
                    处置建议：{chain.lastPath.suggestion}
                  </div>
                </Panel>
              </Col>
            )}
          </>
        )}
      </Row>
    </div>
  );
}
