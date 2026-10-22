import { Col, Row, Select, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { MiniStat, PageHead, Panel, SoftTag } from '@/components/ui';
import { harmonics, rms } from '@/core/analytics';
import { engine, useTelemetry } from '@/core/engine';
import { fx } from '@/core/format';
import { hash } from '@/core/noise';
import { RACKS } from '@/core/topology';
import { PALETTE } from '@/theme';

const N = 256; // 每周波采样点
const CYCLES = 2;
const H_MAX = 25;

// 典型谐波分布（开关电源 / PFC 负载）
const V_PROFILE: Record<number, number> = { 3: 0.42, 5: 0.7, 7: 0.45, 9: 0.12, 11: 0.28, 13: 0.18, 15: 0.06, 17: 0.08, 19: 0.06 };
const I_PROFILE: Record<number, number> = { 2: 0.05, 3: 0.82, 5: 0.5, 7: 0.3, 9: 0.2, 11: 0.13, 13: 0.09, 15: 0.06, 17: 0.05, 19: 0.04, 21: 0.03, 23: 0.025, 25: 0.02 };

function normalize(p: Record<number, number>) {
  const s = Math.sqrt(Object.values(p).reduce((a, v) => a + v * v, 0));
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v / s])) as Record<number, number>;
}
const VN = normalize(V_PROFILE);
const IN = normalize(I_PROFILE);

function synth(rmsV: number, thd: number, profile: Record<number, number>, phase: number, seed: number, tick: number) {
  const out: number[] = [];
  for (let i = 0; i < N * CYCLES; i++) {
    const th = (2 * Math.PI * i) / N;
    let v = Math.sin(th - phase);
    for (const k in profile) {
      const hN = Number(k);
      const ph = hash(seed, hN) * Math.PI * 2 + 0.05 * Math.sin(tick / 3 + hN);
      v += (thd / 100) * profile[k] * Math.sin(hN * (th - phase) + ph);
    }
    out.push(Math.SQRT2 * rmsV * v * (1 + 0.002 * (hash(seed + 7, i + tick * 31) - 0.5)));
  }
  return out;
}

interface Source {
  key: string;
  label: string;
  v: number;
  i: number;
  pf: number;
  thdu: number;
  thdi: number;
  f: number;
}

export default function Waveform() {
  useTelemetry();
  const s = engine.snapshot;
  const tick = Math.floor(s.t / 2000);
  const [key, setKey] = useState('PDC-1:L1');

  const sources: Source[] = useMemo(() => {
    const list: Source[] = [];
    for (const p of s.pdcs) {
      for (const ph of p.phases) {
        list.push({ key: `${p.id}:${ph.phase}`, label: `${p.id} 进线 ${ph.phase}`, v: ph.v, i: ph.i, pf: ph.pf, thdu: p.thdu, thdi: 0, f: p.f });
      }
    }
    for (const r of s.racks) {
      for (const c of [r.pa, r.pb]) list.push({ key: c.id, label: c.id, v: c.v, i: c.i, pf: c.pf, thdu: c.thdu, thdi: c.thdi, f: c.f });
    }
    // 进线电流谐波取支路电流加权
    for (const p of s.pdcs) {
      for (const ph of p.phases) {
        const chs = s.racks.filter((r) => RACKS.find((d) => d.id === r.id)!.phase === ph.phase).map((r) => (p.path === 'A' ? r.pa : r.pb));
        const tot = chs.reduce((a, c) => a + c.i, 0);
        const src = list.find((x) => x.key === `${p.id}:${ph.phase}`)!;
        src.thdi = chs.reduce((a, c) => a + c.thdi * c.i, 0) / (tot || 1) * 0.82;
      }
    }
    return list;
  }, [s]);

  const src = sources.find((x) => x.key === key) ?? sources[0];
  const seed = key.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const phi = Math.acos(Math.min(0.999, src.pf + 0.004));
  const vw = useMemo(() => synth(src.v, src.thdu, VN, 0, seed, tick), [src.v, src.thdu, seed, tick]);
  const iw = useMemo(() => synth(src.i, src.thdi, IN, phi, seed + 3, tick), [src.i, src.thdi, phi, seed, tick]);

  const vh = harmonics(vw, CYCLES, H_MAX);
  const ih = harmonics(iw, CYCLES, H_MAX);
  const thdV = (Math.sqrt(vh.slice(1).reduce((a, v) => a + v * v, 0)) / vh[0]) * 100;
  const thdI = (Math.sqrt(ih.slice(1).reduce((a, v) => a + v * v, 0)) / ih[0]) * 100;
  const crestV = Math.max(...vw.map(Math.abs)) / rms(vw);
  const crestI = Math.max(...iw.map(Math.abs)) / rms(iw);
  const dpf = Math.cos(phi);
  const tpf = dpf / Math.sqrt(1 + (thdI / 100) ** 2);

  const waveOpt = useMemo(() => {
    const dt = 1000 / (src.f * N);
    return {
      grid: { left: 48, right: 48, top: 40, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(2) },
      legend: legendTopRight,
      xAxis: { type: 'value', name: 'ms', min: 0, max: +(dt * N * CYCLES).toFixed(2), axisLabel: { formatter: (v: number) => v.toFixed(0) } },
      yAxis: [
        { type: 'value', name: 'V', min: -340, max: 340 },
        { type: 'value', name: 'A', splitLine: { show: false }, scale: true },
      ],
      series: [
        { name: '电压 u(t)', type: 'line', showSymbol: false, data: vw.map((v, i) => [i * dt, v]), color: PALETTE.amber, lineStyle: { width: 1.8 } },
        { name: '电流 i(t)', type: 'line', showSymbol: false, yAxisIndex: 1, data: iw.map((v, i) => [i * dt, v]), color: PALETTE.cyan, lineStyle: { width: 1.8 } },
      ],
    };
  }, [vw, iw, src.f]);

  const specOpt = useMemo(
    () => ({
      grid: { left: 44, right: 16, top: 40, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v?.toFixed?.(2)}%` },
      legend: legendTopRight,
      xAxis: { type: 'category', data: Array.from({ length: H_MAX - 1 }, (_, i) => i + 2), name: '次' },
      yAxis: { type: 'value', name: '% 基波' },
      series: [
        {
          name: '电压谐波',
          type: 'bar',
          barGap: '10%',
          data: vh.slice(1).map((v) => (v / vh[0]) * 100),
          color: PALETTE.amber,
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: 4 }], lineStyle: { color: PALETTE.red, type: 'dashed' }, label: { formatter: '奇次限值 4%', color: PALETTE.red, position: 'insideEndTop' } },
        },
        { name: '电流谐波', type: 'bar', data: ih.slice(1).map((v) => (v / ih[0]) * 100), color: PALETTE.cyan },
      ],
    }),
    [vh, ih],
  );

  // 三相相量
  const pdc = s.pdcs.find((p) => key.startsWith(p.id)) ?? s.pdcs[0];
  const phasorOpt = useMemo(() => {
    const vmax = 240;
    const imax = Math.max(...pdc.phases.map((p) => p.i)) * 1.2;
    const colors = [PALETTE.amber, PALETTE.green, PALETTE.red];
    const wrap = (a: number) => ((a % 360) + 360) % 360;
    const arrow = (r: number, ang: number, size: number) => [
      { value: [0, wrap(ang)], symbol: 'none' },
      { value: [r, wrap(ang)], symbol: 'arrow', symbolSize: size, symbolRotate: ang - 90 },
    ];
    const series = pdc.phases.flatMap((ph, k) => {
      const ang = 90 - k * 120;
      const ia = ang - (Math.acos(Math.min(0.999, ph.pf)) * 180) / Math.PI;
      return [
        { type: 'line', coordinateSystem: 'polar', name: `U${ph.phase}`, data: arrow(ph.v, ang, 10), color: colors[k], lineStyle: { width: 2.4 }, showSymbol: true },
        {
          type: 'line',
          coordinateSystem: 'polar',
          name: `I${ph.phase}`,
          data: arrow((ph.i / imax) * vmax * 0.75, ia, 8),
          color: colors[k],
          lineStyle: { width: 1.6, type: 'dashed' },
          showSymbol: true,
        },
      ];
    });
    return {
      polar: { radius: '70%', center: ['50%', '46%'] },
      angleAxis: { type: 'value', startAngle: 0, clockwise: false, min: 0, max: 360, interval: 30, axisLabel: { show: false }, splitLine: { lineStyle: { type: 'dashed', opacity: 0.4 } }, axisLine: { lineStyle: { opacity: 0.3 } } },
      radiusAxis: { min: 0, max: vmax, axisLabel: { show: false }, splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } }, axisLine: { show: false } },
      tooltip: { show: false },
      legend: { bottom: 0, itemWidth: 14, itemHeight: 6, data: series.map((x) => x.name) },
      series,
    };
  }, [pdc]);

  const quality = [
    { item: '电压偏差', value: `${(((src.v - 220) / 220) * 100).toFixed(2)}%`, limit: '+7% / -10%', ok: Math.abs(src.v - 220) / 220 < 0.07, std: 'GB/T 12325' },
    { item: '频率偏差', value: `${(src.f - 50).toFixed(3)} Hz`, limit: '±0.2 Hz', ok: Math.abs(src.f - 50) < 0.2, std: 'GB/T 15945' },
    { item: '电压总谐波畸变率', value: `${thdV.toFixed(2)}%`, limit: '≤ 5%', ok: thdV < 5, std: 'GB/T 14549' },
    { item: '电流总谐波畸变率', value: `${thdI.toFixed(2)}%`, limit: '≤ 15%（参考）', ok: thdI < 15, std: 'IEEE 519' },
    { item: '三相电流不平衡度', value: `${pdc.unbalance.toFixed(2)}%`, limit: '≤ 15%（参考）', ok: pdc.unbalance < 15, std: '运维规程' },
    { item: '长时闪变 Plt', value: (0.18 + hash(seed, Math.floor(tick / 60)) * 0.12).toFixed(2), limit: '≤ 1.0', ok: true, std: 'GB/T 12326' },
  ];

  const options = [
    { label: '列头柜进线', options: sources.filter((x) => x.key.includes(':')).map((x) => ({ value: x.key, label: x.label })) },
    { label: '机柜 PDU', options: sources.filter((x) => !x.key.includes(':')).map((x) => ({ value: x.key, label: x.label })) },
  ];

  return (
    <div>
      <PageHead
        module="电参采集模块"
        title="波形分析"
        desc="基于 12.8 kHz 同步采样的瞬时波形，进行 FFT 谐波分解、相量与电能质量指标评估"
        extra={
          <Space>
            <span className="muted" style={{ fontSize: 12 }}>
              分析对象
            </span>
            <Select showSearch value={key} onChange={setKey} options={options} style={{ width: 200 }} />
          </Space>
        }
      />
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(8, minmax(0,1fr))' }}>
            <MiniStat label="电压有效值" value={fx(src.v, 1)} unit="V" />
            <MiniStat label="电流有效值" value={fx(src.i, 2)} unit="A" />
            <MiniStat label="频率" value={fx(src.f, 3)} unit="Hz" />
            <MiniStat label="THDu" value={fx(thdV, 2)} unit="%" color={thdV > 5 ? PALETTE.red : undefined} />
            <MiniStat label="THDi" value={fx(thdI, 2)} unit="%" color={thdI > 15 ? PALETTE.orange : undefined} />
            <MiniStat label="电压波峰系数" value={fx(crestV, 3)} />
            <MiniStat label="电流波峰系数" value={fx(crestI, 3)} />
            <MiniStat label="位移 / 总功率因数" value={`${fx(dpf, 3)} / ${fx(tpf, 3)}`} />
          </div>
        </Col>
        <Col xs={24} xl={16}>
          <Panel title="瞬时波形" sub={`${CYCLES} 个周波 · ${N} 点/周波`} extra={<SoftTag color={PALETTE.blue}>同步采样</SoftTag>}>
            <EChart option={waveOpt} height={300} />
          </Panel>
        </Col>
        <Col xs={24} xl={8}>
          <Panel title="三相相量图" sub={pdc.id}>
            <EChart option={phasorOpt} height={300} />
          </Panel>
        </Col>
        <Col xs={24} xl={14}>
          <Panel title="谐波频谱" sub={`2 ~ ${H_MAX} 次 · FFT`}>
            <EChart option={specOpt} height={290} />
          </Panel>
        </Col>
        <Col xs={24} xl={10}>
          <Panel title="电能质量评估" flush>
            <Table
              size="small"
              pagination={false}
              rowKey="item"
              dataSource={quality}
              columns={[
                { title: '指标', dataIndex: 'item' },
                { title: '实测', dataIndex: 'value', render: (v) => <span className="num">{v}</span> },
                { title: '限值', dataIndex: 'limit', render: (v) => <span className="muted">{v}</span> },
                { title: '依据', dataIndex: 'std', render: (v) => <span className="muted" style={{ fontSize: 12 }}>{v}</span> },
                { title: '结论', dataIndex: 'ok', width: 70, render: (ok: boolean) => (ok ? <Tag color="success">合格</Tag> : <Tag color="error">超限</Tag>) },
              ]}
            />
            <div className="muted" style={{ fontSize: 12, padding: '10px 16px 14px' }}>
              近 1 小时未检出电压暂降、暂升及短时中断事件。
            </div>
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
