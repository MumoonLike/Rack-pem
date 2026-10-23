import { DownloadOutlined, HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { App, Button, Col, DatePicker, Empty, Form, Radio, Row, Select, Space, Spin, Table, Tabs, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import EChart from '@/components/EChart';
import { legendTopRight } from '@/components/chartKit';
import { MiniStat, PageHead, Panel } from '@/components/ui';
import { mean, quantile, std } from '@/core/analytics';
import { fx, tstr } from '@/core/format';
import { computeSnapshot, type Snapshot } from '@/core/model';
import { RACKS } from '@/core/topology';

type Param = 'load' | 'ia' | 'ib' | 'v' | 'pf' | 'thdi' | 'tin' | 'tout' | 'rh' | 'pue';
type Agg = 'avg' | 'max' | 'min' | 'p95';

const PARAMS: Record<Param, { label: string; unit: string; d: number }> = {
  load: { label: 'IT 负载', unit: 'kW', d: 2 },
  ia: { label: 'A 路电流', unit: 'A', d: 2 },
  ib: { label: 'B 路电流', unit: 'A', d: 2 },
  v: { label: 'A 路电压', unit: 'V', d: 1 },
  pf: { label: '功率因数', unit: '', d: 3 },
  thdi: { label: '电流谐波畸变率', unit: '%', d: 2 },
  tin: { label: '进风温度（上）', unit: '℃', d: 2 },
  tout: { label: '出风温度（上）', unit: '℃', d: 2 },
  rh: { label: '进风相对湿度', unit: '%RH', d: 1 },
  pue: { label: 'PUE', unit: '', d: 3 },
};

const GRANS = [
  { value: 10, label: '10 秒' },
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 3600, label: '1 小时' },
];

const AGG_LABEL: Record<Agg, string> = { avg: '平均值', max: '最大值', min: '最小值', p95: 'P95' };

function pick(s: Snapshot, obj: string, p: Param): number {
  if (obj === 'ROOM') {
    switch (p) {
      case 'load':
        return s.room.it;
      case 'pue':
        return s.room.pue;
      case 'tin':
        return s.room.tinMax;
      case 'tout':
        return s.room.toutMax;
      case 'rh':
        return s.room.rhAvg;
      case 'ia':
        return s.pdcs[0].phases.reduce((a, x) => a + x.i, 0);
      case 'ib':
        return s.pdcs[1].phases.reduce((a, x) => a + x.i, 0);
      case 'v':
        return s.pdcs[0].phases[0].v;
      case 'pf':
        return s.pdcs[0].phases.reduce((a, x) => a + x.pf, 0) / 3;
      case 'thdi':
        return mean(s.racks.map((r) => r.pa.thdi));
    }
  }
  const r = s.rackMap[obj];
  switch (p) {
    case 'load':
      return r.load;
    case 'ia':
      return r.pa.i;
    case 'ib':
      return r.pb.i;
    case 'v':
      return r.pa.v;
    case 'pf':
      return r.pa.pf;
    case 'thdi':
      return r.pa.thdi;
    case 'tin':
      return r.tin[2];
    case 'tout':
      return r.tout[2];
    case 'rh':
      return r.rhF;
    case 'pue':
      return s.room.pue;
  }
}

function aggregate(v: number[], a: Agg) {
  if (a === 'avg') return mean(v);
  if (a === 'max') return Math.max(...v);
  if (a === 'min') return Math.min(...v);
  return quantile(v, 0.95);
}

interface Config {
  objects: string[];
  param: Param;
  range: [number, number];
  gran: number;
  agg: Agg;
}

interface Result {
  config: Config;
  times: number[];
  series: { obj: string; values: number[] }[];
  elapsed: number;
  evals: number;
}

interface Task {
  id: string;
  created: number;
  config: Config;
  points: number;
}

const OBJ_LABEL = (o: string) => (o === 'ROOM' ? '全机房' : o);

function loadTasks(): Task[] {
  try {
    return JSON.parse(localStorage.getItem('pem.seqTasks') || '[]');
  } catch {
    return [];
  }
}

function generate(c: Config): Result {
  const t0 = performance.now();
  const [from, to] = c.range;
  const step = c.gran * 1000;
  const buckets = Math.max(1, Math.floor((to - from) / step));
  const perBucket = Math.max(1, Math.min(Math.floor(c.gran / 2), Math.floor(6000 / buckets), 6));
  const times: number[] = [];
  const series = c.objects.map((obj) => ({ obj, values: [] as number[] }));
  let evals = 0;
  for (let b = 0; b < buckets; b++) {
    const start = from + b * step;
    const samples: number[][] = c.objects.map(() => []);
    for (let k = 0; k < perBucket; k++) {
      const t = Math.floor((start + ((k + 0.5) * step) / perBucket) / 2000) * 2000;
      const s = computeSnapshot(t);
      evals += 1;
      c.objects.forEach((o, i) => samples[i].push(pick(s, o, c.param)));
    }
    times.push(start);
    series.forEach((sr, i) => sr.values.push(aggregate(samples[i], c.agg)));
  }
  return { config: c, times, series, elapsed: performance.now() - t0, evals };
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Sequence() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tasks, setTasks] = useState<Task[]>(loadTasks);

  const run = (c: Config, record = true) => {
    setLoading(true);
    window.setTimeout(() => {
      const r = generate(c);
      setResult(r);
      setLoading(false);
      if (!record) return;
      const task: Task = { id: `SEQ-${dayjs().format('MMDDHHmmss')}`, created: Date.now(), config: c, points: r.times.length * r.series.length };
      const next = [task, ...tasks].slice(0, 12);
      setTasks(next);
      try {
        localStorage.setItem('pem.seqTasks', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      message.success(`序列生成完成：${r.series.length} 条 × ${r.times.length} 点`);
    }, 30);
  };

  const onFinish = (v: { objects: string[]; param: Param; range: [Dayjs, Dayjs]; gran: number; agg: Agg }) => {
    const span = v.range[1].valueOf() - v.range[0].valueOf();
    if (span / (v.gran * 1000) > 2016) {
      message.warning('点数过多，请增大粒度或缩短时间范围（单序列 ≤ 2016 点）');
      return;
    }
    if (span / (v.gran * 1000) < 2) {
      message.warning('时间范围过短，请减小粒度');
      return;
    }
    run({ objects: v.objects, param: v.param, range: [v.range[0].valueOf(), v.range[1].valueOf()], gran: v.gran, agg: v.agg });
  };

  useEffect(() => {
    const now = dayjs();
    run({ objects: ['A06', 'A07', 'B03'], param: 'load', range: [now.subtract(6, 'hour').valueOf(), now.valueOf()], gran: 60, agg: 'avg' }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = result ? PARAMS[result.config.param] : null;

  const exportCsv = () => {
    if (!result || !meta) return;
    const head = ['时间', ...result.series.map((s) => `${OBJ_LABEL(s.obj)}_${meta.label}${meta.unit ? `(${meta.unit})` : ''}`)].join(',');
    const rows = result.times.map((t, i) => [dayjs(t).format('YYYY-MM-DD HH:mm:ss'), ...result.series.map((s) => s.values[i].toFixed(meta.d))].join(','));
    download(`sequence_${result.config.param}_${dayjs().format('YYYYMMDDHHmmss')}.csv`, '﻿' + [head, ...rows].join('\n'), 'text/csv;charset=utf-8');
  };

  const exportJson = () => {
    if (!result || !meta) return;
    const body = {
      param: result.config.param,
      unit: meta.unit,
      aggregation: result.config.agg,
      granularitySec: result.config.gran,
      series: result.series.map((s) => ({ object: s.obj, points: result.times.map((t, i) => [t, +s.values[i].toFixed(meta.d)]) })),
    };
    download(`sequence_${result.config.param}_${dayjs().format('YYYYMMDDHHmmss')}.json`, JSON.stringify(body, null, 2), 'application/json');
  };

  const chartOpt = result &&
    meta && {
      grid: { left: 54, right: 24, top: 44, bottom: 64 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed?.(meta.d) },
      legend: { ...legendTopRight, type: 'scroll', left: 0 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true, name: meta.unit },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 12 }],
      series: result.series.map((s) => ({
        name: OBJ_LABEL(s.obj),
        type: 'line',
        showSymbol: result.times.length < 80,
        symbolSize: 4,
        data: result.times.map((t, i) => [t, s.values[i]]),
      })),
    };

  const statRows =
    result?.series.map((s) => ({
      obj: OBJ_LABEL(s.obj),
      min: Math.min(...s.values),
      max: Math.max(...s.values),
      avg: mean(s.values),
      std: std(s.values),
      p95: quantile(s.values, 0.95),
      last: s.values[s.values.length - 1],
    })) ?? [];

  const now = dayjs();
  return (
    <div>
      <PageHead module="电参采集模块" title="序列生成" desc="按对象、参数、时间窗与粒度对采集数据进行重采样与聚合，生成标准化时间序列，供分析建模与报表导出" />
      <Row gutter={[14, 14]}>
        <Col xs={24} xl={7}>
          <Panel title="生成配置">
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={onFinish}
              initialValues={{ objects: ['A06', 'A07', 'B03'], param: 'load', range: [now.subtract(6, 'hour'), now], gran: 60, agg: 'avg' }}
            >
              <Form.Item label="采集对象" name="objects" rules={[{ required: true, message: '请选择对象' }]}>
                <Select
                  mode="multiple"
                  maxTagCount="responsive"
                  options={[{ value: 'ROOM', label: '全机房' }, ...RACKS.map((r) => ({ value: r.id, label: r.id }))]}
                />
              </Form.Item>
              <Form.Item label="参数" name="param">
                <Select options={(Object.keys(PARAMS) as Param[]).map((k) => ({ value: k, label: `${PARAMS[k].label}${PARAMS[k].unit ? `（${PARAMS[k].unit}）` : ''}` }))} />
              </Form.Item>
              <Form.Item label="时间范围" name="range" rules={[{ required: true, message: '请选择时间范围' }]}>
                <DatePicker.RangePicker
                  showTime={{ format: 'HH:mm' }}
                  format="MM-DD HH:mm"
                  style={{ width: '100%' }}
                  disabledDate={(d) => d.isAfter(dayjs()) || d.isBefore(dayjs().subtract(30, 'day'))}
                  presets={[
                    { label: '近 1 小时', value: [now.subtract(1, 'hour'), now] },
                    { label: '近 6 小时', value: [now.subtract(6, 'hour'), now] },
                    { label: '近 24 小时', value: [now.subtract(24, 'hour'), now] },
                    { label: '近 7 天', value: [now.subtract(7, 'day'), now] },
                  ]}
                />
              </Form.Item>
              <Form.Item label="时间粒度" name="gran">
                <Radio.Group optionType="button" buttonStyle="solid" options={GRANS} size="small" />
              </Form.Item>
              <Form.Item label="聚合方式" name="agg">
                <Radio.Group options={(Object.keys(AGG_LABEL) as Agg[]).map((k) => ({ value: k, label: AGG_LABEL[k] }))} />
              </Form.Item>
              <Button type="primary" htmlType="submit" block icon={<PlayCircleOutlined />} loading={loading}>
                生成序列
              </Button>
            </Form>
          </Panel>
          <Panel title="生成记录" style={{ marginTop: 14 }} extra={<HistoryOutlined className="muted" />}>
            {tasks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" />
            ) : (
              tasks.slice(0, 6).map((t) => (
                <div
                  key={t.id + t.created}
                  className="list-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    form.setFieldsValue({ ...t.config, range: [dayjs(t.config.range[0]), dayjs(t.config.range[1])] });
                    run(t.config, false);
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      {PARAMS[t.config.param].label} · {t.config.objects.map(OBJ_LABEL).join('、')}
                    </div>
                    <div className="muted num" style={{ fontSize: 12 }}>
                      {dayjs(t.config.range[0]).format('MM-DD HH:mm')} ~ {dayjs(t.config.range[1]).format('MM-DD HH:mm')} · {GRANS.find((g) => g.value === t.config.gran)?.label}
                    </div>
                  </div>
                  <Tag bordered={false}>{t.points} 点</Tag>
                </div>
              ))
            )}
          </Panel>
        </Col>
        <Col xs={24} xl={17}>
          <Spin spinning={loading} tip="正在生成序列…">
            <Panel
              title="序列结果"
              sub={result && meta ? `${PARAMS[result.config.param].label} · ${AGG_LABEL[result.config.agg]} · ${GRANS.find((g) => g.value === result.config.gran)?.label}` : undefined}
              extra={
                <Space>
                  <Button size="small" icon={<DownloadOutlined />} disabled={!result} onClick={exportCsv}>
                    CSV
                  </Button>
                  <Button size="small" icon={<DownloadOutlined />} disabled={!result} onClick={exportJson}>
                    JSON
                  </Button>
                </Space>
              }
              style={{ minHeight: 640 }}
            >
              {!result || !meta ? (
                <Empty style={{ marginTop: 160 }} description="配置参数后点击“生成序列”" />
              ) : (
                <>
                  <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', marginBottom: 12 }}>
                    <MiniStat label="序列数" value={result.series.length} unit="条" />
                    <MiniStat label="单序列点数" value={result.times.length} unit="点" />
                    <MiniStat label="时间跨度" value={fx((result.config.range[1] - result.config.range[0]) / 3600000, 1)} unit="小时" />
                    <MiniStat label="重采样计算" value={result.evals.toLocaleString()} unit="次" />
                    <MiniStat label="生成耗时" value={fx(result.elapsed, 0)} unit="ms" />
                  </div>
                  <Tabs
                    items={[
                      { key: 'chart', label: '序列曲线', children: <EChart option={chartOpt!} height={420} notMerge /> },
                      {
                        key: 'stat',
                        label: '统计特征',
                        children: (
                          <Table
                            size="small"
                            rowKey="obj"
                            pagination={false}
                            dataSource={statRows}
                            columns={[
                              { title: '对象', dataIndex: 'obj' },
                              ...(['min', 'max', 'avg', 'std', 'p95', 'last'] as const).map((k) => ({
                                title: { min: '最小', max: '最大', avg: '均值', std: '标准差', p95: 'P95', last: '末值' }[k],
                                dataIndex: k,
                                align: 'right' as const,
                                render: (v: number) => <span className="num">{fx(v, meta.d)}</span>,
                              })),
                            ]}
                          />
                        ),
                      },
                      {
                        key: 'table',
                        label: '数据明细',
                        children: (
                          <Table
                            size="small"
                            rowKey="t"
                            scroll={{ x: true }}
                            pagination={{ pageSize: 12, size: 'small', showSizeChanger: false }}
                            dataSource={result.times.map((t, i) => ({ t, ...Object.fromEntries(result.series.map((s) => [s.obj, s.values[i]])) }))}
                            columns={[
                              { title: '时间', dataIndex: 't', render: (v: number) => <span className="num">{tstr(v, 'MM-DD HH:mm:ss')}</span> },
                              ...result.series.map((s) => ({
                                title: `${OBJ_LABEL(s.obj)}${meta.unit ? ` (${meta.unit})` : ''}`,
                                dataIndex: s.obj,
                                align: 'right' as const,
                                render: (v: number) => <span className="num">{fx(v, meta.d)}</span>,
                              })),
                            ]}
                          />
                        ),
                      },
                    ]}
                  />
                </>
              )}
            </Panel>
          </Spin>
        </Col>
      </Row>
    </div>
  );
}
