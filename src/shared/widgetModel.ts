// Pure helpers used by widgets (unit tested).

/** 6×7 calendar matrix starting on Monday. */
export function monthMatrix(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, inMonth: date.getMonth() === month };
  });
}

export function formatBytes(n: number, lang: 'fr' | 'en', perSecond = false): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Math.max(0, n);
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  const s = v.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 });
  return `${s} ${units[i]}${perSecond ? '/s' : ''}`;
}

export function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** mm:ss, or h:mm:ss above an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

/** WMO weather code (Open-Meteo) → Orelle glyph name. */
export function weatherGlyph(code: number): string {
  if (code === 0) return 'sun';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'cloud';
}

/** Keeps a widget fully reachable inside the layer after a move/resize or a resolution change. */
export function clampRect(r: { x: number; y: number; w: number; h: number }, bounds: { w: number; h: number }) {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  return { x: Math.round(Math.min(Math.max(0, r.x), bounds.w - w)), y: Math.round(Math.min(Math.max(0, r.y), bounds.h - h)), w: Math.round(w), h: Math.round(h) };
}

/** Snaps a coordinate to an 8 px grid unless the user holds Alt. */
export const snap = (v: number, grid = 8) => Math.round(v / grid) * grid;
