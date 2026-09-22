import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { check, hash, json, validatePanel, mergeRounds, atomicWrite } from './sync-core.mjs';
import { loadSession, openBrowser, collectRounds, printFailure } from './mister-client.mjs';

async function main() {
  const { values } = parseArgs({ options: { round: { type: 'string' }, headed: { type: 'boolean', default: false } } });
  const requested = values.round === undefined ? undefined : Number(values.round);
  check(requested === undefined || (Number.isInteger(requested) && requested >= 1 && requested <= 38), 'Usa --round entre 1 y 38.');
  // Never leave a stale candidate that could be mistaken for this attempt's successful output.
  await mkdir('.sync', { recursive: true });
  for (const file of ['candidate.json', 'report.json', 'summary.md']) await rm(`.sync/${file}`, { force: true });
  const source = await readFile('mister-datos.json', 'utf8');
  const configSource = await readFile('mister-sync.config.json', 'utf8');
  const panel = JSON.parse(source);
  const config = JSON.parse(configSource);
  validatePanel(panel, config);
  const { browser, page } = await openBrowser(await loadSession(), !values.headed);
  try {
    const rounds = await collectRounds(page, config, requested);
    const { output, changes } = mergeRounds(panel, config, rounds);
    const candidate = json(output);
    const report = {
      schema: 1, checkedAt: output.sync.lastSuccessfulSync, sourceSha256: hash(source),
      configSha256: hash(configSource), candidateSha256: hash(candidate),
      fullSeasonCheck: requested === undefined,
      checkedRounds: rounds.map(r => ({ round: r.round, gameweekId: r.id, state: r.state })), changes
    };
    const summary = [
      '# Vista previa Mister', '',
      `${rounds.length} jornadas comprobadas; ${changes.length} puntuaciones nuevas o corregidas.`,
      'Las jornadas abiertas o con partidos pendientes conservan sus datos anteriores.', '',
      '| Participante | Jornada | Antes | Mister |', '|---|---|---|---|',
      ...changes.map(c => `| ${c.player} | J${c.round} | ${c.before ?? 'Pendiente'} | ${c.after} |`), '',
      'El panel original no se ha modificado. La publicación requiere un paso separado.', ''
    ].join('\n');
    await atomicWrite('.sync/candidate.json', candidate);
    await atomicWrite('.sync/report.json', json(report));
    await atomicWrite('.sync/summary.md', summary);
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
    console.log(`${rounds.length} jornadas comprobadas; ${changes.length} cambios. Revisa .sync/summary.md.`);
  } finally { await browser.close(); }
}
main().catch(printFailure);
