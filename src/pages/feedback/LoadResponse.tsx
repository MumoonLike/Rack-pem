import { Col, Empty, Row, Select, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { quantile } from '@/core/analytics';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { allResponses, eventResponse, rackResponse } from '@/core/feedback';
import { fx, signed, tstr } from '@/core/format';
import { KIND_LABEL, RACKS, RACK_MAP, type RackKind } from '@/core/topology';
import { PALETTE } from '@/theme';

const KIND_COLOR: Record<RackKind, string> = { compute: PALETTE.blue, storage: PALETTE.teal, network: PALETTE.cyan, gpu: PALETTE.purple };

export default function LoadResponse() {
  useTelemetry();
  const h = engine.history;
  const [rack, setRack] = useState('A07');
  const [evIdx, setEvIdx] = useState(-1);
  const all = useAnalysis('responses', () => allResponses(h), 30);
  const detail = useAnalysis(`resp:${rack}`, () => rackResponse(h, rack), 15);
  const events = detail.events;
  const ev = events[evIdx < 0 || evIdx >= events.length ? events.length - 1 : evIdx];
  const evFit = useAnalysis(`resp-ev:${rack}:${ev?.t ?? 0}`, () => (ev ? eventResponse(h, ev) : null), 1000);

  const totalEvents = all.reduce((a, r) => a + r.events.length, 0);
  const compute = all.filter((r) => RACK_MAP[r.rack].kind === 'compute');
  const medTau = quantile(all.map((r) => r.tau), 0.5);
  const medTheta = quantile(all.map((r) => r.theta), 0.5);
  const avgR2 = all.reduce((a, r) => a + r.r2, 0) / all.length;
  const abnormal = all.filter((r) => r.r2 < 0.5 || r.gainRatio > 1.25 || r.gainRatio < 0.75);

  const mainOpt = useMemo(
    () => ({
      grid: { left: 46, right: 46, top: 52, bottom: 26 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: 'kW', scale: true },
        { type: 'value', name: 'ΔT ℃', scale: true, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'IT 负载',
          type: 'line',
          step: 'middle',
          showSymbol: false,
          data: detail.t.map((t, i) => [t, detail.load[i]]),
          color: PALETTE.blue,
          areaStyle: { opacity: 0.1 },
          markLine: {
            silent: true,
            symbol: 'none',
            data: events.map((e) => ({ xAxis: e.t })),
            lineStyle: { color: PALETTE.amber, type: 'dotted', width: 1 },
            label: { show: false },
          },
        },
        { name: '实测出入风温差', type: 'line', yAxisIndex: 1, showSymbol: false, data: detail.t.map((t, i) => [t, detail.resp[i]]), color: PALETTE.orange },
        { name: 'FOPDT 模型', type: 'line', yAxisIndex: 1, showSymbol: false, data: detail.t.map((t, i) => [t, detail.fitted[i]]), color: PALETTE.green, lineStyle: { type: 'dashed', width: 1.6 } },
      ],
    }),
    [detail, events],
  );

  const stepOpt = useMemo(() => {
    if (!evFit || !ev) return null;
    const t0 = ev.t;
    const x = evFit.t.map((t) => (t - t0) / 1000);
    const y0 = evFit.resp.slice(0, 25).reduce((a, b) => a + b, 0) / 25;
    const dL = ev.dL;
    const norm = (v: number) => (v - y0) / (evFit.K * dL || 1);
    return {
      grid: { left: 44, right: 16, top: 40, bottom: 34 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(3) },
      legend: legendTopRight,
      xAxis: { type: 'value', name: 's', min: -60, max: Math.round(x[x.length - 1]), nameLocation: 'end' },
      yAxis: { type: 'value', name: '归一化响应', min: -0.4, max: 1.6 },
      series: [
        { name: '实测', type: 'line', showSymbol: false, data: x.map((v, i) => [v, norm(evFit.resp[i])]), color: PALETTE.orange, lineStyle: { width: 1.2 } },
        {
          name: '模型',
          type: 'line',
          showSymbol: false,
          data: x.map((v, i) => [v, norm(evFit.fitted[i])]),
          color: PALETTE.green,
          lineStyle: { width: 2 },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { fontSize: 10, position: 'insideEndTop', distance: 2 },
            data: [
              { xAxis: evFit.theta, lineStyle: { color: PALETTE.slate, type: 'dashed' }, label: { formatter: `θ=${evFit.theta}s` } },
              { xAxis: evFit.theta + evFit.tau, lineStyle: { color: PALETTE.purple, type: 'dashed' }, label: { formatter: `θ+τ=${evFit.theta + evFit.tau}s` } },
              { yAxis: 0.632, lineStyle: { color: PALETTE.purple, type: 'dotted' }, label: { formatter: '63.2%' } },
            ],
          },
        },
      ],
    };
  }, [evFit, ev]);

  const scatterOpt = useMemo(
    () => ({
      grid: { left: 46, right: 16, top: 36, bottom: 40 },
      legend: legendTopRight,
      tooltip: { trigger: 'item', formatter: (p: { data: { name: string; value: number[] } }) => `${p.data.name}<br/>τ ${p.data.value[0]} s · K ${p.data.value[1].toFixed(2)} ℃/kW` },
      xAxis: { type: 'value', name: '时间常数 τ (s)', nameLocation: 'middle', nameGap: 26, scale: true },
      yAxis: { type: 'value', name: '增益 K ℃/kW', scale: true },
      series: (Object.keys(KIND_COLOR) as RackKind[]).map((k) => ({
        name: KIND_LABEL[k],
        type: 'scatter',
        symbolSize: (v: number[]) => 8 + v[2] * 8,
        data: all.filter((r) => RACK_MAP[r.rack].kind === k).map((r) => ({ name: r.rack, value: [r.tau, r.K, r.r2] })),
        itemStyle: { color: KIND_COLOR[k] },
        label: { show: true, formatter: (p: { data: { name: string } }) => p.data.name, position: 'right', fontSize: 10 },
        labelLayout: { hideOverlap: true },
      })),
    }),
    [all],
  );

  return (
    <div>
      <PageHead
        module="结果反馈模块"
        title="负载响应分析"
        desc="以机柜 IT 负载为输入、出入风温差为输出，辨识一阶惯性加纯滞后（FOPDT）热响应模型，量化增益、时间常数与滞后，识别散热响应异常"
        extra={
          <Space>
            <span className="muted" style={{ fontSize: 12 }}>
              分析机柜
            </span>
            <Select
              value={rack}
              onChange={(v) => {
                setRack(v);
                setEvIdx(-1);
              }}
              style={{ width: 160 }}
              options={RACKS.map((r) => ({ value: r.id, label: `${r.id} · ${KIND_LABEL[r.kind]}` }))}
              popupMatchSelectWidth={false}
            />
          </Space>
        }
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
            <MiniStat label="辨识机柜" value={all.length} unit="台" />
            <MiniStat label="检出阶跃事件" value={totalEvents} unit="次" />
            <MiniStat label="计算柜平均增益" value={fx(compute.reduce((a, r) => a + r.K, 0) / compute.length, 2)} unit="℃/kW" />
            <MiniStat label="时间常数中位" value={fx(medTau, 0)} unit="s" />
            <MiniStat label="纯滞后中位" value={fx(medTheta, 0)} unit="s" />
            <MiniStat label="平均拟合 R²" value={fx(avgR2, 3)} color={avgR2 < 0.8 ? PALETTE.amber : undefined} />
          </div>
        </Col>
        <Col xs={24} xl={15}>
          <Panel
            title="负载—温差响应辨识"
            sub={`${rack} · 近 60 分钟`}
            extra={
              <Space size={6}>
                <SoftTag color={PALETTE.blue}>K {fx(detail.K, 2)} ℃/kW</SoftTag>
                <SoftTag color={PALETTE.purple}>τ {detail.tau} s</SoftTag>
                <SoftTag color={PALETTE.slate}>θ {detail.theta} s</SoftTag>
                <SoftTag color={detail.r2 >= 0.8 ? PALETTE.green : PALETTE.amber}>R² {fx(detail.r2, 3)}</SoftTag>
              </Space>
            }
          >
            <EChart option={mainOpt} height={300} />
          </Panel>
        </Col>
        <Col xs={24} xl={9}>
          <Panel
            title="阶跃响应"
            extra={
              events.length > 0 && (
                <Select
                  size="small"
                  value={evIdx < 0 || evIdx >= events.length ? events.length - 1 : evIdx}
                  onChange={setEvIdx}
                  style={{ width: 150 }}
                  options={events.map((e, i) => ({ value: i, label: `${tstr(e.t, 'HH:mm:ss')} ${e.dir} ${Math.abs(e.dL).toFixed(1)}kW` }))}
                />
              )
            }
          >
            {stepOpt ? (
              <>
                <EChart option={stepOpt} height={256} notMerge />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  单次事件局部辨识：K {fx(evFit!.K, 2)} ℃/kW · τ {evFit!.tau} s · θ {evFit!.theta} s · R² {fx(evFit!.r2, 3)}
                </div>
              </>
            ) : (
              <Empty style={{ paddingTop: 70 }} description="该机柜近 1 小时无显著负载阶跃" />
            )}
          </Panel>
        </Col>
        <Col xs={24} xl={9}>
          <Panel title="响应参数分布" sub="点大小 ∝ 拟合优度">
            <EChart option={scatterOpt} height={330} />
          </Panel>
        </Col>
        <Col xs={24} xl={15}>
          <Panel title="机柜响应参数" sub={abnormal.length ? `${abnormal.length} 台响应异常` : '响应正常'} flush>
            <Table
              size="small"
              rowKey="rack"
              dataSource={all}
              pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
              onRow={(r) => ({ onClick: () => setRack(r.rack), style: { cursor: 'pointer', background: r.rack === rack ? 'var(--primary-soft)' : undefined } })}
              columns={[
                { title: '机柜', dataIndex: 'rack', render: (v) => <b>{v}</b> },
                { title: '类型', key: 'k', render: (_, r) => <span className="text-2">{KIND_LABEL[RACK_MAP[r.rack].kind]}</span> },
                { title: '增益 K', dataIndex: 'K', align: 'right', sorter: (a, b) => a.K - b.K, render: (v: number) => <span className="num">{fx(v, 2)}</span> },
                { title: '同类偏差', dataIndex: 'gainRatio', align: 'right', render: (v: number) => <span className="num" style={{ color: Math.abs(v - 1) > 0.25 ? PALETTE.orange : undefined }}>{signed((v - 1) * 100, 0)}%</span> },
                { title: 'τ (s)', dataIndex: 'tau', align: 'right', sorter: (a, b) => a.tau - b.tau, render: (v: number) => <span className="num">{v}</span> },
                { title: 'θ (s)', dataIndex: 'theta', align: 'right', render: (v: number) => <span className="num">{v}</span> },
                { title: 'R²', dataIndex: 'r2', align: 'right', sorter: (a, b) => a.r2 - b.r2, render: (v: number) => <span className="num">{fx(v, 3)}</span> },
                { title: '阶跃事件', key: 'ev', align: 'right', render: (_, r) => <span className="num">{r.events.length}</span> },
                {
                  title: '评估',
                  key: 's',
                  render: (_, r) =>
                    r.r2 < 0.5 ? <Tag color="error">响应失配</Tag> : Math.abs(r.gainRatio - 1) > 0.25 ? <Tag color="warning">增益偏离</Tag> : <Tag color="success">正常</Tag>,
                },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
