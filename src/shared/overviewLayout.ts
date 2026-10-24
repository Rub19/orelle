// Mission Control layout (pure, unit tested): picks the column count that gives the largest
// thumbnails, then fits each window's aspect ratio inside its cell, centred, rows centred too.

export interface Card { x: number; y: number; w: number; h: number }

export function layoutCards(aspects: number[], width: number, height: number, gap = 28, label = 30): Card[] {
  const n = aspects.length;
  if (!n || width <= 0 || height <= 0) return [];
  let best: { cols: number; score: number } = { cols: 1, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (width - gap * (cols - 1)) / cols;
    const ch = (height - gap * (rows - 1)) / rows - label;
    if (cw <= 0 || ch <= 0) continue;
    // Total thumbnail area; ties go to fewer columns (bigger, calmer layout).
    let score = 0;
    for (const a of aspects) {
      const w = Math.min(cw, ch * a);
      score += w * (w / a);
    }
    if (score > best.score * 1.0001) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const cw = (width - gap * (cols - 1)) / cols;
  const ch = Math.min((height - gap * (rows - 1)) / rows - label, cw / 1.2);
  const totalH = rows * (ch + label) + gap * (rows - 1);
  const top = Math.max(0, (height - totalH) / 2);
  const out: Card[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cw + gap * (inRow - 1);
    const left = (width - rowW) / 2;
    for (let c = 0; c < inRow; c++) {
      const a = aspects[r * cols + c];
      const w = Math.min(cw, ch * a);
      const h = w / a;
      out.push({
        x: Math.round(left + c * (cw + gap) + (cw - w) / 2),
        y: Math.round(top + r * (ch + label + gap) + (ch - h) / 2),
        w: Math.round(w),
        h: Math.round(h),
      });
    }
  }
  return out;
}
