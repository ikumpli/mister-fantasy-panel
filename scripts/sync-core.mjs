import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BASE_URL = 'https://mister.mundodeportivo.com';
export class SyncError extends Error {}
export function check(condition, message) {
  if (!condition) throw new SyncError(message);
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function atomicWrite(file, value, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, value, { mode, flag: 'wx' });
  await rename(temp, file);
}

export function validatePanel(panel, config) {
  check(panel.season === config.season && panel.seasonJ === config.seasonJ,
    'La temporada del panel no coincide con la configuración.');
  check(Array.isArray(panel.players) && panel.players.length === 10, 'Se esperan diez participantes.');
  const ids = panel.players.map(p => p.id);
  check(new Set(ids).size === ids.length && ids.every(id => /^\d+$/.test(config.managerIds[id] || '')) &&
    Object.keys(config.managerIds).length === ids.length && new Set(Object.values(config.managerIds)).size === ids.length,
    'La correspondencia de participantes no es válida.');
  check(Object.keys(panel.points).length === ids.length, 'Hay participantes inesperados en los puntos.');
  for (const id of ids) {
    check(Array.isArray(panel.points[id]) && panel.points[id].length === config.seasonJ &&
      panel.points[id].every(p => p === null || Number.isSafeInteger(p)), `Puntos inválidos para ${id}.`);
  }
}

export function roundLinks(links, config) {
  const found = new Map();
  for (const link of links) {
    const label = link.text.trim().match(/^J\s*(\d+)$/i);
    if (!label) continue;
    const url = new URL(link.href, BASE_URL);
    if (url.origin !== BASE_URL || url.pathname !== '/standings') continue;
    const round = Number(label[1]);
    const id = url.searchParams.get('gw');
    check(round >= 1 && round <= config.seasonJ && /^\d+$/.test(id || ''), 'Jornada inválida.');
    check(!found.has(round) || found.get(round) === id, 'Hay IDs contradictorios para una jornada.');
    found.set(round, id);
  }
  check(found.size > 0 && new Set(found.values()).size === found.size, 'No se pudo leer el calendario.');
  // The pinned J1/J4 IDs were observed in this league. Never guess a new season from today's date.
  for (const [round, id] of Object.entries(config.seasonAnchors)) {
    check(found.get(Number(round)) === id, 'El calendario no coincide con la temporada configurada.');
  }
  return [...found].sort(([a], [b]) => a - b).map(([round, id]) => ({ round, id }));
}

export function standingsRows(links, config) {
  const rows = new Map();
  for (const link of links) {
    const url = new URL(link.href, BASE_URL);
    const match = url.pathname.match(/^\/users\/(\d+)(?:\/|$)/);
    if (url.origin !== BASE_URL || !match || !/PTS?\b/i.test(link.text)) continue;
    const points = [...link.text.matchAll(/(?:^|\s)(-?\d+(?:\.\d{3})*)\s*PTS?\b/gi)];
    check(points.length === 1, 'Una fila tiene una puntuación ausente o ambigua.');
    const value = Number(points[0][1].replaceAll('.', ''));
    check(Number.isSafeInteger(value) && !rows.has(match[1]), 'Puntos inválidos o participante duplicado.');
    rows.set(match[1], value);
  }
  const expected = Object.values(config.managerIds);
  check(rows.size === expected.length && expected.every(id => rows.has(id)),
    'La clasificación no contiene exactamente los diez participantes de Juan hacker.');
  return Object.fromEntries(rows);
}

export function validateHistory(data, config) {
  check(String(data?.userInfo?.id_community) === config.leagueId,
    'Mister devolvió un participante de otra liga. No se guardó ningún cambio.');
  check(data.userGameWeeks && typeof data.userGameWeeks === 'object' && !Array.isArray(data.userGameWeeks),
    'No se encontró el historial de puntos del participante.');
  return data.userGameWeeks;
}

function statusName(value) {
  if (value && typeof value === 'object') value = value.internalStatus ?? value.status ?? value.name ?? value.slug;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function roundState(data, config) {
  const name = statusName(data?.gameweekStatus);
  const closed = ['closed', 'finished', 'played'].includes(name);
  const pending = ['ongoing', 'playing', 'live', 'in_progress', 'unstarted', 'pending', 'scheduled'].includes(name);
  check(closed || pending, 'Mister no devolvió un estado de jornada reconocido; se cancela la actualización.');
  if (!closed) return 'pending';
  // A closed round may still contain postponed games. Do not settle sprint payments yet.
  check(Array.isArray(data.games) && data.games.length === config.expectedMatchesPerRound,
    'No se pudieron verificar todos los partidos de una jornada cerrada.');
  const ids = data.games.map(g => String(g.id ?? g.id_match ?? ''));
  check(ids.every(id => /^\d+$/.test(id)) && new Set(ids).size === ids.length, 'Partidos ausentes o duplicados.');
  const states = data.games.map(g => statusName(g.status));
  const known = ['played', 'finished', 'closed', 'fixture', 'scheduled', 'postponed', 'suspended', 'ongoing', 'playing', 'live', 'in_progress'];
  check(states.every(s => known.includes(s)), 'Estado de partido desconocido; se cancela la actualización.');
  return states.every(s => ['played', 'finished', 'closed'].includes(s)) ? 'closed' : 'pending';
}

export function mergeRounds(panel, config, rounds, now = new Date().toISOString()) {
  validatePanel(panel, config);
  check(Array.isArray(rounds) && rounds.length > 0, 'No se han comprobado jornadas.');
  const output = structuredClone(panel);
  const changes = [];
  const seen = new Set();
  const statuses = { ...(panel.sync?.rounds || {}) };
  for (const item of rounds) {
    check(Number.isInteger(item.round) && item.round >= 1 && item.round <= config.seasonJ && !seen.has(item.round),
      'Jornada duplicada o fuera de la temporada.');
    seen.add(item.round);
    check(item.state === 'closed' || item.state === 'pending', 'Estado de jornada inválido.');
    statuses[item.round] = { gameweekId: item.id, status: item.state };
    if (item.state !== 'closed') continue; // Retain last known scores when a round reopens.
    const expected = Object.values(config.managerIds);
    check(item.points && Object.keys(item.points).length === expected.length &&
      expected.every(id => Number.isSafeInteger(item.points[id])), 'Faltan puntuaciones válidas.');
    for (const player of panel.players) {
      const before = panel.points[player.id][item.round - 1];
      const after = item.points[config.managerIds[player.id]];
      if (before !== after) changes.push({ player: player.name, round: item.round, before, after });
      output.points[player.id][item.round - 1] = after;
    }
  }
  output.sync = { source: 'Mister Fantasy', lastSuccessfulSync: now, rounds: statuses };
  validatePanel(output, config);
  return { output, changes };
}
