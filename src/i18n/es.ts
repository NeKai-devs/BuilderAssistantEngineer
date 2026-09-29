import type { Messages } from "./en.js";

export const es: Messages = {
  "program.description":
    "Convierte una idea o un repo existente en un plan de ejecución para agentes de IA de consola.",
  "option.backend": "backend de IA a usar",
  "option.lang": "idioma del CLI y de los artefactos generados",
  "option.dryRun": "muestra exactamente qué se enviaría a la IA, sin escribir nada",
  "option.yes": "acepta todas las confirmaciones",
  "option.help": "muestra la ayuda",
  "option.version": "muestra la versión",
  "option.only": "genera solo un grupo de artefactos",
  "option.headless": "ejecuta el agente sin sesión interactiva (acepta ediciones, nunca bypass)",
  "command.init": "detecta el proyecto, elige backend, agentes e idioma, y hace la entrevista",
  "command.plan": "analiza el repo y genera el plan, la memoria y los agentes",
  "command.next":
    "ejecuta la siguiente tarea pendiente, la verifica, la revisa y la marca como hecha",
  "command.status": "muestra fases, tareas y progreso",
  "command.replan": "re-analiza el repo, conserva lo hecho y actualiza lo pendiente",
  "command.review": "revisa el diff de una tarea contra sus criterios de aceptación y AGENTS.md",
  "command.help": "muestra la ayuda de un comando",
  "option.brief": "archivos separados por comas con tu brief o docs (evita pegar texto)",
  "ui.cancelled": "Cancelado.",
  "format.retrying":
    "La respuesta no siguió el formato; se pide una vez más corregir solo el formato.",
  "format.failed":
    "La respuesta sigue sin cumplir el formato ({{details}}). Salida original guardada en {{path}}.",
  "init.intro": "builder-assistant-engineer · configuración",
  "init.lang": "Idioma del CLI y del plan generado",
  "init.mode": "Tipo de proyecto",
  "init.detected": "detectado",
  "init.backend": "¿Qué IA hará el análisis?",
  "init.backendMissing": "`{{command}}` no está en el PATH; instálalo antes de ejecutar plan.",
  "init.targets": "¿Qué agentes trabajarán en este repo?",
  "init.redoInterview": "Ya existe una entrevista en .bae/interview.md. ¿Rehacerla?",
  "init.briefMissing": "No se pudieron leer los archivos del brief: {{path}}",
  "init.dryRunNoAi": "Dry run: init no enviaría nada a la IA.",
  "init.dryRunDone": "Dry run terminado. No se escribió nada.",
  "init.done": "Configuración guardada en .bae/. Siguiente paso: {{command}}",
  "mode.greenfield": "Greenfield — proyecto nuevo, poco o ningún código",
  "mode.brownfield": "Brownfield — código existente",
  "backend.label.manual": "Manual (copiar y pegar)",
  "backend.hint.installed": "instalado",
  "backend.hint.missing": "no está en el PATH",
  "backend.hint.api": "clave de Anthropic o compatible con OpenAI por variables de entorno",
  "backend.hint.apiReady": "credenciales encontradas en el entorno",
  "backend.hint.manual": "funciona con cualquier IA, incluso un chat web",
  "interview.intro": "Entrevista — pulsa Enter para saltar cualquier pregunta.",
  "interview.brief":
    "Brief: pega un resumen de una línea, o rutas a archivos con tu brief o docs (separadas por comas)",
  "interview.briefPlaceholder": "p. ej. docs/brief.md, notas/idea.md",
  "interview.briefLoaded": "Cargados {{count}} archivo(s): {{paths}}",
  "interview.objective": "¿Cuál es el objetivo sobre este repo?",
  "interview.q.what": "¿Qué quieres construir y para quién?",
  "interview.q.problem": "¿Qué problema resuelve y cómo sabrás que funciona?",
  "interview.q.scope": "¿Qué entra en el primer entregable y qué queda fuera?",
  "interview.q.constraints":
    "Restricciones: stack obligatorio, plazos, plataformas, integraciones, presupuesto?",
  "interview.q.team": "¿Quién ejecuta el plan (solo IA, tú + IA, un equipo) y con qué nivel?",
  "interview.q.rules":
    "Preferencias y prohibiciones: convenciones, zonas del repo que no se tocan?",
  "interview.followUps": "El analista puede hacer hasta {{max}} preguntas de seguimiento.",
  "interview.thinking": "Pensando la siguiente pregunta…",
  "interview.other": "Otra (escríbela)",
  "interview.skip": "Saltar",
  "interview.answer": "Tu respuesta",
  "interview.adaptiveFailed": "Se omiten las preguntas de seguimiento restantes: {{details}}",
  "interview.adaptiveManual": "Con el backend manual se omiten las preguntas de seguimiento.",
  "objective.feature": "Construir una funcionalidad nueva",
  "objective.refactor": "Refactorizar",
  "objective.migration": "Migrar (framework, lenguaje, infraestructura)",
  "objective.bugs": "Corregir bugs",
  "objective.docs": "Documentar el código",
  "md.interview": "Entrevista",
  "md.mode": "Modo",
  "md.objective": "Objetivo",
  "md.brief": "Brief",
  "md.followUps": "Preguntas de seguimiento",
  "md.summary": "Resumen",
  "md.skipped": "sin respuesta",
  "config.missing": "No hay configuración en .bae/config.json. Ejecuta primero {{command}}.",
  "digest.reading": "Leyendo el repositorio…",
  "plan.intro": "builder-assistant-engineer · plan",
  "plan.noInterview":
    "No hay entrevista en .bae/interview.md; se planifica solo a partir del repositorio.",
  "plan.analyzing": "El analista está construyendo el plan (puede tardar varios minutos)",
  "plan.progress": "Recibiendo el plan… {{chars}} caracteres",
  "plan.existingPlan":
    "Ya existe un plan en docs/plan/tasks. ¿Regenerarlo desde cero? (replan conserva el progreso)",
  "plan.useReplan": "Sin cambios. Usa replan para actualizar el plan conservando lo hecho.",
  "plan.dryRunDone":
    "Dry run: el prompt de arriba es exactamente lo que se enviaría. No se escribió nada.",
  "plan.continuing":
    "La respuesta se cortó en {{marker}}; se pide al analista que continúe desde ahí.",
  "plan.summary": "Resumen",
  "plan.blocking": "bloqueante",
  "plan.done": "{{count}} archivo(s) escritos. Siguiente paso: {{next}}",
  "plan.nothingWritten": "No se escribió ningún archivo.",
  "artifacts.changes": "Cambios",
  "artifacts.confirm": "¿Escribir {{count}} archivo(s)?",
  "artifacts.all": "Escribir todo",
  "artifacts.each": "Revisar uno a uno",
  "artifacts.none": "No escribir nada",
  "artifacts.confirmOne": "¿Escribir {{path}}?",
  "artifacts.new": "nuevo, {{lines}} líneas",
  "artifacts.updated": "+{{added}} −{{removed}}",
  "artifacts.unchanged": "sin cambios",
  "artifacts.keptDone": "tarea hecha, se conserva tal cual",
  "tasks.invalid": "Se ignora un archivo de tarea inválido: {{error}}",
  "next.intro": "builder-assistant-engineer · next",
  "next.meta": "fase {{phase}} · tamaño {{size}} · riesgo {{risk}} · depende de {{deps}}",
  "next.dryRunDone":
    "Dry run: la tarea de arriba es exactamente lo que recibiría el agente. No se cambió nada.",
  "next.headlessNeedsAgent":
    "--headless necesita un backend de agente (claude, opencode, codex, gemini); se usa el flujo manual.",
  "next.launching":
    "Abriendo {{backend}} con la tarea. Sal de la sesión cuando la tarea esté terminada.",
  "next.attempt": "Intento {{attempt}} de {{max}} con {{backend}} (headless, acepta ediciones)",
  "next.done": "{{id}} está hecha. Siguiente paso: {{command}}",
  "next.notDone": "{{id}} sigue en curso. Corrígela y vuelve a ejecutar {{command}}.",
  "trust.title": "Comandos que este repositorio hace ejecutar a bae",
  "trust.suite": "Comandos del proyecto, antes y después de cada tarea:",
  "trust.checks": "Comprobaciones de las tareas (## Verification):",
  "trust.allowed": "También permitidos sin confirmación (verify.allow en .bae/config.json):",
  "trust.confirm":
    "bae todavía no ha ejecutado nada en este repositorio en esta máquina. Ejecutará los comandos de arriba con tus permisos, también con --yes y --headless, que no responden esta pregunta. ¿Confías en ellos?",
  "trust.changedTitle": "Comandos nuevos o cambiados desde que aprobaste este repositorio",
  "trust.confirmChanged":
    "Estos comandos son nuevos o cambiaron desde la última vez que aprobaste los comandos de este repositorio, por ejemplo tras un pull o un replan. bae los ejecutará con tus permisos, también con --yes y --headless, que no responden esta pregunta. ¿Confías en ellos?",
  "trust.agentLoads":
    "El agente también cargará esto del repositorio al arrancar (bae no lo ejecuta; revísalo antes de seguir):",
  "trust.declined":
    "No se ejecutó nada. Revisa .bae/config.json y los bloques ## Verification de docs/plan/tasks, y vuelve a ejecutar {{command}}.",
  "trust.noTerminal":
    "Antes de que bae ejecute por primera vez los comandos de este repositorio, una persona debe aprobarlos, y no hay terminal donde preguntar. Ejecuta {{command}} una vez en una terminal para aprobarlos.",
  "next.noChanges":
    "El agente no cambió ningún archivo para {{id}}, así que bae no ejecutó sus comprobaciones.",
  "next.stopped":
    "{{reason}}\n{{id}} sigue en curso, y esta ejecución no cuenta como uno de sus intentos. Corrige la causa y vuelve a ejecutar {{command}}.",
  "next.stoppedTitle": "Parada antes de las comprobaciones (no cuenta como intento)",
  "next.nothingRun": "No se ejecutó nada. Corrige la causa y vuelve a ejecutar {{command}}.",
  "next.blocked":
    "{{id}} queda bloqueada: {{reason}} Logs: {{path}}. Para reintentar, corrige la causa, pon `status: pending` en {{task}} y corre {{command}}.",
  "next.noPlan": "Todavía no hay tareas. Ejecuta primero {{command}}.",
  "next.allDone": "Todas las tareas están hechas.",
  "next.nothingReady": "No hay ninguna tarea lista",
  "opencode.model": "opencode usará {{model}} (de {{source}}).",
  "opencode.weakModel":
    'opencode usará {{model}} (de {{source}}), que parece un modelo gratuito o pequeño. Un plan necesita un modelo fuerte: usa --backend claude, o pon un "model" más fuerte en opencode.json.',
  "opencode.noModel":
    'opencode no tiene "model" en opencode.json, así que usará el suyo por defecto, que puede ser gratuito. Un plan necesita un modelo fuerte: usa --backend claude, o pon un "model" en opencode.json.',
  "plan.notAPlan":
    "La respuesta ({{chars}} caracteres) no trae archivos del plan, así que no es un plan; se pide de nuevo con el prompt completo. La respuesta queda en {{path}}.",
  "plan.needsReviewWarn":
    "{{count}} tarea(s) aún tienen una Verification que la CLI no acepta: {{ids}}. Se escriben con status needs_review, y next no las correrá hasta que se corrijan.",
  "plan.needsReview":
    "{{count}} tarea(s) necesitan revisión antes de que next pueda correrlas: {{ids}}. El review_note de cada archivo dice qué corregir en su Verification; luego pon su status en pending.",
  "verification.commandsRetrying":
    "Algunos comandos del proyecto en el plan son de los que bae no ejecuta sin que alguien los confirme; se pide al analista que corrija solo esos:\n{{notes}}",
  "verification.commandsKept":
    "Estos comandos del proyecto se quedan en .bae/config.json, pero next --headless y next --yes los rechazarán hasta que los cambies o añadas su comienzo a verify.allow en .bae/config.json:\n{{notes}}",
  "verification.retrying":
    "{{count}} tarea(s) tienen una Verification que la CLI no acepta: {{kinds}}. Se le pide al analista que corrija solo esas. Detalles en {{report}}.",
  "verification.fixing": "El analista está corrigiendo la Verification de esas tareas",
  "verification.fixed": "Todas las Verification están corregidas.",
  "verification.retryFailed": "Falló la petición para corregir la Verification: {{details}}",
  "status.reviewReason": "{{id}} necesita revisión: {{reason}}",
  "next.needsReview": "necesita revisión: {{note}}",
  "next.unblock":
    "Corrige lo que dice en su archivo una tarea que necesita revisión y pon su status en pending, desbloquea o termina las demás tareas de arriba, o ejecuta replan.",
  "verify.commands": "Verificación",
  "verify.confirm": "¿Ejecutar ahora estos comandos de verificación?",
  "verify.declined": "No se ejecutó la verificación; la tarea sigue en curso.",
  "verify.none":
    "La tarea no tiene comandos de verificación en un bloque ```sh dentro de Verification.",
  "verify.failed": "La verificación falló: `{{command}}` terminó con {{code}}.",
  "verify.passed": "Verificación superada.",
  "verify.stillFailing":
    "`{{command}}` ya fallaba antes de la tarea y sigue fallando (salida {{code}}), así que no bloqueó. Si algún criterio de aceptación exige que pase, la tarea no está hecha.",
  "review.intro": "builder-assistant-engineer · review",
  "review.running": "El revisor está comprobando {{id}}…",
  "review.findings": "Hallazgos de la revisión",
  "review.passed": "Revisión superada.",
  "review.failed": "La revisión de {{id}} no pasó.",
  "review.noGit": "Revisión omitida: no es un repositorio git, así que no hay diff que revisar.",
  "review.noChanges":
    "La tarea no cambió archivos y sus chequeos pasan, así que no se llamó al revisor.",
  "review.dryRun": "Dry run: el prompt de revisión de arriba no se envió.",
  "review.noTask": "No hay ninguna tarea en curso. Indica un id, p. ej. review T-003.",
  "review.unknownTask": "No se encontró la tarea {{id}} en docs/plan/tasks.",
  "status.empty": "Todavía no hay plan. Ejecuta primero {{command}}.",
  "status.phase": "Fase {{phase}}",
  "status.waiting": "espera a {{ids}}",
  "status.total": "{{done}}/{{total}} hechas ({{percent}}%)",
  "status.next": "siguiente: {{id}} {{title}}",
  "status.noNext": "ninguna tarea lista",
  "replan.intro": "builder-assistant-engineer · replan",
  "replan.noPlan": "No hay plan que actualizar. Ejecuta primero {{command}}.",
  "replan.noChangelog": "El analista no escribió docs/plan/CHANGELOG.md.",
  "artifacts.removed": "se elimina, ya no está en el plan",
  "argument.task": "id de tarea, p. ej. T-003 (por defecto, la tarea en curso)",
  "error.configJson": "{{path}} no es JSON válido: {{details}}",
  "error.configInvalid": "{{path}} no es válido:\n{{details}}",
  "error.promptMissingVars": "{{path}} usa variables que no se proporcionaron: {{vars}}",
  "error.unexpected": "Error inesperado. Repórtalo adjuntando la salida siguiente.",
  "backend.notInstalled":
    "`{{command}}` no está instalado o no está en el PATH. Instálalo o elige otro backend con --backend.",
  "backend.timedOut":
    "`{{command}}` no terminó en {{minutes}} minutos y se detuvo (agent.timeoutMinutes en .bae/config.json).",
  "backend.failed": "`{{command}}` terminó con código {{code}}:\n{{details}}",
  "backend.sessionFailed":
    "`{{command}}` terminó con código {{code}} antes de acabar la tarea (por ejemplo, se respondió No a la pregunta de confianza en la carpeta, la CLI no tiene sesión iniciada o falló), así que bae no ejecutó ninguna comprobación.",
  "backend.apiNotConfigured":
    "El backend api necesita ANTHROPIC_API_KEY, u OPENAI_BASE_URL/OPENAI_API_KEY para un endpoint compatible con OpenAI.",
  "backend.apiModelRequired": "Define BAE_MODEL con el modelo a usar en {{baseUrl}}.",
  "backend.apiProviderInvalid": "BAE_API_PROVIDER debe ser anthropic u openai, no {{provider}}.",
  "backend.apiHttp": "Error de la API de {{provider}} ({{status}}): {{details}}",
  "backend.apiNetwork": "No se pudo conectar con {{url}}: {{details}}",
  "backend.apiInteractive": "El backend api no puede abrir una sesión interactiva.",
  "backend.refusal": "El modelo rechazó la solicitud.",
  "backend.truncated": "La respuesta alcanzó el límite de tokens de salida y está incompleta.",
  "manual.copied": "Prompt copiado al portapapeles y guardado en {{path}}.",
  "manual.notCopied": "No se pudo usar el portapapeles; el prompt está guardado en {{path}}.",
  "manual.awaitingResponse":
    "Pégalo en tu IA. Luego pega aquí la respuesta completa y termina con Ctrl-D (Ctrl-Z, Enter en Windows), o guárdala en {{path}} y pulsa Enter.",
  "manual.awaitingDone": "Ejecútalo con tu agente y pulsa Enter cuando la tarea termine.",
  "manual.emptyResponse": "No se recibió respuesta. Pégala aquí o guárdala en {{path}}.",
  "plan.commands": "Comandos del proyecto guardados en .bae/config.json",
  "regression.title": "Chequeo de regresión",
  "regression.baselineTitle": "Línea base de regresión, antes de la tarea",
  "regression.confirm":
    "¿Ejecutar ahora los comandos de lint y test del proyecto para registrar la línea base?",
  "regression.preexisting":
    "`{{command}}` ya falla antes de la tarea (salida {{code}}); queda registrado como preexistente y no bloquea.",
  "regression.found": "Regresión: `{{command}}` termina con {{code}} después de la tarea.",
  "regression.stillFailing":
    "`{{command}}` sigue fallando (salida {{code}}), igual que antes de la tarea.",
  "regression.passed": "Chequeo de regresión superado.",
  "evidence.retrying":
    "{{count}} ruta(s) citadas no están en el repositorio ni marcadas (new); se pide al analista corregir solo esas.",
  "evidence.fixing": "El analista está corrigiendo las rutas citadas…",
  "evidence.fixed": "Todas las rutas citadas existen o están marcadas (new).",
  "evidence.unverified": "{{count}} ruta(s) citadas siguen sin verificar; aparecen en el resumen.",
  "evidence.summary": "Rutas sin verificar (no están en el repositorio ni marcadas como nuevas):",
  "mechanical.secretFile":
    "Parece un archivo de secretos (.env, clave privada o credenciales); déjalo fuera del cambio.",
  "mechanical.secretValue": "Añade lo que parece una credencial ({{kind}}); léela del entorno.",
  "mechanical.noTests":
    "La tarea exige tests (tests: required), pero no ejecuta más tests que antes ni añade aserciones a un archivo de test.",
  "mechanical.outOfScope": "Cambios fuera del Scope de la tarea: {{files}}",
  "mechanical.failed": "Los chequeos automáticos fallaron, así que no se lanzó el revisor.",
  "plan.openQuestions":
    "Preguntas abiertas, guardadas en .bae/interview.md; respóndelas allí y ejecuta replan cuando puedas",
  "plan.questionsSaved": "{{count}} pregunta(s) guardadas en .bae/interview.md.",
  "plan.rerun":
    "Respondiste preguntas bloqueantes. ¿Volver a generar el plan ahora con tus respuestas?",
  "plan.rerunning": "Generando el plan otra vez con tus respuestas.",
  "md.planQuestions": "Preguntas del plan ({{date}})",
  "md.why": "Por qué",
  "md.options": "Opciones",
  "md.blocking": "Bloqueante: el plan asumió una respuesta",
  "md.answer": "Respuesta",
  "md.open": "abierta, sin responder",
  "handoff.missing":
    "{{path}} no tiene nota de traspaso: escribe como máximo {{max}} líneas bajo ## Log (qué cambió, decisiones, trampas).",
  "handoff.tooLong":
    "La nota de traspaso de {{path}} tiene {{count}} líneas; déjala en {{max}} como máximo.",
  "handoff.passed": "Nota de traspaso presente.",
  "md.lessons": "Lecciones aprendidas",
  "lesson.asking": "{{id}} falló varias veces; pidiendo al agente la causa raíz y una regla…",
  "lesson.title": "Lección de {{id}}",
  "lesson.body": "Causa raíz: {{cause}}\nRegla: {{rule}}",
  "lesson.confirm": "¿Añadir esta regla a AGENTS.md?",
  "lesson.added": "Regla añadida a AGENTS.md.",
  "lesson.skipped": "Regla no añadida; queda en {{path}}.",
  "lesson.failed": "No se pudo obtener una lección del agente: {{details}}",
  "status.blockedReason": "{{id}} está bloqueada: {{reason}}",
  "status.stoppedReason": "{{id}} se detuvo: {{reason}}",
  "status.metrics": "Métricas locales",
  "status.attempts": "intentos: {{attempts}} en {{tasks}} tarea(s), {{average}} por tarea",
  "status.firstAttempt": "hechas al primer intento: {{count}}/{{tasks}} ({{percent}}%)",
  "status.regressions": "regresiones atrapadas: {{count}}",
  "status.time": "tiempo por tarea hecha: {{average}} de media, {{total}} en total",
  "status.taskRuns": "{{attempts}} intento(s), {{time}}",
  "format.repaired": "Respuesta reparada localmente: {{repairs}}.",
  "evidence.retryFailed":
    "Falló la petición para corregir las rutas citadas, así que el plan las conserva tal cual: {{details}}",
  "regression.noCommands":
    "No hay comando de lint ni de test en .bae/config.json ni en los manifiestos; el chequeo de regresión queda desactivado hasta que los añadas en commands.",
  "option.acceptFinding":
    "acepta un hallazgo por su id (repetible); solo secretos, y hallazgos de contrato o de tests en archivos que el Alcance de la tarea lista",
  "review.noBase":
    "Revisión fallida: el commit registrado al empezar la tarea ya no existe, así que no se pueden aislar sus cambios.",
  "review.noCapture": "{{id}} no tiene captura de next; se revisa contra el HEAD actual.",
  "contract.title": "Contrato",
  "contract.failed":
    "La tarea cambió archivos que definen sus propios chequeos; se restauraron desde el estado capturado antes de la tarea.",
  "contract.recovered":
    "Una ejecución anterior de {{id}} terminó antes de sus chequeos; se restauraron los archivos que cambió y que definen los chequeos.",
  "contract.task": "Editó el archivo de la tarea fuera de ## Log.",
  "contract.tasks": "Editó otro archivo de tarea.",
  "contract.bae": "Cambió la configuración o los prompts de bae.",
  "contract.agents":
    "Cambió la definición de un agente o la configuración con la que corre el revisor.",
  "contract.gitignore": "Cambió un archivo de ignore, que decide qué ve la revisión.",
  "contract.scripts": "Cambió {{detail}}, que los chequeos ejecutan.",
  "contract.runner": "Cambió la configuración del runner de tests.",
  "contract.restored": "Restaurado.",
  "contract.sealed":
    "bae solo guarda una huella de este archivo, porque puede contener credenciales, así que no pudo restaurarlo: revísalo y devuélvelo a su estado tú.",
  "contract.removed": "Eliminado.",
  "findings.accepted": "Aceptado con --accept-finding.",
  "findings.acceptedTitle": "Hallazgos aceptados",
  "regression.failed": "El chequeo de regresión falló.",
  "regression.mustPass":
    "`{{command}}` sigue fallando (exit {{code}}) y la tarea es tests: fix, así que la suite de tests debe terminar en verde.",
  "regression.uncomparable":
    "`{{command}}` ya fallaba antes de la tarea y sigue fallando (exit {{code}}); su salida no tiene conteos para comparar, así que solo pasa en verde.",
  "regression.worse":
    "Regresión: `{{command}}` falla más chequeos que antes de la tarea ({{now}}; antes: {{before}}).",
  "regression.lateStop":
    "{{id}} no tiene línea base de regresión de antes de que corriera su agente.",
  "regression.declinedStop":
    "Sin correr antes lint y tests no hay línea base, así que la tarea no podría completarse.",
  "regression.noToolchain":
    "Todavía no hay toolchain: el repositorio no tiene código ni manifiesto de proyecto, así que no hay baseline que registrar. {{id}} la crea, y los comandos de lint y tests del proyecto deben pasar después.",
  "regression.notFound":
    "`{{command}}` no encontró un programa que ejecuta (exit 127), así que no hay baseline. Instala las dependencias del proyecto (por ejemplo `npm install`) y vuelve a correr next.",
  "regression.unusable":
    "`{{command}}` no da una línea base usable (exit {{code}}): no terminó, o falla sin conteos que comparar. La tarea no podría completarse mientras siga en rojo.",
  "review.noVerdict": "El revisor no dio veredicto.",
  "review.error": "El revisor no pudo dar un veredicto: {{details}}",
  "skip.used": "Se continúa sin este chequeo por --allow-skip: {{what}}",
  "skip.title": "Omitido con --allow-skip",
  "skip.stopped":
    "No se lanzó nada. Corrige la causa, o vuelve a correr next con --allow-skip para seguir sin ese chequeo; la omisión queda en el log de la ejecución.",
  "env.denied":
    "{{agent}} no tuvo permiso para ejecutar {{commands}}, así que otro intento fallaría igual. bae deja al agente correr los chequeos de la tarea e instalar dependencias; permite lo demás en los permisos del propio {{agent}} (en Claude Code, una regla como `Bash({{first}} *)` en .claude/settings.json de una carpeta de confianza), o corre next sin --headless y apruébalo tú.",
  "env.alsoDenied": "Tampoco se le permitió a {{agent}} ejecutar {{commands}}.",
  "env.moreDenied": "y {{count}} más",
  "env.notFound":
    "`{{command}}` no encontró un programa que ejecuta (exit 127): faltan las dependencias del proyecto o una herramienta. Otro intento fallaría igual; instálalas (por ejemplo `npm install`).",
  "next.budgetUsed": "La tarea ya usó sus {{max}} intentos automáticos.",
  "next.refusedBlocked":
    "{{id}} queda bloqueada antes de lanzar el agente, porque sus comprobaciones no pueden ejecutarse; no se ejecutó nada y no cuenta como intento. Corrige su bloque ## Verification o los comandos de .bae/config.json y pon `status: pending` en {{task}}.",
  "capture.lateStop":
    "{{id}} está en curso sin una captura de antes de que corriera su agente, así que sus chequeos no tienen un punto de partida fiable. Vuelve a ponerla en pending, o corre con --allow-skip.",
  "capture.noGit":
    "No es un repositorio git, así que la revisión no puede ver los cambios de la tarea.",
  "option.allowSkip":
    "continúa cuando un chequeo no puede correr (sin git, sin línea base, sin veredicto del revisor); cada omisión queda registrada",
  "integrity.title": "Integridad de los tests",
  "integrity.failed": "La tarea quitó o desactivó tests.",
  "integrity.deleted": "Borra un archivo de test.",
  "integrity.skipMarker": "Añade un marcador que omite o aísla tests ({{marker}}).",
  "integrity.exclusion":
    "Añade una configuración del runner de tests que deja tests fuera ({{keys}}).",
  "integrity.fewerTests":
    "`{{command}}` ejecuta menos tests que antes de la tarea ({{now}}; antes: {{before}}).",
  "integrity.moreSkipped":
    "`{{command}}` omite más tests que antes de la tarea ({{now}}; antes: {{before}}).",
  "verify.noBash":
    "La Verificación corre como un script de bash y no se encontró bash. En Windows instala Git for Windows, que trae Git Bash; en otros sistemas pon bash en el PATH.",
  "verify.masks":
    "La Verificación oculta fallos en `{{command}}` (|| true, set +e). El bloque corre con set -euo pipefail y debe fallar cuando falla un chequeo.",
  "verify.trivial":
    "La Verificación no ejecuta nada que compruebe la tarea:\n{{command}}\nUsa el runner de tests del proyecto, un linter o un chequeo con resultado esperado (test -f, grep -q, curl -f).",
  "verify.notAllowed":
    "`{{command}}` no está en la lista de comandos que bae corre cuando nadie los confirma ({{why}}). Añade un prefijo a verify.allow en .bae/config.json, o corre next sin --yes ni --headless y confírmalo tú.",
  "regression.notAllowed":
    "El comando del proyecto `{{command}}` no está en la lista de comandos que bae corre cuando nadie los confirma ({{why}}). Añade un prefijo a verify.allow en .bae/config.json.",
  "verify.dynamic": "ejecuta código que se arma en tiempo de ejecución o en otro shell",
  "verify.unknown": "programa desconocido",
  "verify.unsafeWarning": "`{{command}}` parece peligroso ({{reason}}); léelo antes de confirmar.",
  "verify.onlyExcused":
    "La Verificación solo ejecuta comandos que ya fallaban antes de la tarea, así que no comprueba nada de esta tarea.",
  "evidence.linesFailed":
    "El plan cita líneas que no existen, incluso después de pedir al analista que las corrija:\n{{list}}\nEl plan no se escribió; la respuesta rechazada está en {{path}}. Vuelve a correr plan.",
  "state.tampered":
    "Código ejecutado para esta tarea cambió el estado propio de bae fuera del repositorio ({{files}}); se restauró y el intento falla.",
  "review.gitError":
    "Revisión fallida: git no pudo listar los cambios de la tarea (índice, configuración o filtro rotos), así que los chequeos no pueden verlos.",
  "contract.memory": "Cambió un archivo de memoria de agentes, que leen los agentes y el revisor.",
  "contract.git": "Cambió atributos de git, que deciden cómo ve la revisión los archivos.",
  "contract.gitdir":
    "Cambió la configuración de git del repositorio en .git, de la que dependen los chequeos.",
  "contract.toolchain":
    "Cambió una configuración del gestor de paquetes o de una herramienta que decide cómo corren los chequeos.",
  "contract.shadow": "Añadió un archivo que se ejecutaría en lugar de la herramienta del proyecto.",
  "contract.indexFlags":
    "Marcó archivos como sin cambios en el índice de git (assume-unchanged o skip-worktree), lo que los oculta de la revisión: {{files}}. Se quitaron las marcas.",
  "integrity.removedTests": "Quita tests que no vuelven a añadirse: {{tests}}.",
  "integrity.lostAssertions":
    "Quita {{count}} línea(s) de aserción de un archivo de test sin volver a añadirlas.",
  "capture.headMoved":
    "{{id}} conserva el commit registrado cuando empezó; los commits hechos desde entonces cuentan como parte de los cambios de la tarea.",
  "contract.restoreFailed":
    "No se pudo restaurar {{files}} desde la captura. Corrígelos a mano; la siguiente ejecución los vuelve a comprobar antes de empezar.",
  "integrity.suppression": "Añade un comentario que silencia un chequeo ({{markers}}).",
  "integrity.expectedOutput":
    "Cambia un snapshot o un archivo de salida esperada, que decide qué aceptan los tests.",
  "regression.baselineTampered":
    "Correr los comandos del proyecto para la línea base cambió archivos de los que dependen los chequeos ({{files}}); se restauraron y no se lanzó nada.",
  "regression.unknown":
    "`{{command}}` termina con {{code}}, pero bae no pudo leer cuántos tests corrieron, así que no puede saber si pasaron.",
  "regression.unknownRunner":
    "bae no reconoce el runner de tests detrás de `{{command}}`, así que no puede saber si los tests pasan. Pon en commands.test de .bae/config.json el runner mismo, por ejemplo `npx vitest run`, `npx jest`, `pytest`, `go test -v ./...`, `cargo test` o `dotnet test`.",
  "regression.noCounts":
    "`{{command}}` no da una línea base usable: pasa, pero no dice cuántos tests corrieron, así que la tarea no podría compararse con ella.",
  "regression.unreadSkipped": "`{{command}}` no dijo cuántos tests corrieron",
  "contract.scoped":
    "El Scope de la tarea lista este archivo, así que el cambio se queda: los chequeos corren con él y el revisor lo ve.",
  "contract.weakerScripts": "Deja de correr lo que corrían estos scripts: {{scripts}}.",
  "contract.weakerRunner": "Añade ajustes que dejan tests fuera ({{keys}}).",
  "contract.weakerToolchain":
    "Añade un ajuste que cambia cómo arranca el gestor de paquetes o el runner de tests.",
  "review.noEvidence":
    "(ninguna: esta revisión no se corrió justo después de los chequeos de next)",
  "integrity.scoped":
    "El Scope de la tarea lista este archivo, así que el revisor debe decir por qué este cambio es correcto.",
  "review.unjustified":
    "El revisor aprobó la tarea sin decir por qué son correctos estos cambios en archivos de test: {{files}}.",
  "mechanical.secretHistory":
    "Un commit hecho durante la tarea añade algo que parece una credencial ({{kind}}). Se queda en el historial de git aunque el archivo ya no lo tenga, así que reescribe esos commits.",
  "mechanical.secretFileHistory":
    "Un commit hecho durante la tarea añade un archivo de secretos. Se queda en el historial de git aunque el archivo ya no exista, así que reescribe esos commits.",
  "regression.notYetCreated":
    "`{{command}}` todavía no existe (su herramienta o script no está instalado o escrito), así que ahora no se compara; cuando una tarea lo cree, deberá pasar.",
  "regression.stillAbsent":
    "`{{command}}` sigue sin existir; la tarea que lo cree deberá hacer que pase.",
  "regression.noTestsYet":
    "`{{command}}` todavía no tiene tests que correr, así que no hay línea base; después de la tarea debe pasar y decir cuántos tests corrieron.",
  "integrity.planned":
    "El Scope de la tarea marca archivos de test que elimina, así que lo juzga el revisor.",
  "run.started":
    "Trabajando en la rama {{branch}}, creada desde {{from}}; cada tarea terminada se commitea ahí.",
  "run.elsewhere":
    "Las tareas de esta run se commitean en {{branch}}, y estás en {{current}}. Vuelve con `git switch {{branch}}` o usa --new-run para empezar otra run desde aquí (por ejemplo, después de mergearla).",
  "run.replanElsewhere":
    "Las tareas de esta run se commitean en {{branch}}, y estás en {{current}}. Vuelve con `git switch {{branch}}` antes de replanificar, para que el plan nuevo quede junto a ellas.",
  "run.confirm": "¿Crear la rama {{branch}} desde {{from}} y commitear ahí cada tarea terminada?",
  "run.declined":
    "Sigues en {{current}}. Las tareas terminadas no se commitean; el próximo next vuelve a preguntar, y --yes crea la rama sin preguntar.",
  "run.finished": "Todas las tareas están hechas en {{branch}}. Abre el pull request con:",
  "run.switchFailed": "No se pudo crear la rama {{branch}}: {{details}}",
  "run.stopped": "No se cambió nada.",
  "commit.done": "{{id}} commiteada como {{sha}} en {{branch}}.",
  "commit.failed":
    "No se pudo commitear {{id}}: {{details}}. La tarea está hecha; commitea sus cambios a mano.",
  "commit.replan": "Plan nuevo commiteado como {{sha}} en {{branch}}.",
  "commit.plan": "Plan commiteado como {{sha}} en {{branch}}.",
  "commit.planFailed": "No se pudo commitear el plan: {{details}}. Commitea sus archivos a mano.",
  "plan.commitConfirm": "¿Commitear ahora los archivos del plan, para que next parta de ellos?",
  "status.run": "Rama {{branch}}, creada desde {{from}}",
  "status.runElsewhere": "Las tareas de esta run se commitean en {{branch}}; estás en {{current}}.",
  "status.noCommits": "todavía sin commits",
  "option.noVerify":
    "commitear sin los hooks pre-commit y commit-msg del repositorio, como git commit --no-verify",
  "option.newRun":
    "empezar una rama bae/ nueva desde la rama actual en vez de seguir la run registrada",
};
