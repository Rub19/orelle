// Small file logger: one file per day in %APPDATA%/NOVA/logs, 7 days kept. Writes are async and batched.
import fs from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

let dir: string | null = null;
let queue: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const verbose = process.argv.includes('--nova-dev');

function fmt(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ''}`;
  try { return typeof err === 'string' ? err : JSON.stringify(err); } catch { return String(err); }
}

function write(level: Level, scope: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${extra !== undefined ? ' ' + fmt(extra) : ''}`;
  if (verbose || level === 'error' || level === 'warn') (level === 'error' ? console.error : console.log)(line);
  if (!dir) return;
  queue.push(line);
  if (!flushTimer) flushTimer = setTimeout(flush, 500);
}

function flush() {
  flushTimer = null;
  if (!dir || queue.length === 0) return;
  const file = path.join(dir, `nova-${new Date().toISOString().slice(0, 10)}.log`);
  const data = queue.join('\n') + '\n';
  queue = [];
  fs.appendFile(file, data, () => {});
}

export const log = {
  init(logDir: string) {
    dir = logDir;
    fs.mkdirSync(dir, { recursive: true });
    // Retention: delete logs older than 7 days.
    try {
      const cutoff = Date.now() - 7 * 86400_000;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (f.endsWith('.log') && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      }
    } catch { /* best effort */ }
  },
  flushSync() {
    if (!dir || queue.length === 0) return;
    try { fs.appendFileSync(path.join(dir, `nova-${new Date().toISOString().slice(0, 10)}.log`), queue.join('\n') + '\n'); } catch { /* ignore */ }
    queue = [];
  },
  debug: (scope: string, msg: string, extra?: unknown) => verbose && write('debug', scope, msg, extra),
  info: (scope: string, msg: string, extra?: unknown) => write('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => write('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => write('error', scope, msg, extra),
};
