// Orelle extensions are declarative: a manifest.json describing launcher commands that open a
// web page, open a local folder (never a program) or copy a text. No extension code is ever executed, so an
// extension can only do what its manifest visibly declares; the permissions shown to the user are
// derived from it. Pure functions, unit tested.

export type ExtensionCommand =
  | { id: string; title: string; subtitle: string; keyword: string; kind: 'url'; target: string }
  | { id: string; title: string; subtitle: string; keyword: string; kind: 'path'; target: string }
  | { id: string; title: string; subtitle: string; keyword: string; kind: 'copy'; target: string };

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  commands: ExtensionCommand[];
}

export type ExtensionPermission = { kind: 'web'; hosts: string[] } | { kind: 'files'; paths: string[] } | { kind: 'clipboard' };

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const ENV_RE = /%(USERPROFILE|APPDATA|LOCALAPPDATA|ONEDRIVE|PUBLIC|HOMEDRIVE)%/gi;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Expands the few allowed environment variables; returns null for anything else that is not absolute. */
export function expandPath(p: string, env: Record<string, string | undefined>): string | null {
  const out = p.replace(ENV_RE, (_m, name: string) => env[name.toUpperCase()] ?? env[name] ?? '');
  if (/%[^%]+%/.test(out)) return null;
  return /^[a-z]:\\/i.test(out) ? out : null;
}

export function parseManifest(raw: unknown): { ok: true; manifest: ExtensionManifest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'manifest is not an object' };
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 64);
  if (!ID_RE.test(id)) return { ok: false, error: 'invalid id' };
  const name = str(m.name, 60);
  if (!name) return { ok: false, error: 'missing name' };
  const commands: ExtensionCommand[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(m.commands) ? m.commands.slice(0, 50) : []) {
    if (typeof c !== 'object' || c === null) continue;
    const r = c as Record<string, unknown>;
    const cid = str(r.id, 64);
    const title = str(r.title, 80);
    if (!ID_RE.test(cid) || !title || seen.has(cid)) continue;
    const base = { id: cid, title, subtitle: str(r.subtitle, 120), keyword: str(r.keyword, 24).toLowerCase().replace(/\s+/g, '') };
    if (typeof r.url === 'string' && /^https:\/\/[^\s/]+/i.test(r.url) && r.url.length <= 1000) commands.push({ ...base, kind: 'url', target: r.url });
    else if (typeof r.path === 'string' && r.path.length <= 500 && (/^[a-z]:\\/i.test(r.path) || /^%[a-z]+%/i.test(r.path))) commands.push({ ...base, kind: 'path', target: r.path });
    else if (typeof r.copy === 'string' && r.copy.length <= 2000) commands.push({ ...base, kind: 'copy', target: r.copy });
    else continue;
    seen.add(cid);
  }
  if (!commands.length) return { ok: false, error: 'no valid command' };
  return {
    ok: true,
    manifest: { id, name, version: str(m.version, 20) || '1.0.0', author: str(m.author, 60), description: str(m.description, 300), commands },
  };
}

/** What the extension is able to do, for display before the user turns it on. */
export function permissionsOf(m: ExtensionManifest): ExtensionPermission[] {
  const hosts = new Set<string>();
  const paths = new Set<string>();
  let clipboard = false;
  for (const c of m.commands) {
    if (c.kind === 'url') {
      try { hosts.add(new URL(c.target.replace(/\{query\}/g, 'x')).hostname); } catch { /* skipped by parse */ }
    } else if (c.kind === 'path') paths.add(c.target);
    else clipboard = true;
  }
  const out: ExtensionPermission[] = [];
  if (hosts.size) out.push({ kind: 'web', hosts: [...hosts] });
  if (paths.size) out.push({ kind: 'files', paths: [...paths] });
  if (clipboard) out.push({ kind: 'clipboard' });
  return out;
}

/** Fills {query} (URL-encoded for web pages). */
export function fillTarget(c: ExtensionCommand, query: string): string {
  if (c.kind === 'url') return c.target.replace(/\{query\}/g, encodeURIComponent(query));
  // Paths are fixed: a query can never point a command somewhere else.
  return c.kind === 'copy' ? c.target.replace(/\{query\}/g, query) : c.target;
}
