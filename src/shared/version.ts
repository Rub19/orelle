// Semantic version comparison for update checks (pure, unit tested).

/** -1, 0 or 1. Accepts "v1.2.3", "1.2", pre-release tags ("1.2.0-beta.1" < "1.2.0"). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2);
    const nums = core.split('.').map((x) => Number.parseInt(x, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
