// Orelle main process: wires services and surfaces, owns the application lifecycle.
import { app, BrowserWindow, ipcMain, nativeTheme, powerMonitor, screen, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createTranslator, resolveLanguage } from '../shared/i18n';
import type { Bootstrap, Settings, SurfaceKind } from '../shared/types';
import type { OrelleContext } from './context';
import { Hotkeys } from './hotkeys';
import { log } from './logger';
import * as audio from './native/audio';
import * as w32 from './native/win32';
import { AppIndex } from './services/appIndex';
import { ClipboardHistory } from './services/clipboardHistory';
import { FileIndex } from './services/fileIndex';
import { buildDefaultDock } from './services/firstRun';
import { IconService, registerIconScheme } from './services/iconService';
import { ScreenTimeService } from './services/screenTimeService';
import { ScriptService } from './services/scriptService';
import { SearchService } from './services/searchService';
import { SettingsService } from './services/settingsService';
import { SystemService } from './services/systemService';
import { TaskbarService } from './services/taskbarService';
import { UsageService } from './services/usageService';
import { WeatherService } from './services/weatherService';
import { WindowTracker } from './services/windowTracker';
import { OrelleTray } from './tray';
import { ControlCenterController } from './windows/controlCenterController';
import { DockController } from './windows/dockController';
import { LauncherController } from './windows/launcherController';
import { SettingsController } from './windows/settingsController';
import { WidgetsController } from './windows/widgetsController';

const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const SMOKE = process.argv.includes('--orelle-smoke');

// Isolated profile for tests: --orelle-user-data=<dir>.
const customData = argValue('orelle-user-data') ?? (SMOKE ? path.join(app.getPath('temp'), `orelle-smoke-${process.pid}`) : undefined);
if (customData) app.setPath('userData', customData);
else {
  const dataDir = path.join(app.getPath('appData'), 'Orelle');
  // The product was called NOVA before v0.2: carry the user's profile over once.
  const legacy = path.join(app.getPath('appData'), 'NOVA');
  if (!fs.existsSync(dataDir) && fs.existsSync(path.join(legacy, 'settings.json'))) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      for (const f of ['settings.json', 'usage.json', 'screen-time.json', 'apps.json', 'taskbar-original.json']) {
        if (fs.existsSync(path.join(legacy, f))) fs.copyFileSync(path.join(legacy, f), path.join(dataDir, f));
      }
    } catch { /* start fresh */ }
  }
  app.setPath('userData', dataDir);
}

app.setAppUserModelId('com.orelle.desktop');
registerIconScheme();

// Must be decided before Chromium starts: read the raw setting synchronously.
try {
  const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  if (raw?.general?.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch { /* first run or unreadable: keep the default (on) */ }

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

process.on('uncaughtException', (err) => log.error('process', 'Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('process', 'Unhandled rejection', err));

async function main() {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  const logDir = path.join(dataDir, 'logs');
  log.init(logDir);
  log.info('app', `Orelle ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.getSystemVersion()})`);

  const settings = new SettingsService(dataDir);
  // Startup screen (skipped for the silent sign-in start and for tests).
  const splashShownAt = Date.now();
  const splash = SMOKE || process.argv.includes('--orelle-autostart') ? null : showSplash(settings.firstRun, resolveLanguage(settings.get().general.language, app.getLocale()));
  const usage = new UsageService(dataDir);
  const icons = new IconService(path.join(dataDir, 'icon-cache'));
  icons.serve();
  const apps = new AppIndex(dataDir, icons);
  const tracker = new WindowTracker(process.pid);
  const files = new FileIndex();
  const clip = new ClipboardHistory();
  const system = new SystemService();
  const weather = new WeatherService();
  const screenTime = new ScreenTimeService(dataDir);
  const taskbar = new TaskbarService(dataDir);

  const distDir = __dirname;
  const language = () => resolveLanguage(settings.get().general.language, app.getLocale());
  const ctx: OrelleContext = {
    dataDir,
    logDir,
    settings,
    usage,
    icons,
    apps,
    tracker,
    capabilities: { win32: w32.win32Available(), windowTracking: false, appBar: w32.win32Available(), acrylic: Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621 },
    t: createTranslator(language()),
    language: language(),
    preload: path.join(distDir, 'preload.js'),
    rendererFile: (s) => path.join(distDir, 'renderer', `${s}.html`),
    actions: {
      toggleLauncher: () => launcher.toggle(),
      openSettings: (section) => settingsUi.open(section),
      toggleDock: () => dock.toggleVisible(),
      pinToDock: (ref) => dock.pinRef(ref),
      toggleControlCenter: () => control.toggle(),
      editWidgets: () => widgets.toggleEditing(),
    },
  };

  const scripts = new ScriptService(ctx);
  const search = new SearchService(ctx, files, clip, scripts);
  const dock = new DockController(ctx);
  const launcher = new LauncherController(ctx, search);
  const widgets = new WidgetsController(ctx, system, weather, screenTime);
  const control = new ControlCenterController(ctx, system, () => widgets.toggleEditing());
  const hotkeys = new Hotkeys();

  // Every global shortcut, by action name.
  const hotkeyActions: Record<string, { get: (s: Settings) => string | null; run: () => void }> = {
    launcher: { get: (s) => (s.launcher.enabled ? s.launcher.hotkey : null), run: () => launcher.toggle() },
    control: { get: (s) => s.controlCenter.hotkey || null, run: () => control.toggle() },
  };
  const syncHotkeys = (s: Settings) => {
    for (const [name, a] of Object.entries(hotkeyActions)) {
      const accel = a.get(s);
      if (!accel) hotkeys.remove(name);
      else {
        const res = hotkeys.set(name, accel, a.run);
        if (!res.ok) log.warn('app', `Shortcut ${accel} for ${name} unavailable (${res.error}); change it in Preferences`);
      }
    }
  };
  const settingsUi = new SettingsController(ctx, {
    set: (name, accel) => {
      const a = hotkeyActions[name];
      return a ? hotkeys.set(name, accel, a.run) : { ok: false, error: 'invalid' };
    },
    suspend: (on) => hotkeys.suspend(on),
  }, weather);
  const tray = new OrelleTray(ctx, path.join(distDir, 'icons'), () => app.quit());

  applyTheme(settings.get());
  dock.registerIpc();
  launcher.registerIpc();
  settingsUi.registerIpc();
  widgets.registerIpc();
  control.registerIpc();
  registerSharedIpc(ctx, { dock, launcher, settingsUi, widgets, control });

  // ---------- First run: build a Dock from installed apps ----------
  if (settings.firstRun || settings.get().dock.items.length === 0) {
    if (!apps.ready) await apps.refresh();
    settings.update({ dock: { items: buildDefaultDock(apps) } });
    log.info('app', 'First run: default Dock created');
  } else {
    void apps.refresh();
  }

  tracker.start();
  ctx.capabilities.windowTracking = tracker.available;
  // Crash recovery first (restores a taskbar left auto-hidden), then the user's choice.
  if (!settings.get().general.hideTaskbar) taskbar.restore();
  else taskbar.apply(true);
  dock.start();
  widgets.start();
  launcher.create();
  // The control center is created on first use (saves a renderer process at idle).
  tray.sync();
  syncLoginItem(settings.get());
  syncHotkeys(settings.get());
  if (settings.get().privacy.clipboardHistory && launcher.window) clip.enable(launcher.window);
  // Close the splash once the Dock is painted (never sooner than its short intro animation).
  if (splash) {
    const dockWin = dock.window;
    await Promise.race([
      dockWin ? new Promise<void>((r) => dockWin.once('ready-to-show', () => r())) : Promise.resolve(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    await new Promise((r) => setTimeout(r, Math.max(0, 1300 - (Date.now() - splashShownAt))));
    if (!splash.isDestroyed()) {
      await splash.webContents.executeJavaScript("document.querySelector('.splash').classList.add('out')").catch(() => {});
      setTimeout(() => !splash.isDestroyed() && splash.destroy(), 280);
    }
  }
  if (settings.firstRun && !SMOKE) settingsUi.open('general');

  // Background warm-up, once the UI is up.
  setTimeout(() => {
    apps.warmIcons();
    if (settings.get().launcher.providers.files) void files.build();
  }, SMOKE ? 0 : 8000);

  // ---------- Reactivity ----------
  const appOf = (hwnd: number | null) => {
    const w = hwnd ? tracker.list().find((x) => x.hwnd === hwnd) : undefined;
    if (!w) return null;
    const entry = apps.entryFor({ appId: w.aumid, exe: w.exe });
    return { key: (w.aumid ?? w.exe).toLowerCase(), name: entry?.name ?? dock.nameForWindow(w) };
  };
  tracker.on('change', () => dock.pushState());
  tracker.on('foreground', (hwnd: number | null) => {
    dock.pushState();
    screenTime.focus(appOf(hwnd));
  });
  tracker.on('fullscreen', (fs: boolean) => dock.onFullscreenChanged(fs));
  apps.on('change', () => dock.pushState());
  icons.on('change', () => {
    dock.pushState();
    broadcast('orelle:iconsChanged');
  });

  settings.on('change', (next: Settings, prev: Settings) => {
    const lang = language();
    if (lang !== ctx.language) {
      ctx.language = lang;
      ctx.t = createTranslator(lang);
    }
    applyTheme(next);
    dock.onSettingsChanged(next, prev);
    widgets.onSettingsChanged(next, prev);
    tray.sync();
    if (next.general.launchAtLogin !== prev.general.launchAtLogin) syncLoginItem(next);
    if (next.general.hideTaskbar !== prev.general.hideTaskbar) taskbar.apply(next.general.hideTaskbar);
    if (next.launcher.enabled !== prev.launcher.enabled || next.launcher.hotkey !== prev.launcher.hotkey || next.controlCenter.hotkey !== prev.controlCenter.hotkey) syncHotkeys(next);
    if (next.appearance.effects !== prev.appearance.effects) {
      launcher.onEffectsChanged();
      control.onEffectsChanged();
      settingsUi.updateTitleBar();
    }
    if (next.privacy.clipboardHistory !== prev.privacy.clipboardHistory) {
      if (next.privacy.clipboardHistory && launcher.window) clip.enable(launcher.window);
      else clip.disable();
    }
    if (next.launcher.providers.files && !prev.launcher.providers.files) void files.build();
    broadcastSettings(ctx);
  });

  nativeTheme.on('updated', () => {
    settingsUi.updateTitleBar();
    broadcastSettings(ctx);
  });

  let displayTimer: NodeJS.Timeout | null = null;
  const onDisplays = () => {
    if (displayTimer) clearTimeout(displayTimer);
    displayTimer = setTimeout(() => {
      dock.onDisplaysChanged();
      widgets.layout();
    }, 300);
  };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  const onWake = () => {
    log.info('app', 'Resumed / unlocked: refreshing integrations');
    hotkeys.refresh();
    tracker.refresh();
    onDisplays();
  };
  powerMonitor.on('resume', onWake);
  powerMonitor.on('unlock-screen', onWake);

  // `Orelle --orelle-quit` stops the running instance cleanly (scripts, uninstaller).
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--orelle-quit')) app.quit();
    else settingsUi.open(argv.find((a) => a.startsWith('--orelle-section='))?.split('=')[1]);
  });
  // Orelle lives in the background: closing the preferences window must not quit it.
  app.on('window-all-closed', () => { /* stay resident */ });
  // Every way out (quit, app.exit in tests, process exit) must give back what Orelle borrowed from
  // the shell: the AppBar reservation and the taskbar state. Windows does not reclaim AppBars itself.
  let shutDown = false;
  const shutdown = () => {
    if (shutDown) return;
    shutDown = true;
    hotkeys.disableAll();
    tracker.stop();
    files.dispose();
    clip.disable();
    taskbar.restore();
    dock.destroy();
    widgets.destroy();
    tray.destroy();
    settings.flush();
    usage.flush();
    screenTime.flush();
    log.info('app', 'Orelle stopped');
    log.flushSync();
  };
  app.on('before-quit', shutdown);
  process.on('exit', () => dock.releaseAppBarSync());

  if (SMOKE) void runSmoke(ctx, { dock, launcher, search, files, widgets, control, system }, shutdown);
}

function showSplash(firstRun: boolean, lang: 'fr' | 'en'): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    center: true,
    title: 'Orelle',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.showInactive());
  void win.loadFile(path.join(__dirname, 'renderer', 'splash.html'), { query: { lang, first: firstRun ? '1' : '0' } });
  return win;
}

function applyTheme(s: Settings) {
  const theme = s.appearance.theme;
  nativeTheme.themeSource = theme === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark';
}

function syncLoginItem(s: Settings) {
  if (SMOKE) return;
  // A fixed value name, so the uninstaller can remove it.
  const opts = app.isPackaged
    ? { openAtLogin: s.general.launchAtLogin, name: 'Orelle', args: ['--orelle-autostart'] }
    : { openAtLogin: s.general.launchAtLogin, name: 'Orelle', path: process.execPath, args: [app.getAppPath(), '--orelle-autostart'] };
  try {
    if (app.getLoginItemSettings(opts).openAtLogin !== s.general.launchAtLogin) app.setLoginItemSettings(opts);
    // Remove the entry left by the pre-rename build, if any.
    const legacy = { ...opts, name: 'NOVA' };
    if (app.getLoginItemSettings(legacy).openAtLogin) app.setLoginItemSettings({ ...legacy, openAtLogin: false });
  } catch (err) {
    log.warn('app', 'Cannot update login item', err);
  }
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}

function broadcastSettings(ctx: OrelleContext) {
  broadcast('orelle:settings', { settings: ctx.settings.get(), language: ctx.language, darkSystem: nativeTheme.shouldUseDarkColors });
}

function registerSharedIpc(
  ctx: OrelleContext,
  c: { dock: DockController; launcher: LauncherController; settingsUi: SettingsController; widgets: WidgetsController; control: ControlCenterController },
) {
  const surfaceOf = (wc: WebContents): SurfaceKind | null => {
    if (c.dock.window?.webContents === wc) return 'dock';
    if (c.launcher.window?.webContents === wc) return 'launcher';
    if (c.settingsUi.window?.webContents === wc) return 'settings';
    if (c.widgets.window?.webContents === wc) return 'widgets';
    if (c.control.window?.webContents === wc) return 'control';
    return null;
  };

  ipcMain.handle('orelle:bootstrap', (e: IpcMainInvokeEvent): Bootstrap | null => {
    const surface = surfaceOf(e.sender);
    if (!surface) return null;
    return {
      surface,
      settings: ctx.settings.get(),
      language: ctx.language,
      darkSystem: nativeTheme.shouldUseDarkColors,
      version: app.getVersion(),
      capabilities: ctx.capabilities,
    };
  });

  // Which surface may change which top-level settings group.
  const writable: Partial<Record<SurfaceKind, string[] | 'all'>> = { settings: 'all', dock: ['dock'], widgets: ['widgets'] };
  ipcMain.handle('orelle:updateSettings', (e, patch: unknown) => {
    const surface = surfaceOf(e.sender);
    const allowed = surface ? writable[surface] : undefined;
    if (!allowed || typeof patch !== 'object' || patch === null) return null;
    if (allowed !== 'all' && Object.keys(patch).some((k) => !allowed.includes(k))) return null;
    return ctx.settings.update(patch);
  });
}

// ---------- Smoke test (npm run smoke) ----------

async function runSmoke(
  ctx: OrelleContext,
  c: { dock: DockController; launcher: LauncherController; search: SearchService; files: FileIndex; widgets: WidgetsController; control: ControlCenterController; system: SystemService },
  shutdown: () => void,
) {
  const report: Record<string, unknown> = { ok: false };
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    await wait(2500);
    check('win32 bindings', ctx.capabilities.win32);
    check('window tracking', ctx.tracker.available, { windows: ctx.tracker.list().length });
    check('apps indexed', ctx.apps.entries().length > 10, { count: ctx.apps.entries().length });
    check('default dock built', ctx.settings.get().dock.items.length >= 3, ctx.settings.get().dock.items.map((i) => ('name' in i ? i.name : i.type)));
    check('dock window visible', c.dock.isVisible(), c.dock.window?.getBounds());
    const calc = c.search.search('2+2*3');
    check('calculator', calc.results[0]?.kind === 'calc' && /^8$/.test(calc.results[0].title), calc.results[0]?.title);
    const unit = c.search.search('10 km en mi');
    check('unit conversion', unit.results[0]?.kind === 'unit', unit.results[0]?.title);
    const firstApp = ctx.apps.entries()[0];
    const appRes = c.search.search(firstApp?.name ?? 'x');
    check('app search', appRes.results.some((r) => r.kind === 'app'), appRes.results.slice(0, 3).map((r) => r.title));
    const st = c.search.search('wifi');
    check('windows settings search', st.results.some((r) => r.kind === 'setting'), st.results.slice(0, 3).map((r) => r.title));
    c.launcher.show();
    await wait(600);
    check('launcher shows', c.launcher.isVisible());
    c.launcher.hide();
    // Phase 4
    check('widgets layer visible', !!c.widgets.window?.isVisible(), { widgets: ctx.settings.get().widgets.items.map((w) => w.type) });
    const vol = audio.getVolume();
    check('core audio volume read', vol !== null && vol.level >= 0 && vol.level <= 100, vol);
    c.system.subscribe('smoke');
    await wait(2300);
    const stats = c.system.stats;
    c.system.unsubscribe('smoke');
    check('system stats', !!stats && stats.memTotal > 0 && stats.cpu >= 0, stats && { cpu: Math.round(stats.cpu), memGB: +(stats.memUsed / 1e9).toFixed(1), disks: stats.disks.length, battery: stats.battery });
    // Writing the volume back to its current level exercises the write path without changing anything.
    if (vol) check('core audio volume write', audio.setVolume(vol.level) && audio.getVolume()?.level === vol.level);
    check('taskbar state readable', w32.getTaskbarAutoHide() !== null, { autoHide: w32.getTaskbarAutoHide() });
    c.control.show();
    await wait(1500);
    check('control center shows', c.control.isVisible());
    const capDir = argValue('orelle-capture');
    if (capDir) {
      fs.mkdirSync(capDir, { recursive: true });
      const lw = c.launcher.window!;
      c.launcher.show();
      await lw.webContents.executeJavaScript(`window.__orelleTestQuery && window.__orelleTestQuery(${JSON.stringify(argValue('orelle-capture-query') ?? 'spo')})`);
      await wait(900);
      fs.writeFileSync(path.join(capDir, 'launcher.png'), (await lw.webContents.capturePage()).toPNG());
      c.launcher.hide();
      if (c.dock.window) fs.writeFileSync(path.join(capDir, 'dock.png'), (await c.dock.window.webContents.capturePage()).toPNG());
    }
    c.control.hide();
    await c.files.build();
    check('file index', c.files.ready);
    // Memory of every Orelle process (KB → MB), after the UI is fully up.
    // Idle footprint after closing the control center (created on demand, then released).
    c.control.release();
    await wait(1500);
    const metrics = app.getAppMetrics();
    const sum = (k: 'workingSetSize' | 'privateBytes') => Math.round(metrics.reduce((s, m) => s + ((m.memory as unknown as Record<string, number>)?.[k] ?? 0), 0) / 1024);
    report.memory = {
      privateMB: sum('privateBytes'),
      workingSetMB: sum('workingSetSize'),
      processes: metrics.map((m) => ({ type: m.type, privateMB: Math.round(((m.memory as unknown as Record<string, number>)?.privateBytes ?? 0) / 1024), workingSetMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024) })),
    };
    report.ok = checks.every((x) => x.ok);
  } catch (err) {
    report.error = String(err);
  }
  report.checks = checks;
  const out = argValue('orelle-smoke-report') ?? path.join(ctx.dataDir, 'smoke-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  log.flushSync();
  shutdown();
  app.exit(report.ok ? 0 : 1);
}
