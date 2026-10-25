// Preferences IPC for extensions, AI, window layouts, profiles and automations. Only the
// preferences window may call these.
import { app, dialog, ipcMain, safeStorage, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { normAutomation } from '../shared/settingsExtras';
import { exportTheme, currentLook, lookPatch, parseTheme } from '../shared/themeModel';
import type { Automation } from '../shared/types';
import type { OrelleContext } from './context';
import type { AiService } from './services/aiService';
import type { AutomationService } from './services/automationService';
import type { ExtensionService } from './services/extensionService';
import type { ProfileService } from './services/profileService';
import type { WindowService } from './services/windowService';
import type { UpdateService } from './services/updateService';
import { buildDiagnostics } from './services/diagnostics';

export function registerExtrasIpc(
  ctx: OrelleContext,
  settingsWindow: () => BrowserWindow | null,
  s: { extensions: ExtensionService; ai: AiService; windows: WindowService; profiles: ProfileService; automations: AutomationService; updates: UpdateService },
) {
  const from = (e: IpcMainEvent | IpcMainInvokeEvent) => settingsWindow()?.webContents === e.sender;
  const t = () => ctx.t;

  ipcMain.handle('settings:extensions', (e, reload: unknown) => {
    if (!from(e)) return [];
    if (reload) s.extensions.load();
    return s.extensions.list();
  });
  ipcMain.on('settings:openExtensionsFolder', (e) => {
    if (from(e)) void shell.openPath(s.extensions.userDir);
  });

  ipcMain.handle('settings:aiStatus', (e) => (from(e) ? { hasKey: s.ai.hasKey(), encryption: safeStorage.isEncryptionAvailable() } : null));
  ipcMain.handle('settings:aiSetKey', (e, key: unknown) => (from(e) && typeof key === 'string' ? s.ai.setKey(key) : false));
  ipcMain.handle('settings:aiConsent', async (e, on: unknown) => {
    if (!from(e)) return false;
    if (!on) {
      ctx.settings.update({ ai: { consent: false } });
      return false;
    }
    const provider = ctx.settings.get().ai.provider;
    const where = provider === 'ollama' ? t()('ai.consent.local', { endpoint: ctx.settings.get().ai.endpoint || 'http://localhost:11434' }) : t()(`ai.consent.cloud`, { provider: provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI' });
    const win = settingsWindow();
    const opts = {
      type: 'question' as const,
      title: t()('ai.consent.title'),
      message: t()('ai.consent.message'),
      detail: `${where}\n\n${t()('ai.consent.detail')}`,
      buttons: [t()('ai.consent.accept'), t()('system.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    const accepted = res.response === 0;
    ctx.settings.update({ ai: { consent: accepted } });
    return accepted;
  });
  ipcMain.handle('settings:aiTest', async (e) => {
    if (!from(e)) return { state: 'error' };
    return s.ai.ask(ctx.language === 'fr' ? 'Réponds uniquement « OK ».' : 'Reply with just “OK”.');
  });

  ipcMain.handle('settings:saveLayout', (e, name: unknown) => {
    if (!from(e) || typeof name !== 'string') return false;
    s.windows.saveCurrent(name);
    return true;
  });
  ipcMain.on('settings:restoreLayout', (e, id: unknown) => {
    if (from(e) && typeof id === 'string') void s.windows.restore(id, true);
  });
  ipcMain.on('settings:toggleProfile', (e, id: unknown) => {
    if (from(e) && typeof id === 'string') s.profiles.toggle(id);
  });
  ipcMain.handle('settings:pickWallpaper', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle('settings:exportTheme', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { defaultPath: 'mon-theme.orelle-theme.json', filters: [{ name: 'Orelle theme', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(exportTheme('Orelle', currentLook(ctx.settings.get())), null, 2));
    return { ok: true };
  });
  ipcMain.handle('settings:importTheme', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return { ok: false };
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Orelle theme', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      if (fs.statSync(r.filePaths[0]).size > 64 * 1024) return { ok: false, error: 'file too large' };
      const parsed = parseTheme(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
      if (!parsed.ok) return { ok: false, error: parsed.error };
      ctx.settings.update(lookPatch(parsed.look));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
    }
  });
  ipcMain.on('settings:runAutomation', (e, id: unknown) => {
    if (!from(e) || typeof id !== 'string') return;
    const a = ctx.settings.get().automations.find((x) => x.id === id);
    if (a) void s.automations.run(a);
  });
  ipcMain.handle('settings:updateStatus', (e) => (from(e) ? s.updates.status : null));
  ipcMain.handle('settings:checkUpdates', (e) => (from(e) ? s.updates.check(true) : null));
  ipcMain.handle('settings:downloadUpdate', (e) => (from(e) ? s.updates.download() : false));
  ipcMain.handle('settings:installUpdate', (e) => (from(e) ? s.updates.install() : false));
  ipcMain.on('settings:openRelease', (e) => {
    const url = s.updates.status.url;
    if (from(e) && url && url.startsWith('https://github.com/')) void shell.openExternal(url);
  });
  ipcMain.handle('settings:saveDiagnostics', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('desktop'), `orelle-diagnostic-${new Date().toISOString().slice(0, 10)}.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, buildDiagnostics(ctx));
    shell.showItemInFolder(r.filePath);
    return { ok: true };
  });
  ipcMain.on('settings:restartNormal', (e) => {
    if (!from(e)) return;
    try { fs.writeFileSync(path.join(ctx.dataDir, 'run-state.json'), JSON.stringify({ unclean: 0 })); } catch { /* ignore */ }
    app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--orelle-safe-mode') });
    app.quit();
  });
  ipcMain.handle('settings:automationHistory', (e) => (from(e) ? s.automations.getHistory() : []));
  ipcMain.on('settings:clearAutomationHistory', (e) => { if (from(e)) s.automations.clearHistory(); });
  ipcMain.handle('settings:exportAutomations', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { defaultPath: 'automatisations.orelle.json', filters: [{ name: 'Orelle automations', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify({ format: 'orelle-automations', version: 1, automations: ctx.settings.get().automations }, null, 2));
    return { ok: true };
  });
  ipcMain.handle('settings:importAutomations', async (e) => {
    const win = settingsWindow();
    if (!from(e) || !win) return { ok: false };
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Orelle automations', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      if (fs.statSync(r.filePaths[0]).size > 512 * 1024) return { ok: false, error: 'file too large' };
      const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (raw?.format !== 'orelle-automations' || !Array.isArray(raw.automations)) return { ok: false, error: 'not an Orelle automations file' };
      // Imported rules are validated like stored ones, get fresh ids and start disabled.
      const imported = (raw.automations as unknown[]).map(normAutomation).filter((a): a is Automation => !!a)
        .map((a) => ({ ...a, id: `auto-${Math.random().toString(36).slice(2, 10)}`, enabled: false }));
      ctx.settings.update({ automations: [...ctx.settings.get().automations, ...imported].slice(0, 50) });
      return { ok: true, count: imported.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
    }
  });
}
