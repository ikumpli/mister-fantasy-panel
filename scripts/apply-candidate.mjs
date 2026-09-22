import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { check, hash, readJson, validatePanel, atomicWrite, SyncError } from './sync-core.mjs';

export async function applyCandidate(root = '.') {
  const file = p => `${root}/${p}`;
  const original = await readFile(file('mister-datos.json'), 'utf8');
  const configSource = await readFile(file('mister-sync.config.json'), 'utf8');
  const candidate = await readFile(file('.sync/candidate.json'), 'utf8');
  const report = await readJson(file('.sync/report.json'));
  check(report.schema === 1 && report.sourceSha256 === hash(original) && report.configSha256 === hash(configSource) &&
    report.candidateSha256 === hash(candidate), 'El panel, configuración o candidato cambió desde la comprobación. Ejecuta otra vista previa.');
  check(report.fullSeasonCheck === true, 'La publicación requiere una comprobación completa, sin --round.');
  const age = Date.now() - Date.parse(report.checkedAt);
  check(Number.isFinite(age) && age >= -60000 && age < 6 * 60 * 60 * 1000, 'La vista previa ha caducado. Repite la comprobación.');
  validatePanel(JSON.parse(candidate), JSON.parse(configSource));
  await atomicWrite(file('.sync/previous.json'), original);
  await atomicWrite(file('mister-datos.json'), candidate, 0o644);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyCandidate().then(() => console.log('JSON actualizado. Copia anterior en .sync/previous.json.'))
    .catch(error => { console.error(error instanceof SyncError ? error.message : 'No se pudo aplicar la vista previa.'); process.exitCode = 1; });
}
