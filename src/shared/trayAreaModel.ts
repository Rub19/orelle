export interface TrayAreaState {
  wifi: { connected: boolean; signal: number | null } | null;
  volume: { level: number; muted: boolean } | null;
  battery: { percent: number; charging: boolean; present: boolean } | null;
  microphone?: { level: number; muted: boolean } | null;
  /** Current Orelle/Windows input-language abbreviation, e.g. FRA or ENG. */
  keyboard?: string;
  /** Number of connected displays, used by the display affordance label. */
  displayCount?: number;
  focus?: boolean;
  unread: number;
  windowsUpdatePending: boolean;
  orelleUpdateAvailable: boolean;
}

export type TrayAreaItemId = 'network' | 'microphone' | 'keyboard' | 'display' | 'volume' | 'battery' | 'update' | 'focus' | 'notifications' | 'clock' | 'peek';

/** The compact status order used by the bottom-right Orelle surface. */
export function trayAreaItems(state: TrayAreaState): TrayAreaItemId[] {
  const items: TrayAreaItemId[] = ['peek', 'microphone', 'keyboard', 'display', 'network'];
  if (state.volume) items.push('volume');
  if (state.battery?.present) items.push('battery');
  if (state.windowsUpdatePending || state.orelleUpdateAvailable) items.push('update');
  items.push('focus', 'notifications', 'clock');
  return items;
}
