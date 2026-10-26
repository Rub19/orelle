import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, SECTIONS } from '../src/renderer/settings/navigation';

describe('settings navigation', () => {
  it('places every settings section in exactly one navigation group', () => {
    const grouped = NAV_GROUPS.flatMap((group) => [...group.sections]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped).toEqual(SECTIONS.map((section) => section.id));
  });
});
