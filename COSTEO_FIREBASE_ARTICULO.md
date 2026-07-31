# Costeo real para operar ExpBuilder en Firebase/Cloud

Fecha de consulta: 2026-05-23.

Este documento estima los costos reales de operar el proyecto como servicio gratuito en la nube, sin aplicar limites gratuitos. En todos los calculos se usa el precio unitario de pago desde la primera unidad consumida. Los precios estan en USD y asumen, salvo que se indique otra cosa, region `us-central1` porque las funciones actuales usan `us-central1` en produccion.

Estos numeros son un modelo de costo, no una garantia de factura exacta. La factura real depende de duracion efectiva de funciones, tamano de payloads, logs, retries, egress, latencia de proveedores externos, experimentos atascados, custom code y arquitectura final de despliegue. Para cerrar una cifra operativa final conviene medir un piloto en staging con payloads reales.

## Resumen ejecutivo

El costo por guardar datos de 500 participantes es muy bajo si se mantiene el flujo actual recomendado: `IndexedDB` activado y `batchSize = 0`. En ese modo, los datos de cada participante no se guardan trial-by-trial en Firestore: se acumulan en el navegador y se envian una vez al final a `apiDataComplete`, que escribe el CSV en Google Drive, Dropbox u OSF del investigador. Si el investigador activa batching (`batchSize > 0`) o fuerza envios desde codigo/trials, el costo debe calcularse por numero real de batch sends, no solo por numero de participantes.

El costo que si puede dominar no es Firestore por "documentos", sino:

- Hosting del builder y transferencia del bundle web.
- El servidor Express acoplado al cliente (`VITE_API_URL`), que hoy usa LowDB, archivos locales y Socket.IO.
- Funciones que transfieren archivos grandes de participantes hacia proveedores externos.
- Operar un backend con WebSockets o instancias siempre activas.
- Logs, builds y Artifact Registry si se despliega con App Hosting o Cloud Run.

El articulo de DataPipe si publica una cifra marginal: aproximadamente 0.01 USD por cada 500 archivos de datos procesados, segun costos cloud al momento de escribir el paper. La FAQ actual complementa esto diciendo que DataPipe es gratis para usuarios, corre en Firebase y su consumo actual es menor a 1 USD/mes. La comparacion justa para el articulo debe distinguir costo marginal de ingestion contra alcance funcional: DataPipe es un puente liviano hacia OSF; este proyecto ademas incluye builder visual, OAuth multi-proveedor, publicacion en GitHub Pages, dashboard, subida de media, subida de archivos de participantes y configuracion de experimentos.

## Alcance real del proyecto

### Backend Firebase actual

Funciones exportadas desde `functions/index.js`:

- `apiData`: endpoint publico/administrativo para crear sesion, guardar batches/trials temporales, listar, descargar, borrar y finalizar sesiones.
- `apiDataComplete`: endpoint del flujo barato por defecto. Recibe todos los trials al final y escribe directo al storage externo.
- `finalizeDisconnectedSessions`: trigger de Realtime Database sobre `/sessions/{experimentID}/{sessionId}`.
- `processSessionTimeout`: task queue function respaldada por Cloud Tasks para expirar sesiones desconectadas de forma durable.
- `uploadParticipantFile`: endpoint publico para subir archivos de participantes a Drive, Dropbox u OSF; configurado con `memory: "512MiB"`.
- `publishExperiment`: endpoint autenticado para publicar el experimento en GitHub y habilitar GitHub Pages.
- `apiDeleteExperiment`, `apiCondition`, callbacks OAuth de Google Drive, Dropbox, GitHub y OSF, `osfManage`, `createOAuthStateEndpoint`.

Servicios Firebase usados:

- Cloud Run functions / Cloud Functions for Firebase v2.
- Cloud Tasks via Firebase task queue functions para timeouts diferidos de sesiones desconectadas.
- Firestore para experimentos, usuarios, tokens OAuth, metadatos de sesiones, archivos de participantes y datos temporales cuando hay batch/trial-by-trial.
- Realtime Database para estado vivo de sesiones y reconexion.
- Firebase Authentication para cuentas de investigadores en el builder.
- Firebase Hosting o App Hosting para servir el cliente/builder si se publica en Firebase.

### Cliente acoplado

Los paths indicados por el usuario confirman que la app no es puramente estatica:

- `client/src/pages/Settings`: usa Firebase Auth, Firestore directo y funciones HTTP para OAuth (`googleDriveOAuthCallback`, `dropboxOAuthCallback`, `githubOAuthCallback`, `osfOAuthCallback`, `osfManage`, `createOAuthStateEndpoint`). Tambien llama al servidor local/remoto `VITE_API_URL` para export/import/reset/load.
- `client/src/pages/ExperimentPanel`: llama a `VITE_API_URL` para `appearance-settings`, `tunnel-settings` y `session-name-config`, ademas de Firestore directo en settings del experimento.
- `client/src/pages/ExperimentBuilder/components/Timeline/PublishExperiment.ts`: llama a `VITE_API_URL/api/publish-experiment/:experimentID`; ese servidor arma el HTML, lee archivos locales y despues llama a `publishExperiment` en Firebase.

### Servidor Express acoplado

El servidor en `JsPsych/server` tiene implicaciones de costo separadas:

- `api.js` levanta Express + Socket.IO en puerto 3000.
- Usa LowDB (`server/utils/db.js`) sobre `database/db.json`.
- Escribe archivos locales: uploads, plugins, HTML generado, previews, exports/imports.
- Sirve `dist`, plugins y endpoints de experimentos, trials, configs, resultados, files, tunnel y agent.

Si se sube tal cual a Cloud Run/App Hosting, se debe resolver persistencia. En serverless, el filesystem del contenedor es efimero. Para produccion hay dos caminos:

1. Migrar LowDB y archivos locales a Firestore/Cloud Storage/Firebase Storage. Esto reduce necesidad de una instancia viva, pero agrega costos por reads/writes/storage.
2. Ejecutar el servidor como contenedor en Cloud Run con almacenamiento persistente externo. Esto agrega costo de Cloud Run, egress, logs y posiblemente una instancia activa para WebSockets.

## Precios base usados

No se descuentan free tiers. Se aplican los precios unitarios de pago desde la primera unidad.

| Componente | Precio usado | Fuente |
| --- | ---: | --- |
| Firestore Standard, reads | 0.03 USD / 100,000 documentos | https://cloud.google.com/firestore/pricing |
| Firestore Standard, writes | 0.09 USD / 100,000 documentos | https://cloud.google.com/firestore/pricing |
| Firestore Standard, deletes | 0.01 USD / 100,000 documentos | https://cloud.google.com/firestore/pricing |
| Firestore storage | aprox. 0.15 USD / GiB-mes (`0.000205479 USD/GiB-hora * 730h`) | https://cloud.google.com/firestore/pricing |
| Realtime Database storage | 5.00 USD / GB | https://firebase.google.com/pricing |
| Realtime Database download | 1.00 USD / GB | https://firebase.google.com/pricing |
| Cloud Tasks operations | 0.40 USD / 1,000,000 operaciones | https://cloud.google.com/tasks/pricing |
| Cloud Functions invocations | 0.40 USD / 1,000,000 invocaciones | https://firebase.google.com/pricing |
| Cloud Functions outbound networking | 0.12 USD / GB | https://firebase.google.com/pricing |
| Cloud Functions build minutes | 0.003 USD / minuto | https://firebase.google.com/pricing |
| Cloud Run request CPU activo | 0.000024 USD / vCPU-segundo | https://cloud.google.com/run/pricing |
| Cloud Run memoria activa | 0.0000025 USD / GiB-segundo | https://cloud.google.com/run/pricing |
| Cloud Run requests | 0.40 USD / 1,000,000 requests | https://cloud.google.com/run/pricing |
| Firebase Storage, bucket legacy `*.appspot.com`, storage | 0.026 USD / GB | https://firebase.google.com/pricing |
| Firebase Storage, bucket legacy `*.appspot.com`, download | 0.12 USD / GB | https://firebase.google.com/pricing |
| Firebase Storage, bucket legacy `*.appspot.com`, upload ops | 0.05 USD / 10,000 ops | https://firebase.google.com/pricing |
| Firebase Storage, bucket legacy `*.appspot.com`, download ops | 0.004 USD / 10,000 ops | https://firebase.google.com/pricing |
| Firebase Hosting storage | 0.026 USD / GB | https://firebase.google.com/pricing |
| Firebase Hosting transfer | 0.15 USD / GB | https://firebase.google.com/pricing |
| App Hosting cached bandwidth | 0.15 USD / GiB | https://firebase.google.com/docs/app-hosting/costs |
| App Hosting uncached bandwidth | 0.20 USD / GiB | https://firebase.google.com/docs/app-hosting/costs |
| App Hosting build minutes | 0.006 USD / build-minute | https://firebase.google.com/docs/app-hosting/costs |
| App Hosting Artifact Registry storage | 0.10 USD / GB-mes | https://firebase.google.com/docs/app-hosting/costs |
| Cloud Logging storage | 0.50 USD / GiB | https://firebase.google.com/docs/app-hosting/costs |
| Firebase Auth / Identity Platform Tier 1 | 0.0055 USD / MAU en el primer tramo pagado | https://cloud.google.com/identity-platform/pricing |
| Identity Platform OIDC/SAML | 0.015 USD / MAU en el tramo pagado | https://cloud.google.com/identity-platform/pricing |

Notas:

- Firestore Enterprise tiene otra metrica de unidades y puede duplicar aproximadamente el costo de operaciones respecto al ejemplo Standard. Los calculos de este documento usan Firestore Standard regional.
- Firebase Hosting clasico aplica mejor para el SPA estatico. App Hosting aplica si se mueve parte de la app a framework backend/SSR o a backend gestionado por App Hosting.
- Cloud Functions v2 se factura sobre la infraestructura de Cloud Run para CPU/memoria; por eso se usan precios Cloud Run para computo.
- No se incluyen impuestos, soporte, dominios, cuotas de terceros, ni descuentos por committed use.

## Modelo de consumo

Variables:

- `P`: participantes por mes.
- `T`: trials por participante.
- `B`: batch size configurado. Si `B = 0`, el flujo manda todo al final.
- `K`: envios de batch por participante. En el flujo automatico con `B > 0`, `K = ceil(T / B)`. Si custom code o un trial llama `sendBatchConcatenated(...)`, `K` debe incluir esos envios extra. En trial-by-trial, `K = T`.
- `F`: archivos de participante por sesion.
- `F_MB`: MB promedio por archivo.
- `U`: investigadores activos por mes.
- `V`: visitas o cargas completas del builder por mes.
- `A`: requests mensuales al servidor Express (`VITE_API_URL`).
- `M`: MB de media subida por experimento al publicar.

Formulas base:

```text
Firestore reads  = reads * 0.03 / 100000
Firestore writes = writes * 0.09 / 100000
Firestore deletes = deletes * 0.01 / 100000

Function invocations = invocations * 0.40 / 1000000
Function compute = seconds * vCPU * 0.000024 + seconds * GiB_mem * 0.0000025
Function outbound = GB_to_external_internet * 0.12

Firebase Hosting transfer = GB_served * 0.15
Realtime Database download = GB_downloaded * 1.00
Realtime Database storage = GB_stored * 5.00
```

Regla practica para batching:

```text
si batchSize = 0:
  batch_docs = 0
  se usa apiDataComplete al final

si batchSize > 0:
  K = ceil(trials_por_participante / batchSize)
  batch_docs = participantes * K
  finalizeSession lee K docs por participante y luego los borra

si se manda trial por trial:
  K = trials_por_participante
  batch_docs = participantes * trials_por_participante
```

El codigo publico expone `BATCH_CONFIG` y `sendBatchConcatenated(trials, batchNumber)` al scope de ejecucion del experimento. Por eso el costo real debe modelarse como eventos de envio, no solo como una configuracion global fija.

## Flujo de participante publicado

### Modo recomendado: IndexedDB ON + batchSize = 0

Este es el modo mas barato y deberia ser el default para el articulo.

Por participante completado:

- 1 llamada a `apiData` para crear/registrar sesion y asignar numero/condicion.
- 1 llamada a `apiDataComplete` al finalizar, con todos los trials.
- Aproximadamente 3 a 4 escrituras a Realtime Database: iniciar sesion, primer estado in-progress, final completed/disconnected y marca posterior de procesamiento.
- El trigger `finalizeDisconnectedSessions` se invoca por esos cambios de RTDB; en el caso feliz no reconstruye datos temporales porque `needsFinalization=false`, pero puede escribir metadata/enlace de archivo.
- Firestore escribe metadatos y contadores; no guarda trials temporales.
- El CSV final se manda al storage externo del investigador: Drive, Dropbox u OSF.

Estimacion conservadora por participante. La cifra incluye el trigger de RTDB y el write posterior con `finalizationProcessed`; los numeros exactos pueden moverse un poco por `sessionName`, refresh de token OAuth o retries de proveedor externo.

| Recurso | Cantidad aproximada |
| --- | ---: |
| Function invocations | 5 a 6 |
| Firestore reads | 5 a 8 |
| Firestore writes | 5 a 8 |
| Realtime Database writes | 3 a 4 |
| Firestore trial documents | 0 |

Costo para 500 participantes:

| Concepto | Calculo | Costo |
| --- | ---: | ---: |
| Invocaciones Functions | 3,000 * 0.40 / 1,000,000 | 0.0012 USD |
| Compute Functions, si cada invocacion durara 1s a 1 vCPU/256MiB | 3,000s * (0.000024 + 0.256 * 0.0000025) | 0.0739 USD |
| Firestore ops, 8 reads + 8 writes por participante | 4,000 reads + 4,000 writes | 0.0048 USD |
| RTDB storage/download | Payloads pequenos | < 0.01 USD normalmente |
| Function outbound para CSVs pequenos | Depende de tamano; 500 * 200KB = 0.095GB | 0.0114 USD |

Total tecnico aproximado para datos de 500 sesiones, sin hosting del builder ni servidor Express siempre activo: alrededor de 0.10 USD en el caso normal con estas suposiciones conservadoras.

Este numero no significa que operar todo el producto cueste 0.10 USD/mes. Significa que la recoleccion de datos de 500 participantes, con el flujo barato, no es el centro del costo.

### Costo adicional por timeout durable con Cloud Tasks

El flujo feliz de un participante que termina el experimento no encola Cloud Tasks.
Cloud Tasks solo aparece cuando una sesion resumible queda desconectada y necesita
procesarse despues de `resumeExpiresAt`.

Cada sesion desconectada resumible agrega normalmente dos operaciones de Cloud
Tasks: una operacion para encolar y una operacion por el intento de entrega.
Sin considerar free tier:

```
costo_cloud_tasks = sesiones_desconectadas * 2 * 0.40 / 1,000,000
```

Para 500 participantes:

| Supuesto de desconexion | Sesiones desconectadas | Operaciones Cloud Tasks | Costo |
| --- | ---: | ---: | ---: |
| 5% | 25 | 50 | 0.00002 USD |
| 20% | 100 | 200 | 0.00008 USD |
| 100% peor caso | 500 | 1,000 | 0.0004 USD |

Este costo es marginal. Lo relevante no es el precio del task, sino que ahora si
se ejecuta el trabajo correcto: limpiar Firestore para IndexedDB expirado o
finalizar OSF sin IndexedDB tras la ventana de retoma.

### Sensibilidad por batchSize y numero de trials

La tabla siguiente mantiene `P = 500 participantes` y cambia `T` y `batchSize`. Uso 100, 300 y 1000 trials porque cubren experimentos cortos, pesados y casos atascados/largos. El costo aproximado incluye invocaciones, compute de funciones a 1s por invocacion con 1 vCPU/256MiB y operaciones Firestore temporales. No incluye hosting del builder, API Express, logs, ni egress del CSV final hacia Drive/Dropbox/OSF.

Importante: en `batchSize = 0`, el numero de operaciones casi no cambia con `T`, pero el payload enviado a `apiDataComplete`, el tiempo de conversion CSV y el egress hacia el proveedor externo si crecen con el numero/tamano de trials.

| Trials por participante | batchSize | Batch sends por participante | Batch/trial docs para 500 participantes | Invocaciones Functions aprox. | Backend ops+compute aprox. |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0 | 0 | 0 | 3,000 | 0.08 USD |
| 100 | 50 | 2 | 1,000 | 3,500 | 0.09 USD |
| 100 | 25 | 4 | 2,000 | 4,500 | 0.12 USD |
| 100 | 10 | 10 | 5,000 | 7,500 | 0.20 USD |
| 100 | 5 | 20 | 10,000 | 12,500 | 0.33 USD |
| 100 | 1 | 100 | 50,000 | 52,500 | 1.38 USD |
| 300 | 0 | 0 | 0 | 3,000 | 0.08 USD |
| 300 | 50 | 6 | 3,000 | 5,500 | 0.15 USD |
| 300 | 25 | 12 | 6,000 | 8,500 | 0.22 USD |
| 300 | 10 | 30 | 15,000 | 17,500 | 0.46 USD |
| 300 | 5 | 60 | 30,000 | 32,500 | 0.86 USD |
| 300 | 1 | 300 | 150,000 | 152,500 | 4.02 USD |
| 1000 | 0 | 0 | 0 | 3,000 | 0.08 USD |
| 1000 | 50 | 20 | 10,000 | 12,500 | 0.33 USD |
| 1000 | 25 | 40 | 20,000 | 22,500 | 0.59 USD |
| 1000 | 10 | 100 | 50,000 | 52,500 | 1.38 USD |
| 1000 | 5 | 200 | 100,000 | 102,500 | 2.70 USD |
| 1000 | 1 | 1,000 | 500,000 | 502,500 | 13.24 USD |

Lectura de la tabla:

- `batchSize = 0` es el flujo mas barato en operaciones, pero depende mas de que el navegador termine y pueda subir todo al final.
- `batchSize = 50` o `25` mantiene costo bajo y reduce riesgo de perder todo si el participante abandona.
- `batchSize = 10` fue el escenario original del documento: 100 trials, 10 batches por participante, 5,000 batch docs para 500 participantes. Con 1000 trials, el mismo `batchSize=10` sube a 100 batches por participante y 50,000 batch docs.
- `batchSize = 1` equivale a mandar cada trial por separado. Es el peor caso operativo: mas invocaciones, mas writes, mas deletes y mas oportunidades de fallo.
- Si un trial o custom code llama `sendBatchConcatenated(...)` adicionalmente, se suma a `K`; si lo hace cada trial, se debe costear como `batchSize = 1`.

### Batch mode: IndexedDB ON + batchSize > 0

Escenario original del calculo: si `batchSize=10` y cada participante tiene `T=100` trials:

- `ceil(T/B) = 10` batches por participante.
- Cada batch invoca `apiData` y escribe un documento temporal en Firestore.
- Al final, `finalizeSession` lee los batches, crea el CSV, escribe metadatos y borra datos temporales.

Costo para 500 participantes:

| Concepto | Calculo | Costo |
| --- | ---: | ---: |
| Invocaciones Functions | aprox. 7,500 | 0.0030 USD |
| Compute Functions, 1s a 1 vCPU/256MiB | 7,500s | 0.1848 USD |
| Firestore reads/writes/deletes temporales | aprox. 10 batches por participante + finalize | 0.0101 USD |

Total aproximado: 0.20 USD a 0.50 USD, dependiendo de duracion real de funciones y tamano de datos.

### Trial-by-trial: IndexedDB OFF o batchSize = 1

Si se mandan 100 trials por participante:

- Cada trial invoca `apiData`.
- Cada trial escribe un documento temporal en Firestore.
- Al final se lee, serializa, sube y borra.
- Con `IndexedDB ON + batchSize=1`, el payload es un batch de un solo trial; con `IndexedDB OFF`, el payload es el trial directo. Para costeo operativo son practicamente el mismo peor caso.

Costo para 500 participantes:

| Concepto | Calculo | Costo |
| --- | ---: | ---: |
| Invocaciones Functions | aprox. 52,500 | 0.0210 USD |
| Compute Functions, 1s a 1 vCPU/256MiB | 52,500s | 1.29 USD |
| Firestore reads/writes/deletes | aprox. 50,000 trials + finalize | 0.0822 USD |

Total aproximado: 1.40 USD a 3.00 USD si las funciones son I/O-bound y tardan cerca de 1s. Si cada request tarda menos, baja. Si hay latencia alta de Drive/Dropbox/OSF, sube.

Conclusion: incluso trial-by-trial no es caro en 500 participantes, pero aumenta latencia, puntos de fallo, Firestore churn y superficie de abuso.

## Archivos de participantes

`uploadParticipantFile` acepta hasta 20 archivos por request, 25MB por archivo y 100MB por request. Los archivos no se guardan en Firebase Storage; pasan por la funcion y se suben a Drive, Dropbox u OSF. Firebase cobra computo, invocacion, Firestore metadata y potencialmente outbound networking.

Ejemplo: 500 participantes, 1 archivo de 10MB por participante.

| Concepto | Calculo | Costo |
| --- | ---: | ---: |
| Invocaciones | 500 * 0.40 / 1,000,000 | 0.0002 USD |
| Outbound Functions a proveedor externo | 4.88GB * 0.12 | 0.5856 USD |
| Compute, 5s a 1 vCPU/512MiB por upload | 2,500s * (0.000024 + 0.5 * 0.0000025) | 0.0631 USD |
| Firestore metadata | 500 writes | 0.0005 USD |

Total aproximado: 0.65 USD para mover 5GB de archivos. Si los archivos son de video/audio y suben a 50GB, el egress seria aprox. 6 USD, mas computo.

## OAuth, publish y funciones administrativas

Estos costos escalan con investigadores, no con participantes:

- Cada conexion OAuth usa `createOAuthStateEndpoint` + callback del proveedor + reads/writes en Firestore.
- `publishExperiment` lee/crea/actualiza experimento en Firestore, obtiene token GitHub, sube `index.html`, media y habilita GitHub Pages.
- `apiDeleteExperiment` borra Firestore y subcolecciones.
- `apiCondition`, listar/descargar/borrar sesiones y renombrar sesiones son operaciones administrativas de bajo volumen.

El costo de Firebase por publish/OAuth es normalmente centavos o menos por miles de operaciones. El costo real esta mas en:

- tiempo de funcion esperando APIs externas;
- outbound hacia GitHub/Drive/Dropbox/OSF;
- limites/rate limits de terceros;
- storage/bandwidth desplazado a cuentas externas.

Ejemplo: 1,000 acciones administrativas al mes, 2s promedio a 1 vCPU/256MiB:

```text
Invocations: 1,000 * 0.40 / 1,000,000 = 0.0004 USD
Compute: 2,000s * (0.000024 + 0.256 * 0.0000025) = 0.0493 USD
Firestore: bajo, salvo borrados masivos.
```

## Hosting del builder

El `dist` actual del cliente pesa aproximadamente 23MB. En hosting estatico, el storage del bundle es irrelevante, pero la transferencia puede dominar.

Si cada visita descargara el bundle completo sin cache:

| Cargas completas del builder | Transferencia aprox. | Costo Firebase Hosting |
| ---: | ---: | ---: |
| 1,000 | 22.5GB | 3.37 USD |
| 10,000 | 224.6GB | 33.69 USD |
| 100,000 | 2,246GB | 336.91 USD |

En la practica, cache/CDN/browser cache reducen la transferencia por visita repetida, pero el mensaje para el articulo es claro: si el builder se usa mucho, el bundle y los assets pesan mas en la factura que Firestore.

Recomendacion: medir `dist`, configurar cache headers agresivos para assets versionados y reducir chunks pesados si se espera trafico alto.

## Servidor Express / API acoplada

Este es el mayor punto de decision arquitectonica. El cliente depende de `VITE_API_URL` para:

- cargar/crear/borrar experimentos;
- editar timeline/trials/configs;
- subir/listar/borrar media;
- generar HTML de run/preview;
- export/import/reset;
- publicar a Firebase/GitHub;
- settings del panel;
- resultados locales;
- Socket.IO.

### Si se despliega tal cual en Cloud Run

Supuesto: 1 vCPU, 512MiB, request-based billing.

| Escenario | Calculo | Costo mensual aprox. |
| --- | ---: | ---: |
| Min instances = 0, sin trafico | 0 | 0 USD |
| Min instances = 1, idle request-based | 30d * 24h * 3600s * (1 * 0.0000025 + 0.5 * 0.0000025) | 9.72 USD |
| Una instancia activa todo el mes, como WebSocket/long request permanente | 30d * 24h * 3600s * (1 * 0.000024 + 0.5 * 0.0000025) | 65.45 USD |

Los WebSockets son importantes: en Cloud Run, una conexion WebSocket mantiene un request abierto. Si hay conexiones constantes, el servicio puede acumular tiempo activo, no solo requests cortos.

Ademas:

- Cloud Run requests: 0.40 USD / millon.
- Logs: si se usa Cloud Logging, 0.50 USD / GiB de logs.
- Artifact Registry: imagenes de contenedor almacenadas.
- Cloud Build: builds/deploys.
- Storage persistente externo si se quiere conservar LowDB/uploads.

### Si se migra a Firebase nativo

Mapeo razonable:

- `db.json` -> Firestore (`experiments`, `trials`, `configs`, `pluginConfigs`, `sessionResults`, `participantFiles`, `chat`).
- uploads/media/plugins generados -> Cloud Storage/Firebase Storage.
- session tracking -> Realtime Database o Firestore listeners.
- publish -> Cloud Function o Cloud Run job/function.

Ventaja: escala a cero real y evita contenedor vivo para CRUD. Desventaja: cada read/write ahora se factura; hay que redisenar queries, indices y reglas.

Para el articulo, conviene decir que el costo de esta API no esta cerrado hasta decidir ese despliegue. Lo que si es real: si se mantiene como servidor acoplado, hay un costo de backend aparte del costo Firebase functions de recoleccion.

## Proveedores externos y costos desplazados

El proyecto usa o puede usar:

- GitHub Pages para hosting del experimento publicado.
- Google Drive, Dropbox u OSF para guardar CSVs y archivos de participantes.
- OSF para flujo similar a DataPipe.

Esto reduce la factura Firebase, pero no hace que el recurso sea "sin costo". Desplaza almacenamiento, ancho de banda, cuotas y limites a cuentas externas.

Limites relevantes:

- GitHub Pages documenta limite recomendado de repositorio de 1GB, sitio publicado de 1GB y soft bandwidth limit de 100GB/mes: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- OSF Storage limita proyectos/componentes privados a 5GB y publicos a 50GB: https://help.osf.io/article/139-check-your-project-or-components-storage-usage
- DataPipe tambien delega hosting y storage a GitHub Pages/OSF, y por eso reporta costo operativo bajo: https://pipe.jspsych.org/faq

## Comparacion con DataPipe

Lo encontrado en fuentes oficiales:

- El paper de DataPipe reporta un costo marginal aproximado de 0.01 USD por cada 500 archivos de datos procesados, calculado con precios cloud del momento de escritura.
- DataPipe dice que es gratis para usuarios.
- DataPipe dice que no hostea el experimento; el usuario debe usar GitHub Pages, Netlify, hosting universitario u otro.
- DataPipe dice que bajo operacion normal no almacena datos; enruta a OSF y solo cachea temporalmente fallos.
- DataPipe dice que su consumo Firebase actual es menor a 1 USD/mes.
- DataPipe soporta CSV/JSON/base64, validacion, limites de sesion, asignacion de condiciones y metadata.

Por tanto, la comparacion defendible es: DataPipe tiene un costo marginal menor para el caso acotado "procesar archivos hacia OSF"; ExpBuilder tiene un costo marginal todavia bajo, pero hace mas trabajo por sesion y opera una plataforma completa.

| Area | DataPipe | ExpBuilder |
| --- | --- | --- |
| Guardar datos en OSF | Si | Si |
| CSV/JSON | Si | Si |
| Base64/archivos | Si, con endpoint base64 | Si, con `uploadParticipantFile` y proveedores multiples |
| Validacion | Si | Si |
| Condition assignment | Si | Si |
| Hosting del experimento | No, requiere externo | Publica a GitHub Pages desde el builder |
| Builder visual de experimentos | No | Si |
| OAuth Drive/Dropbox/GitHub/OSF | Principalmente OSF | Si, multi-proveedor |
| Media del experimento | Fuera del scope principal | Subida, gestion y publicacion |
| Dashboard/settings/resultados | Dashboard DataPipe acotado | App completa acoplada a API |
| Costo operativo esperado | 0.01 USD por 500 archivos procesados segun paper; < 1 USD/mes de consumo actual segun FAQ | Depende de builder/API/hosting; recoleccion de 500 sesiones puede rondar 0.10 USD |

Mensaje recomendado:

> DataPipe reporta aproximadamente 0.01 USD por cada 500 archivos procesados. ExpBuilder, usando el flujo batch final, puede procesar 500 sesiones por alrededor de 0.10 USD en Firebase directo. Es mas caro en costo marginal porque hace mas trabajo por sesion, pero sigue en el rango de centavos y ofrece una plataforma completa de construccion, publicacion, OAuth multi-proveedor y gestion de archivos. El tradeoff es que operar el builder completo introduce costos de hosting/API que DataPipe evita al ser un puente liviano.

## Estimacion mensual por escenarios

### Escenario A: solo recoleccion publica, 500 participantes

Supuestos:

- 500 participantes/mes.
- 100 trials por participante.
- `IndexedDB ON`, `batchSize=0`.
- CSV promedio de 200KB por participante.
- Sin archivos de participantes.
- Sin contar hosting del builder ni servidor Express.

Resultado: ~0.10 USD/mes.

Lectura: tecnicamente casi gratis. La factura real puede subir por logs, retries, payloads grandes o abuso, pero no por "500 documentos" de Firestore.

### Escenario B: 500 participantes con batches

Supuestos:

- 500 participantes/mes.
- 100 trials.
- `batchSize=10`.
- Sin archivos.

Resultado: ~0.20 a 0.50 USD/mes.

Lectura: sigue barato, pero usa Firestore temporalmente y multiplica requests. Si el experimento sube a 1000 trials y mantiene `batchSize=10`, el costo operativo aproximado sube a ~1.38 USD antes de egress/logs; si manda trial por trial (`batchSize=1`), puede subir a ~13.24 USD para 500 participantes x 1000 trials.

### Escenario C: 500 participantes trial-by-trial

Supuestos:

- 500 participantes/mes.
- 100 trials.
- `IndexedDB OFF`.

Resultado: ~1.40 a 3.00 USD/mes.

Lectura: no es prohibitivo a 500 sesiones, pero es el modo menos eficiente y mas riesgoso.

### Escenario D: 500 participantes con archivos

Supuestos:

- 500 participantes/mes.
- 1 archivo de 10MB por participante.
- Los archivos se suben a proveedor externo por `uploadParticipantFile`.

Resultado: ~0.65 USD/mes por mover 5GB, principalmente egress.

Si son 50GB/mes de archivos, solo egress podria rondar 6 USD/mes.

### Escenario E: builder completo con hosting estatico

Supuestos:

- `dist` de 23MB.
- Firebase Hosting clasico.
- 10,000 cargas completas sin cache efectiva.

Resultado: ~33.69 USD/mes de transferencia.

Lectura: el hosting del builder puede superar por mucho al costo de datos de participantes. Cache y bundle splitting importan.

### Escenario F: API Express en Cloud Run

Supuestos:

- 1 vCPU, 512MiB.
- Socket.IO o conexiones activas sostienen una instancia ocupada todo el mes.

Resultado: ~65.45 USD/mes por instancia activa continua.

Si no hay conexiones permanentes y se escala a cero, el costo puede ser muy bajo. Si se configura `minInstances=1` solo para evitar cold starts, el idle request-based seria ~9.72 USD/mes sin free tier.

## Riesgos de costo y mitigaciones

1. Mantener `IndexedDB ON + batchSize=0` como default.
   - Es el modo que evita guardar trials en Firestore y minimiza invocaciones.

2. Reportar siempre `trials_por_participante` y `batchSize` en cualquier comparacion publica.
   - Sin esos dos datos, "500 participantes" no dice cuanto trabajo real hizo Firebase.

3. Evitar trial-by-trial salvo que haya una razon experimental fuerte.
   - Multiplica invocaciones, writes, deletes y latencia.

4. Limitar archivos de participantes.
   - Ya existen limites de 25MB por archivo y 100MB por request; conviene agregar cuotas por experimento/mes y validacion de MIME.

5. No desplegar el servidor Express como si fuera estatico.
   - LowDB y filesystem local necesitan una estrategia de persistencia. Sin eso, hay riesgo de perdida de datos y costos mal estimados.

6. Si se usa Cloud Run para la API, preferir `minInstances=0`.
   - Evita pagar idle. Para sesiones en vivo, evaluar mover tracking a RTDB en vez de Socket.IO persistente.

7. Reducir transferencia del builder.
   - Medir chunks, cache headers, lazy loading y assets pesados. A 23MB, el trafico del builder domina rapido.

8. Controlar logs.
   - Las funciones tienen muchos `console.log`; con alto trafico, Cloud Logging puede convertirse en costo real.

9. Proteger endpoints publicos.
   - `apiDataComplete` y `uploadParticipantFile` son publicos por diseño para participantes. Necesitan App Check, quotas por experimento, rate limiting o tokens firmados por publicacion para evitar abuso.

10. Distinguir costo Firebase de costo total.
   - Drive/Dropbox/OSF/GitHub pueden no aparecer en la factura Firebase, pero tienen cuotas, limites y terminos de uso.

## Conclusion para el articulo

El proyecto puede competir con DataPipe en costo marginal de recoleccion si mantiene el flujo de envio final por participante. DataPipe reporta aproximadamente 0.01 USD por 500 archivos procesados; ExpBuilder queda alrededor de 0.10 USD por 500 sesiones en el flujo real actual, sin contar hosting del builder ni API Express siempre activa. La ventaja competitiva no deberia presentarse como "mas barato que DataPipe por archivo", sino como:

- costo marginal de recoleccion muy bajo;
- mas funcionalidades que un puente de datos;
- publicacion y gestion de experimentos desde una sola herramienta;
- soporte multi-proveedor para storage;
- archivos de participantes y media;
- control sobre el pipeline.

La advertencia honesta es que una plataforma completa tiene costos que DataPipe evita: hosting del builder, API acoplada, persistencia del servidor, logs, deploys y trafico web. Si la arquitectura se optimiza para serverless real, el costo mensual puede seguir siendo bajo. Si se mantiene un backend Express con WebSockets activos y filesystem local, el costo operativo base puede pasar de centavos a decenas de dolares mensuales.

## Fuentes

- Firebase pricing: https://firebase.google.com/pricing
- Firestore pricing: https://cloud.google.com/firestore/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Firebase App Hosting costs: https://firebase.google.com/docs/app-hosting/costs
- Identity Platform pricing: https://cloud.google.com/identity-platform/pricing
- DataPipe paper: https://link.springer.com/content/pdf/10.3758/s13428-023-02161-x.pdf
- DataPipe FAQ: https://pipe.jspsych.org/faq
- DataPipe API docs: https://pipe.jspsych.org/api-docs
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- OSF storage limits: https://help.osf.io/article/139-check-your-project-or-components-storage-usage
