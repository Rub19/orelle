// User automations: "when <trigger>, do <actions>". Triggers are a time of day, an app being
// launched, Orelle starting or a global shortcut; actions only use Orelle's own features (profiles,
// layouts, theme, focus mode, notifications) or open what the user typed in the rule (a web page or
// a file/folder path). Nothing is evaluated as a command line.
import path from 'node:path';
import type { Automation, AutomationAction, Settings } from '../../shared/types';
import type { OrelleContext } from '../context';
import type { Hotkeys } from '../hotkeys';
import { openPath, openUrl, safeLaunch } from './launchService';
import type { NotificationService } from './notificationService';
import type { ProfileService } from './profileService';
import type { WindowService } from './windowService';
import { log } from '../logger';

export class AutomationService {
  private timer: NodeJS.Timeout | null = null;
  private fired = new Map<string, string>();
  private knownApps: Set<string> | null = null;
  private hotkeyNames = new Set<string>();

  constructor(
    private readonly ctx: OrelleContext,
    private readonly hotkeys: Hotkeys,
    private readonly notifications: NotificationService,
    private readonly profiles: ProfileService,
    private readonly windows: WindowService,
  ) {}

  private rules() {
    return this.ctx.settings.get().automations.filter((a) => a.enabled);
  }

  start() {
    this.timer = setInterval(() => this.tick(), 20_000);
    this.ctx.tracker.on('change', () => this.onWindows());
    this.syncHotkeys();
    setTimeout(() => {
      for (const a of this.rules()) if (a.trigger.kind === 'startup') void this.run(a);
    }, 5000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const n of this.hotkeyNames) this.hotkeys.remove(n);
    this.hotkeyNames.clear();
  }

  onSettingsChanged(next: Settings, prev: Settings) {
    if (next.automations !== prev.automations) this.syncHotkeys();
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
      const res = this.hotkeys.set(name, accel, () => void this.run(a));
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
      void this.run(a);
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
      if ([...keys].some((k) => match(k) && ![...before].some((b) => b === k))) void this.run(a);
    }
  }

  /** Runs every action of a rule in order. Also used by "Run now" in Preferences. */
  async run(a: Automation): Promise<void> {
    log.info('automations', `Running "${a.name}"`);
    for (const action of a.actions) {
      try {
        await this.runAction(action, a);
      } catch (err) {
        log.warn('automations', `${a.name}: ${action.kind} failed`, err);
      }
    }
  }

  private async runAction(action: AutomationAction, a: Automation) {
    switch (action.kind) {
      case 'profile': await this.profiles.activate(action.id); break;
      case 'layout': await this.windows.restore(action.id, true); break;
      case 'theme': this.ctx.settings.update({ appearance: { theme: action.theme } }); break;
      case 'focus': this.ctx.settings.update({ notifications: { focus: action.on } }); break;
      case 'notify': this.notifications.notify({ title: a.name, body: action.text, source: 'automations', glyph: 'bolt' }); break;
      case 'open':
        if (/^https?:\/\//i.test(action.target)) await safeLaunch(() => openUrl(action.target), action.target);
        else await safeLaunch(() => openPath(action.target), action.target);
        break;
    }
  }
}
