import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

dayjs.locale('zh-cn');

export type Mode = 'dark' | 'light';

export const PALETTE = {
  blue: '#3E8BFF',
  cyan: '#22C3D6',
  green: '#36C690',
  amber: '#F5B83D',
  orange: '#FF8A3D',
  red: '#FF5A5F',
  purple: '#8C7BFF',
  pink: '#F06EAA',
  teal: '#2BB3A3',
  slate: '#7F8EA3',
};

export const SERIES_COLORS = [
  PALETTE.blue,
  PALETTE.cyan,
  PALETTE.amber,
  PALETTE.purple,
  PALETTE.green,
  PALETTE.orange,
  PALETTE.pink,
  PALETTE.teal,
  PALETTE.red,
];

export interface ChartTokens {
  mode: Mode;
  text: string;
  subtext: string;
  axis: string;
  split: string;
  panel: string;
  tooltipBg: string;
  tooltipBorder: string;
  area: (c: string, a?: number) => string;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const CHART_TOKENS: Record<Mode, ChartTokens> = {
  dark: {
    mode: 'dark',
    text: '#C9D4E5',
    subtext: '#7F8EA3',
    axis: 'rgba(148,163,184,0.28)',
    split: 'rgba(148,163,184,0.10)',
    panel: '#111A2B',
    tooltipBg: 'rgba(15,23,38,0.96)',
    tooltipBorder: 'rgba(148,163,184,0.22)',
    area: (c, a = 0.25) => hexA(c, a),
  },
  light: {
    mode: 'light',
    text: '#3A4A61',
    subtext: '#7A889C',
    axis: 'rgba(100,116,139,0.35)',
    split: 'rgba(100,116,139,0.14)',
    panel: '#FFFFFF',
    tooltipBg: 'rgba(255,255,255,0.98)',
    tooltipBorder: 'rgba(100,116,139,0.2)',
    area: (c, a = 0.18) => hexA(c, a),
  },
};

export { hexA };

interface ThemeCtxValue {
  mode: Mode;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeCtxValue>({ mode: 'dark', toggle: () => {} });

function readMode(): Mode {
  try {
    const v = localStorage.getItem('pem.theme');
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* 存储不可用时使用默认值 */
  }
  return 'dark';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(readMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem('pem.theme', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const value = useMemo(() => ({ mode, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }), [mode]);
  const dark = mode === 'dark';

  return (
    <ThemeCtx.Provider value={value}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: PALETTE.blue,
            colorInfo: PALETTE.blue,
            colorSuccess: PALETTE.green,
            colorWarning: PALETTE.amber,
            colorError: PALETTE.red,
            borderRadius: 8,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
            colorBgLayout: dark ? '#0A111E' : '#F2F5F9',
            colorBgContainer: dark ? '#111A2B' : '#FFFFFF',
            colorBgElevated: dark ? '#162238' : '#FFFFFF',
            colorBorder: dark ? 'rgba(148,163,184,0.22)' : '#DCE3EC',
            colorBorderSecondary: dark ? 'rgba(148,163,184,0.12)' : '#E8EDF3',
            colorText: dark ? '#E3EAF5' : '#1F2A3D',
            colorTextSecondary: dark ? '#93A3BA' : '#5F6E84',
          },
          components: {
            Layout: {
              headerBg: dark ? '#0D1626' : '#FFFFFF',
              siderBg: dark ? '#0D1626' : '#FFFFFF',
              bodyBg: dark ? '#0A111E' : '#F2F5F9',
              headerHeight: 56,
              headerPadding: '0 20px',
            },
            Menu: {
              itemBg: 'transparent',
              subMenuItemBg: 'transparent',
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              darkItemSelectedBg: 'rgba(62,139,255,0.16)',
              darkItemSelectedColor: '#7CB2FF',
              itemSelectedBg: 'rgba(62,139,255,0.10)',
              itemBorderRadius: 8,
              itemMarginInline: 10,
              itemHeight: 40,
            },
            Card: { headerFontSize: 14, paddingLG: 16 },
            Table: {
              headerBg: dark ? '#14203A' : '#F5F7FA',
              rowHoverBg: dark ? 'rgba(62,139,255,0.08)' : '#F3F8FF',
              cellPaddingBlockSM: 7,
              borderColor: dark ? 'rgba(148,163,184,0.12)' : '#EDF1F6',
            },
            Segmented: { itemSelectedBg: dark ? '#22324F' : '#FFFFFF' },
            Tabs: { horizontalMargin: '0 0 12px 0' },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeCtx);
}

export function useChartTokens() {
  return CHART_TOKENS[useThemeMode().mode];
}

/** 温度/指标热力色带 */
const HEAT_STOPS: [number, string][] = [
  [0, '#2F6BFF'],
  [0.25, '#22C3D6'],
  [0.5, '#36C690'],
  [0.7, '#F5D63D'],
  [0.85, '#FF8A3D'],
  [1, '#FF4D4F'],
];

export const HEAT_COLORS = HEAT_STOPS.map((s) => s[1]);

export function heatColor(v: number, lo: number, hi: number) {
  const x = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i];
    const [p0, c0] = HEAT_STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      const a = parseInt(c0.slice(1), 16);
      const b = parseInt(c1.slice(1), 16);
      const mix = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * f);
      return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}
