// Types shared by the main process, the preload bridge and the renderers.

export type ThemeId = 'system' | 'dark' | 'light' | 'midnight' | 'graphite' | 'aurora';
export type Language = 'auto' | 'fr' | 'en';
export type DockPosition = 'bottom' | 'left' | 'right';
export type EffectsLevel = 'full' | 'reduced' | 'off';

export type DockItem =
  | { id: string; type: 'app'; name: string; appId?: string; path?: string; args?: string[] }
  | { id: string; type: 'folder' | 'file'; name: string; path: string }
  | { id: string; type: 'url'; name: string; url: string }
  | { id: string; type: 'orelle'; name: string; action: OrelleAction }
  | { id: string; type: 'separator' };

export type OrelleAction = 'launcher' | 'settings' | 'control';

export type ControlModuleId =
  | 'wifi' | 'bluetooth' | 'focus' | 'theme' | 'taskbar' | 'widgets' | 'nightlight' | 'airplane'
  | 'volume' | 'brightness' | 'media' | 'battery' | 'system' | 'tools' | 'links';

export interface ControlModule {
  id: ControlModuleId;
  visible: boolean;
  /** Grid span: s = a third of a row, m = half, l = full row. */
  size: 's' | 'm' | 'l';
}

export interface AllowedScript {
  id: string;
  name: string;
  keyword: string;
  path: string;
  /** SHA-256 of the file content the user approved; any change requires a new confirmation. */
  approvedHash: string | null;
  showConsole: boolean;
}

export type WidgetType =
  | 'clock'
  | 'calendar'
  | 'weather'
  | 'system'
  | 'network'
  | 'battery'
  | 'media'
  | 'notes'
  | 'todo'
  | 'timer'
  | 'recentApps'
  | 'shortcuts'
  | 'appUsage';

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  /** Position/size in DIP, relative to the widget display's work area. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  hidden: boolean;
  /** Per-type options and content (clock style, note text, todo items, shortcuts…). */
  config: Record<string, unknown>;
}

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
    /** Turns on Windows' own taskbar auto-hide while Orelle runs; the previous state is restored on exit. */
    hideTaskbar: boolean;
    /** GPU compositing; off saves ~100 MB of memory at the cost of smoother animations (applies after restart). */
    hardwareAcceleration: boolean;
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
    scripts: AllowedScript[];
  };
  privacy: {
    searchHistory: boolean;
    clipboardHistory: boolean;
  };
  widgets: {
    enabled: boolean;
    display: string;
    items: WidgetInstance[];
    /** Default widgets are placed once; removing them all afterwards is respected. */
    seeded: boolean;
    weather: { city: string; latitude: number | null; longitude: number | null; unit: 'c' | 'f' };
  };
  files: {
    favorites: { name: string; path: string }[];
    showHidden: boolean;
    view: 'grid' | 'list' | 'details';
    sort: { key: 'name' | 'mtime' | 'size' | 'kind'; desc: boolean };
    /** Folders opened from the Dock / launcher open in Orelle Files instead of File Explorer. */
    openFoldersInOrelle: boolean;
  };
  monitor: {
    alerts: boolean;
    cpuAlert: number;
    memAlert: number;
  };
  controlCenter: {
    hotkey: string;
    /** Module order, size and visibility, edited from the panel's "Customize" mode. */
    modules: ControlModule[];
  };
}

// ---------- Live data for widgets / control center ----------

export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  disks: { mount: string; used: number; total: number }[];
  netDown: number;
  netUp: number;
  battery: { percent: number; charging: boolean; present: boolean; minutesLeft: number | null } | null;
  uptime: number;
}

export interface ControlState {
  volume: { level: number; muted: boolean; device: string } | null;
  microphone: { level: number; muted: boolean; device: string } | null;
  brightness: number | null;
  wifi: { connected: boolean; ssid: string | null; signal: number | null } | null;
  battery: SystemStats['battery'];
}

export interface WeatherData {
  city: string;
  temperature: number;
  code: number;
  high: number;
  low: number;
  unit: 'c' | 'f';
  updatedAt: number;
  daily: { date: string; code: number; high: number; low: number }[];
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
  /** For Orelle's own buttons: which built-in action (drives the artwork). */
  action?: OrelleAction;
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
  | 'orelle';

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

export type SurfaceKind = 'dock' | 'launcher' | 'settings' | 'widgets' | 'control' | 'splash' | 'files' | 'monitor';

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
