// User automations: "when <trigger>, if <conditions>, do <actions>". Triggers are a time of day,
// an app being launched, Orelle starting, a global shortcut, the battery dropping below a level,
// the power source changing, a display being connected or removed, or a profile turning on.
// Actions only use Orelle's own features (profiles, layouts, theme, focus mode, notifications) or
// open what the user typed in the rule (a web page or a file/folder path). Nothing is evaluated as
// a command line. Every run is recorded in a local history (automation-history.json).
import fs from 'node:fs';
import path from 'node:path';
import { inWindow } from '../../shared/timeWindow';
import type { Automation, AutomationAction, AutomationCondition, Settings } from '../../shared/types';
import type { OrelleContext } from '../context';
import type { Hotkeys } from '../hotkeys';
import * as w32 from '../native/win32';
import { openPath, openUrl, safeLaunch } from './launchService';
import type { NotificationService } from './notificationService';
import type { ProfileService } from './profileService';
import type { WindowService } from './windowService';
import { log } from '../logger';

export interface AutomationRun {
  id: string;
  name: string;
  at: number;
  cause: string;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  detail: string;
}

const MAX_HISTORY = 100;

export class AutomationService {
  private timer: NodeJS.Timeout | null = null;
  private fired = new Map<string, string>();
  private knownApps: Set<string> | null = null;
  private hotkeyNames = new Set<string>();
  private lastPower: { percent: number; charging: boolean; present: boolean } | null = null;
  private history: AutomationRun[] = [];
  private historyFile: string;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly hotkeys: Hotkeys,
    private readonly notifications: NotificationService,
    private readonly profiles: ProfileService,
    private readonly windows: WindowService,
  ) {
    this.historyFile = path.join(ctx.dataDir, 'automation-history.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      if (Array.isArray(raw)) this.history = raw.slice(0, MAX_HISTORY);
    } catch { /* none yet */ }
    profiles.onActivated((id) => this.fire((t) => t.kind === 'profileOn' && t.id === id, 'profile'));
  }

  private rules() {
    return this.ctx.settings.get().automations.filter((a) => a.enabled);
  }

  start() {
    this.timer = setInterval(() => this.tick(), 20_000);
    this.ctx.tracker.on('change', () => this.onWindows());
    this.syncHotkeys();
    this.lastPower = w32.getPowerStatus();
    setTimeout(() => this.fire((t) => t.kind === 'startup', 'startup'), 5000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const n of this.hotkeyNames) this.hotkeys.remove(n);
    this.hotkeyNames.clear();
    this.flush();
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
    this.flush();
  }

  onSettingsChanged(next: Settings, prev: Settings) {
    if (next.automations !== prev.automations) this.syncHotkeys();
  }

  onDisplaysChanged() {
    this.fire((t) => t.kind === 'displayChanged', 'display');
  }

  private fire(match: (t: Automation['trigger']) => boolean, cause: string) {
    for (const a of this.rules()) if (match(a.trigger)) void this.run(a, cause);
  }

  private syncHotkeys() {
    const wanted = new Map<string, { a: Automation; accel: string }>();
    for (const a of this.rules()) if (a.trigger.kind === 'hotkey') wanted.set(`auto:${a.id}`, { a, accel: a.trigger.accel });
    for (const n of this.hotkeyNames) {
      if (!wanted.has(n)) {
        this.hotkeys.remove(n);
        this.hotkeyNames.delete(n);
      }
    }
    for (const [name, { a, accel }] of wanted) {
      const res = this.hotkeys.set(name, accel, () => void this.run(a, 'hotkey'));
      if (res.ok) this.hotkeyNames.add(name);
      else log.warn('automations', `${a.name}: shortcut ${accel} unavailable (${res.error})`);
    }
  }

  private tick() {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const stamp = `${now.toDateString()} ${hhmm}`;
    for (const a of this.rules()) {
      if (a.trigger.kind !== 'time' || a.trigger.at !== hhmm || !a.trigger.days.includes(now.getDay())) continue;
      if (this.fired.get(a.id) === stamp) continue;
      this.fired.set(a.id, stamp);
      void this.run(a, 'time');
    }
    // Power: fire once when crossing a battery level or when the source changes.
    const p = w32.getPowerStatus();
    const prev = this.lastPower;
    this.lastPower = p;
    if (!p || !prev || !p.present) return;
    for (const a of this.rules()) {
      const t = a.trigger;
      if (t.kind === 'batteryBelow' && !p.charging && p.percent < t.percent && prev.percent >= t.percent) void this.run(a, 'battery');
      if (t.kind === 'powerSource' && p.charging !== prev.charging && (t.source === 'ac') === p.charging) void this.run(a, 'power');
    }
  }

  private onWindows() {
    const keys = new Set<string>();
    for (const w of this.ctx.tracker.list()) {
      if (w.exe) keys.add(path.basename(w.exe).toLowerCase());
      if (w.aumid) keys.add(w.aumid.toLowerCase());
    }
    const before = this.knownApps;
    this.knownApps = keys;
    // The first enumeration is what was already open, not a launch.
    if (!before) return;
    for (const a of this.rules()) {
      if (a.trigger.kind !== 'appLaunched') continue;
      const want = a.trigger.app;
      const match = (k: string) => k === want || k === `${want}.exe` || (want.length > 3 && k.includes(want));
      if ([...keys].some((k) => match(k) && !before.has(k))) void this.run(a, 'app');
    }
  }

  /** The first condition that does not hold, or null when the rule may run. */
  failedCondition(a: Automation, now = new Date()): AutomationCondition | null {
    for (const c of a.conditions) {
      if (c.kind === 'between' && !inWindow(now, c.from, c.to)) return c;
      if (c.kind === 'weekdays' && !c.days.includes(now.getDay())) return c;
      if (c.kind === 'onBattery') {
        const p = w32.getPowerStatus();
        const onBattery = !!p && p.present && !p.charging;
        if (onBattery !== c.value) return c;
      }
      if (c.kind === 'profileActive' && this.ctx.settings.get().profiles.active !== c.id) return c;
    }
    return null;
  }

  /** Runs every action of a rule in order. "Run now" in Preferences passes `manual` (conditions ignored). */
  async run(a: Automation, cause = 'manual'): Promise<AutomationRun> {
    const record = (status: AutomationRun['status'], detail: string): AutomationRun => {
      const r = { id: a.id, name: a.name, at: Date.now(), cause, status, detail };
      this.history.unshift(r);
      this.history.length = Math.min(this.history.length, MAX_HISTORY);
      this.persist();
      return r;
    };
    const blocked = cause === 'manual' ? null : this.failedCondition(a);
    if (blocked) {
      log.debug('automations', `"${a.name}" skipped (condition ${blocked.kind})`);
      return record('skipped', blocked.kind);
    }
    log.info('automations', `Running "${a.name}" (${cause})`);
    const errors: string[] = [];
    for (const action of a.actions) {
      try {
        const ok = await this.runAction(action, a);
        if (ok === false) errors.push(`${action.kind}: ${this.ctx.t('settings.auto.error.target')}`);
      } catch (err) {
        errors.push(`${action.kind}: ${err instanceof Error ? err.message : String(err)}`);
        log.warn('automations', `${a.name}: ${action.kind} failed`, err);
      }
    }
    const status = !errors.length ? 'ok' : errors.length === a.actions.length ? 'failed' : 'partial';
    if (status !== 'ok') this.notifications.notify({ title: this.ctx.t('settings.auto.failedTitle', { name: a.name }), body: errors.join(' · '), source: 'automations', glyph: 'bolt', action: 'settings:automations' });
    return record(status, errors.join(' · '));
  }

  private async runAction(action: AutomationAction, a: Automation): Promise<boolean> {
    switch (action.kind) {
      case 'profile': return this.profiles.activate(action.id);
      case 'layout': return (await this.windows.restore(action.id, true)) > 0;
      case 'theme': this.ctx.settings.update({ appearance: { theme: action.theme } }); return true;
      case 'focus': this.ctx.settings.update({ notifications: { focus: action.on } }); return true;
      case 'notify': this.notifications.notify({ title: a.name, body: action.text, source: 'automations', glyph: 'bolt' }); return true;
      case 'open':
        if (/^https?:\/\//i.test(action.target)) return safeLaunch(() => openUrl(action.target), action.target);
        return safeLaunch(() => openPath(action.target), action.target);
    }
  }

  private saveTimer: NodeJS.Timeout | null = null;
  private persist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  private flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history));
    } catch (err) {
      log.warn('automations', 'Cannot save history', err);
    }
  }
}
