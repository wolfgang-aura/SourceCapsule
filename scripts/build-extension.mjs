import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension-src');
const out = path.join(root, 'dist', 'sourcecapsule-extension');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;

await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const name of ['compat.js', 'background.js']) {
  await fs.copyFile(path.join(source, name), path.join(out, name));
}
await fs.copyFile(
  path.join(root, 'sourcecapsule.user.js'),
  path.join(out, 'sourcecapsule.user.js')
);

console.log(`[1/4] manifest.json -> ${out}`);
console.log('[2/4] compat.js copied');
console.log('[3/4] background.js copied');
console.log(`[4/4] sourcecapsule.user.js copied (v${pkg.version})`);
console.log('Extension build complete.');
