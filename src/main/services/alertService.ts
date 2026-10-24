// Optional resource alerts (Preferences › Orelle apps): a Windows notification when CPU or memory
// stays above the chosen threshold. Off by default; sampling only runs while alerts are on.
import type { SystemStats } from '../../shared/types';
import type { OrelleContext } from '../context';
import type { NotificationService } from './notificationService';
import type { SystemService } from './systemService';
import { log } from '../logger';

const SUSTAIN_MS = 30_000;
const COOLDOWN_MS = 10 * 60_000;

export class AlertService {
  private since: Record<'cpu' | 'mem', number | null> = { cpu: null, mem: null };
  private lastAlert: Record<'cpu' | 'mem', number> = { cpu: 0, mem: 0 };
  private active = false;
  private listener = (s: SystemStats) => this.check(s);

  constructor(private readonly ctx: OrelleContext, private readonly system: SystemService, private readonly notifications: NotificationService) {}

  /** Set by profiles that ask for silence (games, streaming). */
  muted = false;

  sync() {
    const want = this.ctx.settings.get().monitor.alerts;
    if (want === this.active) return;
    this.active = want;
    if (want) {
      this.system.on('stats', this.listener);
      this.system.subscribe('alerts');
    } else {
      this.system.off('stats', this.listener);
      this.system.unsubscribe('alerts');
      this.since = { cpu: null, mem: null };
    }
  }

  private check(s: SystemStats) {
    const m = this.ctx.settings.get().monitor;
    const values = { cpu: s.cpu, mem: (s.memUsed / s.memTotal) * 100 };
    const limits = { cpu: m.cpuAlert, mem: m.memAlert };
    const now = Date.now();
    for (const k of ['cpu', 'mem'] as const) {
      if (values[k] < limits[k]) { this.since[k] = null; continue; }
      this.since[k] ??= now;
      if (now - this.since[k]! < SUSTAIN_MS || now - this.lastAlert[k] < COOLDOWN_MS) continue;
      this.lastAlert[k] = now;
      const t = this.ctx.t;
      if (this.muted) continue;
      this.notifications.notify({
        title: t(k === 'cpu' ? 'alerts.cpu.title' : 'alerts.mem.title'),
        body: t('alerts.body', { value: Math.round(values[k]), limit: limits[k] }),
        source: 'alerts',
        glyph: k === 'cpu' ? 'cpu' : 'chart',
        action: 'monitor',
      });
      log.info('alerts', `${k} alert at ${Math.round(values[k])}%`);
    }
  }
}
