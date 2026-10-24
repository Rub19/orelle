// The only bridge between renderers and the main process. Exposes a narrow, typed API;
// the main process additionally checks which window each call comes from.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  AllowedScript, AppInfo, Bootstrap, ControlState, DisplayInfo, DockLayout, DockState, ResultPreview, SearchResponse, Settings, SystemStats, WeatherData,
} from '../shared/types';
import type { FileEntry, FileOperation, FileProperties, FsError, MonitorSampleDto, Place, StartupItemDto } from '../shared/appTypes';

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
    activate: (key: string, opts: { newInstance?: boolean } = {}) => ipcRenderer.send('dock:activate', key, opts),
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
  },

  settings: {
    onSection: (cb: (section: string) => void) => on('settings:section', cb),
    initialSection: (): string | null => process.argv.find((a) => a.startsWith('--orelle-section='))?.split('=')[1] ?? null,
    apps: (): Promise<AppInfo[]> => ipcRenderer.invoke('settings:apps'),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('settings:displays'),
    setHotkey: (name: 'launcher' | 'control', accel: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('settings:setHotkey', name, accel),
    geocode: (q: string): Promise<{ name: string; country: string; latitude: number; longitude: number }[] | null> => ipcRenderer.invoke('settings:geocode', q),
    addScript: (): Promise<AllowedScript | null> => ipcRenderer.invoke('settings:addScript'),
    pickPath: (kind: 'file' | 'folder'): Promise<string | null> => ipcRenderer.invoke('settings:pickPath', kind),
    editWidgets: () => ipcRenderer.send('settings:editWidgets'),
    recordingHotkey: (on: boolean) => ipcRenderer.send('settings:recordingHotkey', on),
    exportProfile: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:export'),
    importProfile: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke('settings:import'),
    reset: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('settings:reset'),
    clearHistory: (): Promise<boolean> => ipcRenderer.invoke('settings:clearHistory'),
    reindex: (): Promise<number> => ipcRenderer.invoke('settings:reindex'),
    openFolder: (which: 'logs' | 'data') => ipcRenderer.send('settings:openFolder', which),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder'),
    openWinSettings: (uri: string) => ipcRenderer.send('settings:openWinSettings', uri),
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
    exportReport: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('monitor:export'),
    reveal: (p: string) => ipcRenderer.send('monitor:reveal', p),
    openFolder: (p: string) => ipcRenderer.send('monitor:openFolder', p),
    system: (what: 'services' | 'startup' | 'taskmgr') => ipcRenderer.send('monitor:system', what),
  },
};

export type OrelleApi = typeof api;
contextBridge.exposeInMainWorld('orelle', api);
