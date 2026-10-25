// Shared service container handed to every controller.
import type { Translator } from '../shared/i18n';
import type { Capabilities, SurfaceKind } from '../shared/types';
import type { AppIndex } from './services/appIndex';
import type { IconService } from './services/iconService';
import type { SettingsService } from './services/settingsService';
import type { UsageService } from './services/usageService';
import type { WindowTracker } from './services/windowTracker';

export interface OrelleContext {
  dataDir: string;
  logDir: string;
  settings: SettingsService;
  usage: UsageService;
  icons: IconService;
  apps: AppIndex;
  tracker: WindowTracker;
  capabilities: Capabilities;
  t: Translator;
  language: 'fr' | 'en';
  preload: string;
  rendererFile: (surface: SurfaceKind) => string;
  /** Cross-controller actions, wired in main.ts. */
  actions: {
    toggleLauncher(): void;
    openSettings(section?: string): void;
    toggleDock(): void;
    pinToDock(ref: { appId?: string; path?: string; name: string }): void;
    toggleControlCenter(): void;
    editWidgets(): void;
    /** Orelle's own apps (file browser, activity monitor). */
    openApp(app: 'files' | 'monitor' | 'tools', arg?: string): void;
    /** Orelle notification center (set once the service exists). */
    /** Mission Control (set once the controller exists). */
    toggleMission?(): void;
    /** Screenshot tool. */
    capture?(): void;
    /** Dock folder stack next to an icon (screen DIP). */
    openStack?(folder: string, anchor: { x: number; y: number; width: number; height: number }): void;
    notify?(n: { title: string; body: string; source: string; glyph: string; action?: string }): void;
  };
}
