import {
  BellOutlined,
  EnvironmentOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Breadcrumb, Button, Dropdown, Empty, Layout, Menu, Popover, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LEVEL_META } from '@/core/alarms';
import { engine, TICK_MS, useTelemetry } from '@/core/engine';
import { tstr } from '@/core/format';
import { SERIES_KEYS } from '@/core/model';
import { SITE } from '@/core/topology';
import { Dot, LevelTag } from '@/components/ui';
import { NAV, findNav } from '@/nav';
import { PALETTE, useThemeMode } from '@/theme';

const { Sider, Header, Content } = Layout;

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3E8BFF" />
          <stop offset="1" stopColor="#22C3D6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#bm)" />
      <rect x="9" y="6.5" width="14" height="19" rx="2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M11.5 11.5h9M11.5 15.5h9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      <path d="M10.5 21h3l1.2-2.4 1.8 4 1.4-2.6h3.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="header-chip num" style={{ minWidth: 168, justifyContent: 'center' }}>
      {dayjs(now).format('YYYY-MM-DD HH:mm:ss')}
    </span>
  );
}

function AlarmBell() {
  useTelemetry();
  const nav = useNavigate();
  const active = engine.alarms.activeList();
  const unacked = active.filter((a) => !a.ackTime).length;
  const content = (
    <div style={{ width: 340 }}>
      {active.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无活动告警" />
      ) : (
        active.slice(0, 6).map((a) => (
          <div key={a.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => nav('/alarms')}>
            <LevelTag level={a.level} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.target} · {a.title}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {tstr(a.start)} 起
              </div>
            </div>
          </div>
        ))
      )}
      <Button type="link" block onClick={() => nav('/alarms')}>
        进入告警中心
      </Button>
    </div>
  );
  const worst = active[0]?.level;
  return (
    <Popover content={content} title={`活动告警 ${active.length} 条`} placement="bottomRight" trigger="click">
      <Badge count={unacked} size="small" offset={[-2, 2]} color={worst ? LEVEL_META[worst].color : undefined}>
        <Button type="text" shape="circle" icon={<BellOutlined style={{ fontSize: 17 }} />} />
      </Badge>
    </Popover>
  );
}

function LinkStatus() {
  const v = useTelemetry();
  const age = Date.now() - engine.snapshot.t;
  const ok = age < TICK_MS * 3;
  return (
    <Tooltip title={`最近采集 ${tstr(engine.snapshot.t)}，测点 ${SERIES_KEYS.length} 个`}>
      <span className="header-chip" data-v={v}>
        <Dot color={ok ? PALETTE.green : PALETTE.amber} pulse />
        采集链路{ok ? '正常' : '延迟'} · {TICK_MS / 1000}s
      </span>
    </Tooltip>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [full, setFull] = useState(false);
  const { mode, toggle } = useThemeMode();
  const loc = useLocation();
  const nav = useNavigate();
  const { group, leaf } = findNav(loc.pathname);

  const items = useMemo(
    () =>
      NAV.map((g) =>
        g.children
          ? {
              key: g.key,
              icon: g.icon,
              label: g.label,
              children: g.children.map((c) => ({ key: c.path, label: c.label })),
            }
          : { key: g.path!, icon: g.icon, label: g.label },
      ),
    [],
  );
  const [openKeys, setOpenKeys] = useState<string[]>(group?.children ? [group.key] : []);
  useEffect(() => {
    if (group?.children && !openKeys.includes(group.key)) setOpenKeys((k) => [...k, group.key]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    document.title = `${leaf?.label ?? group?.label ?? '运行总览'} · 中心机柜动力环监一体化系统`;
  }, [leaf, group]);

  const crumbs = [{ title: <span className="hide-sm">中心机柜动力环监一体化系统</span> }, ...(group ? [{ title: group.module ?? group.label }] : []), ...(leaf ? [{ title: leaf.label }] : [])];

  return (
    <Layout className="app-shell">
      <Sider width={228} collapsedWidth={68} collapsed={collapsed} className="app-sider" theme={mode}>
        <div className="brand">
          <BrandMark />
          {!collapsed && (
            <div className="brand-text">
              <div className="brand-title">动力环监一体化</div>
              <div className="brand-sub">RACK · PEM</div>
            </div>
          )}
        </div>
        <div className="menu-scroll">
          <Menu
            mode="inline"
            theme={mode}
            items={items}
            selectedKeys={[loc.pathname]}
            openKeys={collapsed ? undefined : openKeys}
            onOpenChange={(k) => setOpenKeys(k as string[])}
            onClick={(e) => nav(e.key)}
            style={{ borderInlineEnd: 'none', paddingTop: 8 }}
          />
        </div>
        {!collapsed && (
          <div className="sider-foot">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>采集周期</span>
              <span className="num text-2">{TICK_MS / 1000} s</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span>接入测点</span>
              <span className="num text-2">{SERIES_KEYS.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span>系统版本</span>
              <span className="num text-2">V2.3.0</span>
            </div>
          </div>
        )}
      </Sider>
      <Layout style={{ background: 'transparent', minWidth: 0 }}>
        <Header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((c) => !c)} />
            <Breadcrumb items={crumbs} />
          </div>
          <div className="header-tools">
            <span className="header-chip hide-md">
              <EnvironmentOutlined />
              {SITE.building} · {SITE.name.split('·')[1]?.trim()}
            </span>
            <LinkStatus />
            <Clock />
            <AlarmBell />
            <Tooltip title={mode === 'dark' ? '切换浅色主题' : '切换深色主题'}>
              <Button type="text" shape="circle" icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} />
            </Tooltip>
            <Tooltip title={full ? '退出全屏' : '全屏'}>
              <Button
                type="text"
                shape="circle"
                icon={full ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  { key: 'p', icon: <UserOutlined />, label: '个人信息' },
                  { key: 's', icon: <SettingOutlined />, label: '阈值策略' },
                  { type: 'divider' },
                  { key: 'o', icon: <LogoutOutlined />, label: '退出登录' },
                ],
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar size={30} style={{ background: 'linear-gradient(135deg,#3E8BFF,#22C3D6)' }} icon={<UserOutlined />} />
                <span className="text-2 user-name hide-sm" style={{ fontSize: 13 }}>
                  值班工程师
                </span>
              </span>
            </Dropdown>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        <div className="app-footer">中心机柜动力环监一体化系统 · 运维中心 © {new Date().getFullYear()}</div>
      </Layout>
    </Layout>
  );
}
