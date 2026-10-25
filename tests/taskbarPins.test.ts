import { describe, expect, it } from 'vitest';
import { cleanButtonName, expandKnownFolder, mergeTaskbarPins } from '../src/shared/taskbarPins';

// Captured from a real Windows 11 taskbar (French UI).
const buttons = [
  { id: 'Valve.Steam.Client', name: 'Steam épinglé', x: 1005, y: 1032 },
  { id: 'OperaSoftware.OperaGXWebBrowser.1696423079', name: 'Navigateur Opera GX épinglé', x: 873, y: 1032 },
  { id: 'com.squirrel.Discord.Discord', name: 'Discord épinglé', x: 917, y: 1032 },
  { id: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe', name: 'EpicGamesLauncher épinglé', x: 961, y: 1032 },
  { id: 'Microsoft.Windows.Explorer', name: 'Explorateur de fichiers épinglé', x: 1049, y: 1032 },
  { id: 'Claude_pzs8sxrjxfjjc!Claude', name: 'Claude - 1 fenêtre en cours d’exécution', x: 1093, y: 1032 },
];
const links = [
  { file: 'a\\Steam.lnk', name: 'Steam', aumid: 'Valve.Steam.Client', target: 'C:\\Program Files (x86)\\Steam\\steam.exe' },
  { file: 'a\\Discord.lnk', name: 'Discord', aumid: 'com.squirrel.Discord.Discord', target: 'C:\\Users\\u\\AppData\\Local\\Discord\\Update.exe' },
  { file: 'a\\EpicGamesLauncher.lnk', name: 'EpicGamesLauncher', aumid: null, target: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe' },
  { file: 'a\\File Explorer.lnk', name: 'File Explorer', aumid: 'Microsoft.Windows.Explorer', target: '' },
  { file: 'a\\Navigateur Opera GX.lnk', name: 'Navigateur Opera GX', aumid: 'OperaSoftware.OperaGXWebBrowser.1696423079', target: 'C:\\Users\\u\\AppData\\Local\\Programs\\Opera GX\\opera.exe' },
];
const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' };

describe('taskbar pins', () => {
  it('keeps exactly the pinned buttons, in visual order, and skips running-only apps', () => {
    const pins = mergeTaskbarPins(buttons, links, (id) => id.startsWith('Claude'), env);
    expect(pins.map((p) => p.name)).toEqual(['Navigateur Opera GX', 'Discord', 'EpicGamesLauncher', 'Steam', 'File Explorer']);
    expect(pins[2].target).toBe('C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe');
  });

  it('falls back to the pinned shortcuts when the taskbar cannot be read', () => {
    expect(mergeTaskbarPins([], links, () => false, env).map((p) => p.name)).toEqual(['Steam', 'Discord', 'EpicGamesLauncher', 'File Explorer', 'Navigateur Opera GX']);
  });

  it('counts a running app as pinned when its shortcut is pinned (English UI)', () => {
    const pins = mergeTaskbarPins([{ id: 'Valve.Steam.Client', name: 'Steam - 1 running window', x: 0, y: 0 }], links.slice(0, 1), () => true, env);
    expect(pins).toHaveLength(1);
  });

  it('cleans names and expands known folders', () => {
    expect(cleanButtonName('Claude - 1 fenêtre en cours d’exécution')).toBe('Claude');
    expect(cleanButtonName('Discord pinned')).toBe('Discord');
    expect(expandKnownFolder('{6D809377-6AF0-444B-8957-A3773F02200E}\\App\\a.exe', env)).toBe('C:\\Program Files\\App\\a.exe');
    expect(expandKnownFolder('Microsoft.Windows.Explorer', env)).toBeNull();
  });
});
