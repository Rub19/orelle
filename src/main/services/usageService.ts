// Local usage memory: how often / how recently items were opened. Feeds launcher ranking and
// the Dock "recent apps" section. Never leaves the device; can be cleared from Privacy settings.
import path from 'node:path';
import { JsonFile } from '../store';

export interface UsageRecord {
  count: number;
  last: number;
  title: string;
  /** Opaque payload needed to re-open the item (app ref, path…). */
  ref?: { appId?: string; path?: string };
}

interface UsageData {
  items: Record<string, UsageRecord>;
}

const MAX_ITEMS = 400;

export class UsageService {
  private file: JsonFile<UsageData>;
  private data: UsageData;

  constructor(dataDir: string) {
    this.file = new JsonFile<UsageData>(path.join(dataDir, 'usage.json'), 2000);
    const raw = this.file.read() as UsageData | null;
    this.data = raw && typeof raw === 'object' && raw.items ? raw : { items: {} };
  }

  record(id: string, title: string, ref?: UsageRecord['ref']) {
    const r = this.data.items[id] ?? { count: 0, last: 0, title };
    r.count += 1;
    r.last = Date.now();
    r.title = title;
    if (ref) r.ref = ref;
    this.data.items[id] = r;
    const keys = Object.keys(this.data.items);
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => this.data.items[a].last - this.data.items[b].last);
      for (const k of keys.slice(0, keys.length - MAX_ITEMS)) delete this.data.items[k];
    }
    this.file.write(this.data);
  }

  /** Frecency boost in [0, 0.25]. */
  boost(id: string): number {
    const r = this.data.items[id];
    if (!r) return 0;
    const ageDays = (Date.now() - r.last) / 86400_000;
    const recency = ageDays < 1 ? 1 : ageDays < 7 ? 0.7 : ageDays < 30 ? 0.4 : 0.15;
    return Math.min(0.25, Math.log2(1 + r.count) * 0.04 * recency + recency * 0.05);
  }

  recent(prefix: string, limit: number): (UsageRecord & { id: string })[] {
    return Object.entries(this.data.items)
      .filter(([id]) => id.startsWith(prefix))
      .sort((a, b) => b[1].last - a[1].last)
      .slice(0, limit)
      .map(([id, r]) => ({ id, ...r }));
  }

  clear() {
    this.data = { items: {} };
    this.file.writeNow(this.data);
  }

  flush() {
    this.file.flush();
  }
}
