// Windows virtual desktops as Explorer records them (read-only registry values), pure and unit
// tested. VirtualDesktopIDs is a REG_BINARY list of 16-byte GUIDs in desktop order;
// CurrentVirtualDesktop is one GUID. Both are absent while there is a single desktop.

export interface VirtualDesktop { id: string; index: number; name: string; current: boolean }

/** 16 bytes (registry hex) → "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" (mixed-endian like Windows). */
export function guidFromHex(hex: string): string {
  const b = hex.match(/../g)!.map((x) => x.toUpperCase());
  const le = (a: string[]) => [...a].reverse().join('');
  return `{${le(b.slice(0, 4))}-${le(b.slice(4, 6))}-${le(b.slice(6, 8))}-${b.slice(8, 10).join('')}-${b.slice(10, 16).join('')}}`;
}

export function parseDesktops(idsHex: string | null, currentHex: string | null, names: Record<string, string>, defaultName: (n: number) => string): VirtualDesktop[] {
  const clean = (idsHex ?? '').replace(/[^0-9a-f]/gi, '');
  const ids = clean.length >= 32 ? clean.match(/.{32}/g)!.map(guidFromHex) : [];
  const current = currentHex && currentHex.replace(/[^0-9a-f]/gi, '').length === 32 ? guidFromHex(currentHex.replace(/[^0-9a-f]/gi, '')) : null;
  if (!ids.length) return [{ id: 'single', index: 0, name: defaultName(1), current: true }];
  return ids.map((id, i) => ({ id, index: i, name: names[id.toUpperCase()] || defaultName(i + 1), current: current ? id === current : i === 0 }));
}

/** Ctrl+Win+Left/Right presses needed to go from `from` to `to`. */
export function stepsBetween(from: number, to: number): { key: 'left' | 'right'; count: number } {
  return to >= from ? { key: 'right', count: to - from } : { key: 'left', count: from - to };
}
