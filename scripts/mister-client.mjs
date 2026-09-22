import { chromium } from 'playwright';
import path from 'node:path';
import { BASE_URL, SyncError, check, readJson, roundLinks, standingsRows, validateHistory, roundState } from './sync-core.mjs';

export const SESSION_FILE = 'playwright/.auth/mister.json';
export function getSessionFile(env = process.env) {
  if (env.MISTER_STORAGE_STATE_PATH === undefined) return SESSION_FILE;
  const file = env.MISTER_STORAGE_STATE_PATH.trim();
  check(file.length > 0 && path.isAbsolute(file),
    'MISTER_STORAGE_STATE_PATH debe ser una ruta absoluta, fuera del repositorio.');
  const resolved = path.resolve(file);
  const relative = path.relative(process.cwd(), resolved);
  check(relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative),
    'La ruta personalizada de sesión debe estar fuera del repositorio.');
  return resolved;
}
export async function loadSession(env = process.env) {
  let state;
  try {
    state = env.MISTER_STORAGE_STATE
      ? JSON.parse(env.MISTER_STORAGE_STATE)
      : await readJson(getSessionFile(env));
  } catch {
    throw new SyncError('Falta una sesión válida. Ejecuta npm run mister:login o renueva el secreto MISTER_STORAGE_STATE.');
  }
  check(Array.isArray(state.cookies) && state.cookies.length > 0 && Array.isArray(state.origins),
    'El archivo de sesión no tiene el formato esperado.');
  return state;
}

export async function openBrowser(storageState, headless = true) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(45000);
  const page = await context.newPage();
  return { browser, context, page };
}

export function keepMisterSession(state) {
  const host = new URL(BASE_URL).hostname;
  return {
    cookies: state.cookies.filter(cookie => {
      const domain = cookie.domain.replace(/^\./, '');
      return host === domain || host.endsWith(`.${domain}`);
    }),
    origins: state.origins.filter(origin => origin.origin === BASE_URL)
  };
}

export async function openStandings(page, config, roundId) {
  const url = new URL('/standings', BASE_URL);
  if (roundId) url.searchParams.set('gw', roundId);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  const current = new URL(page.url());
  check(response?.ok() && current.origin === BASE_URL && current.pathname === '/standings' &&
    current.searchParams.get('gw') === (roundId || null),
    'Mister no abrió la clasificación solicitada. La sesión puede haber caducado.');
  try {
    await page.locator(':is(a[href^="users/"], a[href*="/users/"]):visible').filter({ hasText: /PTS?\b/i }).first().waitFor({ state: 'visible' });
  } catch (error) {
    // Only counts and fixed labels: never dump page HTML, URLs, tokens or storage.
    const counts = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href]')];
      const visible = links.filter(a => a.getClientRects().length > 0);
      return {
        visibleLinks: visible.length,
        absoluteUserPaths: visible.filter(a => (a.getAttribute('href') || '').includes('/users/')).length,
        relativeUserPaths: visible.filter(a => (a.getAttribute('href') || '').startsWith('users/')).length,
        userQueryLinks: visible.filter(a => /[?&]id_user=/.test(a.getAttribute('href') || '')).length,
        userLinksWithPoints: visible.filter(a => (a.getAttribute('href') || '').includes('users') && /PTS?\b/i.test(a.textContent)).length,
        pointsVisible: /PTS?\b/i.test(document.body.innerText),
        standingsPage: location.pathname === '/standings'
      };
    }).catch(() => ({ pageUnavailable: true }));
    const kind = error?.name === 'TimeoutError' ? 'timeout' : 'selector-or-page-error';
    throw new SyncError(`No se pudo leer la clasificación. Diagnóstico: ${kind} ${JSON.stringify(counts)}`);
  }
  const links = await page.locator('a[href^="users/"], a[href*="/users/"]').evaluateAll(nodes => nodes
    .filter(node => node.getClientRects().length > 0)
    .map(node => ({ href: node.href, text: node.innerText.replace(/\s+/g, ' ').trim() })));
  return standingsRows(links, config);
}

export async function selectLeague(page, config) {
  await page.goto(`${BASE_URL}/action/change?id_community=${encodeURIComponent(config.leagueId)}`,
    { waitUntil: 'domcontentloaded' });
  await openStandings(page, config);
}

async function api(page, endpoint, form) {
  // The session's internal token stays in the browser. Never print requests, responses or headers.
  const result = await page.evaluate(async ({ endpoint, form }) => {
    const auth = window._FG_cfg?.auth;
    if (!auth) return { error: true };
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30000),
        headers: { 'X-Auth': auth, 'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(form).toString()
      });
      if (!response.ok || response.redirected) return { error: true };
      const body = await response.json();
      return body.data && typeof body.data === 'object' ? { data: body.data } : { error: true };
    } catch { return { error: true }; }
  }, { endpoint, form });
  check(!result.error, 'La consulta interna de Mister falló. Renueva la sesión si ha caducado.');
  return result.data;
}

export async function collectRounds(page, config, requestedRound) {
  await selectLeague(page, config);
  const links = await page.locator('a[href*="standings?gw="]').evaluateAll(nodes => nodes
    .map(node => ({ href: node.href, text: node.textContent.trim() })));
  const available = roundLinks(links, config);
  const selected = requestedRound ? available.filter(r => r.round === requestedRound) : available;
  check(selected.length > 0, 'La jornada solicitada no aparece en Mister.');
  const histories = {};
  // Besides points, this endpoint supplies the actual league ID for every manager.
  for (const id of Object.values(config.managerIds)) {
    const data = await api(page, '/ajax/sw/users', { post: 'users', id, comments: '0' });
    histories[id] = validateHistory(data, config);
  }
  const rounds = [];
  for (const round of selected) {
    const metadata = await api(page, '/ajax/sw/gameweek', { post: 'gameweek', id: round.id, comments: '0' });
    const state = roundState(metadata, config);
    if (state === 'pending') {
      rounds.push({ ...round, state });
      continue;
    }
    const points = await openStandings(page, config, round.id);
    for (const id of Object.values(config.managerIds)) {
      const history = histories[id][round.id];
      const value = typeof history?.points === 'string' && /^-?\d+$/.test(history.points)
        ? Number(history.points) : history?.points;
      check(String(history?.id_gameweek) === round.id && Number.isSafeInteger(value) && value === points[id],
        `J${round.round}: la tabla y el historial no coinciden. Reintenta cuando termine la actualización de Mister.`);
    }
    rounds.push({ ...round, state, points });
  }
  return rounds;
}

export function printFailure(error) {
  console.error(error instanceof SyncError ? error.message :
    'No se completó la operación. Comprueba Node 22+, npm ci, npm run browser:install y la conexión a Internet.');
  console.error('No se publicaron datos. No compartas archivos de sesión ni contraseñas en los logs.');
  process.exitCode = 1;
}
