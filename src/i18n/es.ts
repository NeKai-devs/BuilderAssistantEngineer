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
  "argument.task": "id de tarea, p. ej. T-003 (por defecto, la tarea en curso)",
  "error.notImplemented": "`{{command}}` aún no está implementado.",
  "error.configJson": "{{path}} no es JSON válido: {{details}}",
  "error.configInvalid": "{{path}} no es válido:\n{{details}}",
  "error.promptMissingVars": "{{path}} usa variables que no se proporcionaron: {{vars}}",
  "error.unexpected": "Error inesperado. Repórtalo adjuntando la salida siguiente.",
  "backend.notInstalled":
    "`{{command}}` no está instalado o no está en el PATH. Instálalo o elige otro backend con --backend.",
  "backend.failed": "`{{command}}` terminó con código {{code}}:\n{{details}}",
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
};
