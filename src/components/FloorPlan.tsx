import { Badge, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { LEVEL_META, type AlarmLevel } from '@/core/alarms';
import { engine } from '@/core/engine';
import type { Snapshot } from '@/core/model';
import { ACUS, KIND_LABEL, PDCS, RACKS, ROW_SLOTS, type RowId } from '@/core/topology';
import { PALETTE, hexA } from '@/theme';

export interface CellValue {
  value: string;
  sub?: string;
  color: string;
  bar?: number;
  tip?: ReactNode;
}

interface Props {
  snap: Snapshot;
  cell: (rackId: string) => CellValue;
  selected?: string | null;
  onSelect?: (rackId: string) => void;
  showAlarms?: boolean;
  compact?: boolean;
}

function rackAlarmLevel(id: string): AlarmLevel | undefined {
  let lvl: AlarmLevel | undefined;
  for (const a of engine.alarms.active.values()) {
    if (a.rack === id && (!lvl || a.level < lvl)) lvl = a.level;
  }
  return lvl;
}

export default function FloorPlan({ snap, cell, selected, onSelect, showAlarms = true, compact }: Props) {
  const row = (rowId: RowId) => {
    const cells: ReactNode[] = [];
    for (let slot = 0; slot < ROW_SLOTS; slot++) {
      const rack = RACKS.find((r) => r.row === rowId && r.slot === slot);
      const acu = ACUS.find((a) => a.row === rowId && a.slot === slot);
      const pdc = PDCS.find((p) => p.row === rowId && p.slot === slot);
      if (rack) {
        const c = cell(rack.id);
        const lvl = showAlarms ? rackAlarmLevel(rack.id) : undefined;
        cells.push(
          <Tooltip key={slot} title={c.tip ?? `${rack.id} · ${KIND_LABEL[rack.kind]}`} mouseEnterDelay={0.3}>
            <div
              className={`floor-cell ${selected === rack.id ? 'selected' : ''}`}
              style={{
                background: `linear-gradient(180deg, ${hexA(c.color, 0.26)}, ${hexA(c.color, 0.08)})`,
                borderColor: selected === rack.id ? undefined : hexA(c.color, 0.45),
                height: compact ? 58 : undefined,
              }}
              onClick={() => onSelect?.(rack.id)}
            >
              <div className="fc-name">
                <span>{rack.id}</span>
              </div>
              <div>
                <div className="fc-val num">{c.value}</div>
                {!compact && c.sub && <div className="fc-sub">{c.sub}</div>}
              </div>
              {c.bar !== undefined && <div className="fc-bar" style={{ width: `${Math.min(100, c.bar * 100)}%`, background: c.color }} />}
              {lvl && (
                <span className="fc-alarm">
                  <Badge color={LEVEL_META[lvl].color} status="processing" />
                </span>
              )}
            </div>
          </Tooltip>,
        );
      } else if (acu) {
        const a = snap.acus.find((x) => x.id === acu.id)!;
        const warn = a.supply - a.setpoint > 2;
        cells.push(
          <Tooltip key={slot} title={`${acu.id} 送风 ${a.supply.toFixed(1)}℃ / 回风 ${a.ret.toFixed(1)}℃ / 风机 ${a.fan.toFixed(0)}%`}>
            <div className="floor-cell infra" style={{ borderStyle: 'dashed', borderColor: warn ? PALETTE.orange : hexA(PALETTE.cyan, 0.5), height: compact ? 58 : undefined }}>
              <div className="fc-name" style={{ color: PALETTE.cyan, fontSize: 11 }}>
                {acu.id.replace('ACU-', '空调 ')}
              </div>
              <div>
                <div className="fc-val num" style={{ fontSize: 13, color: warn ? PALETTE.orange : undefined }}>
                  {a.supply.toFixed(1)}℃
                </div>
                {!compact && <div className="fc-sub">风机 {a.fan.toFixed(0)}%</div>}
              </div>
              <div
                className="fc-bar"
                style={{ width: `${a.fan}%`, background: `repeating-linear-gradient(90deg, ${PALETTE.cyan} 0 4px, transparent 4px 6px)` }}
              />
            </div>
          </Tooltip>,
        );
      } else if (pdc) {
        const p = snap.pdcs.find((x) => x.id === pdc.id)!;
        cells.push(
          <Tooltip key={slot} title={`${pdc.id}（${pdc.path} 路）· ${p.kw.toFixed(1)} kW · 不平衡度 ${p.unbalance.toFixed(1)}%`}>
            <div className="floor-cell infra" style={{ borderColor: hexA(PALETTE.amber, 0.5), height: compact ? 58 : undefined }}>
              <div className="fc-name" style={{ color: PALETTE.amber, fontSize: 11 }}>
                列头柜
              </div>
              <div>
                <div className="fc-val num" style={{ fontSize: 13 }}>
                  {p.kw.toFixed(1)}
                  <span className="muted" style={{ fontSize: 10, marginLeft: 2 }}>
                    kW
                  </span>
                </div>
                {!compact && <div className="fc-sub">{pdc.id} · {pdc.path} 路</div>}
              </div>
            </div>
          </Tooltip>,
        );
      }
    }
    return <div className="floor-row">{cells}</div>;
  };

  return (
    <div className="floor-wrap">
      <div className="floor">
        <div className="floor-aisle hot">热通道 A</div>
        {row('A')}
        <div className="floor-aisle cold">封闭冷通道</div>
        {row('B')}
        <div className="floor-aisle hot">热通道 B</div>
      </div>
    </div>
  );
}
