// The only bridge between renderers and the main process. Exposes a narrow, typed API;
// the main process additionally checks which window each call comes from.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { Bootstrap, DisplayInfo, AppInfo, DockLayout, DockState, ResultPreview, SearchResponse, Settings } from '../shared/types';

type Off = () => void;
const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void): Off => {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  bootstrap: (): Promise<Bootstrap> => ipcRenderer.invoke('nova:bootstrap'),
  onSettings: (cb: (p: { settings: Settings; language: 'fr' | 'en'; darkSystem: boolean }) => void) => on('nova:settings', cb),
  onIconsChanged: (cb: () => void) => on('nova:iconsChanged', cb),
  updateSettings: (patch: unknown): Promise<Settings | null> => ipcRenderer.invoke('nova:updateSettings', patch),
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
    initialSection: (): string | null => process.argv.find((a) => a.startsWith('--nova-section='))?.split('=')[1] ?? null,
    apps: (): Promise<AppInfo[]> => ipcRenderer.invoke('settings:apps'),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('settings:displays'),
    setHotkey: (accel: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('settings:setHotkey', accel),
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
};

export type NovaApi = typeof api;
contextBridge.exposeInMainWorld('nova', api);
