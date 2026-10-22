import { BarChart, BoxplotChart, CustomChart, GaugeChart, GraphChart, HeatmapChart, LineChart, PieChart, RadarChart, SankeyChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, type CSSProperties } from 'react';
import { CHART_TOKENS, SERIES_COLORS, useThemeMode, type Mode } from '@/theme';

echarts.use([
  LineChart,
  BoxplotChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  GraphChart,
  SankeyChart,
  GaugeChart,
  RadarChart,
  PieChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  DataZoomComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  GraphicComponent,
  CanvasRenderer,
]);

function buildTheme(mode: Mode) {
  const t = CHART_TOKENS[mode];
  const axis = {
    axisLine: { show: true, lineStyle: { color: t.axis } },
    axisTick: { show: false, lineStyle: { color: t.axis } },
    axisLabel: { color: t.subtext, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: t.split, type: 'dashed' } },
    nameTextStyle: { color: t.subtext, fontSize: 11 },
  };
  return {
    color: SERIES_COLORS,
    backgroundColor: 'transparent',
    textStyle: {
      color: t.text,
      fontFamily: "'Barlow', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    title: { textStyle: { color: t.text }, subtextStyle: { color: t.subtext } },
    legend: { textStyle: { color: t.subtext, fontSize: 12 }, pageTextStyle: { color: t.subtext }, pageIconColor: t.text },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.25);backdrop-filter:blur(6px);',
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: { ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    logAxis: axis,
    line: { symbol: 'none', smooth: false, lineStyle: { width: 1.6 } },
    gauge: { title: { color: t.subtext }, detail: { color: t.text } },
    visualMap: { textStyle: { color: t.subtext } },
    dataZoom: {
      borderColor: t.axis,
      textStyle: { color: t.subtext },
      handleStyle: { color: t.text },
      fillerColor: 'rgba(62,139,255,0.15)',
      dataBackground: { lineStyle: { color: t.axis }, areaStyle: { color: t.split } },
    },
    graph: { label: { color: t.text } },
  };
}

echarts.registerTheme('pem-dark', buildTheme('dark'));
echarts.registerTheme('pem-light', buildTheme('light'));

export type EOption = echarts.EChartsCoreOption;

interface Props {
  option: EOption;
  height?: number | string;
  style?: CSSProperties;
  className?: string;
  notMerge?: boolean;
  onClick?: (params: any) => void;
}

export default function EChart({ option, height = 260, style, className, notMerge, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const { mode } = useThemeMode();
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, `pem-${mode}`, { renderer: 'canvas' });
    inst.current = chart;
    chart.setOption(optionRef.current);
    chart.on('click', (p) => clickRef.current?.(p));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, [mode]);

  useEffect(() => {
    inst.current?.setOption(option, notMerge ? { notMerge: true } : undefined);
  }, [option, notMerge]);

  return <div ref={ref} className={className} style={{ width: '100%', height, ...style }} />;
}

export { echarts };
