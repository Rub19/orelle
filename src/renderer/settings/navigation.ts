import type { StringKey } from '../../shared/i18n';

export type Section = 'general' | 'appearance' | 'studio' | 'topbar' | 'dock' | 'launcher' | 'windows' | 'profiles' | 'widgets' | 'notifications' | 'apps' | 'extensions' | 'automations' | 'ai' | 'privacy' | 'backup' | 'updates' | 'about';

export type SectionMeta = { id: Section; glyph: string; color: string };

export const SECTIONS: readonly SectionMeta[] = [
  { id: 'general', glyph: 'sliders', color: '#8e8e93' },
  { id: 'appearance', glyph: 'palette', color: '#bf5af2' },
  { id: 'studio', glyph: 'sparkle', color: '#ff375f' },
  { id: 'topbar', glyph: 'window', color: '#0a84ff' },
  { id: 'dock', glyph: 'dock', color: '#0a84ff' },
  { id: 'launcher', glyph: 'search', color: '#5e5ce6' },
  { id: 'windows', glyph: 'columns', color: '#5e5ce6' },
  { id: 'widgets', glyph: 'grid', color: '#ff375f' },
  { id: 'notifications', glyph: 'bellOn', color: '#ff453a' },
  { id: 'profiles', glyph: 'gamepad', color: '#ff9f0a' },
  { id: 'apps', glyph: 'folder', color: '#f2b33d' },
  { id: 'extensions', glyph: 'sparkle', color: '#30d158' },
  { id: 'automations', glyph: 'bolt', color: '#ffd60a' },
  { id: 'ai', glyph: 'sparkle', color: '#bf5af2' },
  { id: 'privacy', glyph: 'shield', color: '#30d158' },
  { id: 'backup', glyph: 'archive', color: '#ff9f0a' },
  { id: 'updates', glyph: 'download', color: '#0a84ff' },
  { id: 'about', glyph: 'info', color: '#64d2ff' },
];

export const NAV_GROUPS: readonly { id: string; labelKey: StringKey; sections: readonly Section[] }[] = [
  { id: 'start', labelKey: 'settings.nav.start', sections: ['general', 'appearance', 'studio'] },
  { id: 'interface', labelKey: 'settings.nav.interface', sections: ['topbar', 'dock', 'launcher', 'windows', 'widgets', 'notifications'] },
  { id: 'productivity', labelKey: 'settings.nav.productivity', sections: ['profiles', 'apps', 'extensions', 'automations', 'ai'] },
  { id: 'system', labelKey: 'settings.nav.system', sections: ['privacy', 'backup', 'updates', 'about'] },
];
