import { EventEmitter } from 'node:events';
import path from 'node:path';
import { applyPatch, defaultSettings, normalizeSettings } from '../../shared/settings';
import type { Settings } from '../../shared/types';
import { JsonFile } from '../store';
import { log } from '../logger';

export class SettingsService extends EventEmitter {
  private file: JsonFile<Settings>;
  private current: Settings;
  /** True when no settings file existed (first launch). */
  readonly firstRun: boolean;

  constructor(dataDir: string) {
    super();
    this.file = new JsonFile<Settings>(path.join(dataDir, 'settings.json'));
    const raw = this.file.read();
    this.firstRun = raw === null;
    this.current = raw === null ? defaultSettings() : normalizeSettings(raw);
    if (raw !== null && (raw as { version?: number }).version !== this.current.version) {
      log.info('settings', `Migrated settings to v${this.current.version}`);
      this.file.writeNow(this.current);
    }
  }

  get(): Settings {
    return this.current;
  }

  update(patch: unknown): Settings {
    const prev = this.current;
    this.current = applyPatch(prev, patch);
    this.file.write(this.current);
    this.emit('change', this.current, prev);
    return this.current;
  }

  /** Replaces everything (profile import / reset). The previous file stays as settings.json.bak. */
  replace(raw: unknown): Settings {
    const prev = this.current;
    this.current = normalizeSettings(raw);
    this.file.writeNow(this.current);
    this.emit('change', this.current, prev);
    return this.current;
  }

  flush() {
    this.file.flush();
  }
}
