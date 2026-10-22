import {
  AimOutlined,
  ApartmentOutlined,
  BellOutlined,
  CloudOutlined,
  DashboardOutlined,
  FireOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';

export interface NavLeaf {
  path: string;
  label: string;
  component: LazyExoticComponent<ComponentType>;
}

export interface NavGroup {
  key: string;
  label: string;
  module?: string;
  icon: ReactNode;
  path?: string;
  component?: LazyExoticComponent<ComponentType>;
  children?: NavLeaf[];
}

export const NAV: NavGroup[] = [
  {
    key: 'overview',
    label: '运行总览',
    icon: <DashboardOutlined />,
    path: '/overview',
    component: lazy(() => import('./pages/overview')),
  },
  {
    key: 'power',
    label: '电参采集',
    module: '电参采集模块',
    icon: <ThunderboltOutlined />,
    children: [
      { path: '/power/signal', label: '信号采集', component: lazy(() => import('./pages/power/Signal')) },
      { path: '/power/waveform', label: '波形分析', component: lazy(() => import('./pages/power/Waveform')) },
      { path: '/power/sequence', label: '序列生成', component: lazy(() => import('./pages/power/Sequence')) },
    ],
  },
  {
    key: 'env',
    label: '环境联测',
    module: '环境联测模块',
    icon: <CloudOutlined />,
    children: [
      { path: '/env/humidity', label: '湿度监测', component: lazy(() => import('./pages/env/Humidity')) },
      { path: '/env/correlation', label: '关联分析', component: lazy(() => import('./pages/env/Correlation')) },
      { path: '/env/path', label: '路径识别', component: lazy(() => import('./pages/env/AirPath')) },
    ],
  },
  {
    key: 'thermal',
    label: '温升识别',
    module: '温升识别模块',
    icon: <FireOutlined />,
    children: [
      { path: '/thermal/locate', label: '节点定位', component: lazy(() => import('./pages/thermal/Locate')) },
      { path: '/thermal/direction', label: '热向分析', component: lazy(() => import('./pages/thermal/Direction')) },
      { path: '/thermal/screening', label: '温升筛选', component: lazy(() => import('./pages/thermal/Screening')) },
    ],
  },
  {
    key: 'anomaly',
    label: '异常联判',
    module: '异常联判模块',
    icon: <ApartmentOutlined />,
    children: [
      { path: '/anomaly/ranking', label: '节点排序分析', component: lazy(() => import('./pages/anomaly/Ranking')) },
      { path: '/anomaly/consistency', label: '分布一致性计算', component: lazy(() => import('./pages/anomaly/Consistency')) },
      { path: '/anomaly/fusion', label: '融合路径构建', component: lazy(() => import('./pages/anomaly/Fusion')) },
    ],
  },
  {
    key: 'feedback',
    label: '结果反馈',
    module: '结果反馈模块',
    icon: <AimOutlined />,
    children: [
      { path: '/feedback/chains', label: '路径链组提取', component: lazy(() => import('./pages/feedback/Chains')) },
      { path: '/feedback/response', label: '负载响应分析', component: lazy(() => import('./pages/feedback/LoadResponse')) },
      { path: '/feedback/efficiency', label: '能效路径筛选', component: lazy(() => import('./pages/feedback/Efficiency')) },
    ],
  },
  {
    key: 'alarms',
    label: '告警中心',
    icon: <BellOutlined />,
    path: '/alarms',
    component: lazy(() => import('./pages/alarms')),
  },
];

export function findNav(pathname: string): { group?: NavGroup; leaf?: NavLeaf } {
  for (const g of NAV) {
    if (g.path === pathname) return { group: g };
    const leaf = g.children?.find((c) => c.path === pathname);
    if (leaf) return { group: g, leaf };
  }
  return {};
}
