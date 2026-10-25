// The only bridge between renderers and the main process. Exposes a narrow, typed API;
// the main process additionally checks which window each call comes from.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  AllowedScript, AppInfo, Bootstrap, ControlState, DisplayInfo, DockLayout, DockState, ResultPreview, SearchResponse, Settings, SystemStats, WeatherData,
} from '../shared/types';
import type { OrelleNotification } from '../shared/types';
import type { FileEntry, FileOperation, FileProperties, FsError, MonitorSampleDto, Place, StartupItemDto } from '../shared/appTypes';

export interface TopBarStateDto {
  app: { name: string; title: string; icon: string | null } | null;
  profile: { name: string; glyph: string } | null;
  elevated: boolean;
  unread: number;
  focus: boolean;
  volume: { level: number; muted: boolean } | null;
  stats: Pick<SystemStats, 'cpu' | 'netDown' | 'netUp' | 'battery'> | null;
  taskbarHidden: boolean;
}
export interface MissionWindowDto { hwnd: number; title: string; app: string; icon: string | null; minimized: boolean; aspect: number; active: boolean }
export interface AudioDeviceDto { id: string; name: string; flow: 'output' | 'input'; isDefault: boolean; level: number; muted: boolean; peak: number }
export interface AudioSessionDto { pid: number; system: boolean; active: boolean; level: number; muted: boolean; peak: number; name: string; icon: string | null; exe: string }
export interface FileItemDto { path: string; size: number; mtime: number }
export interface ScanResultDto { ok: boolean; canceled?: boolean; root: string; total: number; files: number; skipped: number; children: { path: string; name: string; size: number; files: number; dir: boolean }[]; largest: FileItemDto[]; ms: number }
export interface ClipItemDto { id: string; kind: 'text' | 'image'; text: string; thumb: string | null; width?: number; height?: number; at: number; pinned: boolean; source: string | null }
export interface StackItemDto { path: string; name: string; dir: boolean; mtime: number; icon: string | null; thumb: string | null }
export interface MenuAppDto { id: string; name: string; icon: string | null }
export interface MenuDataDto { apps: MenuAppDto[]; pinned: MenuAppDto[]; profiles: { id: string; name: string; glyph: string; on: boolean }[]; user: string }
export interface ExtensionInfoDto {
  id: string; name: string; version: string; author: string; description: string; builtin: boolean; enabled: boolean;
  commands: { title: string; keyword: string; kind: string }[];
  permissions: ({ kind: 'web'; hosts: string[] } | { kind: 'files'; paths: string[] } | { kind: 'clipboard' })[];
  error?: string; dir: string;
}

type Off = () => void;
const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void): Off => {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  bootstrap: (): Promise<Bootstrap> => ipcRenderer.invoke('orelle:bootstrap'),
  onSettings: (cb: (p: { settings: Settings; language: 'fr' | 'en'; darkSystem: boolean }) => void) => on('orelle:settings', cb),
  onIconsChanged: (cb: () => void) => on('orelle:iconsChanged', cb),
  updateSettings: (patch: unknown): Promise<Settings | null> => ipcRenderer.invoke('orelle:updateSettings', patch),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  dock: {
    onState: (cb: (s: DockState) => void) => on('dock:state', cb),
    onLayout: (cb: (l: DockLayout) => void) => on('dock:layout', cb),
    setInteractive: (v: boolean) => ipcRenderer.send('dock:interactive', v),
    activate: (key: string, opts: { newInstance?: boolean; anchor?: { x: number; y: number; width: number; height: number } } = {}) => ipcRenderer.send('dock:activate', key, opts),
    contextMenu: (key: string | null) => ipcRenderer.send('dock:context', key),
    reorder: (ids: string[]) => ipcRenderer.send('dock:reorder', ids),
    remove: (key: string) => ipcRenderer.send('dock:remove', key),
    pin: (key: string, index?: number) => ipcRenderer.send('dock:pin', key, index),
    addPaths: (paths: string[], index?: number) => ipcRenderer.send('dock:addPaths', paths, index),
  },

  launcher: {
    onShow: (cb: (token: string) => void) => on('launcher:show', cb),
    onHide: (cb: () => void) => on('launcher:hide', cb),
    search: (q: string): Promise<SearchResponse | null> => ipcRenderer.invoke('launcher:search', q),
    preview: (id: string): Promise<ResultPreview | null> => ipcRenderer.invoke('launcher:preview', id),
    execute: (id: string, mode: 'primary' | 'alt'): Promise<boolean> => ipcRenderer.invoke('launcher:execute', id, mode),
    toggleFavorite: (id: string): Promise<boolean> => ipcRenderer.invoke('launcher:toggleFavorite', id),
    pin: (id: string): Promise<boolean> => ipcRenderer.invoke('launcher:pin', id),
    hide: () => ipcRenderer.send('launcher:hide'),
    onAi: (cb: (a: { query: string; state: 'loading' | 'answer' | 'error'; text?: string; model?: string }) => void) => on('launcher:ai', cb),
    copy: (text: string) => ipcRenderer.send('launcher:copy', text),
  },

  settings: {
    onSection: (cb: (section: string) => void) => on('settings:section', cb),
    initialSection: (): string | null => process.argv.find((a) => a.startsWith('--orelle-section='))?.split('=')[1] ?? null,
    apps: (): Promise<AppInfo[]> => ipcRenderer.invoke('settings:apps'),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('settings:displays'),
    setHotkey: (name: 'launcher' | 'control' | 'overview', accel: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('settings:setHotkey', name, accel),
    geocode: (q: string): Promise<{ name: string; country: string; latitude: number; longitude: number }[] | null> => ipcRenderer.invoke('settings:geocode', q),
    addScript: (): Promise<AllowedScript | null> => ipcRenderer.invoke('settings:addScript'),
    pickPath: (kind: 'file' | 'folder'): Promise<string | null> => ipcRenderer.invoke('settings:pickPath', kind),
    editWidgets: () => ipcRenderer.send('settings:editWidgets'),
    openApp: (which: 'files' | 'monitor') => ipcRenderer.send('settings:openApp', which),
    recordingHotkey: (on: boolean) => ipcRenderer.send('settings:recordingHotkey', on),
    exportProfile: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:export'),
    importProfile: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:import'),
    reset: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('settings:reset'),
    clearHistory: (): Promise<boolean> => ipcRenderer.invoke('settings:clearHistory'),
    reindex: (): Promise<number> => ipcRenderer.invoke('settings:reindex'),
    openFolder: (which: 'logs' | 'data') => ipcRenderer.send('settings:openFolder', which),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder'),
    openWinSettings: (uri: string) => ipcRenderer.send('settings:openWinSettings', uri),
    extensions: (reload = false): Promise<ExtensionInfoDto[]> => ipcRenderer.invoke('settings:extensions', reload),
    openExtensionsFolder: () => ipcRenderer.send('settings:openExtensionsFolder'),
    installExtension: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; id?: string; replaced?: boolean }> => ipcRenderer.invoke('settings:installExtension'),
    removeExtension: (id: string): Promise<boolean> => ipcRenderer.invoke('settings:removeExtension', id),
    aiStatus: (): Promise<{ hasKey: boolean; encryption: boolean }> => ipcRenderer.invoke('settings:aiStatus'),
    aiSetKey: (key: string): Promise<boolean> => ipcRenderer.invoke('settings:aiSetKey', key),
    aiConsent: (on: boolean): Promise<boolean> => ipcRenderer.invoke('settings:aiConsent', on),
    aiTest: (): Promise<{ state: string; text?: string; model?: string }> => ipcRenderer.invoke('settings:aiTest'),
    saveLayout: (name: string): Promise<boolean> => ipcRenderer.invoke('settings:saveLayout', name),
    restoreLayout: (id: string) => ipcRenderer.send('settings:restoreLayout', id),
    toggleProfile: (id: string) => ipcRenderer.send('settings:toggleProfile', id),
    runAutomation: (id: string) => ipcRenderer.send('settings:runAutomation', id),
    restartNormal: () => ipcRenderer.send('settings:restartNormal'),
    updateStatus: (): Promise<{ state: string; latest?: string; url?: string; at?: number; percent?: number } | null> => ipcRenderer.invoke('settings:updateStatus'),
    checkUpdates: (): Promise<{ state: string; latest?: string; url?: string; at?: number } | null> => ipcRenderer.invoke('settings:checkUpdates'),
    openRelease: () => ipcRenderer.send('settings:openRelease'),
    downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('settings:downloadUpdate'),
    installUpdate: (): Promise<boolean> => ipcRenderer.invoke('settings:installUpdate'),
    elevate: (on: boolean): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:elevate', on),
    saveDiagnostics: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('settings:saveDiagnostics'),
    syncDockTaskbar: (): Promise<{ ok: boolean; count?: number }> => ipcRenderer.invoke('settings:syncDockTaskbar'),
    automationHistory: (): Promise<{ id: string; name: string; at: number; cause: string; status: 'ok' | 'partial' | 'failed' | 'skipped'; detail: string }[]> => ipcRenderer.invoke('settings:automationHistory'),
    clearAutomationHistory: () => ipcRenderer.send('settings:clearAutomationHistory'),
    exportAutomations: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('settings:exportAutomations'),
    importAutomations: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; count?: number }> => ipcRenderer.invoke('settings:importAutomations'),
    pickWallpaper: (): Promise<string | null> => ipcRenderer.invoke('settings:pickWallpaper'),
    exportTheme: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('settings:exportTheme'),
    importTheme: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:importTheme'),
  },

  panel: {
    onShow: (cb: () => void) => on('panel:show', cb),
  },

  topbar: {
    onState: (cb: (s: TopBarStateDto) => void) => on('topbar:state', cb),
    action: (a: string, x?: number) => ipcRenderer.send('topbar:action', a, x),
    volume: (delta: number) => ipcRenderer.send('topbar:volume', delta),
    contextMenu: () => ipcRenderer.send('topbar:context'),
    setInteractive: (v: boolean) => ipcRenderer.send('topbar:interactive', v),
  },

  trayArea: {
    peek: () => ipcRenderer.send('trayarea:peek'),
  },

  tools: {
    startSection: (): string | null => new URLSearchParams(location.search).get('section'),
    onSection: (cb: (s: string) => void) => on('tools:section', cb),
    audio: (): Promise<{ devices: AudioDeviceDto[]; sessions: AudioSessionDto[] } | null> => ipcRenderer.invoke('tools:audio'),
    audioSet: (change: { kind: 'device'; id: string; level?: number; muted?: boolean } | { kind: 'session'; pid: number; system: boolean; level?: number; muted?: boolean }): Promise<boolean> => ipcRenderer.invoke('tools:audioSet', change),
    openSound: (which: 'output' | 'input' | 'apps') => ipcRenderer.send('tools:openSound', which),
    drives: (): Promise<{ drives: { root: string; total: number; free: number }[]; home: string }> => ipcRenderer.invoke('tools:drives'),
    analyze: (root: string): Promise<ScanResultDto | null> => ipcRenderer.invoke('tools:analyze', root),
    duplicates: (root: string, minMB: number): Promise<{ ok: boolean; canceled?: boolean; groups: { size: number; hash: string; files: FileItemDto[] }[]; wasted: number } | null> => ipcRenderer.invoke('tools:duplicates', root, minMB),
    cancel: () => ipcRenderer.send('tools:cancel'),
    onProgress: (cb: (p: { scanned: number; current: string; phase?: string }) => void) => on('tools:progress', cb),
    cleanup: (): Promise<{ id: 'temp' | 'systemtemp' | 'crashdumps' | 'downloads'; path: string; size: number; files: number; olderThanDays: number }[]> => ipcRenderer.invoke('tools:cleanup'),
    clean: (id: 'temp' | 'systemtemp' | 'crashdumps'): Promise<{ ok: boolean; removed: number; freed: number; canceled?: boolean } | null> => ipcRenderer.invoke('tools:clean', id),
    recycle: (paths: string[]): Promise<{ ok: boolean; removed: number; refused: number; canceled?: boolean } | null> => ipcRenderer.invoke('tools:recycle', paths),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('tools:pickFolder'),
    reveal: (p: string) => ipcRenderer.send('tools:reveal', p),
    openFolder: (p: string) => ipcRenderer.send('tools:openFolder', p),
    clipList: (): Promise<{ enabled: boolean; items: ClipItemDto[] } | null> => ipcRenderer.invoke('tools:clipList'),
    onClipChanged: (cb: () => void) => on('tools:clipChanged', cb),
    clipCopy: (id: string): Promise<boolean> => ipcRenderer.invoke('tools:clipCopy', id),
    clipPaste: (id: string): Promise<boolean> => ipcRenderer.invoke('tools:clipPaste', id),
    clipPin: (id: string, on: boolean) => ipcRenderer.send('tools:clipPin', id, on),
    clipRemove: (id: string) => ipcRenderer.send('tools:clipRemove', id),
    clipClear: (all: boolean) => ipcRenderer.send('tools:clipClear', all),
    network: (): Promise<{ adapters: { name: string; ipv4: string[]; ipv6: string[]; mac: string; gateway: string | null; dns: string[] }[]; probes: { id: string; ok: boolean; ms: number | null; detail: string }[] } | null> => ipcRenderer.invoke('tools:network'),
    openNetworkSettings: () => ipcRenderer.send('tools:networkSettings'),
  },

  capture: {
    onFrame: (cb: (f: { image: string; windows: { x: number; y: number; w: number; h: number; title: string }[] }) => void) => on('capture:frame', cb),
    done: (rect: { x: number; y: number; w: number; h: number } | null) => ipcRenderer.send('capture:done', rect),
    cancel: () => ipcRenderer.send('capture:cancel'),
  },

  stack: {
    data: (): Promise<{ folder: string; name: string; items: StackItemDto[] } | null> => ipcRenderer.invoke('stack:data'),
    onRefresh: (cb: () => void) => on('stack:refresh', cb),
    open: (p: string) => ipcRenderer.send('stack:open', p),
    reveal: (p: string) => ipcRenderer.send('stack:reveal', p),
    openFolder: () => ipcRenderer.send('stack:openFolder'),
    hide: () => ipcRenderer.send('stack:hide'),
  },

  welcome: {
    dock: (): Promise<{ name: string; icon: string | null }[]> => ipcRenderer.invoke('welcome:dock'),
    finish: () => ipcRenderer.send('welcome:finish'),
  },

  mission: {
    onData: (cb: (list: MissionWindowDto[]) => void) => on('mission:data', cb),
    layout: (rects: { hwnd: number; x: number; y: number; w: number; h: number; visible: boolean }[]) => ipcRenderer.send('mission:layout', rects),
    activate: (hwnd: number) => ipcRenderer.send('mission:activate', hwnd),
    close: (hwnd: number) => ipcRenderer.send('mission:close', hwnd),
    hide: () => ipcRenderer.send('mission:hide'),
    onDesktops: (cb: (d: { id: string; index: number; name: string; current: boolean }[]) => void) => on('mission:desktops', cb),
    desktop: (index: number | 'new') => ipcRenderer.send('mission:desktop', index),
  },

  menu: {
    data: (): Promise<MenuDataDto | null> => ipcRenderer.invoke('menu:data'),
    onRefresh: (cb: () => void) => on('menu:refresh', cb),
    launch: (appId: string): Promise<boolean> => ipcRenderer.invoke('menu:launch', appId),
    pin: (appId: string) => ipcRenderer.send('menu:pin', appId),
    profile: (id: string) => ipcRenderer.send('menu:profile', id),
    action: (a: 'lock' | 'sleep' | 'restart' | 'shutdown' | 'signout' | 'settings' | 'files' | 'monitor' | 'launcher' | 'windowsStart' | 'mission' | 'capture') => ipcRenderer.send('menu:action', a),
    hide: () => ipcRenderer.send('menu:hide'),
  },

  notifications: {
    list: (): Promise<OrelleNotification[] | null> => ipcRenderer.invoke('notifications:list'),
    onChanged: (cb: () => void) => on('notifications:changed', cb),
    activate: (id: string) => ipcRenderer.send('notifications:activate', id),
    remove: (id: string) => ipcRenderer.send('notifications:remove', id),
    clear: () => ipcRenderer.send('notifications:clear'),
    open: (what: 'windows' | 'calendar' | 'settings') => ipcRenderer.send('notifications:open', what),
    hide: () => ipcRenderer.send('notifications:hide'),
  },

  widgets: {
    onEdit: (cb: (on: boolean) => void) => on('widgets:edit', cb),
    onStats: (cb: (s: SystemStats) => void) => on('widgets:stats', cb),
    setInteractive: (v: boolean) => ipcRenderer.send('widgets:interactive', v),
    setEditing: (v: boolean) => ipcRenderer.send('widgets:edit', v),
    subscribeStats: (v: boolean) => ipcRenderer.send('widgets:subscribeStats', v),
    weather: (force = false): Promise<WeatherData | null> => ipcRenderer.invoke('widgets:weather', force),
    recentApps: (): Promise<{ id: string; name: string; icon: string | null }[]> => ipcRenderer.invoke('widgets:recentApps'),
    launchRecent: (id: string): Promise<boolean> => ipcRenderer.invoke('widgets:launchRecent', id),
    screenTime: (): Promise<{ key: string; name: string; ms: number }[]> => ipcRenderer.invoke('widgets:screenTime'),
    media: (key: 'playPause' | 'next' | 'previous') => ipcRenderer.send('widgets:media', key),
    open: (target: string): Promise<boolean> => ipcRenderer.invoke('widgets:open', target),
    shortcutIcon: (target: string): Promise<string | null> => ipcRenderer.invoke('widgets:shortcutIcon', target),
    openSystem: (what: 'clock' | 'calendar' | 'system' | 'network' | 'battery') => ipcRenderer.send('widgets:openSystem', what),
  },

  control: {
    onState: (cb: (s: ControlState) => void) => on('control:state', cb),
    setVolume: (v: number): Promise<boolean> => ipcRenderer.invoke('control:setVolume', v),
    setMuted: (v: boolean): Promise<boolean> => ipcRenderer.invoke('control:setMuted', v),
    setMicMuted: (v: boolean): Promise<boolean> => ipcRenderer.invoke('control:setMicMuted', v),
    onStats: (cb: (s: SystemStats) => void) => on('control:stats', cb),
    setBrightness: (v: number) => ipcRenderer.send('control:setBrightness', v),
    media: (key: 'playPause' | 'next' | 'previous') => ipcRenderer.send('control:media', key),
    openSettings: (uri: string) => ipcRenderer.send('control:openSettings', uri),
    action: (a: 'toggleTheme' | 'toggleDock' | 'toggleTaskbar' | 'editWidgets' | 'lock' | 'preferences' | 'launcher' | 'files' | 'monitor') => ipcRenderer.send('control:action', a),
    hide: () => ipcRenderer.send('control:hide'),
  },

  files: {
    startPath: (): string | null => new URLSearchParams(location.search).get('path'),
    places: (): Promise<Place[]> => ipcRenderer.invoke('files:places'),
    entries: (paths: string[]): Promise<FileEntry[]> => ipcRenderer.invoke('files:entries', paths),
    recent: (): Promise<FileEntry[]> => ipcRenderer.invoke('files:recent'),
    list: (dir: string): Promise<{ ok: true; entries: FileEntry[] } | { ok: false; error: FsError }> => ipcRenderer.invoke('files:list', dir),
    icons: (items: { path: string; dir: boolean }[]): Promise<Record<string, string | null>> => ipcRenderer.invoke('files:icons', items),
    thumbnail: (p: string, size?: number): Promise<string | null> => ipcRenderer.invoke('files:thumbnail', p, size),
    preview: (p: string): Promise<{ kind: 'image' | 'text' | 'none'; data?: string; truncated?: boolean }> => ipcRenderer.invoke('files:preview', p),
    properties: (p: string): Promise<FileProperties | null> => ipcRenderer.invoke('files:properties', p),
    mkdir: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: FsError }> => ipcRenderer.invoke('files:mkdir', dir, name),
    newFile: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: FsError }> => ipcRenderer.invoke('files:newFile', dir, name),
    rename: (p: string, name: string): Promise<{ ok: boolean; path?: string; error?: FsError }> => ipcRenderer.invoke('files:rename', p, name),
    transfer: (paths: string[], dest: string, mode: 'copy' | 'move'): Promise<string | null> => ipcRenderer.invoke('files:transfer', paths, dest, mode),
    remove: (paths: string[], permanent: boolean): Promise<string | null> => ipcRenderer.invoke('files:remove', paths, permanent),
    archive: (kind: 'compress' | 'extract', paths: string[], dest: string): Promise<string | null> => ipcRenderer.invoke('files:archive', kind, paths, dest),
    search: (root: string, q: string, content: boolean): Promise<FileEntry[]> => ipcRenderer.invoke('files:search', root, q, content),
    open: (p: string): Promise<string | null> => ipcRenderer.invoke('files:open', p),
    openWith: (p: string) => ipcRenderer.send('files:openWith', p),
    showInExplorer: (p: string) => ipcRenderer.send('files:showInExplorer', p),
    copyPath: (paths: string[]) => ipcRenderer.send('files:copyPath', paths),
    newWindow: (dir?: string) => ipcRenderer.send('files:newWindow', dir),
    terminal: (dir: string) => ipcRenderer.send('files:terminal', dir),
    startDrag: (paths: string[]) => ipcRenderer.send('files:startDrag', paths),
    watch: (dir: string | null) => ipcRenderer.send('files:watch', dir),
    onChanged: (cb: (dir: string) => void) => on('files:changed', cb),
    onProgress: (cb: (op: FileOperation) => void) => on('files:progress', cb),
    openMonitor: () => ipcRenderer.send('files:openMonitor'),
  },

  monitor: {
    startTab: (): string | null => new URLSearchParams(location.search).get('tab'),
    onSample: (cb: (s: MonitorSampleDto) => void) => on('monitor:sample', cb),
    onTab: (cb: (tab: string) => void) => on('monitor:tab', cb),
    history: (): Promise<Omit<MonitorSampleDto, 'processes'>[]> => ipcRenderer.invoke('monitor:history'),
    latest: (): Promise<MonitorSampleDto | null> => ipcRenderer.invoke('monitor:latest'),
    end: (pid: number): Promise<{ ok: boolean; error?: string; canceled?: boolean }> => ipcRenderer.invoke('monitor:end', pid),
    close: (pid: number): Promise<number> => ipcRenderer.invoke('monitor:close', pid),
    startup: (): Promise<StartupItemDto[]> => ipcRenderer.invoke('monitor:startup'),
    setStartup: (id: string, enabled: boolean): Promise<boolean> => ipcRenderer.invoke('monitor:startupSet', id, enabled),
    restoreStartup: (): Promise<number> => ipcRenderer.invoke('monitor:startupRestore'),
    journal: (): Promise<{ at: number; id: string; name: string }[]> => ipcRenderer.invoke('monitor:journal'),
    services: (): Promise<{ name: string; display: string; state: string; start: string; pid: number }[]> => ipcRenderer.invoke('monitor:services'),
    info: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('monitor:info'),
    sensors: (): Promise<{ gpus: { name: string; tempC: number | null; load: number | null; memUsedMB: number | null; memTotalMB: number | null; powerW: number | null; fan: number | null }[]; gpuSource: string | null; battery: { id: string; designMWh: number; fullMWh: number; healthPercent: number; cycles: number | null } | null; thermal: { name: string; tempC: number }[] } | null> => ipcRenderer.invoke('monitor:sensors'),
    exportReport: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('monitor:export'),
    reveal: (p: string) => ipcRenderer.send('monitor:reveal', p),
    openFolder: (p: string) => ipcRenderer.send('monitor:openFolder', p),
    system: (what: 'services' | 'startup' | 'taskmgr') => ipcRenderer.send('monitor:system', what),
  },
};

export type OrelleApi = typeof api;
contextBridge.exposeInMainWorld('orelle', api);
