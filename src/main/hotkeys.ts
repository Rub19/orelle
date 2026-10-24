// Global shortcuts (RegisterHotKey under the hood), one per named action. Conflicts are reported
// instead of failing silently, and a failed change keeps the previous working shortcut.
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

type Result = { ok: boolean; error?: 'invalid' | 'conflict' };

export class Hotkeys {
  private bindings = new Map<string, { accel: string; handler: () => void }>();
  private suspended = false;

  /** Registers (or re-registers) the shortcut of action `name`. */
  set(name: string, accel: string, handler: () => void): Result {
    if (!isValidAccelerator(accel)) return { ok: false, error: 'invalid' };
    const previous = this.bindings.get(name);
    if (previous?.accel === accel && globalShortcut.isRegistered(accel)) return { ok: true };
    if ([...this.bindings].some(([n, b]) => n !== name && b.accel.toLowerCase() === accel.toLowerCase())) return { ok: false, error: 'conflict' };
    if (previous) globalShortcut.unregister(previous.accel);
    let ok = false;
    try {
      ok = globalShortcut.register(accel, handler);
    } catch (err) {
      log.warn('hotkeys', `Cannot register ${accel}`, err);
    }
    if (ok) {
      this.bindings.set(name, { accel, handler });
      log.info('hotkeys', `${name}: ${accel}`);
      return { ok: true };
    }
    log.warn('hotkeys', `${accel} (${name}) is taken by another application`);
    if (previous) {
      try { globalShortcut.register(previous.accel, previous.handler); } catch { /* ignore */ }
    }
    return { ok: false, error: 'conflict' };
  }

  remove(name: string) {
    const b = this.bindings.get(name);
    if (b) globalShortcut.unregister(b.accel);
    this.bindings.delete(name);
  }

  /** While the user records a new shortcut in Preferences, none may fire. */
  suspend(on: boolean) {
    if (on === this.suspended) return;
    this.suspended = on;
    if (on) globalShortcut.unregisterAll();
    else this.refresh();
  }

  disableAll() {
    globalShortcut.unregisterAll();
    this.bindings.clear();
  }

  /** After sleep/resume or session unlock, registrations can be lost: re-apply all. */
  refresh() {
    if (this.suspended) return;
    globalShortcut.unregisterAll();
    for (const [name, b] of this.bindings) {
      try {
        if (!globalShortcut.register(b.accel, b.handler)) log.warn('hotkeys', `Lost ${b.accel} (${name})`);
      } catch { /* ignore */ }
    }
  }
}
