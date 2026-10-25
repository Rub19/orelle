// Performance profile (pure, unit tested). "Light" trades eye candy for memory and CPU on modest
// PCs: no GPU process, surfaces created on demand, slower background sampling.

export type PerformancePref = 'auto' | 'standard' | 'light';

const GiB = 1024 ** 3;

/** A PC counts as modest with 8 GB of RAM or less, or 4 logical processors or fewer. */
export function isModestPc(totalMemBytes: number, cpuCount: number): boolean {
  return totalMemBytes <= 8.5 * GiB || cpuCount <= 4;
}

export function resolvePerformance(pref: PerformancePref, totalMemBytes: number, cpuCount: number): 'standard' | 'light' {
  if (pref !== 'auto') return pref;
  return isModestPc(totalMemBytes, cpuCount) ? 'light' : 'standard';
}

/** Sampling intervals and lifetimes per profile (ms). */
export function tuning(profile: 'standard' | 'light') {
  return profile === 'light'
    ? { statsInterval: 4000, volumePoll: 15_000, appRefreshDelay: 90_000, buildFileIndexAtStart: false, trimHiddenAfter: 15_000, trimAwayAfter: 30_000, releasePanelsAfter: 10 * 60_000, prewarmLauncherAfter: 20_000 }
    : { statsInterval: 2000, volumePoll: 5000, appRefreshDelay: 10_000, buildFileIndexAtStart: true, trimHiddenAfter: 60_000, trimAwayAfter: 120_000, releasePanelsAfter: 10 * 60_000, prewarmLauncherAfter: 0 };
}
