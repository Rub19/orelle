// Theme Studio runtime: the light/dark schedule and the desktop wallpaper. The wallpaper found
// before Orelle first changed it is remembered (wallpaper-original.json) and put back when the
// user clears Orelle's wallpaper, so the change is always reversible.
import fs from 'node:fs';
import path from 'node:path';
import { scheduledTheme } from '../../shared/themeModel';
import type { Settings } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { log } from '../logger';

export class ThemeService {
  private timer: NodeJS.Timeout | null = null;
  private file: string;

  constructor(private readonly ctx: OrelleContext) {
    this.file = path.join(ctx.dataDir, 'wallpaper-original.json');
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const a = this.ctx.settings.get().appearance;
    if (!a.schedule.enabled) return;
    const want = scheduledTheme(new Date(), a.schedule.lightAt, a.schedule.darkAt);
    if (a.theme !== want) {
      log.info('theme', `Schedule: switching to ${want}`);
      this.ctx.settings.update({ appearance: { theme: want } });
    }
  }

  onSettingsChanged(next: Settings, prev: Settings) {
    const a = next.appearance.schedule;
    const b = prev.appearance.schedule;
    if (a.enabled !== b.enabled || a.lightAt !== b.lightAt || a.darkAt !== b.darkAt) this.tick();
    if (next.appearance.wallpaper !== prev.appearance.wallpaper) this.applyWallpaper(next.appearance.wallpaper);
  }

  original(): string | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return typeof raw.path === 'string' ? raw.path : null;
    } catch {
      return null;
    }
  }

  private applyWallpaper(file: string) {
    if (!file) {
      const orig = this.original();
      if (orig !== null) {
        if (orig && fs.existsSync(orig)) w32.setWallpaper(orig);
        try { fs.unlinkSync(this.file); } catch { /* gone */ }
        log.info('theme', 'Original wallpaper restored');
      }
      return;
    }
    if (!fs.existsSync(file)) {
      log.warn('theme', `Wallpaper not found: ${file}`);
      return;
    }
    if (this.original() === null) fs.writeFileSync(this.file, JSON.stringify({ path: w32.getWallpaper() }));
    if (!w32.setWallpaper(file)) log.warn('theme', 'SystemParametersInfo(SPI_SETDESKWALLPAPER) failed');
  }
}
