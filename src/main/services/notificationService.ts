// Orelle's own notification center: every notice Orelle raises (resource alerts, automations,
// profiles, file operations…) goes through here, is kept in a local history (notifications.json,
// optional) and shown as a Windows toast unless Orelle's focus mode is on.
// Windows does not let a regular desktop app read other apps' notifications, so those stay in the
// Windows notification center, which the panel links to.
import { Notification } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { OrelleNotification } from '../../shared/types';
import type { OrelleContext } from '../context';
import { log } from '../logger';

const MAX = 100;

export type NotifyInput = Omit<OrelleNotification, 'id' | 'at' | 'read'>;

export class NotificationService extends EventEmitter {
  private file: string;
  private items: OrelleNotification[] = [];
  private saveTimer: NodeJS.Timeout | null = null;
  /** Set by profiles: focus while a profile asks for it, on top of the user's own switch. */
  profileFocus = false;

  constructor(private readonly ctx: OrelleContext, private readonly onAction: (action: string) => void) {
    super();
    this.file = path.join(ctx.dataDir, 'notifications.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.items = raw.filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string').slice(0, MAX);
    } catch { /* none yet */ }
  }

  get focus() {
    return this.ctx.settings.get().notifications.focus || this.profileFocus;
  }

  list() {
    return this.items;
  }

  unread() {
    return this.items.filter((n) => !n.read).length;
  }

  notify(input: NotifyInput): OrelleNotification | null {
    const s = this.ctx.settings.get().notifications;
    if (!s.enabled) return null;
    const n: OrelleNotification = { ...input, id: randomUUID(), at: Date.now(), read: false };
    if (s.history) {
      this.items.unshift(n);
      this.items.length = Math.min(this.items.length, MAX);
      this.persist();
    }
    if (!this.focus && Notification.isSupported()) {
      const toast = new Notification({ title: n.title, body: n.body, silent: false });
      if (n.action) toast.on('click', () => this.onAction(n.action!));
      toast.show();
    }
    log.info('notify', `${n.source}: ${n.title}`);
    this.emit('change');
    return n;
  }

  activate(id: string) {
    const n = this.items.find((x) => x.id === id);
    if (!n) return;
    n.read = true;
    this.persist();
    this.emit('change');
    if (n.action) this.onAction(n.action);
  }

  markAllRead() {
    if (!this.items.some((n) => !n.read)) return;
    for (const n of this.items) n.read = true;
    this.persist();
    this.emit('change');
  }

  remove(id: string) {
    this.items = this.items.filter((n) => n.id !== id);
    this.persist();
    this.emit('change');
  }

  clear() {
    this.items = [];
    this.persist();
    this.emit('change');
  }

  private persist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 800);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      if (this.ctx.settings.get().notifications.history) fs.writeFileSync(this.file, JSON.stringify(this.items));
      else if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } catch (err) {
      log.warn('notify', 'Cannot save history', err);
    }
  }
}
