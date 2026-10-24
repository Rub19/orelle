// Activity profiles (Gaming, Development, Streaming, Productivity…): one click applies a theme,
// a taskbar mode, hides widgets, turns on Orelle's focus mode, silences resource alerts, launches
// apps and restores a window layout. What a profile changes is snapshotted first and put back
// exactly when the profile is turned off (the snapshot survives a restart).
import fs from 'node:fs';
import path from 'node:path';
import { fuzzyScore } from '../../shared/fuzzy';
import type { ActivityProfile, SearchResult, Settings, TaskbarMode, ThemeId } from '../../shared/types';
import type { OrelleContext } from '../context';
import { launchApp } from './launchService';
import type { AlertService } from './alertService';
import type { NotificationService } from './notificationService';
import type { SearchPlugin } from './searchService';
import type { WindowService } from './windowService';
import { log } from '../logger';

interface Snapshot { theme: ThemeId; taskbarMode: TaskbarMode; widgets: boolean }

export class ProfileService implements SearchPlugin {
  readonly prefix = 'profile';
  private file: string;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly notifications: NotificationService,
    private readonly alerts: AlertService,
    private readonly windows: WindowService,
  ) {
    this.file = path.join(ctx.dataDir, 'profile-snapshot.json');
  }

  get active(): ActivityProfile | null {
    const s = this.ctx.settings.get().profiles;
    return s.list.find((p) => p.id === s.active) ?? null;
  }

  /** Re-applies the runtime-only parts of the active profile after a restart. */
  start() {
    this.applyRuntime(this.active);
  }

  private applyRuntime(p: ActivityProfile | null) {
    this.notifications.profileFocus = !!p?.focus;
    this.alerts.muted = !!p?.muteAlerts;
  }

  private readSnapshot(): Snapshot | null {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return typeof s.theme === 'string' && typeof s.taskbarMode === 'string' ? s : null;
    } catch {
      return null;
    }
  }

  toggle(id: string) {
    if (this.ctx.settings.get().profiles.active === id) this.deactivate();
    else void this.activate(id);
  }

  async activate(id: string): Promise<boolean> {
    const p = this.ctx.settings.get().profiles.list.find((x) => x.id === id);
    if (!p) return false;
    if (this.active) this.deactivate(true);
    const s = this.ctx.settings.get();
    const snap: Snapshot = { theme: s.appearance.theme, taskbarMode: s.general.taskbarMode, widgets: s.widgets.enabled };
    fs.writeFileSync(this.file, JSON.stringify(snap));
    const patch: Record<string, unknown> = { profiles: { active: id } };
    if (p.theme) patch.appearance = { theme: p.theme };
    if (p.taskbarMode) patch.general = { taskbarMode: p.taskbarMode };
    if (p.hideWidgets) patch.widgets = { enabled: false };
    this.ctx.settings.update(patch);
    this.applyRuntime(p);
    log.info('profiles', `Profile on: ${p.name}`);
    this.notifications.notify({ title: this.ctx.t('profiles.on', { name: p.name }), body: this.describe(p), source: 'profiles', glyph: p.glyph });
    for (const a of p.launch) {
      try { await launchApp({ appId: a.appId, path: a.path }); } catch (err) { log.warn('profiles', `Cannot launch ${a.name}`, err); }
    }
    if (p.layoutId) void this.windows.restore(p.layoutId, true);
    return true;
  }

  /** Turns the active profile off and puts back what it changed. */
  deactivate(silent = false) {
    const p = this.active;
    const snap = this.readSnapshot();
    const patch: Record<string, unknown> = { profiles: { active: null } };
    if (snap) {
      patch.appearance = { theme: snap.theme };
      patch.general = { taskbarMode: snap.taskbarMode };
      patch.widgets = { enabled: snap.widgets };
    }
    this.ctx.settings.update(patch);
    try { fs.unlinkSync(this.file); } catch { /* none */ }
    this.applyRuntime(null);
    if (p) {
      log.info('profiles', `Profile off: ${p.name}`);
      if (!silent) this.notifications.notify({ title: this.ctx.t('profiles.off', { name: p.name }), body: this.ctx.t('profiles.restored'), source: 'profiles', glyph: p.glyph });
    }
  }

  private describe(p: ActivityProfile) {
    const t = this.ctx.t;
    const parts: string[] = [];
    if (p.focus) parts.push(t('profiles.does.focus'));
    if (p.muteAlerts) parts.push(t('profiles.does.mute'));
    if (p.hideWidgets) parts.push(t('profiles.does.widgets'));
    if (p.launch.length) parts.push(t('profiles.does.launch', { n: p.launch.length }));
    if (p.layoutId) parts.push(t('profiles.does.layout'));
    return parts.join(' · ') || t('profiles.does.nothing');
  }

  onSettingsChanged(next: Settings) {
    // A profile removed while active: forget it.
    if (next.profiles.active === null && (this.notifications.profileFocus || this.alerts.muted)) this.applyRuntime(null);
  }

  private result(p: ActivityProfile, score: number): SearchResult {
    const on = this.ctx.settings.get().profiles.active === p.id;
    return { id: `profile:${p.id}`, kind: 'profile', title: this.ctx.t(on ? 'profiles.turnOff' : 'profiles.turnOn', { name: p.name }), subtitle: this.describe(p), glyph: p.glyph, score, action: this.ctx.t('launcher.run') };
  }

  search(q: string): SearchResult[] {
    const word = this.ctx.t('launcher.kind.profile');
    return this.ctx.settings.get().profiles.list
      .map((p) => this.result(p, Math.max(fuzzyScore(q, p.name), fuzzyScore(q, `${word} ${p.name}`) * 0.9) * 0.9))
      .filter((r) => r.score > 0.45);
  }

  resolve(id: string) {
    const p = this.ctx.settings.get().profiles.list.find((x) => x.id === id);
    return p ? this.result(p, 0) : null;
  }

  execute(id: string) {
    this.toggle(id);
    return true;
  }
}
