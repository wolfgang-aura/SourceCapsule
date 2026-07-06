import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension-src');
const out = path.join(root, 'dist', 'sourcecapsule-extension');
const development = process.argv.includes('--development');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
if (development) {
  manifest.host_permissions.push('http://127.0.0.1/*', 'http://localhost/*');
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const extensionFiles = ['compat.js', 'page-bridge.js', 'popup.html', 'popup.css', 'popup.js'];
let background = await fs.readFile(path.join(source, 'background.js'), 'utf8');
if (development)
  background = background.replace(
    'const DEVELOPMENT_HOSTS_ENABLED = false;',
    'const DEVELOPMENT_HOSTS_ENABLED = true;'
  );
await fs.writeFile(path.join(out, 'background.js'), background);
for (const name of extensionFiles) {
  await fs.copyFile(path.join(source, name), path.join(out, name));
}
await fs.copyFile(
  path.join(root, 'sourcecapsule.user.js'),
  path.join(out, 'sourcecapsule.user.js')
);

console.log(`[1/8] manifest.json -> ${out} (${development ? 'development' : 'production'})`);
console.log('[2/8] background.js copied');
extensionFiles.forEach((name, index) => console.log(`[${index + 3}/8] ${name} copied`));
console.log(`[8/8] sourcecapsule.user.js copied (v${pkg.version})`);
console.log(
  `Extension build complete: 8 files, v${pkg.version}, ${development ? 'development' : 'production'}.`
);
