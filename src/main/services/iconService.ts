// High-resolution icons (128 px, alpha) extracted by the Shell helper and served to renderers
// through the private `orelle-icon://` scheme, which can only read PNGs from the icon cache.
import { net, protocol } from 'electron';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runShellHelper } from './shellBridge';
import { log } from '../logger';

export const ICON_SIZE = 128;

export function registerIconScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'orelle-icon', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

export class IconService extends EventEmitter {
  private queue = new Set<string>();
  /** Visible right now (Dock): extracted before anything queued in the background. */
  private urgent = new Set<string>();
  private failed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(readonly cacheDir: string) {
    super();
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  /** Must be called after app ready. */
  serve() {
    protocol.handle('orelle-icon', (req) => {
      const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
      if (!/^[a-f0-9]{40}\.png$/.test(name)) return new Response('bad request', { status: 400 });
      return net.fetch(pathToFileURL(path.join(this.cacheDir, name)).toString());
    });
  }

  private keyMap: Record<string, string> | null = null;
  private keyMapTimer: NodeJS.Timeout | null = null;

  /**
   * Shared icon for a key (e.g. "ext:.pdf"): the first file seen with that key is used as the
   * representative, so a folder of 2 000 PDFs costs one extraction, not 2 000.
   */
  getByKey(key: string, parsingName: string, urgent = false): string | null {
    if (!this.keyMap) {
      try { this.keyMap = JSON.parse(fs.readFileSync(path.join(this.cacheDir, 'keys.json'), 'utf8')); } catch { this.keyMap = {}; }
    }
    const map = this.keyMap!;
    let rep = map[key];
    if (!rep || (this.failed.has(rep) && rep !== parsingName)) {
      rep = parsingName;
      map[key] = rep;
      if (this.keyMapTimer) clearTimeout(this.keyMapTimer);
      this.keyMapTimer = setTimeout(() => fs.writeFile(path.join(this.cacheDir, 'keys.json'), JSON.stringify(map), () => {}), 1000);
    }
    return this.get(rep, urgent);
  }

  fileFor(parsingName: string): string {
    const hash = createHash('sha1').update(`${parsingName.toLowerCase()}|${ICON_SIZE}`, 'utf8').digest('hex');
    return path.join(this.cacheDir, `${hash}.png`);
  }

  urlForFile(file: string | null | undefined): string | null {
    if (!file) return null;
    return `orelle-icon://i/${path.basename(file)}`;
  }

  /** Returns the icon URL when cached; otherwise schedules extraction and returns null (a `change` event follows). */
  get(parsingName: string | null | undefined, urgent = false): string | null {
    if (!parsingName) return null;
    const file = this.fileFor(parsingName);
    if (fs.existsSync(file)) return this.urlForFile(file);
    if (!this.failed.has(parsingName)) {
      if (urgent) {
        this.urgent.add(parsingName);
        this.queue.delete(parsingName);
      } else if (!this.urgent.has(parsingName)) this.queue.add(parsingName);
      if (!this.timer) this.timer = setTimeout(() => this.drain(), urgent ? 30 : 150);
    }
    return null;
  }

  private async drain() {
    this.timer = null;
    if (this.running || (this.queue.size === 0 && this.urgent.size === 0)) return;
    this.running = true;
    // Small urgent batches return fast; background batches amortize the helper start-up.
    const batch = this.urgent.size ? [...this.urgent].slice(0, 16) : [...this.queue].slice(0, 48);
    batch.forEach((p) => { this.urgent.delete(p); this.queue.delete(p); });
    try {
      const out = await runShellHelper('icons', this.cacheDir, JSON.stringify(batch), 60_000);
      const result = (out ? JSON.parse(out) : {}) as Record<string, string | null>;
      for (const p of batch) if (!result[p]) this.failed.add(p);
      this.emit('change');
    } catch (err) {
      log.warn('icons', 'icon extraction failed', err);
      batch.forEach((p) => this.failed.add(p));
    } finally {
      this.running = false;
      if (this.queue.size || this.urgent.size) this.timer = setTimeout(() => this.drain(), 50);
    }
  }
}
