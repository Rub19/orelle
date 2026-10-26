import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppIndex, iconParsingName } from '../src/main/services/appIndex';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('application icon source', () => {
  it('uses the real executable for classic applications', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orelle-icon-source-'));
    dirs.push(dir);
    const target = path.join(dir, 'Deceive.exe');
    writeFileSync(target, '');
    expect(iconParsingName({ appId: 'deceive', target })).toBe(target);
  });

  it('keeps AppsFolder for packaged applications without a target', () => {
    expect(iconParsingName({ appId: 'Microsoft.WindowsStore_8wekyb3d8bbwe!App', target: null }))
      .toBe('shell:AppsFolder\\Microsoft.WindowsStore_8wekyb3d8bbwe!App');
  });

  it('uses the target when iconFor is called with an indexed app id', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orelle-app-index-'));
    dirs.push(dir);
    const target = path.join(dir, 'Deceive.exe');
    writeFileSync(path.join(dir, 'apps.json'), JSON.stringify([{ name: 'Deceive', appId: 'deceive', target }]));
    const calls: string[] = [];
    const icons = { get: (name: string) => { calls.push(name); return null; } } as never;
    const index = new AppIndex(dir, icons);
    expect(index.entries()).toHaveLength(1);
    expect(iconParsingName(index.entries()[0])).toBe(target);
    index.iconFor('DECEIVE', true);
    expect(calls).toEqual([target]);
  });
});
