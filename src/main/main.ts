// Orelle main process: wires services and surfaces, owns the application lifecycle.
import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { resolvePerformance, tuning } from '../shared/performance';
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
import { AppsController } from './windows/appsController';
import { FileService } from './services/fileService';
import { MonitorService } from './services/monitorService';
import { AlertService } from './services/alertService';
import { AiService } from './services/aiService';
import { AutomationService } from './services/automationService';
import { ExtensionService } from './services/extensionService';
import { NotificationService } from './services/notificationService';
import { ProfileService } from './services/profileService';
import { SNAP_HOTKEYS, WindowService, type SnapTarget } from './services/windowService';
import { WinKeyHook } from './native/keyboard';
import { registerExtrasIpc } from './extrasIpc';
import { MenuController, NotificationCenterController } from './windows/shellPanels';
import { TopBarController } from './windows/topBarController';
import { MissionControlController } from './windows/missionControlController';
import { ToolsController, type ToolsSection } from './windows/toolsController';
import { StorageService } from './services/storageService';
import { ThemeService } from './services/themeService';
import { MemoryTrimmer } from './services/memoryTrimmer';
import { WelcomeController } from './windows/welcomeController';
import { UpdateService } from './services/updateService';
import { CaptureController } from './windows/captureController';
import { StackController } from './windows/stackController';
import { DesktopService } from './services/desktopService';
import { SensorService } from './services/sensorService';
import { DesktopMenuService } from './services/desktopMenuService';
import { buildDiagnostics } from './services/diagnostics';
import { diagnose } from './services/networkService';
import { panelTiming } from './windows/panelWindow';

const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const SMOKE = process.argv.includes('--orelle-smoke');
// Performance measurement: a normal start in an isolated profile, then an idle memory report.
const MEASURE = process.argv.includes('--orelle-measure');
const T0 = Date.now();

// Isolated profile for tests: --orelle-user-data=<dir>.
const customData = argValue('orelle-user-data') ?? (SMOKE || MEASURE ? path.join(app.getPath('temp'), `orelle-smoke-${process.pid}`) : undefined);
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
let rawGeneral: Record<string, unknown> = {};
try {
  rawGeneral = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))?.general ?? {};
} catch { /* first run or unreadable: defaults */ }
const pref = rawGeneral.performance === 'standard' || rawGeneral.performance === 'light' ? rawGeneral.performance : 'auto';
const PERF = resolvePerformance(pref, os.totalmem(), os.cpus().length);
const TUNE = tuning(PERF);
// Light profile: no GPU process (≈ 100 MB). Effects are drawn in software instead.
const GPU = rawGeneral.hardwareAcceleration !== false && PERF !== 'light';
if (!GPU) app.disableHardwareAcceleration();

if (process.argv.includes('--orelle-restore-taskbar')) {
  // Used by the uninstaller: gives the taskbar back even if Orelle crashed while it was hidden.
  void app.whenReady().then(() => {
    new TaskbarService(app.getPath('userData')).restore();
    app.exit(0);
  });
} else if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--orelle-quit')) {
  // Nothing was running: nothing to stop (the installer calls this unconditionally).
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

  // Clipboard notifications need a window that lives as long as Orelle: the Dock when there is one.
  const clipHost = () => {
    if (dock.window) return dock.window;
    launcher.create();
    launcher.hostsClipboard = true;
    return launcher.window!;
  };
  // Crash guard: two unclean exits in a row → safe mode (nothing that changes Windows' behaviour).
  const runState = path.join(dataDir, 'run-state.json');
  let unclean = 0;
  try { unclean = Number(JSON.parse(fs.readFileSync(runState, 'utf8')).unclean) || 0; } catch { /* first run */ }
  const SAFE = !SMOKE && (process.argv.includes('--orelle-safe-mode') || unclean >= 2);
  if (!SMOKE) try { fs.writeFileSync(runState, JSON.stringify({ unclean: unclean + 1 })); } catch { /* read-only profile */ }
  if (SAFE) log.warn('app', `Safe mode (${unclean} unclean exit(s) in a row)`);
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
  const system = new SystemService(TUNE.statsInterval);
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
    capabilities: { win32: w32.win32Available(), windowTracking: false, appBar: w32.win32Available(), acrylic: Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621, safeMode: SAFE, performance: PERF, machine: { memGB: Math.round(os.totalmem() / 1024 ** 3), cpus: os.cpus().length, gpu: GPU } },
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
      openApp: (which, arg) => (which === 'files' ? orelleApps.openFiles(arg) : which === 'tools' ? tools.open((arg as ToolsSection) || 'audio') : orelleApps.openMonitor(arg)),
    },
  };

  const clip = new ClipboardHistory(ctx, () => {
    const fg = tracker.getForeground();
    const w = fg ? tracker.list().find((x) => x.hwnd === fg) : undefined;
    return w ? { exe: w.exe, name: dock.nameForWindow(w) } : null;
  });
  const scripts = new ScriptService(ctx);
  const orelleApps = new AppsController(ctx, new FileService(ctx, files), new MonitorService(ctx));
  // Clicking a notification: a small closed set of actions, never a command line.
  const runNotificationAction = (action: string) => {
    const [kind, ...rest] = action.split(':');
    const arg = rest.join(':');
    if (kind === 'monitor') orelleApps.openMonitor();
    else if (kind === 'files') orelleApps.openFiles(arg || undefined);
    else if (kind === 'settings') settingsUi.open(arg || undefined);
    else if (kind === 'url' && /^https:\/\//i.test(arg)) void shell.openExternal(arg);
    else if (kind === 'reveal' && path.isAbsolute(arg)) shell.showItemInFolder(arg);
  };
  const notifications = new NotificationService(ctx, runNotificationAction);
  ctx.actions.notify = (n) => void notifications.notify(n);
  const alerts = new AlertService(ctx, system, notifications);
  const search = new SearchService(ctx, files, clip, scripts);
  const windowsSvc = new WindowService(ctx);
  const profiles = new ProfileService(ctx, notifications, alerts, windowsSvc);
  const extensions = new ExtensionService(ctx, path.join(distDir, 'extensions'));
  if (!SAFE) extensions.load();
  const ai = new AiService(ctx);
  for (const plugin of [extensions, profiles, windowsSvc, ai]) search.register(plugin);
  const dock = new DockController(ctx);
  const launcher = new LauncherController(ctx, search);
  const widgets = new WidgetsController(ctx, system, weather, screenTime);
  const control = new ControlCenterController(ctx, system, () => widgets.toggleEditing());
  const hotkeys = new Hotkeys();
  const desktops = new DesktopService(ctx);
  const mission = new MissionControlController(ctx, (hwnd) => {
    const w = tracker.list().find((x) => x.hwnd === hwnd);
    return w ? dock.nameForWindow(w) : '';
  }, desktops);
  ctx.actions.toggleMission = () => mission.toggle();
  const storage = new StorageService(ctx);
  const themeSvc = new ThemeService(ctx);
  const updates = new UpdateService(ctx, notifications);
  const capture = new CaptureController(ctx, (file) => notifications.notify({ title: ctx.t('capture.saved'), body: path.basename(file), source: 'capture', glyph: 'image', action: `reveal:${file}` }));
  ctx.actions.capture = () => void capture.start();
  const stack = new StackController(ctx);
  const desktopMenu = new DesktopMenuService(ctx, { editWidgets: () => widgets.toggleEditing(), mission: () => mission.toggle(), capture: () => void capture.start() });
  ctx.actions.openStack = (folder, anchor) => stack.open(folder, anchor);
  const tools = new ToolsController(ctx, storage, clip, () => windowsSvc.target());
  // First run: nothing that changes Windows' behaviour until the guided setup is finished.
  let onboarding = settings.firstRun && !SMOKE && !MEASURE && !settings.get().general.onboarded;
  if (!settings.firstRun && !settings.get().general.onboarded) settings.update({ general: { onboarded: true } });
  const welcome = new WelcomeController(ctx, () => {
    onboarding = false;
    if (SMOKE) return;
    if (!SAFE) {
      taskbar.apply(settings.get().general.taskbarMode);
      syncWinKey(settings.get());
    }
    settingsUi.open('general');
  });
  const menu = new MenuController(ctx, search, profiles);
  const notificationCenter = new NotificationCenterController(ctx, notifications);
  const topbar = new TopBarController(ctx, {
    system,
    notifications,
    profiles,
    windows: windowsSvc,
    taskbar,
    nameFor: (hwnd) => {
      const w = tracker.list().find((x) => x.hwnd === hwnd);
      return w ? dock.nameForWindow(w) : null;
    },
    toggleMenu: () => menu.toggle(),
    toggleNotifications: () => notificationCenter.toggle(),
    toggleControl: () => control.toggle(),
    toggleLauncher: () => launcher.toggle(),
    toggleMission: () => mission.toggle(),
  });
  const automations = new AutomationService(ctx, hotkeys, notifications, profiles, windowsSvc);
  // Optional: a lone press of the Windows key opens Orelle's menu or launcher instead of Start.
  const winKey = new WinKeyHook(() => {
    const mode = settings.get().general.winKey;
    if (mode === 'menu') menu.toggle();
    else if (mode === 'launcher') launcher.toggle();
  }, () => {
    // Win just went down: make sure the target is loaded so it opens instantly on release.
    const mode = settings.get().general.winKey;
    if (mode === 'menu') menu.panel.prewarm();
    else if (mode === 'launcher') launcher.create();
  });
  const syncWinKey = (s: Settings) => (s.general.winKey !== 'windows' && !SMOKE ? winKey.start() : winKey.stop());
  ai.on('answer', (a) => launcher.window?.webContents.send('launcher:ai', a));

  // Every global shortcut, by action name.
  const hotkeyActions: Record<string, { get: (s: Settings) => string | null; run: () => void }> = {
    launcher: { get: (s) => (s.launcher.enabled ? s.launcher.hotkey : null), run: () => launcher.toggle() },
    control: { get: (s) => s.controlCenter.hotkey || null, run: () => control.toggle() },
    overview: { get: (s) => s.windows.overviewHotkey || null, run: () => mission.toggle() },
    clipboard: { get: (s) => (s.privacy.clipboardHistory && s.clipboard.hotkey) || null, run: () => tools.open('clipboard') },
    capture: { get: (s) => s.capture.hotkey || null, run: () => void capture.start() },
  };
  for (const [target, accel] of Object.entries(SNAP_HOTKEYS)) {
    hotkeyActions[`snap:${target}`] = { get: (s) => (s.windows.snapping ? accel : null), run: () => windowsSvc.snap(target as SnapTarget) };
  }
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
  orelleApps.registerIpc();
  menu.registerIpc();
  mission.registerIpc();
  tools.registerIpc();
  welcome.registerIpc();
  capture.registerIpc();
  stack.registerIpc();
  notificationCenter.registerIpc();
  topbar.registerIpc();
  registerSharedIpc(ctx, { dock, launcher, settingsUi, widgets, control, apps: orelleApps, topbar, menu, notificationCenter, mission, tools, welcome, capture, stack });
  registerExtrasIpc(ctx, () => settingsUi.window, { extensions, ai, windows: windowsSvc, profiles, automations, updates });

  // ---------- First run: build a Dock from installed apps ----------
  if (settings.firstRun || settings.get().dock.items.length === 0) {
    if (!apps.ready) await apps.refresh();
    settings.update({ dock: { items: await buildDefaultDock(apps, icons.cacheDir, tracker) } });
    // Modest PC: start lighter (the user can turn these back on at any time).
    if (settings.firstRun && PERF === 'light' && !SMOKE) settings.update({ widgets: { enabled: false }, appearance: { effects: 'reduced' } });
    log.info('app', 'First run: Dock built from the Windows taskbar pins');
  } else {
    // The cached list is used right away; the (PowerShell) rescan waits until the desktop is idle.
    setTimeout(() => void apps.refresh(), SMOKE ? 0 : TUNE.appRefreshDelay);
  }

  tracker.start();
  ctx.capabilities.windowTracking = tracker.available;
  // Crash recovery first (restores a taskbar left auto-hidden), then the user's choice.
  taskbar.apply(SAFE || onboarding ? 'normal' : settings.get().general.taskbarMode);
  profiles.start();
  topbar.host = () => dock.window;
  widgets.host = () => dock.window;
  dock.start();
  topbar.start();
  widgets.start();
  if (PERF !== 'light' || SMOKE) launcher.create();
  panelTiming.releaseAfter = SMOKE ? 60_000 : TUNE.releasePanelsAfter;
  // Light profile: the launcher is loaded once the desktop is idle, not during startup.
  if (PERF === 'light' && !SMOKE) setTimeout(() => launcher.create(), TUNE.prewarmLauncherAfter);
  const trimmer = new MemoryTrimmer(TUNE.trimHiddenAfter, TUNE.trimAwayAfter, () => {
    const fg = w32.getForegroundWindow();
    return !!fg && w32.getWindowPid(fg) === process.pid;
  });
  if (!SMOKE) trimmer.start();
  topbar.volumePoll = TUNE.volumePoll;
  // The control center is created on first use (saves a renderer process at idle).
  tray.sync();
  syncLoginItem(settings.get());
  syncHotkeys(settings.get());
  alerts.sync();
  if (!SAFE) automations.start();
  if (!SMOKE && !MEASURE) updates.schedule();
  // Text size: Orelle's resizable app windows (Preferences, Files, Monitor, Utilities) follow
  // Appearance › Text size; fixed-size panels keep their layout.
  const applyZoom = (w: BrowserWindow) => {
    if (!w.isDestroyed() && w.isResizable()) w.webContents.setZoomFactor(settings.get().appearance.textScale);
  };
  app.on('browser-window-created', (_e, w) => w.webContents.on('did-finish-load', () => applyZoom(w)));
  settings.on('change', (next: Settings, prev: Settings) => {
    if (next.appearance.textScale !== prev.appearance.textScale) BrowserWindow.getAllWindows().forEach(applyZoom);
  });
  // Self-healing: a page frozen for 10 s is restarted (its controller recreates or reloads it).
  app.on('web-contents-created', (_e, wc) => {
    let frozen: NodeJS.Timeout | null = null;
    wc.on('unresponsive', () => {
      frozen ??= setTimeout(() => {
        if (wc.isDestroyed()) return;
        log.error('app', `Renderer unresponsive for 10 s, restarting it: ${wc.getTitle()}`);
        wc.forcefullyCrashRenderer();
        setTimeout(() => !wc.isDestroyed() && wc.reload(), 500);
      }, 10_000);
    });
    wc.on('responsive', () => {
      if (frozen) clearTimeout(frozen);
      frozen = null;
    });
  });
  themeSvc.start();
  if (!SAFE && !MEASURE && !onboarding) syncWinKey(settings.get());
  if (!SAFE && !SMOKE && !MEASURE) desktopMenu.sync();
  if (SAFE) {
    notifications.notify({ title: ctx.t('safe.title'), body: ctx.t('safe.body'), source: 'orelle', glyph: 'shield', action: 'settings:general' });
    setTimeout(() => settingsUi.open('general'), 1500);
  }
  if (settings.get().privacy.clipboardHistory) clip.enable(clipHost());
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
  if (onboarding) welcome.open();

  // Background warm-up, once the UI is up.
  setTimeout(() => {
    apps.warmIcons();
    // Light profile: the file index is built on the first file search instead.
    if (settings.get().launcher.providers.files && TUNE.buildFileIndexAtStart) void files.build();
  }, SMOKE ? 0 : 8000);

  // ---------- Reactivity ----------
  const appOf = (hwnd: number | null) => {
    const w = hwnd ? tracker.list().find((x) => x.hwnd === hwnd) : undefined;
    if (!w) return null;
    const entry = apps.entryFor({ appId: w.aumid, exe: w.exe });
    return { key: (w.aumid ?? w.exe).toLowerCase(), name: entry?.name ?? dock.nameForWindow(w) };
  };
  tracker.on('change', () => {
    dock.pushState();
    topbar.pushState();
  });
  tracker.on('foreground', (hwnd: number | null) => {
    dock.pushState();
    topbar.pushState();
    screenTime.focus(appOf(hwnd));
  });
  tracker.on('fullscreen', (fs: boolean) => {
    dock.onFullscreenChanged(fs);
    topbar.onFullscreenChanged(fs);
  });
  notifications.on('change', () => topbar.pushState());
  apps.on('change', () => dock.pushState());
  icons.on('change', () => {
    dock.pushState();
    topbar.pushState();
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
    topbar.onSettingsChanged(next, prev);
    profiles.onSettingsChanged(next);
    automations.onSettingsChanged(next, prev);
    themeSvc.onSettingsChanged(next, prev);
    if (next.general.winKey !== prev.general.winKey && !SAFE && !onboarding) syncWinKey(next);
    if (next.general.desktopMenu !== prev.general.desktopMenu && !SAFE) desktopMenu.sync();
    tray.sync();
    if (next.general.launchAtLogin !== prev.general.launchAtLogin) syncLoginItem(next);
    if (next.general.taskbarMode !== prev.general.taskbarMode && !SAFE && !onboarding) taskbar.apply(next.general.taskbarMode);
    alerts.sync();
    if (next.launcher.enabled !== prev.launcher.enabled || next.launcher.hotkey !== prev.launcher.hotkey || next.controlCenter.hotkey !== prev.controlCenter.hotkey || next.windows.snapping !== prev.windows.snapping || next.windows.overviewHotkey !== prev.windows.overviewHotkey || next.clipboard.hotkey !== prev.clipboard.hotkey || next.capture.hotkey !== prev.capture.hotkey || next.privacy.clipboardHistory !== prev.privacy.clipboardHistory) syncHotkeys(next);
    if (next.appearance.effects !== prev.appearance.effects) {
      launcher.onEffectsChanged();
      control.onEffectsChanged();
      menu.panel.onEffectsChanged();
      mission.onEffectsChanged();
      notificationCenter.panel.onEffectsChanged();
      settingsUi.updateTitleBar();
      orelleApps.updateTitleBars();
      tools.updateTitleBar();
    }
    if (next.privacy.clipboardHistory !== prev.privacy.clipboardHistory) {
      if (next.privacy.clipboardHistory) clip.enable(clipHost());
      else clip.disable();
    }
    if (next.launcher.providers.files && !prev.launcher.providers.files) void files.build();
    broadcastSettings(ctx);
  });

  nativeTheme.on('updated', () => {
    settingsUi.updateTitleBar();
    orelleApps.updateTitleBars();
    broadcastSettings(ctx);
  });

  let displayTimer: NodeJS.Timeout | null = null;
  const onDisplays = () => {
    if (displayTimer) clearTimeout(displayTimer);
    displayTimer = setTimeout(() => {
      topbar.onDisplaysChanged();
      automations.onDisplaysChanged();
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

  // `Orelle --orelle-quit` stops the running instance cleanly (scripts, uninstaller);
  // `--orelle-open=files[:path]` / `--orelle-open=monitor[:tab]` / `--orelle-open=control` open a surface.
  const openFromArgs = (argv: string[]) => {
    const open = argv.find((a) => a.startsWith('--orelle-open='))?.slice('--orelle-open='.length);
    if (!open) return false;
    const [what, ...rest] = open.split(':');
    const arg = rest.join(':') || undefined;
    if (what === 'files' || what === 'monitor') ctx.actions.openApp(what, arg);
    else if (what === 'control') control.show();
    else if (what === 'launcher') launcher.show();
    else if (what === 'menu') menu.toggle();
    else if (what === 'mission') mission.toggle();
    else if (what === 'tools') tools.open((arg as ToolsSection) || 'audio');
    else if (what === 'notifications') notificationCenter.toggle();
    else return false;
    return true;
  };
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--orelle-quit')) app.quit();
    else if (!openFromArgs(argv)) settingsUi.open(argv.find((a) => a.startsWith('--orelle-section='))?.split('=')[1]);
  });
  openFromArgs(process.argv);
  // Orelle lives in the background: closing the preferences window must not quit it.
  app.on('window-all-closed', () => { /* stay resident */ });
  // Every way out (quit, app.exit in tests, process exit) must give back what Orelle borrowed from
  // the shell: the AppBar reservation and the taskbar state. Windows does not reclaim AppBars itself.
  let shutDown = false;
  const shutdown = () => {
    if (shutDown) return;
    shutDown = true;
    winKey.stop();
    desktopMenu.stop();
    trimmer.stop();
    automations.stop();
    themeSvc.stop();
    hotkeys.disableAll();
    tracker.stop();
    files.dispose();
    clip.disable();
    taskbar.restore();
    topbar.destroy();
    dock.destroy();
    widgets.destroy();
    tray.destroy();
    settings.flush();
    if (!SMOKE) try { fs.writeFileSync(runState, JSON.stringify({ unclean: 0 })); } catch { /* exiting */ }
    usage.flush();
    screenTime.flush();
    notifications.flush();
    log.info('app', 'Orelle stopped');
    log.flushSync();
  };
  app.on('before-quit', shutdown);
  process.on('exit', () => {
    dock.releaseAppBarSync();
    topbar.releaseAppBarSync();
    winKey.stop();
    // Never leave the user without a taskbar.
    try { taskbar.restore(); } catch { /* exiting */ }
  });

  if (MEASURE) void runMeasure(dock.window, shutdown, async () => {
    // Wake-up cost after the idle trim: show the launcher and wait for its page to answer.
    const t = Date.now();
    launcher.show();
    await launcher.window?.webContents.executeJavaScript('document.body.getBoundingClientRect().height');
    const ms = Date.now() - t;
    launcher.hide();
    return ms;
  });
  if (SMOKE) void runSmoke(ctx, { dock, launcher, search, files, widgets, control, system, apps: orelleApps, topbar, menu, notificationCenter, notifications, windows: windowsSvc, profiles, extensions, settingsUi, ai, mission, tools, storage, welcome, updates, capture, stack }, shutdown);
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
  c: { dock: DockController; launcher: LauncherController; settingsUi: SettingsController; widgets: WidgetsController; control: ControlCenterController; apps: AppsController; topbar: TopBarController; menu: MenuController; notificationCenter: NotificationCenterController; mission: MissionControlController; tools: ToolsController; welcome: WelcomeController; capture: CaptureController; stack: StackController },
) {
  const surfaceOf = (wc: WebContents): SurfaceKind | null => {
    if (c.dock.window?.webContents === wc) return 'dock';
    if (c.launcher.window?.webContents === wc) return 'launcher';
    if (c.settingsUi.window?.webContents === wc) return 'settings';
    if (c.widgets.window?.webContents === wc) return 'widgets';
    if (c.control.window?.webContents === wc) return 'control';
    if (c.apps.isFiles(wc)) return 'files';
    if (c.apps.isMonitor(wc)) return 'monitor';
    if (c.topbar.window?.webContents === wc) return 'topbar';
    if (c.menu.panel.window?.webContents === wc) return 'menu';
    if (c.notificationCenter.panel.window?.webContents === wc) return 'notifications';
    if (c.mission.window?.webContents === wc) return 'mission';
    if (c.tools.is(wc)) return 'tools';
    if (c.welcome.is(wc)) return 'welcome';
    if (c.capture.window?.webContents === wc) return 'capture';
    if (c.stack.panel.window?.webContents === wc) return 'stack';
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
  const writable: Partial<Record<SurfaceKind, string[] | 'all'>> = { settings: 'all', dock: ['dock'], widgets: ['widgets'], control: ['controlCenter'], files: ['files'], monitor: ['monitor'], notifications: ['notifications'], tools: ['privacy', 'clipboard', 'storage'], welcome: ['general', 'appearance', 'dock'] };
  ipcMain.handle('orelle:updateSettings', (e, patch: unknown) => {
    const surface = surfaceOf(e.sender);
    const allowed = surface ? writable[surface] : undefined;
    if (!allowed || typeof patch !== 'object' || patch === null) return null;
    if (allowed !== 'all' && Object.keys(patch).some((k) => !allowed.includes(k))) return null;
    return ctx.settings.update(patch);
  });
}

// ---------- Performance measurement (npm run measure) ----------

async function runMeasure(dockWin: BrowserWindow | null, shutdown: () => void, wake: () => Promise<number>) {
  const dockReady = await new Promise<number>((r) => {
    if (!dockWin) return r(Date.now());
    if (dockWin.isVisible()) return r(Date.now());
    dockWin.once('show', () => r(Date.now()));
    setTimeout(() => r(Date.now()), 15000);
  });
  await new Promise((r) => setTimeout(r, Number(argValue('orelle-idle') ?? 15) * 1000));
  const titles = new Map<number, string>();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) titles.set(w.webContents.getOSProcessId(), w.getTitle());
  const metrics = app.getAppMetrics();
  const mb = (m: Electron.ProcessMetric) => Math.round(((m.memory as unknown as Record<string, number>)?.privateBytes ?? 0) / 1024);
  const report = {
    startupMs: dockReady - T0,
    privateMB: metrics.reduce((s, m) => s + mb(m), 0),
    workingSetMB: Math.round(metrics.reduce((s, m) => s + (m.memory?.workingSetSize ?? 0), 0) / 1024),
    cpuIdlePercent: +metrics.reduce((s, m) => s + m.cpu.percentCPUUsage, 0).toFixed(2),
    processes: metrics.map((m) => ({ type: m.type, name: titles.get(m.pid) ?? m.name ?? '', privateMB: mb(m), workingSetMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024) })),
  };
  (report as Record<string, unknown>).launcherWakeMs = await wake();
  const out = argValue('orelle-measure-report');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  shutdown();
  app.exit(0);
}

// ---------- Smoke test (npm run smoke) ----------

async function runSmoke(
  ctx: OrelleContext,
  c: {
    dock: DockController; launcher: LauncherController; search: SearchService; files: FileIndex; widgets: WidgetsController; control: ControlCenterController; system: SystemService; apps: AppsController;
    topbar: TopBarController; menu: MenuController; notificationCenter: NotificationCenterController; notifications: NotificationService; windows: WindowService; profiles: ProfileService; extensions: ExtensionService; settingsUi: SettingsController; ai: AiService; mission: MissionControlController; tools: ToolsController; storage: StorageService; welcome: WelcomeController; updates: UpdateService; capture: CaptureController; stack: StackController;
  },
  shutdown: () => void,
) {
  const report: Record<string, unknown> = { ok: false };
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    checks.push({ name, ok, detail });
    log.info('smoke', `${ok ? 'ok' : 'FAIL'} ${name}`);
  };
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
    // v0.3 shell: top bar (AppBar at the top), Orelle menu, notification center, extensions, profiles, layouts.
    const primary = screen.getPrimaryDisplay();
    check('top bar visible', c.topbar.isVisible(), c.topbar.window?.getBounds());
    check('top bar reserves space', primary.workArea.y >= primary.bounds.y + 20, { workArea: primary.workArea });
    c.control.hide();
    c.menu.toggle();
    await wait(1500);
    check('orelle menu shows', c.menu.panel.isVisible());
    const shot = async (name: string, w: BrowserWindow | null | undefined) => {
      const dir = argValue('orelle-capture');
      if (dir && w) {
        fs.mkdirSync(dir, { recursive: true });
        // A guest window can fail to answer capturePage: never let a screenshot block the test.
        const img = await Promise.race([w.webContents.capturePage(), wait(4000).then(() => null)]);
        if (img) fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      }
    };
    await shot('menu', c.menu.panel.window);
    await shot('topbar', c.topbar.window);
    c.menu.panel.hide();
    c.notifications.profileFocus = true; // no real toast during the test
    const note = c.notifications.notify({ title: 'Smoke', body: 'test', source: 'smoke', glyph: 'check' });
    check('notification stored', !!note && c.notifications.list()[0]?.id === note.id && c.notifications.unread() >= 1);
    c.notificationCenter.toggle();
    await wait(1500);
    check('notification center shows', c.notificationCenter.panel.isVisible());
    await shot('notifications', c.notificationCenter.panel.window);
    if (argValue('orelle-capture')) {
      for (const section of ['studio', 'topbar', 'windows', 'profiles', 'extensions', 'automations', 'ai', 'general']) {
        c.settingsUi.open(section);
        await wait(section === 'topbar' ? 2500 : 1200);
        await shot(`settings-${section}`, c.settingsUi.window);
      }
      c.settingsUi.window?.close();
    }
    c.notificationCenter.panel.hide();
    c.notifications.profileFocus = false;
    const exts = c.extensions.list();
    check('builtin extensions loaded', exts.filter((x) => x.builtin && x.enabled && !x.error).length >= 2, exts.map((x) => ({ id: x.id, error: x.error })));
    // Install / remove a user extension (manifest only, disabled until enabled).
    const extSrc = path.join(ctx.dataDir, 'ext-test.json');
    fs.writeFileSync(extSrc, JSON.stringify({ id: 'smoke.test', name: 'Smoke', commands: [{ id: 'a', title: 'Smoke page', keyword: 'smk', url: 'https://example.org/?q={query}' }] }));
    const inst = c.extensions.install(extSrc);
    const installed = c.extensions.list().find((x) => x.id === 'smoke.test');
    const removed = c.extensions.remove('smoke.test');
    check('extension install / remove', inst.ok && !!installed && !installed.enabled && removed && !c.extensions.list().some((x) => x.id === 'smoke.test'), inst);
    const ext = c.search.search('wiki Lyon');
    check('extension command search', ext.results.some((r) => r.id === 'ext:orelle.web-search/wikipedia:Lyon'), ext.results.slice(0, 3).map((r) => r.id));
    const layout = c.windows.capture('smoke');
    check('layout capture', Array.isArray(layout.windows), { windows: layout.windows.length });
    await c.profiles.activate('focus');
    const on = ctx.settings.get().profiles.active === 'focus';
    c.profiles.deactivate(true);
    check('profile on/off', on && ctx.settings.get().profiles.active === null);
    c.mission.show();
    await wait(2000);
    const live = ctx.tracker.list().filter((w) => !w.minimized).length;
    check('mission control shows', c.mission.isVisible(), { windows: ctx.tracker.list().length });
    const vds = await new DesktopService(ctx).list();
    check('virtual desktops readable', vds.length >= 1 && vds.filter((d) => d.current).length === 1, vds.map((d) => d.name));
    check('mission control live thumbnails', c.mission.thumbnailCount === live, { thumbnails: c.mission.thumbnailCount, live });
    await shot('mission', c.mission.window);
    if (argValue('orelle-capture')) {
      // DWM thumbnails are composited by Windows, not by Chromium: grab the real screen.
      const out = path.join(argValue('orelle-capture')!, 'mission-screen.png').replace(/'/g, "''");
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${out}')`], { timeout: 15000 });
      } catch { /* capture is best effort */ }
    }
    c.mission.hide();
    // Utilities: Core Audio enumeration, storage scan and duplicate detection on files made for the test.
    const devices = audio.listDevices();
    check('audio devices', devices.some((d) => d.flow === 'output'), devices.map((d) => ({ name: d.name, flow: d.flow, def: d.isDefault, level: d.level })));
    const sessions = audio.listSessions();
    check('audio sessions readable', Array.isArray(sessions), { sessions: sessions.length });
    const dupDir = path.join(ctx.dataDir, 'dup-test');
    fs.mkdirSync(dupDir, { recursive: true });
    const blob = Buffer.alloc(200_000, 7);
    fs.writeFileSync(path.join(dupDir, 'a.bin'), blob);
    fs.writeFileSync(path.join(dupDir, 'b.bin'), blob);
    fs.writeFileSync(path.join(dupDir, 'c.bin'), Buffer.concat([blob.subarray(1), Buffer.from([8])]));
    const scanRes = await c.storage.analyze(dupDir);
    check('storage scan', scanRes.ok && scanRes.files === 3 && scanRes.total === 600_000, { files: scanRes.files, total: scanRes.total });
    const dups = await c.storage.duplicates(dupDir, 1000);
    check('storage duplicates', dups.ok && dups.groups.length === 1 && dups.groups[0].files.length === 2, dups.groups.map((g) => g.files.map((f) => path.basename(f.path))));
    c.tools.open('audio');
    await wait(2500);
    check('utilities window', !!c.tools.window?.isVisible());
    await shot('tools-audio', c.tools.window);
    c.tools.open('storage');
    await wait(1500);
    await shot('tools-storage', c.tools.window);
    c.tools.window?.close();
    if (argValue('orelle-capture')) {
      c.welcome.open();
      await wait(2000);
      await shot('welcome-1', c.welcome.window);
      for (let i = 2; i <= 5; i++) {
        await c.welcome.window?.webContents.executeJavaScript("document.querySelector('.btn.primary').click()");
        await wait(500);
        await shot(`welcome-${i}`, c.welcome.window);
      }
      c.welcome.window?.close();
    }
    // AI: off by default; with consent but an unreachable local server, a clean error (no crash, nothing sent elsewhere).
    check('ai off by default', c.search.search('? bonjour').results.every((r) => r.kind !== 'ai'));
    ctx.settings.update({ ai: { provider: 'ollama', consent: true, model: 'smoke', endpoint: 'http://127.0.0.1:9' } });
    const aiRes = await c.ai.ask('ping');
    ctx.settings.update({ ai: { provider: 'none', consent: false, model: '', endpoint: '' } });
    check('ai error path', aiRes.state === 'error', aiRes);
    if (argValue('orelle-update-feed')) {
      // Packaged build against a local feed: the full check → download → SHA-512 verification path.
      const st = await c.updates.check(true);
      const started = st.state === 'available' && c.updates.download();
      for (let i = 0; i < 120 && c.updates.status.state === 'downloading'; i++) await wait(500);
      check('update: detect, download, verify', st.state === 'available' && started && c.updates.status.state === 'ready', { check: st.state, latest: st.latest, final: c.updates.status.state });
    }
    const upd = await c.updates.check(true);
    check('update check answers', ['unavailable', 'current', 'available', 'ready'].includes(upd.state), upd);
    // Screenshot: capture the screen, then a 200×120 area as if the user had dragged it.
    ctx.settings.update({ capture: { folder: path.join(ctx.dataDir, 'shots'), copy: false } });
    fs.mkdirSync(path.join(ctx.dataDir, 'shots'), { recursive: true });
    ctx.settings.update({ capture: { folder: path.join(ctx.dataDir, 'shots') } });
    await c.capture.start();
    await wait(800);
    await shot('capture', c.capture.window);
    ipcMain.emit('capture:done', { sender: c.capture.window?.webContents }, { x: 10, y: 10, w: 200, h: 120 });
    await wait(800);
    const shots = fs.readdirSync(path.join(ctx.dataDir, 'shots')).filter((f) => f.endsWith('.png'));
    const size = shots[0] ? nativeImage.createFromPath(path.join(ctx.dataDir, 'shots', shots[0])).getSize() : null;
    const sf = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor;
    check('screenshot saved and cropped', !!size && size.width === Math.round(200 * sf) && size.height === Math.round(120 * sf), { shots: shots.length, size });
    const netRes = await diagnose();
    check('network diagnostics', netRes.probes.length === 4 && netRes.adapters.length > 0, netRes.probes.map((p) => `${p.id}:${p.ok ? 'ok' : 'fail'}:${p.ms ?? '-'}`));
    if (argValue('orelle-capture')) {
      c.tools.open('network');
      await wait(6000);
      await shot('tools-network', c.tools.window);
      c.tools.window?.close();
    }
    // Dock folder stack on the Downloads folder.
    c.stack.open(app.getPath('downloads'), { x: 900, y: 1000, width: 48, height: 48 });
    await wait(1500);
    check('dock folder stack', c.stack.panel.isVisible());
    await shot('stack', c.stack.panel.window);
    c.stack.panel.hide();
    // Files: dual pane, a colour tag and larger icons.
    const dl = app.getPath('downloads');
    const firstFile = fs.readdirSync(dl).map((n) => path.join(dl, n)).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
    ctx.settings.update({ files: { dualPane: true, iconSize: 88, tags: firstFile ? { [firstFile]: 'blue' } : {} } });
    c.apps.openFiles(dl);
    await wait(4000);
    const fw = BrowserWindow.getAllWindows().find((w) => c.apps.isFiles(w.webContents));
    const filesState = fw ? await fw.webContents.executeJavaScript("JSON.stringify({ panes: document.querySelectorAll('.pane').length, items: document.querySelectorAll('.item').length, tags: document.querySelectorAll('.side-item .tag-dot').length, tile: getComputedStyle(document.querySelector('.content')).getPropertyValue('--tile') })") : '{}';
    const fsx = JSON.parse(filesState);
    check('files: dual pane, tags, icon size', fsx.panes === 2 && fsx.items > 0 && (!firstFile || fsx.tags === 1) && fsx.tile.trim() === '88px', fsx);
    await shot('files', fw);
    fw?.close();
    ctx.settings.update({ files: { dualPane: false } });
    const diag = buildDiagnostics(ctx);
    check('diagnostics report', diag.includes('"capabilities"') && !diag.includes(os.homedir()), { chars: diag.length });
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
    // Files app backend: list the home folder, resolve places.
    const home = await c.apps.files.list(app.getPath('home'));
    check('files: list home', home.ok && home.entries.length > 0, home.ok ? { entries: home.entries.length } : home);
    check('files: places', c.apps.files.places().some((p) => p.kind === 'drive'));
    // Monitor backend: one real sample of processes and counters.
    const sample = await new Promise<import('../shared/appTypes').MonitorSampleDto | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      c.apps.monitor.once('sample', (s) => { clearTimeout(timer); resolve(s); });
      c.apps.monitor.start();
    });
    c.apps.monitor.stop();
    check('monitor: processes', !!sample && sample.processes.length > 20, sample && { processes: sample.processes.length, gpu: sample.gpu, diskBusy: sample.diskBusy, netDown: sample.netDown });
    const startup = await c.apps.monitor.startupItems();
    check('monitor: startup apps readable', Array.isArray(startup), { count: startup.length });
    const sens = await new SensorService().read();
    check('sensors (standard user)', Array.isArray(sens.gpus) && sens.cpuTemp === null, { gpus: sens.gpus.map((g) => `${g.name} ${g.tempC ?? '?'}°C`), battery: sens.battery && `${sens.battery.healthPercent}%` });
    // Memory of every Orelle process (KB → MB), after the UI is fully up.
    // Idle footprint after closing the control center (created on demand, then released).
    c.control.release();
    c.menu.panel.release();
    c.notificationCenter.panel.release();
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
    report.error = err instanceof Error ? `${err.message} @ ${(err.stack ?? '').split('\n').slice(1, 4).join(' | ')}` : String(err);
  }
  report.checks = checks;
  const out = argValue('orelle-smoke-report') ?? path.join(ctx.dataDir, 'smoke-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  log.flushSync();
  shutdown();
  app.exit(report.ok ? 0 : 1);
}
