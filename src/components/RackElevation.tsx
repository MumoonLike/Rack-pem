import { Tooltip } from 'antd';
import type { Snapshot } from '@/core/model';
import { LEVEL_U, RACK_MAP, type DeviceKind, type Level, type Side } from '@/core/topology';
import { PALETTE, hexA, heatColor } from '@/theme';

const KIND_COLOR: Record<DeviceKind, string> = {
  server: PALETTE.blue,
  gpu: PALETTE.purple,
  storage: PALETTE.teal,
  switch: PALETTE.cyan,
  patch: PALETTE.slate,
  kvm: PALETTE.slate,
  firewall: PALETTE.orange,
  blank: PALETTE.slate,
};

const KIND_LABEL: Record<DeviceKind, string> = {
  server: '服务器',
  gpu: 'GPU 服务器',
  storage: '存储',
  switch: '交换机',
  patch: '配线',
  kvm: 'KVM',
  firewall: '防火墙',
  blank: '盲板',
};

const LEVELS: Level[] = ['B', 'M', 'T'];

export default function RackElevation({
  rackId,
  snap,
  rowH = 11,
  highlight,
  showSensors = true,
}: {
  rackId: string;
  snap: Snapshot;
  rowH?: number;
  highlight?: { side: Side; level: Level; uEst?: number } | null;
  showSensors?: boolean;
}) {
  const def = RACK_MAP[rackId];
  const rs = snap.rackMap[rackId];
  const H = 42 * rowH;
  const sensor = (side: Side, level: Level) => {
    const idx = LEVELS.indexOf(level);
    const t = side === 'F' ? rs.tin[idx] : rs.tout[idx];
    const color = side === 'F' ? heatColor(t, 19, 28) : heatColor(t, 26, 48);
    const top = (42 - LEVEL_U[level]) * rowH - 9;
    const hl = highlight && highlight.side === side && highlight.level === level;
    return (
      <Tooltip key={`${side}${level}`} title={`${side === 'F' ? '进风' : '出风'}·${{ T: '上', M: '中', B: '下' }[level]}（U${LEVEL_U[level]}）`}>
        <div
          className="num"
          style={{
            position: 'absolute',
            top,
            [side === 'F' ? 'left' : 'right']: 0,
            width: 50,
            height: 18,
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 600,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: color,
            boxShadow: hl ? `0 0 0 3px ${hexA(PALETTE.red, 0.45)}, 0 0 14px ${PALETTE.red}` : '0 2px 6px rgba(0,0,0,.25)',
            zIndex: 2,
          }}
        >
          {t.toFixed(1)}℃
        </div>
      </Tooltip>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {showSensors && (
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 11 }} className="muted">
          <span>前门 · 进风</span>
          <span>后门 · 出风</span>
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', height: H + 14 }}>
        {showSensors && LEVELS.map((l) => sensor('F', l))}
        {showSensors && LEVELS.map((l) => sensor('R', l))}
        <div className="rack-elev" style={{ position: 'absolute', left: showSensors ? 58 : 0, right: showSensors ? 58 : 0, top: 0, height: H + 14 }}>
          <div style={{ position: 'relative', height: H, marginLeft: 22 }}>
            {Array.from({ length: 42 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: -24,
                  top: i * rowH,
                  height: rowH,
                  width: 18,
                  fontSize: 8,
                  lineHeight: `${rowH}px`,
                  textAlign: 'right',
                  color: 'var(--text-3)',
                  opacity: (42 - i) % 5 === 0 || i === 0 ? 1 : 0,
                }}
                className="num"
              >
                {42 - i}
              </div>
            ))}
            {Array.from({ length: 42 }, (_, i) => (
              <div key={`g${i}`} style={{ position: 'absolute', left: 0, right: 0, top: i * rowH, height: rowH, borderTop: '1px dashed var(--line)' }} />
            ))}
            {def.devices.map((d) => {
              const c = KIND_COLOR[d.kind];
              return (
                <Tooltip key={d.u} title={`${d.name} · ${d.model} · U${d.u}${d.height > 1 ? `-${d.u + d.height - 1}` : ''} · ${KIND_LABEL[d.kind]}${d.ratedW ? ` · ${d.ratedW} W` : ''}`}>
                  <div
                    className="rack-dev"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: (42 - (d.u + d.height - 1)) * rowH + 1,
                      height: d.height * rowH - 2,
                      background: `linear-gradient(90deg, ${hexA(c, 0.32)}, ${hexA(c, 0.14)})`,
                      borderColor: hexA(c, 0.5),
                      fontSize: d.height * rowH >= 14 ? 10.5 : 8,
                      lineHeight: 1,
                    }}
                  >
                    {d.height * rowH >= 9 ? d.name : ''}
                  </div>
                </Tooltip>
              );
            })}
            {highlight?.uEst !== undefined && (
              <div
                style={{
                  position: 'absolute',
                  left: -6,
                  right: -6,
                  top: (42 - highlight.uEst) * rowH - 1,
                  height: 2,
                  background: PALETTE.red,
                  boxShadow: `0 0 10px ${PALETTE.red}`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
