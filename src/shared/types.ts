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

export type OrelleAction = 'launcher' | 'settings' | 'control' | 'files' | 'monitor';

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

export type TaskbarMode = 'normal' | 'autohide' | 'hidden';

export type TopBarItemId = 'media' | 'cpu' | 'network' | 'volume' | 'battery' | 'notifications' | 'control' | 'search' | 'taskbar' | 'clock';

export interface SavedWindow {
  /** Executable path (lower-cased) or AUMID identifying the app. */
  app: string;
  title: string;
  /** Rect in physical pixels on the virtual screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  maximized: boolean;
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  windows: SavedWindow[];
}

export interface ActivityProfile {
  id: string;
  name: string;
  glyph: string;
  /** Apps (dock-style references) launched when the profile is activated. */
  launch: { appId?: string; path?: string; name: string }[];
  /** Optional window layout restored after launching. */
  layoutId: string | null;
  theme: ThemeId | null;
  taskbarMode: TaskbarMode | null;
  /** Hide desktop widgets while active (e.g. gaming). */
  hideWidgets: boolean;
  /** Orelle focus mode (no toasts) while active. */
  focus: boolean;
  /** Pause resource alerts while active. */
  muteAlerts: boolean;
}

export type AutomationTrigger =
  | { kind: 'time'; at: string; days: number[] }
  | { kind: 'appLaunched'; app: string }
  | { kind: 'startup' }
  | { kind: 'hotkey'; accel: string };

export type AutomationAction =
  | { kind: 'profile'; id: string }
  | { kind: 'open'; target: string }
  | { kind: 'theme'; theme: ThemeId }
  | { kind: 'layout'; id: string }
  | { kind: 'notify'; text: string }
  | { kind: 'focus'; on: boolean };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

export interface OrelleNotification {
  id: string;
  at: number;
  title: string;
  body: string;
  /** Short source label, e.g. "Moniteur". */
  source: string;
  glyph: string;
  /** Optional action opened on click (internal command id). */
  action?: string;
  read: boolean;
}

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
    /**
     * Windows taskbar while Orelle runs: untouched, Windows' own auto-hide, or fully hidden (Orelle's
     * top bar and Dock replace it). The original state is restored on exit and after a crash.
     */
    taskbarMode: TaskbarMode;
    /** What a lone press of the Windows key does. */
    winKey: 'windows' | 'menu' | 'launcher';
    /** GPU compositing; off saves ~100 MB of memory at the cost of smoother animations (applies after restart). */
    hardwareAcceleration: boolean;
  };
  topBar: {
    enabled: boolean;
    display: string;
    showActiveApp: boolean;
    showSeconds: boolean;
    showDate: boolean;
    /** Right-hand status items, in order. */
    items: { id: TopBarItemId; visible: boolean }[];
  };
  windows: {
    /** Ctrl+Alt+arrows / Enter / C to place the active window. */
    snapping: boolean;
    layouts: SavedLayout[];
  };
  profiles: {
    active: string | null;
    list: ActivityProfile[];
  };
  notifications: {
    enabled: boolean;
    /** Keep a history in the notification center (stored locally). */
    history: boolean;
    /** Focus mode: Orelle shows no toasts (they still reach the history). */
    focus: boolean;
  };
  extensions: {
    /** id → enabled. Extensions are declarative JSON manifests; no third-party code is executed. */
    enabled: Record<string, boolean>;
  };
  automations: Automation[];
  ai: {
    provider: 'none' | 'anthropic' | 'openai' | 'ollama';
    model: string;
    /** OpenAI-compatible or Ollama base URL. */
    endpoint: string;
    /** The user explicitly agreed to send launcher questions to the provider. */
    consent: boolean;
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
  | 'orelle'
  | 'extension'
  | 'profile'
  | 'layout'
  | 'ai';

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

export type SurfaceKind = 'dock' | 'launcher' | 'settings' | 'widgets' | 'control' | 'splash' | 'files' | 'monitor' | 'topbar' | 'menu' | 'notifications';

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
