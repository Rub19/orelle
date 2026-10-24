// Rasterizes the brand SVGs (resources/brand) into every PNG/ICO the app and installer need,
// using Chromium's renderer for exact SVG and font rendering.  Run: npm run brand
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const brand = path.join(root, 'resources', 'brand');
const icons = path.join(root, 'resources', 'icons');
const png = path.join(brand, 'png');

function writeIco(file, entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  fs.writeFileSync(file, Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
}

async function render(win, svgFile, width, height, color = null) {
  let svg = fs.readFileSync(path.join(brand, svgFile), 'utf8');
  if (color) svg = svg.replace('<svg ', `<svg style="color:${color}" `);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${width}px;height:${height}px;object-fit:contain"></body></html>`;
  win.setContentSize(width, height);
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.images[0].decode()).then(() => true)');
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  return img.resize({ width, height, quality: 'best' }).toPNG();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(icons, { recursive: true });
  fs.mkdirSync(png, { recursive: true });
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);

  const appSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const entries = [];
  for (const s of appSizes) {
    const data = await render(win, 'mark-dark.svg', s, s);
    fs.writeFileSync(path.join(icons, `orelle-${s}.png`), data);
    if ([16, 20, 24, 32, 40, 48, 64, 256].includes(s)) entries.push({ size: s, data });
  }
  writeIco(path.join(icons, 'orelle.ico'), entries);
  writeIco(path.join(icons, 'favicon.ico'), entries.filter((e) => e.size <= 48));
  fs.writeFileSync(path.join(icons, 'orelle.png'), await render(win, 'mark-dark.svg', 512, 512));
  fs.writeFileSync(path.join(icons, 'tray.png'), await render(win, 'mark-dark.svg', 32, 32));
  fs.writeFileSync(path.join(icons, 'tray@2x.png'), await render(win, 'mark-dark.svg', 64, 64));
  fs.writeFileSync(path.join(icons, 'symbol.png'), await render(win, 'symbol.svg', 256, 300));

  // Brand kit previews.
  fs.writeFileSync(path.join(png, 'app-icon-dark-1024.png'), await render(win, 'mark-dark.svg', 1024, 1024));
  fs.writeFileSync(path.join(png, 'app-icon-light-1024.png'), await render(win, 'mark-light.svg', 1024, 1024));
  fs.writeFileSync(path.join(png, 'symbol-color-512.png'), await render(win, 'symbol.svg', 436, 512));
  fs.writeFileSync(path.join(png, 'symbol-mono-white-512.png'), await render(win, 'symbol-mono.svg', 436, 512, '#ffffff'));
  fs.writeFileSync(path.join(png, 'symbol-mono-black-512.png'), await render(win, 'symbol-mono.svg', 436, 512, '#14161D'));
  fs.writeFileSync(path.join(png, 'wordmark-dark-800.png'), await render(win, 'wordmark-dark.svg', 800, 300));
  fs.writeFileSync(path.join(png, 'wordmark-light-800.png'), await render(win, 'wordmark-light.svg', 800, 300));

  console.log('Brand assets written to resources/icons and resources/brand/png');
  app.exit(0);
});
