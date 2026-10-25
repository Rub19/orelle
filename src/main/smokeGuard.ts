export interface WindowTitleInfo {
  pid: number;
  title: string;
}

const ORELLE_SURFACES = new Set(['Orelle Dock', 'Orelle Top Bar']);

export function isOrelleSurfaceTitle(title: string): boolean {
  return ORELLE_SURFACES.has(title);
}

export function hasOtherOrelleSurface(windows: readonly WindowTitleInfo[], currentPid: number): boolean {
  return windows.some((w) => w.pid !== currentPid && isOrelleSurfaceTitle(w.title));
}
