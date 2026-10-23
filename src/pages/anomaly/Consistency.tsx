import { Col, Row, Segmented, Space, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { MiniStat, PageHead, Panel } from '@/components/ui';
import { quantile } from '@/core/analytics';
import { CONSISTENCY_METRICS, consistency, consistencyMatrix } from '@/core/anomaly';
import { useAnalysis } from '@/core/cache';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { RACKS } from '@/core/topology';
import { PALETTE, useChartTokens } from '@/theme';

const VERDICT_COLOR = { 一致: PALETTE.green, 轻微偏移: PALETTE.amber, 显著偏移: PALETTE.red };

export default function Consistency() {
  useTelemetry();
  const h = engine.history;
  const tk = useChartTokens();
  const [win, setWin] = useState(10);
  const [sel, setSel] = useState<{ rack: string; metric: string }>({ rack: 'A06', metric: 'R-T' });
  const matrix = useAnalysis(`cons-m:${win}`, () => consistencyMatrix(h, win), 10);
  const detail = useAnalysis(`cons-d:${win}:${sel.rack}:${sel.metric}`, () => consistency(h, sel.rack, sel.metric, win, 24), 5);
  const meta = CONSISTENCY_METRICS.find((m) => m.key === sel.metric)!;

  const drift = matrix.filter((c) => c.js >= 0.5).length;
  const mild = matrix.filter((c) => c.js >= 0.3 && c.js < 0.5).length;
  const worst = matrix.reduce((a, b) => (b.js > a.js ? b : a));

  const heatOpt = useMemo(
    () => ({
      grid: { left: 70, right: 60, top: 10, bottom: 34 },
      tooltip: {
        formatter: (p: { data: number[] }) =>
          `${RACKS[p.data[0]].id} · ${CONSISTENCY_METRICS[p.data[1]].label}<br/>JS 散度 ${p.data[2].toFixed(3)}<br/>PSI ${p.data[3].toFixed(3)}`,
      },
      xAxis: { type: 'category', data: RACKS.map((r) => r.id), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'category', data: CONSISTENCY_METRICS.map((m) => m.label), axisLabel: { fontSize: 11 } },
      visualMap: {
        min: 0,
        max: 0.8,
        right: 0,
        top: 'middle',
        itemHeight: 160,
        itemWidth: 10,
        calculable: false,
        text: ['偏移', '一致'],
        textStyle: { fontSize: 10 },
        dimension: 2,
        inRange: { color: [tk.mode === 'dark' ? '#1E3A5F' : '#E3F0FF', '#36C690', '#F5D63D', '#FF8A3D', '#FF4D4F'] },
      },
      series: [
        {
          type: 'heatmap',
          data: matrix.map((c) => [RACKS.findIndex((r) => r.id === c.rack), CONSISTENCY_METRICS.findIndex((m) => m.key === c.metric), +c.js.toFixed(3), +c.psi.toFixed(3)]),
          label: { show: true, fontSize: 9, color: tk.text, formatter: (p: { data: number[] }) => p.data[2].toFixed(2) },
          itemStyle: { borderColor: tk.panel, borderWidth: 2, borderRadius: 3 },
        },
      ],
    }),
    [matrix, tk],
  );

  const histOpt = useMemo(() => {
    const norm = (c: number[]) => {
      const s = c.reduce((a, b) => a + b, 0) || 1;
      return c.map((v) => +((v / s) * 100).toFixed(2));
    };
    return {
      grid: { left: 44, right: 16, top: 40, bottom: 30 },
      legend: legendTopRight,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      xAxis: { type: 'category', data: detail.edges.map((e) => e.toFixed(meta.unit === 'kW' || meta.unit === 'A' ? 2 : 1)), name: meta.unit, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', name: '占比 %' },
      series: [
        { name: '基线窗口', type: 'bar', data: norm(detail.baseHist), color: PALETTE.slate, barGap: '-100%', itemStyle: { opacity: 0.55, borderRadius: [2, 2, 0, 0] } },
        { name: `近 ${win} min`, type: 'bar', data: norm(detail.recentHist), color: VERDICT_COLOR[detail.verdict], itemStyle: { opacity: 0.75, borderRadius: [2, 2, 0, 0] } },
      ],
    };
  }, [detail, meta, win]);

  const cdfOpt = useMemo(() => {
    const cdf = (a: number[]) => {
      const s = a.slice().sort((x, y) => x - y);
      const step = Math.max(1, Math.floor(s.length / 120));
      const out: [number, number][] = [];
      for (let i = 0; i < s.length; i += step) out.push([s[i], (i + 1) / s.length]);
      out.push([s[s.length - 1], 1]);
      return out;
    };
    return {
      grid: { left: 44, right: 16, top: 40, bottom: 30 },
      legend: legendTopRight,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(3) },
      xAxis: { type: 'value', scale: true, name: meta.unit },
      yAxis: { type: 'value', min: 0, max: 1, name: 'F(x)' },
      series: [
        { name: '基线 CDF', type: 'line', step: 'end', showSymbol: false, data: cdf(detail.base), color: PALETTE.slate },
        { name: '近期 CDF', type: 'line', step: 'end', showSymbol: false, data: cdf(detail.recent), color: VERDICT_COLOR[detail.verdict] },
      ],
    };
  }, [detail, meta]);

  const boxOpt = useMemo(() => {
    const rn = Math.round((win * 60) / 2);
    const stats = RACKS.map((r) => {
      const v = h.series(`${r.id}.${sel.metric}`).slice(-rn);
      return [Math.min(...v), quantile(v, 0.25), quantile(v, 0.5), quantile(v, 0.75), Math.max(...v)].map((x) => +x.toFixed(2));
    });
    return {
      grid: { left: 44, right: 16, top: 24, bottom: 26 },
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: RACKS.map((r) => r.id), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', scale: true, name: meta.unit },
      series: [
        {
          type: 'boxplot',
          data: stats.map((v, i) => {
            const c = matrix.find((m) => m.rack === RACKS[i].id && m.metric === sel.metric);
            const col = !c ? PALETTE.blue : c.js >= 0.5 ? PALETTE.red : c.js >= 0.3 ? PALETTE.amber : PALETTE.blue;
            return { value: v, itemStyle: { color: `${col}33`, borderColor: col } };
          }),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.metric, matrix, win, Math.floor(engine.version / 5)]);

  return (
    <div>
      <PageHead
        module="异常联判模块"
        title="分布一致性计算"
        desc="对比各测点近期窗口与基线窗口的概率分布，计算 JS 散度、KL 散度、KS 检验与 PSI，量化分布漂移程度"
        extra={
          <Space>
            <span className="muted" style={{ fontSize: 12 }}>
              近期窗口
            </span>
            <Segmented
              value={win}
              onChange={(v) => setWin(v as number)}
              options={[
                { label: '5 min', value: 5 },
                { label: '10 min', value: 10 },
                { label: '15 min', value: 15 },
              ]}
            />
          </Space>
        }
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <MiniStat label="计算组合" value={matrix.length} unit="个（机柜×指标）" />
            <MiniStat label="显著偏移" value={drift} unit="个" color={drift ? PALETTE.red : PALETTE.green} />
            <MiniStat label="轻微偏移" value={mild} unit="个" color={mild ? PALETTE.amber : undefined} />
            <MiniStat label={`最大 JS · ${worst.rack} ${CONSISTENCY_METRICS.find((m) => m.key === worst.metric)!.label}`} value={fx(worst.js, 3)} />
            <MiniStat label="基线窗口" value={`${Math.round((h.size * 2) / 60 - win)} min`} />
          </div>
        </Col>
        <Col span={24}>
          <Panel title="一致性矩阵（JS 散度）" sub="点击单元格查看分布对比">
            <EChart
              option={heatOpt}
              height={250}
              onClick={(p: { data: number[] }) => setSel({ rack: RACKS[p.data[0]].id, metric: CONSISTENCY_METRICS[p.data[1]].key })}
            />
          </Panel>
        </Col>
        <Col xs={24} xl={9}>
          <Panel title="分布对比" sub={`${sel.rack} · ${meta.label}`} extra={<Tag color={detail.verdict === '一致' ? 'success' : detail.verdict === '轻微偏移' ? 'warning' : 'error'}>{detail.verdict}</Tag>}>
            <EChart option={histOpt} height={260} />
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Panel title="经验累积分布" sub="KS 统计量为两条曲线最大纵向距离">
            <EChart option={cdfOpt} height={260} />
          </Panel>
        </Col>
        <Col xs={24} xl={7}>
          <Panel title="一致性指标">
            <div className="grid-auto" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <MiniStat label="JS 散度" value={fx(detail.js, 4)} color={VERDICT_COLOR[detail.verdict]} />
              <MiniStat label="KL 散度" value={fx(detail.kl, 4)} />
              <MiniStat label="KS 统计量 D" value={fx(detail.ks, 4)} />
              <MiniStat label="KS 检验 p 值" value={detail.p < 0.001 ? '< 0.001' : fx(detail.p, 3)} color={detail.p < 0.05 ? PALETTE.orange : undefined} />
              <MiniStat label="PSI" value={fx(detail.psi, 4)} />
              <MiniStat label="均值漂移" value={fx(detail.meanShift, 2)} unit="σ" />
              <MiniStat label="标准差比" value={fx(detail.stdRatio, 3)} />
              <MiniStat label="样本量 基线/近期" value={`${detail.base.length}/${detail.recent.length}`} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
              判定：JS ≥ 0.50 为显著偏移，0.30 ~ 0.50 为轻微偏移；KS 检验按序列自相关折算有效样本量。
            </div>
          </Panel>
        </Col>
        <Col span={24}>
          <Panel title="同指标空间一致性" sub={`${meta.label} · 近 ${win} min 各机柜分布箱线图`}>
            <EChart option={boxOpt} height={240} />
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
