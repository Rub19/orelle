// NOVA's monochrome glyph set (24×24, 1.7 stroke, round caps). Drawn for NOVA; no third-party icon font.

const PATHS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  settings:
    '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-.9-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  logout: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8c0-.5.4-.8.8-.8h3.4c.4 0 .8.3.8.8V7"/><path d="M6.5 7l.8 12a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.8-12"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>',
  ruler: '<path d="m4 15.5 11.5-11.5 4.5 4.5L8.5 20Z"/><path d="m8 11.5 2 2M11 8.5l2 2M14 5.5l2 2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.2-3.4-8.5S9.7 5.8 12 3.5Z"/>',
  command: '<path d="M9 6.5V17.5M15 6.5V17.5M6.5 9H17.5M6.5 15H17.5"/><path d="M9 9a2.5 2.5 0 1 1-2.5-2.5H9M15 9h2.5A2.5 2.5 0 1 0 15 6.5M15 15h2.5a2.5 2.5 0 1 1-2.5 2.5M9 15H6.5A2.5 2.5 0 1 0 9 17.5"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2.5"/><path d="M9 4.5V4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v.5"/><path d="M9 10h6M9 13.5h6M9 17h3.5"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17"/><path d="M6.5 7h.01M8.6 7h.01"/>',
  dock: '<rect x="3" y="14.5" width="18" height="5.5" rx="2.2"/><rect x="5.5" y="9.5" width="3.6" height="3.6" rx="1"/><rect x="10.2" y="7" width="3.6" height="6.1" rx="1"/><rect x="14.9" y="9.5" width="3.6" height="3.6" rx="1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.5l1.7-2"/><path d="M20 20v-4.5h-4.5"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>',
  folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5V17a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17Z"/>',
  file: '<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5Z"/><path d="M14 3.5v5h5"/>',
  sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z"/><path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 2-.8 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.8 1.9-1.8h2.2a3.4 3.4 0 0 0 3.4-3.4c0-4-3.8-7.3-8.5-7.3Z"/><circle cx="7.8" cy="11.5" r=".6"/><circle cx="10" cy="7.8" r=".6"/><circle cx="14.4" cy="7.8" r=".6"/>',
  shield: '<path d="M12 3.5 5 6v5.6c0 4.3 3 7.6 7 8.9 4-1.3 7-4.6 7-8.9V6Z"/><path d="m9.2 12 2 2 3.8-4"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v8.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V9"/><path d="M10 13h4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  enter: '<path d="M20 5v6a3 3 0 0 1-3 3H5"/><path d="m9 10-4 4 4 4"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10.3 10h.01M13.6 10h.01M17 10h.01M8 14h8"/>',
  display: '<rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M9 20h6M12 16.5V20"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v3.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 4 17.5v-9A2.5 2.5 0 0 1 6.5 6H10"/>',
  separator: '<path d="M12 4v16"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
};

export function glyph(name: string, cls = 'glyph'): string {
  const p = PATHS[name] ?? PATHS.sparkle;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}

export function glyphEl(name: string, cls = 'glyph'): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = glyph(name, cls);
  return tpl.content.firstElementChild as SVGElement;
}
