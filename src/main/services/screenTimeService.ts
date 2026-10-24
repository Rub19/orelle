// Time spent per application, measured from foreground-window changes (no polling).
// Paused while the session is locked or the machine sleeps. Stored locally, 14 days kept.
import { powerMonitor } from 'electron';
import path from 'node:path';
import { JsonFile } from '../store';

interface Data {
  /** day (YYYY-MM-DD) → app key → { name, ms } */
  days: Record<string, Record<string, { name: string; ms: number }>>;
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class ScreenTimeService {
  private file: JsonFile<Data>;
  private data: Data;
  private current: { key: string; name: string; since: number } | null = null;
  private paused = false;

  constructor(dataDir: string) {
    this.file = new JsonFile<Data>(path.join(dataDir, 'screen-time.json'), 30_000);
    const raw = this.file.read() as Data | null;
    this.data = raw && typeof raw === 'object' && raw.days ? raw : { days: {} };
    this.prune();
    powerMonitor.on('lock-screen', () => this.pause());
    powerMonitor.on('suspend', () => this.pause());
    powerMonitor.on('unlock-screen', () => this.resume());
    powerMonitor.on('resume', () => this.resume());
  }

  /** Called on every foreground change with the app identity (or null for the desktop / NOVA). */
  focus(app: { key: string; name: string } | null) {
    this.commit();
    this.current = app && !this.paused ? { ...app, since: Date.now() } : null;
  }

  private pause() {
    this.commit();
    this.paused = true;
  }

  private resume() {
    this.paused = false;
  }

  private commit() {
    if (!this.current) return;
    const now = Date.now();
    const ms = now - this.current.since;
    if (ms > 0 && ms < 12 * 3600_000) {
      const day = (this.data.days[dayKey(now)] ??= {});
      const rec = (day[this.current.key] ??= { name: this.current.name, ms: 0 });
      rec.ms += ms;
      rec.name = this.current.name;
      this.file.write(this.data);
    }
    this.current.since = now;
  }

  today(limit = 6): { key: string; name: string; ms: number }[] {
    this.commit();
    const day = this.data.days[dayKey(Date.now())] ?? {};
    return Object.entries(day)
      .map(([key, v]) => ({ key, name: v.name, ms: v.ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit);
  }

  private prune() {
    const cutoff = dayKey(Date.now() - 14 * 86400_000);
    for (const d of Object.keys(this.data.days)) if (d < cutoff) delete this.data.days[d];
  }

  clear() {
    this.data = { days: {} };
    this.file.writeNow(this.data);
  }

  flush() {
    this.commit();
    this.file.flush();
  }
}
