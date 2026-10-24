// Safe arithmetic evaluator for the launcher (no eval). Recursive-descent parser.
// Supports + - * / % ^, parentheses, unary minus, implicit decimal comma, constants and common functions.

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return null;
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '×') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '÷') { out.push({ t: 'op', v: '/' }); i++; continue; }
    return null;
  }
  return out;
}

export function evaluate(input: string): number | null {
  // "3,5 + 1" → decimal comma when the comma is between digits and no function call uses it.
  const src = /[a-z]\s*\(/i.test(input) ? input : input.replace(/(\d),(\d)/g, '$1.$2');
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;

  const primary = (): number => {
    const tok = toks[p++];
    if (!tok) throw new Error('eof');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'op' && tok.v === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('paren');
      p++;
      return v;
    }
    if (tok.t === 'op' && tok.v === '-') return -power();
    if (tok.t === 'op' && tok.v === '+') return power();
    if (tok.t === 'id') {
      if (tok.v in CONSTS) return CONSTS[tok.v];
      const fn = FUNCS[tok.v];
      if (fn && isOp('(')) {
        p++;
        const args = [expr()];
        while (isOp(',')) { p++; args.push(expr()); }
        if (!isOp(')')) throw new Error('paren');
        p++;
        return fn(...args);
      }
    }
    throw new Error('unexpected');
  };
  const power = (): number => {
    const base = primary();
    if (isOp('^')) { p++; return Math.pow(base, unary()); }
    return base;
  };
  const unary = (): number => {
    if (isOp('-')) { p++; return -unary(); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  };
  const term = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%') || (peek() && (peek()!.t === 'num' || peek()!.t === 'id' || isOp('(')))) {
      // Implicit multiplication: "2pi", "3(4+1)".
      if (peek()!.t !== 'op' || isOp('(')) { v *= unary(); continue; }
      const op = toks[p++].v;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  try {
    const v = expr();
    if (p !== toks.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** True when the input looks like a calculation rather than a plain word or number. */
export function looksLikeMath(input: string): boolean {
  const s = input.trim();
  if (!/\d|pi\b/i.test(s)) return false;
  return /[+\-*/%^×÷()]|\b(sqrt|abs|round|floor|ceil|ln|log|exp|sin|cos|tan|min|max|pi)\b/i.test(s);
}

export function formatNumber(n: number, locale = 'fr-FR', maxFraction = 10): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString(locale);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e15)) return n.toExponential(6);
  // Keep at least a few significant digits for small values.
  const digits = abs < 1 ? Math.max(maxFraction, Math.ceil(-Math.log10(abs)) + 3) : maxFraction;
  return n.toLocaleString(locale, { maximumFractionDigits: Math.min(20, digits) });
}
