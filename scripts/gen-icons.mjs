// Renders the NOVA app icon procedurally (squircle + four-point sparkle) to PNG sizes and a
// multi-resolution .ico. No image dependencies: supersampled rasterizer + minimal PNG encoder.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'resources', 'icons');
mkdirSync(out, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * t;

/** Colour of a sample at normalized coords (u, v in [-1, 1]); returns [r, g, b, a] premultiplied-free. */
function sample(u, v, tray) {
  const n = 5; // squircle exponent
  const inset = tray ? 0.98 : 0.86;
  const su = Math.abs(u / inset), sv = Math.abs(v / inset);
  if (su ** n + sv ** n > 1) return null;
  // Background: diagonal indigo → electric blue, with a soft top highlight.
  const t = (u + v + 2) / 4;
  let r = mix(124, 22, t), g = mix(92, 70, t), b = mix(255, 214, t);
  const hl = Math.max(0, 1 - Math.hypot(u + 0.35, v + 0.75) / 1.1) * 0.35;
  r = mix(r, 255, hl); g = mix(g, 255, hl); b = mix(b, 255, hl);
  // Sparkle: concave four-point star |x|^p + |y|^p <= R^p, plus glow.
  const p = 0.55, R = 0.62;
  const sx = Math.abs(u), sy = Math.abs(v + 0.02);
  const d = (sx ** p + sy ** p) ** (1 / p);
  if (d <= R) return [255, 255, 255, 255];
  const glow = Math.max(0, 1 - Math.hypot(u, v) / 0.75) ** 2 * 0.45;
  r = mix(r, 255, glow); g = mix(g, 255, glow); b = mix(b, 255, glow);
  // Small companion sparkle, top right.
  const cx = u - 0.42, cy = v + 0.42;
  if ((Math.abs(cx) ** p + Math.abs(cy) ** p) ** (1 / p) <= 0.16) return [255, 255, 255, 235];
  return [r, g, b, 255];
}

function render(size, tray = false) {
  const ss = size <= 32 ? 8 : 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const u = ((x + (i + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (j + 0.5) / ss) / size) * 2 - 1;
          const c = sample(u, v, tray);
          if (!c) continue;
          const al = c[3] / 255;
          r += c[0] * al; g += c[1] * al; b += c[2] * al; a += al;
        }
      }
      const o = (y * size + x) * 4;
      const n = ss * ss;
      buf[o] = a ? Math.round(r / a) : 0;
      buf[o + 1] = a ? Math.round(g / a) : 0;
      buf[o + 2] = a ? Math.round(b / a) : 0;
      buf[o + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, buf);
}

const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ s, data: render(s) }));
for (const { s, data } of pngs) writeFileSync(path.join(out, `nova-${s}.png`), data);
writeFileSync(path.join(out, 'nova.png'), render(512));
writeFileSync(path.join(out, 'tray.png'), render(32, true));
writeFileSync(path.join(out, 'tray@2x.png'), render(64, true));

// ICO container with embedded PNGs (supported since Windows Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach(({ s, data }, i) => {
  const o = i * 16;
  dir[o] = s >= 256 ? 0 : s;
  dir[o + 1] = s >= 256 ? 0 : s;
  dir[o + 2] = 0; dir[o + 3] = 0;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
writeFileSync(path.join(out, 'nova.ico'), Buffer.concat([header, dir, ...pngs.map((p) => p.data)]));
console.log('Icons written to', path.relative(root, out));
