// Preferences IPC for extensions, AI, window layouts, profiles and automations. Only the
// preferences window may call these.
import { dialog, ipcMain, safeStorage, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { OrelleContext } from './context';
import type { AiService } from './services/aiService';
import type { AutomationService } from './services/automationService';
import type { ExtensionService } from './services/extensionService';
import type { ProfileService } from './services/profileService';
import type { WindowService } from './services/windowService';

export function registerExtrasIpc(
  ctx: OrelleContext,
  settingsWindow: () => BrowserWindow | null,
  s: { extensions: ExtensionService; ai: AiService; windows: WindowService; profiles: ProfileService; automations: AutomationService },
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
  ipcMain.on('settings:runAutomation', (e, id: unknown) => {
    if (!from(e) || typeof id !== 'string') return;
    const a = ctx.settings.get().automations.find((x) => x.id === id);
    if (a) void s.automations.run(a);
  });
}
