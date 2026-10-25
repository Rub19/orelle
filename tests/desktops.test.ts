import { describe, expect, it } from 'vitest';
import { guidFromHex, parseDesktops, stepsBetween } from '../src/shared/virtualDesktops';

describe('virtual desktops', () => {
  it('decodes registry GUIDs the way Windows prints them', () => {
    expect(guidFromHex('78563412cdab01ef0123456789abcdef')).toBe('{12345678-ABCD-EF01-0123-456789ABCDEF}');
  });
  it('lists desktops with names and the current one', () => {
    const a = '78563412cdab01ef0123456789abcdef';
    const b = '11111111222233334444555555555555';
    const list = parseDesktops(a + b, b, { [guidFromHex(a)]: 'Travail' }, (n) => `Bureau ${n}`);
    expect(list.map((d) => [d.name, d.current])).toEqual([['Travail', false], ['Bureau 2', true]]);
  });
  it('treats a missing list as a single desktop', () => {
    expect(parseDesktops(null, null, {}, (n) => `Desktop ${n}`)).toEqual([{ id: 'single', index: 0, name: 'Desktop 1', current: true }]);
  });
  it('counts the shortcut presses between desktops', () => {
    expect(stepsBetween(0, 2)).toEqual({ key: 'right', count: 2 });
    expect(stepsBetween(3, 1)).toEqual({ key: 'left', count: 2 });
  });
});
