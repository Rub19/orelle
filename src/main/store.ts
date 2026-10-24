// Durable JSON storage: atomic writes (tmp + rename), previous version kept as .bak,
// corrupt files quarantined instead of silently overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger';

export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  private pending: T | null = null;

  constructor(readonly file: string, private readonly delayMs = 300) {}

  /** Reads the file, falling back to the .bak copy. Returns null when neither is usable. */
  read(): unknown | null {
    for (const candidate of [this.file, this.file + '.bak']) {
      try {
        if (!fs.existsSync(candidate)) continue;
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch (err) {
        log.error('store', `Unreadable ${path.basename(candidate)}, quarantining`, err);
        try { fs.renameSync(candidate, `${candidate}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      }
    }
    return null;
  }

  /** Debounced write. */
  write(value: T) {
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending === null) return;
    const value = this.pending;
    this.pending = null;
    this.writeNow(value);
  }

  writeNow(value: T) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error('store', `Failed to write ${path.basename(this.file)}`, err);
    }
  }
}
