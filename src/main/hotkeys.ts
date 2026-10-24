// Global shortcut management (RegisterHotKey under the hood). Reports conflicts instead of failing silently.
import { globalShortcut } from 'electron';
import { log } from './logger';

const MODIFIER = /^(Alt|Ctrl|Control|Shift|Super|Meta|CommandOrControl|CmdOrCtrl|AltGr)$/i;

export function isValidAccelerator(accel: string): boolean {
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const mods = parts.slice(0, -1);
  const key = parts[parts.length - 1];
  return mods.every((m) => MODIFIER.test(m)) && !MODIFIER.test(key);
}

export class Hotkeys {
  private current: string | null = null;

  constructor(private readonly onLauncher: () => void) {}

  apply(accel: string): { ok: boolean; error?: 'invalid' | 'conflict' } {
    if (!isValidAccelerator(accel)) return { ok: false, error: 'invalid' };
    const previous = this.current;
    globalShortcut.unregisterAll();
    let ok = false;
    try {
      ok = globalShortcut.register(accel, this.onLauncher);
    } catch (err) {
      log.warn('hotkeys', `Cannot register ${accel}`, err);
    }
    if (ok) {
      this.current = accel;
      log.info('hotkeys', `Launcher shortcut: ${accel}`);
      return { ok: true };
    }
    log.warn('hotkeys', `Shortcut ${accel} is taken by another application`);
    if (previous) {
      try { globalShortcut.register(previous, this.onLauncher); } catch { /* ignore */ }
    }
    return { ok: false, error: 'conflict' };
  }

  disable() {
    globalShortcut.unregisterAll();
    this.current = null;
  }

  /** After sleep/resume or session unlock, registrations can be lost: re-apply. */
  refresh() {
    if (this.current) this.apply(this.current);
  }
}
