// Fuzzy matcher tuned for launcher queries: prefix > word starts > acronyms > subsequence.

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const isBoundary = (text: string, i: number) => {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  return /[\s\-_.\\/()[\]]/.test(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
};

/**
 * Returns a score in [0, 1] (0 = no match). `text` is matched case- and accent-insensitively.
 * Word-start and consecutive matches are rewarded, gaps are penalised.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query.trim());
  if (!q) return 0;
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.95 - Math.min(0.1, (t.length - q.length) * 0.002);

  const idx = t.indexOf(q);
  if (idx > 0) {
    const atWord = isBoundary(text, idx);
    return (atWord ? 0.86 : 0.7) - Math.min(0.1, idx * 0.004);
  }

  // Multi-word query: every token must match somewhere.
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let total = 0;
    for (const tok of tokens) {
      const s = fuzzyScore(tok, text);
      if (!s) return 0;
      total += s;
    }
    return (total / tokens.length) * 0.85;
  }

  // Subsequence with bonuses.
  let ti = 0;
  let score = 0;
  let streak = 0;
  let firstMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    // Prefer the next word-start occurrence when it is close, to reward acronyms.
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch && isBoundary(text, j)) { found = j; break; }
      if (t[j] === ' ' && j - ti > 24) break;
    }
    if (found === -1) found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    if (firstMatch === -1) firstMatch = found;
    const boundary = isBoundary(text, found);
    streak = found === ti && qi > 0 ? streak + 1 : 0;
    score += 1 + (boundary ? 1.5 : 0) + streak * 0.6 - Math.min(1, (found - ti) * 0.08);
    ti = found + 1;
  }
  const max = q.length * 3.1;
  const raw = Math.max(0, score / max);
  return Math.min(0.68, 0.25 + raw * 0.45 - Math.min(0.08, firstMatch * 0.004));
}
