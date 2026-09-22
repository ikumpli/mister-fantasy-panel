import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { BASE_URL, check, readJson, atomicWrite, json } from './sync-core.mjs';
import { getSessionFile, openBrowser, selectLeague, keepMisterSession, printFailure } from './mister-client.mjs';

async function main() {
  check(stdin.isTTY, 'Ejecuta este asistente en tu terminal, no en GitHub Actions.');
  const config = await readJson('mister-sync.config.json');
  const sessionFile = getSessionFile();
  const prompt = createInterface({ input: stdin, output: stdout });
  let browser;
  try {
    console.log(`Abre una sesión independiente de Mister para ${config.leagueName}.`);
    console.log(`Al confirmar, se guardará acceso a tu cuenta en ${sessionFile}.`);
    console.log('Si esa carpeta está en iCloud Drive, se sincronizará con iCloud y tus dispositivos.');
    console.log('No se sube nada a GitHub durante este paso. La ruta predeterminada queda excluida de Git.');
    const opened = await openBrowser(undefined, false);
    browser = opened.browser;
    await opened.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await prompt.question('Inicia sesión en la ventana abierta. Después, vuelve aquí y pulsa Enter: ');
    try {
      await selectLeague(opened.page, config);
    } catch (error) {
      printFailure(error);
      await prompt.question('El navegador sigue abierto para revisar la página. Pulsa Enter cuando quieras cerrarlo: ');
      return;
    }
    const answer = await prompt.question('Se encontraron los diez participantes. ¿Guardar la sesión en la ubicación indicada? [s/N] ');
    check(answer.trim().toLowerCase() === 's', 'No se guardó la sesión.');
    const state = keepMisterSession(await opened.context.storageState({ indexedDB: true }));
    check(state.cookies.length > 0, 'No se encontraron cookies de Mister.');
    check(Buffer.byteLength(json(state)) < 48000, 'La sesión supera el tamaño permitido para un secreto de GitHub.');
    await atomicWrite(sessionFile, json(state));
    console.log('Sesión guardada. Ahora ejecuta: npm run mister:preview -- --round 4');
  } finally {
    prompt.close();
    await browser?.close();
  }
}
main().catch(printFailure);
