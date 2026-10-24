// Orelle's monochrome glyph set (24×24, 1.7 stroke, round caps). Drawn for Orelle; no third-party icon font.

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
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  volumeMute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="m16 10 4 4M20 10l-4 4"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.3a9.5 9.5 0 0 1 13 0"/><path d="M8.6 15.5a5 5 0 0 1 6.8 0"/><path d="M12 19h.01"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  playPause: '<path d="M4 5.5v13l7.5-6.5Z"/><path d="M15 5.5v13M19.5 5.5v13"/>',
  next: '<path d="M5 5.5v13l9-6.5Z"/><path d="M18.5 5.5v13"/>',
  previous: '<path d="M19 5.5v13l-9-6.5Z"/><path d="M5.5 5.5v13"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  note: '<path d="M5 4.5h14v10l-5 5H5Z"/><path d="M14 19.5v-5h5"/><path d="M8.5 9h7M8.5 12.5h4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.5 1 1 2-2M3.5 12l1 1 2-2M3.5 17.5l1 1 2-2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx="1"/><rect x="12.5" y="7" width="3" height="10" rx="1"/><rect x="17.5" y="13" width="3" height="4" rx="1"/>',
  network: '<path d="M12 3v8"/><rect x="8.5" y="11" width="7" height="5" rx="1.5"/><path d="M5 20.5h14M12 16v4.5"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 10.5a4 4 0 0 1-.5 8Z"/>',
  rain: '<path d="M7 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 7a4 4 0 0 1-.5 8"/><path d="M8 18l-1 2.5M12.5 18l-1 2.5M17 18l-1 2.5"/>',
  snow: '<path d="M7 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 7a4 4 0 0 1-.5 8"/><path d="M8 19h.01M12 21h.01M12 17.5h.01M16 19h.01"/>',
  storm: '<path d="M7 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 7a4 4 0 0 1-.5 8"/><path d="m13 14-2.5 4h3l-2 4"/>',
  fog: '<path d="M4 10h16M6 14h12M8 18h8"/><path d="M7 6.5a6 6 0 0 1 10 0"/>',
  partly: '<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.8v1.2M3 8.5h1.2M4.6 4.6l.9.9M12.4 4.6l-.9.9"/><path d="M9.5 19.5a3.8 3.8 0 0 1-.3-7.6 5 5 0 0 1 9.4 1.7 3 3 0 0 1-.6 5.9Z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M4 4l16 16"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M9 20h6M12 16.5V20"/><path d="M8 13l3-3 2 2 3-3"/>',
  taskbar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 16h18"/><path d="M7 18h.01M10 18h.01M13 18h.01"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
  drive: '<rect x="3" y="13" width="18" height="6.5" rx="2"/><path d="M5 13 7 5.5h10L19 13"/><path d="M16.5 16.2h.01"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  folderPlus: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5V17a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17Z"/><path d="M12 10.5v6M9 13.5h6"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5"/><path d="M14 6h6.5M14 11h4.5M14 16h2.5"/>',
  rows: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  columns: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M10 9.5v10"/>',
  sidebarRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8 20 18M8 16 20 6"/>',  eye: '<path d="M2.5 12c1-2.5 4.5-7 9.5-7s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7Z"/><circle cx="12" cy="12" r="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  micOff: '<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.8 2.4"/><path d="M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M3 3l18 18"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4Z"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.8M6.4 6.5C4.4 7.8 3 9.8 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 4.9-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

/** The Orelle symbol (arched window), single colour, for in-UI branding. Same geometry as resources/brand/symbol-mono.svg. */
export function brandMark(cls = 'brand-mark'): string {
  return `<svg class="${cls}" viewBox="226 202 572 678" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M262 836V452a250 250 0 0 1 500 0v384zM318 512h388v-60a194 194 0 0 0-388 0zM328 556a10 10 0 0 0-10 10v204a10 10 0 0 0 10 10h156a10 10 0 0 0 10-10V566a10 10 0 0 0-10-10zM540 556a10 10 0 0 0-10 10v204a10 10 0 0 0 10 10h156a10 10 0 0 0 10-10V566a10 10 0 0 0-10-10z"/><rect x="226" y="836" width="572" height="44" rx="22" fill="currentColor"/></svg>`;
}

export function glyph(name: string, cls = 'glyph'): string {
  if (name === 'orelle') return brandMark(cls.replace('glyph', 'brand-mark'));
  const p = PATHS[name] ?? PATHS.sparkle;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}

export function glyphEl(name: string, cls = 'glyph'): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = glyph(name, cls);
  return tpl.content.firstElementChild as SVGElement;
}
