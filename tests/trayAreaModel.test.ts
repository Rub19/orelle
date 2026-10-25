import { describe, expect, it } from 'vitest';
import { trayAreaItems, type TrayAreaState } from '../src/shared/trayAreaModel';

const base: TrayAreaState = {
  wifi: { connected: true, signal: 87 },
  volume: { level: 42, muted: false },
  battery: { percent: 76, charging: false, present: true },
  unread: 0,
  windowsUpdatePending: false,
  orelleUpdateAvailable: false,
};

describe('tray area model', () => {
  it('keeps the Windows-like status order and hides unavailable hardware', () => {
    expect(trayAreaItems({ ...base, volume: null, battery: { ...base.battery!, present: false } })).toEqual(['network', 'notifications', 'clock', 'peek']);
  });

  it('adds one update affordance for either Windows or Orelle updates', () => {
    expect(trayAreaItems({ ...base, windowsUpdatePending: true })).toContain('update');
    expect(trayAreaItems({ ...base, orelleUpdateAvailable: true }).filter((x) => x === 'update')).toHaveLength(1);
  });
});
