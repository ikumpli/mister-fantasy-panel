import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
await rm('_site', { recursive: true, force: true });
await mkdir('_site', { recursive: true });
// Explicit allowlist: no session files, scripts, reports or node_modules in the Pages artifact.
await copyFile('index.html', '_site/index.html');
await copyFile('mister-datos.json', '_site/mister-datos.json');
await writeFile('_site/.nojekyll', '');
