// Types shared by the main process, the preload bridge and the renderers.

export type ThemeId = 'system' | 'dark' | 'light' | 'midnight' | 'graphite' | 'aurora';
export type Language = 'auto' | 'fr' | 'en';
export type DockPosition = 'bottom' | 'left' | 'right';
export type EffectsLevel = 'full' | 'reduced' | 'off';

export type DockItem =
  | { id: string; type: 'app'; name: string; appId?: string; path?: string; args?: string[] }
  | { id: string; type: 'folder' | 'file'; name: string; path: string }
  | { id: string; type: 'url'; name: string; url: string }
  | { id: string; type: 'nova'; name: string; action: NovaAction }
  | { id: string; type: 'separator' };

export type NovaAction = 'launcher' | 'settings';

export interface CustomCommand {
  id: string;
  keyword: string;
  name: string;
  /** `url` may contain `{query}`; `open` opens a file, folder or app path. */
  kind: 'url' | 'open';
  target: string;
}

export interface LauncherProviders {
  apps: boolean;
  windows: boolean;
  files: boolean;
  settings: boolean;
  system: boolean;
  calculator: boolean;
  units: boolean;
  web: boolean;
  commands: boolean;
  clipboard: boolean;
}

export interface Settings {
  version: number;
  general: {
    language: Language;
    launchAtLogin: boolean;
    showTrayIcon: boolean;
  };
  appearance: {
    theme: ThemeId;
    accent: string;
    /** Glass tint opacity, 0.35 – 1. */
    glassOpacity: number;
    effects: EffectsLevel;
  };
  dock: {
    enabled: boolean;
    position: DockPosition;
    /** 'primary' or an Electron display id. */
    display: string;
    iconSize: number;
    magnification: boolean;
    magnifiedSize: number;
    spacing: number;
    autoHide: boolean;
    reserveSpace: boolean;
    hideOnFullscreen: boolean;
    showRunning: boolean;
    showRecents: boolean;
    recentsCount: number;
    showMinimized: boolean;
    showLabels: boolean;
    items: DockItem[];
  };
  launcher: {
    enabled: boolean;
    hotkey: string;
    maxResults: number;
    webSearchUrl: string;
    providers: LauncherProviders;
    favorites: string[];
    customCommands: CustomCommand[];
  };
  privacy: {
    searchHistory: boolean;
    clipboardHistory: boolean;
  };
}

export type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// ---------- Dock runtime state ----------

export interface DockEntry {
  /** Stable key: dock item id, or `run:<exe>` / `win:<hwnd>` for transient entries. */
  key: string;
  section: 'pinned' | 'running' | 'recent' | 'minimized';
  kind: DockItem['type'];
  label: string;
  icon: string | null;
  running: boolean;
  active: boolean;
  windowCount: number;
}

export interface DockState {
  entries: DockEntry[];
  /** Keys of entries currently launching (bounce until a window appears). */
  launching: string[];
}

export interface DockLayout {
  position: DockPosition;
  iconSize: number;
  magnifiedSize: number;
  magnification: boolean;
  spacing: number;
  autoHide: boolean;
  showLabels: boolean;
  hidden: boolean;
}

// ---------- Launcher ----------

export type ResultKind =
  | 'app'
  | 'window'
  | 'file'
  | 'folder'
  | 'setting'
  | 'system'
  | 'calc'
  | 'unit'
  | 'web'
  | 'url'
  | 'command'
  | 'clipboard'
  | 'nova';

export interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  icon?: string | null;
  /** Monochrome glyph name when there is no bitmap icon. */
  glyph?: string;
  score: number;
  favorite?: boolean;
  /** Label of the Enter action, e.g. "Ouvrir". */
  action: string;
  /** Label of the Ctrl+Enter action when available. */
  altAction?: string;
  preview?: ResultPreview;
}

export interface ResultPreview {
  title: string;
  lines: { label: string; value: string }[];
  thumbnail?: string | null;
  large?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

// ---------- Misc ----------

export interface DisplayInfo {
  id: string;
  label: string;
  primary: boolean;
}

export interface AppInfo {
  key: string;
  name: string;
  appId: string;
  target: string | null;
  icon: string | null;
}

export type SurfaceKind = 'dock' | 'launcher' | 'settings';

export interface Bootstrap {
  surface: SurfaceKind;
  settings: Settings;
  language: 'fr' | 'en';
  darkSystem: boolean;
  version: string;
  capabilities: Capabilities;
}

export interface Capabilities {
  win32: boolean;
  windowTracking: boolean;
  appBar: boolean;
  acrylic: boolean;
}
