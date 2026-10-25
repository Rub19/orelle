// Updates from the project's GitHub releases. The check runs at most once a day (opt-out in
// Preferences). Nothing is downloaded without the user's click: "Download and install" fetches
// the new installer in the background (electron-updater, SHA-512 verified against the release's
// latest.yml), then "Restart to update" — or the next time Orelle quits — installs it silently for
// the current user (no administrator rights). A repository that publishes no release answers 404:
// the check then says "unavailable" instead of pretending everything is up to date.
import { app, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions } from '../../shared/version';
import type { OrelleContext } from '../context';
import type { NotificationService } from './notificationService';
import { log } from '../logger';

/** Where installers are published (this repository's GitHub releases). */
export const UPDATE_OWNER = 'Rub19';
export const UPDATE_REPO = 'orelle';
const DAY = 86_400_000;

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'unavailable' | 'error';
  latest?: string;
  url?: string;
  percent?: number;
  at?: number;
}

export class UpdateService {
  private file: string;
  status: UpdateStatus = { state: 'idle' };
  private wired = false;

  constructor(private readonly ctx: OrelleContext, private readonly notifications: NotificationService) {
    this.file = path.join(ctx.dataDir, 'update-check.json');
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as UpdateStatus;
      // A download does not survive a restart; an "available" result does.
      this.status = saved.state === 'downloading' || saved.state === 'ready' ? { state: 'available', latest: saved.latest, url: saved.url, at: saved.at } : saved;
    } catch { /* never checked */ }
  }

  private get releasePage() {
    return `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`;
  }

  private wire() {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.logger = { info: (m: unknown) => log.info('updates', String(m)), warn: (m: unknown) => log.warn('updates', String(m)), error: (m: unknown) => log.error('updates', String(m)), debug: () => {} };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO });
    autoUpdater.on('download-progress', (p) => {
      this.status = { ...this.status, state: 'downloading', percent: Math.round(p.percent) };
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.status = { state: 'ready', latest: info.version, url: this.releasePage, at: Date.now() };
      this.save();
      this.notifications.notify({ title: this.ctx.t('updates.ready', { v: info.version }), body: this.ctx.t('updates.readyBody'), source: 'orelle', glyph: 'download', action: 'settings:about' });
    });
    autoUpdater.on('error', (err) => {
      log.warn('updates', 'Updater error', err?.message ?? err);
      if (this.status.state === 'downloading') this.status = { ...this.status, state: 'error' };
    });
  }

  /** Background check a few minutes after start, if the last one is a day old. */
  schedule() {
    setTimeout(() => {
      if (!this.ctx.settings.get().general.checkUpdates) return;
      if (this.status.at && Date.now() - this.status.at < DAY) return;
      void this.check(false);
    }, 3 * 60_000);
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.status)); } catch { /* read-only */ }
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status;
    this.status = { state: 'checking' };
    try {
      if (app.isPackaged) {
        this.wire();
        const r = await autoUpdater.checkForUpdates();
        const latest = r?.updateInfo.version ?? '';
        const newer = !!latest && compareVersions(latest, app.getVersion()) > 0;
        this.status = { state: newer ? 'available' : 'current', latest, url: this.releasePage, at: Date.now() };
      } else {
        // Development build: electron-updater only runs in the installed app; read the release list.
        const res = await net.fetch(`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': `Orelle/${app.getVersion()}` } });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        const j = (await res.json()) as { tag_name?: string };
        const latest = (j.tag_name ?? '').replace(/^v/i, '');
        this.status = { state: latest && compareVersions(latest, app.getVersion()) > 0 ? 'available' : 'current', latest, url: this.releasePage, at: Date.now() };
      }
      if (this.status.state === 'available' && !manual) {
        this.notifications.notify({ title: this.ctx.t('updates.available', { v: this.status.latest ?? '' }), body: this.ctx.t('updates.availableBody'), source: 'orelle', glyph: 'download', action: 'settings:about' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const missing = /404|HTTP 404|Cannot find latest|No published versions|Unable to find latest/i.test(msg);
      log.info('updates', `Update check: ${missing ? 'no published release' : msg}`);
      this.status = { state: missing ? 'unavailable' : 'error', at: Date.now() };
    }
    this.save();
    log.info('updates', `Update check: ${this.status.state}${this.status.latest ? ` (${this.status.latest})` : ''}`);
    return this.status;
  }

  /** Downloads the update the user asked for (installed app only). */
  download(): boolean {
    if (!app.isPackaged || this.status.state !== 'available') return false;
    this.wire();
    this.status = { ...this.status, state: 'downloading', percent: 0 };
    void autoUpdater.downloadUpdate().catch((err) => {
      log.warn('updates', 'Download failed', err?.message ?? err);
      this.status = { ...this.status, state: 'error' };
    });
    return true;
  }

  /** Quits Orelle (restoring the taskbar as usual) and runs the downloaded installer silently. */
  install() {
    if (this.status.state !== 'ready') return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }
}
