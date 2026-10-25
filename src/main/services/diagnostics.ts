// Local diagnostic report (Preferences › About): what the user can attach to a bug report.
// Written to a file the user chooses; nothing is ever sent anywhere by Orelle. Contains the
// environment, Orelle's capabilities and settings (no secrets: the AI key lives in its own
// encrypted file and the clipboard history is never included), memory and the latest log lines.
import { app, screen } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OrelleContext } from '../context';

export function buildDiagnostics(ctx: OrelleContext): string {
  const s = ctx.settings.get();
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, privateMB: Math.round(((m.memory as unknown as Record<string, number>)?.privateBytes ?? 0) / 1024), cpu: +m.cpu.percentCPUUsage.toFixed(1) }));
  let logTail = '';
  try {
    const files = fs.readdirSync(ctx.logDir).filter((f) => f.endsWith('.log')).sort();
    const last = files[files.length - 1];
    if (last) logTail = fs.readFileSync(path.join(ctx.logDir, last), 'utf8').split(/\r?\n/).slice(-400).join('\n');
  } catch { /* no logs */ }
  // Personal paths in the logs and settings are reduced to %USERPROFILE%.
  const home = os.homedir();
  const scrub = (txt: string) => txt.split(home).join('%USERPROFILE%').split(home.replace(/\\/g, '\\\\')).join('%USERPROFILE%');
  const report = {
    generated: new Date().toISOString(),
    orelle: app.getVersion(),
    electron: process.versions.electron,
    windows: process.getSystemVersion(),
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 1024 ** 3), freeGB: +(os.freemem() / 1024 ** 3).toFixed(1) },
    displays: screen.getAllDisplays().map((d) => ({ size: `${d.size.width}×${d.size.height}`, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id })),
    capabilities: ctx.capabilities,
    memory: metrics,
    settings: { ...s, dock: { ...s.dock, items: s.dock.items.map((i) => ({ type: i.type, name: 'name' in i ? i.name : '' })) } },
  };
  return `Orelle — rapport de diagnostic / diagnostic report\n${'='.repeat(48)}\n${scrub(JSON.stringify(report, null, 2))}\n\n--- Journal / log (400 dernières lignes) ---\n${scrub(logTail)}\n`;
}
