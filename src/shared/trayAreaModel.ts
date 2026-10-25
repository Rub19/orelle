export interface TrayAreaState {
  wifi: { connected: boolean; signal: number | null } | null;
  volume: { level: number; muted: boolean } | null;
  battery: { percent: number; charging: boolean; present: boolean } | null;
  unread: number;
  windowsUpdatePending: boolean;
  orelleUpdateAvailable: boolean;
}

export type TrayAreaItemId = 'network' | 'volume' | 'battery' | 'update' | 'notifications' | 'clock' | 'peek';

/** The compact status order used by the bottom-right Orelle surface. */
export function trayAreaItems(state: TrayAreaState): TrayAreaItemId[] {
  const items: TrayAreaItemId[] = ['network'];
  if (state.volume) items.push('volume');
  if (state.battery?.present) items.push('battery');
  if (state.windowsUpdatePending || state.orelleUpdateAvailable) items.push('update');
  items.push('notifications', 'clock', 'peek');
  return items;
}
