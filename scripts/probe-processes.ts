// Dev probe: exercises the process / PDH bindings outside the app. Run: npx esbuild ... (see package.json "probe").
import { hungProcessIds, listProcesses, PdhCounters } from '../src/main/native/processes';

const t0 = performance.now();
const procs = listProcesses();
const t1 = performance.now();
const withPath = procs.filter((p) => p.path).length;
const top = [...procs].filter((p) => p.workingSet).sort((a, b) => (b.workingSet ?? 0) - (a.workingSet ?? 0)).slice(0, 5);
console.log(`processes: ${procs.length} (${withPath} with path) in ${(t1 - t0).toFixed(1)} ms`);
for (const p of top) console.log(`  ${p.pid} ${p.name} ws=${Math.round((p.workingSet ?? 0) / 1e6)}MB priv=${Math.round((p.privateBytes ?? 0) / 1e6)}MB cpu=${p.cpuTime} io=${p.ioRead}`);
console.log('hung:', [...hungProcessIds()]);
const pdh = new PdhCounters({
  gpu: '\\GPU Engine(*)\\Utilization Percentage',
  disk: '\\PhysicalDisk(_Total)\\Disk Bytes/sec',
  diskTime: '\\PhysicalDisk(_Total)\\% Disk Time',
  netDown: '\\Network Interface(*)\\Bytes Received/sec',
  netUp: '\\Network Interface(*)\\Bytes Sent/sec',
});
console.log('pdh available:', pdh.available);
setTimeout(() => {
  const s = pdh.sample();
  for (const [k, v] of Object.entries(s)) {
    const total = v.reduce((a, b) => a + b.value, 0);
    console.log(`  ${k}: ${v.length} instances, sum=${total.toFixed(1)}`, v.slice(0, 2).map((x) => x.name.slice(0, 50)));
  }
  pdh.close();
  process.exit(0);
}, 1200);
