import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hash, json, readJson, roundLinks, standingsRows, validateHistory, roundState, mergeRounds } from '../scripts/sync-core.mjs';
import { applyCandidate } from '../scripts/apply-candidate.mjs';
import { keepMisterSession, getSessionFile, loadSession } from '../scripts/mister-client.mjs';

const config = await readJson(new URL('../mister-sync.config.json', import.meta.url));
const original = await readJson(new URL('../mister-datos.json', import.meta.url));
const fixture = await readJson(new URL('./fixtures/jornada4.json', import.meta.url));
const links = fixture.rows.map((r, i) => ({ href: `https://mister.mundodeportivo.com/users/${r.misterManagerId}/name`,
  text: `${i + 1} XX ${r.misterName} 9 / 11 Jugadores · € 44.739.000 ${r.observedPoints} PTS` }));
const points = Object.fromEntries(fixture.rows.map(r => [r.misterManagerId, r.observedPoints]));
function baseline() {
  const data = structuredClone(original);
  delete data.sync;
  for (const r of fixture.rows) {
    data.points[r.panelId] = Array(38).fill(null);
    data.points[r.panelId][3] = r.savedPoints;
  }
  return data;
}
const closedRound = () => ({ round: 4, id: '4045', state: 'closed', points: { ...points } });
const metadata = () => ({ gameweekStatus: 'closed', games: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, status: 'played' })) });

test('reads all ten observed J4 scores and proposes exactly six historical corrections', () => {
  assert.deepEqual(standingsRows(links, config), points);
  const source = baseline();
  const { output, changes } = mergeRounds(source, config, [closedRound()]);
  assert.equal(changes.length, 6);
  assert.equal(output.points.Ma[3], 42);
  assert.equal(output.points.El[3], 47);
  assert.equal(source.points.Ma[3], 28);
  assert.equal(output.points.Ma[4], null);
});

test('repeated imports replace points rather than accumulating them', () => {
  const first = mergeRounds(baseline(), config, [closedRound()]).output;
  const second = mergeRounds(first, config, [closedRound()]);
  assert.equal(second.changes.length, 0);
  assert.deepEqual(second.output.points, first.points);
});

test('zero and negative scores are retained; missing scores are rejected', () => {
  const round = closedRound();
  round.points[config.managerIds.Ma] = 0;
  round.points[config.managerIds.El] = -4;
  const result = mergeRounds(baseline(), config, [round]);
  assert.equal(result.output.points.Ma[3], 0);
  assert.equal(result.output.points.El[3], -4);
  delete round.points[config.managerIds.Cu];
  assert.throws(() => mergeRounds(baseline(), config, [round]), /Faltan/);
  const zeroLinks = links.map(l => ({ ...l, text: l.text.replace(/\d+ PTS$/, '0 PTS') }));
  assert.ok(Object.values(standingsRows(zeroLinks, config)).every(p => p === 0));
  const negativeLinks = links.map(l => ({ ...l, text: l.text.replace(/\d+ PTS$/, '-4 PTS') }));
  assert.ok(Object.values(standingsRows(negativeLinks, config)).every(p => p === -4));
});

test('empty, incomplete, duplicate and wrong-league rows fail closed', () => {
  assert.throws(() => standingsRows([], config));
  assert.throws(() => standingsRows(links.slice(1), config));
  assert.throws(() => standingsRows([...links, links[0]], config));
  assert.throws(() => standingsRows(links.map((l, i) => i ? l : { ...l, href: 'https://mister.mundodeportivo.com/users/999/other' }), config));
  assert.throws(() => validateHistory({ userInfo: { id_community: 999 }, userGameWeeks: {} }, config), /otra liga/);
  assert.throws(() => validateHistory({ userInfo: { id_community: 695985 }, userGameWeeks: null }, config), /historial/);
});

test('pins the season to observed jornada IDs, rejecting rollover and conflicting links', () => {
  const rounds = [{ text: 'J1', href: '/standings?gw=3968' }, { text: 'J4', href: '/standings?gw=4045' }];
  assert.deepEqual(roundLinks(rounds, config), [{ round: 1, id: '3968' }, { round: 4, id: '4045' }]);
  assert.throws(() => roundLinks([{ text: 'J1', href: '/standings?gw=9999' }], config), /temporada/);
  assert.throws(() => roundLinks([...rounds, { text: 'J4', href: '/standings?gw=9999' }], config), /contradictorios/);
});

test('requires explicit completion and all ten fixtures; postponed or reopened rounds stay provisional', () => {
  assert.equal(roundState(metadata(), config), 'closed');
  assert.equal(roundState({ gameweekStatus: 'ongoing' }, config), 'pending');
  const postponed = metadata();
  postponed.games[4].status = 'postponed';
  assert.equal(roundState(postponed, config), 'pending');
  assert.throws(() => roundState({ games: metadata().games }, config), /estado/);
  assert.throws(() => roundState({ ...metadata(), games: [] }, config), /partidos/);
  const unknown = metadata(); unknown.games[0].status = 'new-status';
  assert.throws(() => roundState(unknown, config), /desconocido/);
  const before = baseline();
  const after = mergeRounds(before, config, [{ round: 4, id: '4045', state: 'pending' }]).output;
  assert.deepEqual(after.points, before.points);
  assert.equal(after.sync.rounds[4].status, 'pending');
});

test('session export keeps only cookies usable by Mister and its own origin', () => {
  const state = keepMisterSession({ cookies: [
    { domain: '.mundodeportivo.com', name: 'session' },
    { domain: 'mister.mundodeportivo.com', name: 'session2' },
    { domain: '.google.com', name: 'other-login' },
    { domain: 'evilmundodeportivo.com', name: 'other' }
  ], origins: [{ origin: 'https://mister.mundodeportivo.com' }, { origin: 'https://accounts.google.com' }] });
  assert.equal(state.cookies.length, 2);
  assert.equal(state.origins.length, 1);
});

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mister-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function candidate(root, fullSeasonCheck = true) {
  const data = json(baseline());
  const settings = json(config);
  const merged = mergeRounds(baseline(), config, [closedRound()]);
  const next = json(merged.output);
  await mkdir(`${root}/.sync`);
  await writeFile(`${root}/mister-datos.json`, data);
  await writeFile(`${root}/mister-sync.config.json`, settings);
  await writeFile(`${root}/.sync/candidate.json`, next);
  await writeFile(`${root}/.sync/report.json`, json({ schema: 1, checkedAt: new Date().toISOString(),
    fullSeasonCheck, sourceSha256: hash(data), configSha256: hash(settings), candidateSha256: hash(next) }));
  return { data, next };
}

test('applies a verified candidate atomically and keeps a rollback copy', async t => {
  const root = await temp(t);
  const { data, next } = await candidate(root);
  await applyCandidate(root);
  assert.equal(await readFile(`${root}/mister-datos.json`, 'utf8'), next);
  assert.equal(await readFile(`${root}/.sync/previous.json`, 'utf8'), data);
});

test('a concurrent edit or altered candidate cannot overwrite the original', async t => {
  const root = await temp(t);
  await candidate(root);
  await writeFile(`${root}/mister-datos.json`, 'user edit');
  await assert.rejects(applyCandidate(root), /cambió/);
  assert.equal(await readFile(`${root}/mister-datos.json`, 'utf8'), 'user edit');
});

test('partial previews and stale previews cannot publish', async t => {
  const root = await temp(t);
  await candidate(root, false);
  await assert.rejects(applyCandidate(root), /completa/);
  const report = await readJson(`${root}/.sync/report.json`);
  report.fullSeasonCheck = true;
  report.checkedAt = '2020-01-01T00:00:00Z';
  await writeFile(`${root}/.sync/report.json`, json(report));
  await assert.rejects(applyCandidate(root), /caducado/);
});

test('public site build removes stale files and cannot contain session state', async t => {
  const root = await temp(t);
  await mkdir(`${root}/_site`);
  await writeFile(`${root}/_site/private-test.json`, 'fake test session');
  await writeFile(`${root}/index.html`, '<title>Panel</title>');
  await writeFile(`${root}/mister-datos.json`, json(baseline()));
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-site.mjs', import.meta.url))], { cwd: root });
  assert.deepEqual((await readdir(`${root}/_site`)).sort(), ['.nojekyll', 'index.html', 'mister-datos.json']);
});


test('custom session paths must be absolute and outside the repository', () => {
  assert.equal(getSessionFile({}), 'playwright/.auth/mister.json');
  assert.equal(getSessionFile({ MISTER_STORAGE_STATE_PATH: '/private/tmp/iCloud Drive/Mister/mister.json' }),
    '/private/tmp/iCloud Drive/Mister/mister.json');
  assert.throws(() => getSessionFile({ MISTER_STORAGE_STATE_PATH: 'relative/mister.json' }), /absoluta/);
  assert.throws(() => getSessionFile({ MISTER_STORAGE_STATE_PATH: '' }), /absoluta/);
  assert.throws(() => getSessionFile({ MISTER_STORAGE_STATE_PATH: path.resolve('mister-datos.json') }), /fuera/);
});

test('reads a session from an external path containing spaces without copying it into the project', async t => {
  const root = await temp(t);
  const file = path.join(root, 'iCloud Drive', 'Mister', 'mister.json');
  await mkdir(path.dirname(file), { recursive: true });
  const state = { cookies: [{ domain: 'mister.mundodeportivo.com', name: 'fake-test', value: 'fake-test-value' }], origins: [] };
  await writeFile(file, json(state));
  assert.deepEqual(await loadSession({ MISTER_STORAGE_STATE_PATH: file }), state);
});

test('GitHub secret takes precedence over the local path; invalid secrets do not fall back', async () => {
  const state = { cookies: [{ name: 'fake-test', value: 'fake-test-value' }], origins: [] };
  assert.deepEqual(await loadSession({ MISTER_STORAGE_STATE: json(state), MISTER_STORAGE_STATE_PATH: '/missing/file' }), state);
  await assert.rejects(loadSession({ MISTER_STORAGE_STATE: '{invalid', MISTER_STORAGE_STATE_PATH: '/missing/file' }), /sesión válida/);
});

 test('reads points when adjacent HTML elements produce 49PTS without a space', () => {
  const compact = links.map(link => ({ ...link, text: link.text.replace(' PTS', 'PTS') }));
  assert.deepEqual(standingsRows(compact, config), points);
});

test('reads relative participant URLs as served by Mister', () => {
  const relative = links.map(link => ({ ...link, href: link.href.replace('https://mister.mundodeportivo.com/', '') }));
  assert.deepEqual(standingsRows(relative, config), points);
});
