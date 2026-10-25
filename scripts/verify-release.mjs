import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = process.env.GITHUB_REF_NAME;

if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package version ${version}`);
}

const files = [
  path.join(root, 'release', `Orelle-Setup-${version}.exe`),
  path.join(root, 'release', `Orelle-Setup-${version}.exe.blockmap`),
  path.join(root, 'release', 'latest.yml'),
];
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`Missing release asset: ${path.relative(root, file)}`);
}

const metadata = fs.readFileSync(files[2], 'utf8');
if (!metadata.includes(`Orelle-Setup-${version}.exe`)) {
  throw new Error('latest.yml does not point to the versioned Orelle installer');
}

console.log(`Release assets ready for Orelle ${version}`);
