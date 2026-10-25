// Daily time windows ("22:00 to 07:00"), pure and unit tested. Shared by quiet hours,
// automation conditions and the theme schedule.

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** True when `now` is inside [from, to); windows may cross midnight. Equal bounds = never. */
export function inWindow(now: Date, from: string, to: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const a = minutes(from);
  const b = minutes(to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}
