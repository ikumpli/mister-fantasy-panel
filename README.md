# Mister Fantasy JK · 2026-27

Panel estático para diez participantes. Jornadas 1–4 cargadas desde las capturas de Mister; jornadas 5–38 pendientes (`null` significa pendiente; `0` es una puntuación real). Jimmy se ha retirado y se ha eliminado la competición de invierno.

## Reglas y bote

- Sprints: J1–5, J6–10, J11–15, J16–20, J21–25, J26–30, J31–35.
- Los cuatro últimos de cada sprint aportan 5 €: 7 × 4 × 5 = 140 €.
- General: 1.º gana 40 €, 2.º gana 20 €, 3.º no paga; 4.º y 5.º aportan 10 €; 6.º–8.º aportan 15 €; 9.º y 10.º aportan 20 €.
- Aportaciones de la general: 2 × 10 + 3 × 15 + 2 × 20 = 105 €.
- Recaudación prevista: 140 + 105 = 245 €.
- Premios: 40 + 20 = 60 €.
- Bote común final previsto: 245 − 60 = **185 €**.

No es un registro de cobros realizados. Las jornadas 36–38 cuentan únicamente para la general. Un sprint solo se completa cuando existen datos de todos sus jugadores en todas sus jornadas. En la general, los empates se ordenan alfabéticamente, se indican con «Empate» y mantienen el importe de cada posición consecutiva. Si hay empate en el corte de pagos de un sprint, queda pendiente el desempate entre amigos; el panel no inventa un criterio.

## Uso

Publicar `index.html` y `mister-datos.json` juntos en el alojamiento existente, o ejecutar `python3 -m http.server 8000` en esta carpeta y abrir http://localhost:8000/.

También se puede abrir `index.html` con doble clic y seleccionar `mister-datos.json` cuando el navegador lo solicite. Editar los puntos en el JSON, manteniendo el identificador de temporada `2026-27`. El antiguo archivo de pagos ya no se utiliza.

## Sincronización automática

El importador de Node.js y Playwright lee la liga **Juan hacker** y prepara los puntos en una vista previa antes de publicarlos. El flujo de GitHub Actions puede ejecutarlo cada día y desplegar el JSON validado en GitHub Pages.

**La sincronización está desactivada por defecto y aún requiere una prueba autenticada.** No hay contraseñas ni sesiones en el repositorio. La sesión se crea en un navegador independiente, se guarda en una carpeta privada excluida de Git y, después de verificarla, se puede subir como secreto de GitHub Actions.

Sigue [SETUP.md](SETUP.md) para iniciar sesión, revisar una jornada, probar el proceso completo y activar la programación. La web muestra la fecha de la última sincronización. Las jornadas reabiertas o con partidos aplazados mantienen sus puntos anteriores y sus sprints quedan provisionales.

```sh
npm ci
npm run browser:install
npm run mister:login
npm run mister:preview -- --round 4
npm test
```

La investigación y la prueba visual del 22 de septiembre confirmaron los diez participantes y diferencias entre la J4 visible y el JSON manual. Los puntos del archivo original no se han sustituido. El importador usa interfaces internas de Mister y debe detenerse si su formato cambia o la sesión caduca.

## Nombres en las capturas

Unai corresponde a Zarra; Markel a Mayo; Uriarte a Iñaki. Las equivalencias de los diez participantes se guardan en el campo `misterName` de cada jugador.
