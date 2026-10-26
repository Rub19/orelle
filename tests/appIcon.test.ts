import { describe, expect, it } from 'vitest';
import { iconParsingName } from '../src/shared/appIcon';

describe('application icon source', () => {
  it('uses the real executable for classic applications', () => {
    expect(iconParsingName({ appId: 'deceive', target: 'C:\\Users\\storm\\Downloads\\Deceive.exe' }))
      .toBe('C:\\Users\\storm\\Downloads\\Deceive.exe');
  });

  it('keeps AppsFolder for packaged applications without a target', () => {
    expect(iconParsingName({ appId: 'Microsoft.WindowsStore_8wekyb3d8bbwe!App', target: null }))
      .toBe('shell:AppsFolder\\Microsoft.WindowsStore_8wekyb3d8bbwe!App');
  });

  it('does not treat URLs as executable paths', () => {
    expect(iconParsingName({ appId: 'https://example.test', target: 'https://example.test' }))
      .toBe('shell:AppsFolder\\https://example.test');
  });
});
