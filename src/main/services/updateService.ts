// Update check against the project's GitHub releases (at most once a day, opt-out in Preferences).
// Orelle never downloads or installs anything by itself: a newer version is announced with a link
// to its release page. A private repository answers 404 to anonymous requests: the check then
// reports "unavailable" instead of pretending everything is up to date.
import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions } from '../../shared/version';
import type { OrelleContext } from '../context';
import type { NotificationService } from './notificationService';
import { log } from '../logger';

export const UPDATE_REPO = 'Rub19/orelle';
const DAY = 86_400_000;

export interface UpdateStatus { state: 'idle' | 'checking' | 'current' | 'available' | 'unavailable' | 'error'; latest?: string; url?: string; at?: number }

export class UpdateService {
  private file: string;
  status: UpdateStatus = { state: 'idle' };

  constructor(private readonly ctx: OrelleContext, private readonly notifications: NotificationService) {
    this.file = path.join(ctx.dataDir, 'update-check.json');
    try { this.status = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* never checked */ }
  }

  /** Checks in the background a few minutes after start, if the last check is a day old. */
  schedule() {
    setTimeout(() => {
      if (!this.ctx.settings.get().general.checkUpdates) return;
      if (this.status.at && Date.now() - this.status.at < DAY) return;
      void this.check(false);
    }, 3 * 60_000);
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    this.status = { state: 'checking' };
    try {
      const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `Orelle/${app.getVersion()}` },
      });
      if (res.status === 404) this.status = { state: 'unavailable', at: Date.now() };
      else if (!res.ok) this.status = { state: 'error', at: Date.now() };
      else {
        const j = (await res.json()) as { tag_name?: string; html_url?: string };
        const latest = (j.tag_name ?? '').replace(/^v/i, '');
        const url = typeof j.html_url === 'string' && j.html_url.startsWith('https://github.com/') ? j.html_url : undefined;
        const newer = latest && compareVersions(latest, app.getVersion()) > 0;
        this.status = { state: newer ? 'available' : 'current', latest, url, at: Date.now() };
        if (newer && !manual) {
          this.notifications.notify({
            title: this.ctx.t('updates.available', { v: latest }),
            body: this.ctx.t('updates.availableBody'),
            source: 'orelle',
            glyph: 'download',
            action: url ? `url:${url}` : 'settings:about',
          });
        }
      }
    } catch (err) {
      log.warn('updates', 'Update check failed', err instanceof Error ? err.message : err);
      this.status = { state: 'error', at: Date.now() };
    }
    try { fs.writeFileSync(this.file, JSON.stringify(this.status)); } catch { /* read-only */ }
    log.info('updates', `Update check: ${this.status.state}${this.status.latest ? ` (${this.status.latest})` : ''}`);
    return this.status;
  }
}
