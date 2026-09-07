# Mister Fantasy JK · 2026-27

Panel estático para diez participantes. Jornadas 1–4 cargadas desde las capturas de Mister; jornadas 5–38 pendientes (`null` significa pendiente; `0` es una puntuación real). Jimmy se ha retirado y se ha eliminado la competición de invierno.

## Reglas y bote

- Sprints: J1–5, J6–10, J11–15, J16–20, J21–25, J26–30, J31–35.
- Los cuatro últimos de cada sprint aportan 5 €: 7 × 4 × 5 = 140 €.
- General: 1.º gana 55 €, 2.º gana 30 €, 3.º no paga; 4.º y 5.º aportan 10 €; 6.º–8.º aportan 15 €; 9.º y 10.º aportan 20 €.
- Aportaciones de la general: 2 × 10 + 3 × 15 + 2 × 20 = 105 €.
- Recaudación prevista: 140 + 105 = 245 €.
- Premios: 55 + 30 = 85 €.
- Bote común final previsto: 245 − 85 = **160 €**.

No es un registro de cobros realizados. Las jornadas 36–38 cuentan únicamente para la general. Un sprint solo se completa cuando existen datos de todos sus jugadores en todas sus jornadas. Si hay empate en el corte de pagos, queda pendiente el desempate entre amigos; el panel no inventa un criterio.

## Uso

Publicar `index.html` y `mister-datos.json` juntos en el alojamiento existente, o ejecutar `python3 -m http.server 8000` en esta carpeta y abrir http://localhost:8000/.

También se puede abrir `index.html` con doble clic y seleccionar `mister-datos.json` cuando el navegador lo solicite. Editar los puntos en el JSON, manteniendo el identificador de temporada `2026-27`. El antiguo archivo de pagos ya no se utiliza.

## Automatización: investigación del 7 de septiembre de 2026

No he localizado documentación oficial de una API pública o exportación de resultados para ligas privadas en la web y el centro de ayuda consultados:

- https://www.playmister.com/es/
- https://help.playmister.com/

Existe un proyecto independiente, MisterFantasyExcel, que utiliza una sesión de Chrome para obtener clasificación y eventos de una liga privada:

- https://github.com/JoaquinBeas/MisterFantasyExcel
- https://github.com/JoaquinBeas/MisterFantasyExcel/blob/master/mister_client.py

El código realiza peticiones autenticadas a `/standings` y `/ajax/feed`. Es evidencia de una posible integración mediante las llamadas internas de la web; no constituye una API oficial ni prueba de que los puntos históricos por jornada se puedan recuperar actualmente.

La siguiente fase sería comprobar, con la sesión iniciada del usuario, cómo carga Mister la clasificación de una jornada y adaptar un importador que genere el JSON de este panel. Debe verificar temporada, liga, participantes y jornadas completas, permitir actualizar correcciones de puntos y guardar los datos de acceso fuera del panel y de cualquier alojamiento público. Alternativamente, se puede leer la clasificación visible con automatización de navegador.

No se ha accedido a la cuenta de Mister, las jornadas 1–4 se han transcrito manualmente desde capturas de 2026-27 y no se ha activado ninguna sincronización. La investigación solicitada queda separada de una futura implementación.

## Nombres en las capturas

Unai corresponde a Zarra; Markel a Mayo; Uriarte a Iñaki. Las equivalencias de los diez participantes se guardan en el campo `misterName` de cada jugador.
