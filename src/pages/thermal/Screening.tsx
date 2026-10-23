import { FilterOutlined } from '@ant-design/icons';
import { Col, InputNumber, Row, Segmented, Slider, Space, Switch, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { MiniStat, PageHead, Panel, Spark } from '@/components/ui';
import { linreg } from '@/core/analytics';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { dur, fx } from '@/core/format';
import { riseScreen, seriesKey, type RiseRow } from '@/core/thermal';
import { PALETTE } from '@/theme';

type SideF = 'all' | 'F' | 'R';

export default function Screening() {
  useTelemetry();
  const s = engine.snapshot;
  const h = engine.history;
  const [win, setWin] = useState(5);
  const [thr, setThr] = useState(0.4);
  const [side, setSide] = useState<SideF>('all');
  const [minT, setMinT] = useState<number | null>(null);
  const [onlyHit, setOnlyHit] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const rows = useAnalysis(`rise:${win}:${thr}`, () => riseScreen(h, win, thr), 3);
  const filtered = rows
    .filter((r) => side === 'all' || r.node.side === side)
    .filter((r) => minT === null || r.temp >= minT)
    .filter((r) => !onlyHit || r.rate >= thr || r.peakRate >= thr)
    .sort((a, b) => b.rate - a.rate);
  const hits = rows.filter((r) => r.rate >= thr);
  const peak = rows.reduce((a, b) => (b.peakRate > a.peakRate ? b : a));
  const longest = rows.reduce((a, b) => (b.overSec > a.overSec ? b : a));
  const selRow: RiseRow = rows.find((r) => r.node.id === sel) ?? filtered[0] ?? rows[0];

  const scatterOpt = useMemo(
    () => ({
      grid: { left: 48, right: 24, top: 40, bottom: 44 },
      legend: legendTopRight,
      tooltip: {
        trigger: 'item',
        formatter: (p: { data: { name: string; value: number[] } }) => `${p.data.name}<br/>温度 ${p.data.value[0].toFixed(1)}℃<br/>温升 ${p.data.value[1].toFixed(2)}℃/min`,
      },
      xAxis: { type: 'value', name: '当前温度 ℃', nameLocation: 'middle', nameGap: 28, scale: true },
      yAxis: { type: 'value', name: '温升速率 ℃/min' },
      series: (['F', 'R'] as const).map((sd) => ({
        name: sd === 'F' ? '进风节点' : '出风节点',
        type: 'scatter',
        symbolSize: (v: number[]) => (v[1] >= thr ? 12 : 7),
        data: rows.filter((r) => r.node.side === sd).map((r) => ({ name: r.node.label, value: [r.temp, r.rate], id: r.node.id })),
        itemStyle: { color: sd === 'F' ? PALETTE.cyan : PALETTE.orange, opacity: 0.85 },
        markLine:
          sd === 'F'
            ? {
                silent: true,
                symbol: 'none',
                data: [{ yAxis: thr }],
                lineStyle: { color: PALETTE.red, type: 'dashed' },
                label: { formatter: `阈值 ${thr}`, color: PALETTE.red, position: 'insideEndTop' },
              }
            : undefined,
        markArea:
          sd === 'F'
            ? { silent: true, itemStyle: { color: 'rgba(255,90,95,0.06)' }, data: [[{ yAxis: thr }, { yAxis: 'max' }]] }
            : undefined,
      })),
    }),
    [rows, thr],
  );

  const trendOpt = useMemo(() => {
    const key = seriesKey(selRow.node);
    const pairs = h.pairs(key, 900);
    const w = Math.round((win * 60) / 2);
    const recent = pairs.slice(-w);
    const t0 = recent[0][0];
    const reg = linreg(
      recent.map((p) => (p[0] - t0) / 60000),
      recent.map((p) => p[1]),
    );
    const fit = [recent[0], recent[recent.length - 1]].map((p) => [p[0], reg.intercept + (reg.slope * (p[0] - t0)) / 60000]);
    return {
      grid: { left: 40, right: 16, top: 36, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true, name: '℃' },
      series: [
        {
          name: '节点温度',
          type: 'line',
          showSymbol: false,
          data: pairs,
          color: selRow.node.side === 'F' ? PALETTE.cyan : PALETTE.orange,
          markArea: { silent: true, itemStyle: { color: 'rgba(62,139,255,0.08)' }, data: [[{ xAxis: t0 }, { xAxis: recent[recent.length - 1][0] }]] },
        },
        { name: `回归（${reg.slope.toFixed(2)}℃/min）`, type: 'line', showSymbol: false, data: fit, color: PALETTE.red, lineStyle: { width: 2, type: 'dashed' } },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.t, selRow.node.id, win]);

  return (
    <div>
      <PageHead module="温升识别模块" title="温升筛选" desc="以滑动窗口线性回归计算各节点温升速率，结合阈值、持续时长与温度水平多条件筛选异常温升节点" />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <Panel title="筛选条件" extra={<FilterOutlined className="muted" />}>
            <Space size={28} wrap>
              <Space>
                <span className="text-2">回归窗口</span>
                <Segmented
                  value={win}
                  onChange={(v) => setWin(v as number)}
                  options={[
                    { label: '3 min', value: 3 },
                    { label: '5 min', value: 5 },
                    { label: '10 min', value: 10 },
                    { label: '15 min', value: 15 },
                  ]}
                />
              </Space>
              <Space style={{ width: 360 }}>
                <span className="text-2" style={{ whiteSpace: 'nowrap' }}>
                  速率阈值
                </span>
                <Slider min={0.1} max={1.5} step={0.05} value={thr} onChange={setThr} style={{ width: 200 }} />
                <span className="num">{thr.toFixed(2)} ℃/min</span>
              </Space>
              <Space>
                <span className="text-2">测点侧别</span>
                <Segmented
                  value={side}
                  onChange={(v) => setSide(v as SideF)}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '进风', value: 'F' },
                    { label: '出风', value: 'R' },
                  ]}
                />
              </Space>
              <Space>
                <span className="text-2">温度下限</span>
                <InputNumber value={minT} onChange={(v) => setMinT(v)} placeholder="不限" suffix="℃" style={{ width: 110 }} />
              </Space>
              <Space>
                <span className="text-2">仅显示命中</span>
                <Switch checked={onlyHit} onChange={setOnlyHit} />
              </Space>
            </Space>
          </Panel>
        </Col>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="筛选结果" value={filtered.length} unit="个节点" />
            <MiniStat label="当前超阈节点" value={hits.length} unit="个" color={hits.length ? PALETTE.red : PALETTE.green} />
            <MiniStat label={`近 1h 峰值速率 · ${peak.node.id}`} value={fx(peak.peakRate, 2)} unit="℃/min" />
            <MiniStat label={`累计超阈最长 · ${longest.node.id}`} value={longest.overSec ? dur(longest.overSec * 1000) : '0'} />
            <MiniStat label="最大窗口温升" value={fx(Math.max(...rows.map((r) => r.delta)), 2)} unit="℃" />
          </div>
        </Col>
        <Col xs={24} xl={10}>
          <Panel title="温度—温升速率分布" sub="右上区域为高温快升节点">
            <EChart option={scatterOpt} height={330} onClick={(p: { data: { id: string } }) => p.data?.id && setSel(p.data.id)} />
          </Panel>
        </Col>
        <Col xs={24} xl={14}>
          <Panel title="节点温升曲线" sub={selRow.node.label} extra={selRow.rate >= thr ? <Tag color="error">超阈</Tag> : <Tag color="success">正常</Tag>}>
            <EChart option={trendOpt} height={330} />
          </Panel>
        </Col>
        <Col span={24}>
          <Panel title="筛选明细" flush>
            <Table
              size="small"
              rowKey={(r) => r.node.id}
              dataSource={filtered}
              pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
              onRow={(r) => ({ onClick: () => setSel(r.node.id), style: { cursor: 'pointer', background: r.node.id === selRow.node.id ? 'var(--primary-soft)' : undefined } })}
              columns={[
                { title: '节点', key: 'n', render: (_, r) => <b>{r.node.label}</b> },
                { title: '当前温度', dataIndex: 'temp', align: 'right', sorter: (a, b) => a.temp - b.temp, render: (v: number) => <span className="num">{fx(v, 1)}℃</span> },
                {
                  title: `温升速率（${win} min）`,
                  dataIndex: 'rate',
                  align: 'right',
                  sorter: (a, b) => a.rate - b.rate,
                  render: (v: number) => (
                    <span className="num" style={{ color: v >= thr ? PALETTE.red : v >= thr * 0.6 ? PALETTE.amber : undefined, fontWeight: v >= thr ? 600 : undefined }}>
                      {v > 0 ? '+' : ''}
                      {fx(v, 3)} ℃/min
                    </span>
                  ),
                },
                { title: '窗口变化', dataIndex: 'delta', align: 'right', render: (v: number) => <span className="num">{v > 0 ? '+' : ''}{fx(v, 2)}℃</span> },
                { title: '拟合 R²', dataIndex: 'r2', align: 'right', render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '近 1h 峰值速率', dataIndex: 'peakRate', align: 'right', sorter: (a, b) => a.peakRate - b.peakRate, render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '累计超阈', dataIndex: 'overSec', align: 'right', sorter: (a, b) => a.overSec - b.overSec, render: (v: number) => <span className="num">{v ? dur(v * 1000) : '—'}</span> },
                {
                  title: '近 20 分钟',
                  key: 'spark',
                  width: 130,
                  render: (_, r) => <Spark values={r.spark} color={r.node.side === 'F' ? PALETTE.cyan : PALETTE.orange} width={110} height={24} />,
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
