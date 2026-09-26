export const en = {
  "program.description":
    "Turn an idea or an existing repo into an execution plan for console AI agents.",
  "option.backend": "AI backend to use",
  "option.lang": "language for the CLI and the generated artifacts",
  "option.dryRun": "show exactly what would be sent to the AI without writing anything",
  "option.yes": "accept every confirmation",
  "option.help": "show help",
  "option.version": "show version",
  "option.only": "generate only one group of artifacts",
  "option.headless": "run the agent without an interactive session (accept edits, never bypass)",
  "command.init": "detect the project, choose backend, agents and language, and run the interview",
  "command.plan": "analyze the repo and generate the plan, memory and agents",
  "command.next": "run the next pending task, verify and review it, and mark it done",
  "command.status": "show phases, tasks and progress",
  "command.replan": "re-analyze the repo, keep finished work and update pending tasks",
  "command.review": "review a task's diff against its acceptance criteria and AGENTS.md",
  "command.help": "show help for a command",
  "argument.task": "task id, e.g. T-003 (defaults to the task in progress)",
  "error.notImplemented": "`{{command}}` is not implemented yet.",
  "error.configJson": "{{path}} is not valid JSON: {{details}}",
  "error.configInvalid": "{{path}} is invalid:\n{{details}}",
  "error.promptMissingVars": "{{path}} uses variables that were not provided: {{vars}}",
  "error.unexpected": "Unexpected error. Please report it with the output below.",
  "backend.notInstalled":
    "`{{command}}` is not installed or not in PATH. Install it or pick another backend with --backend.",
  "backend.failed": "`{{command}}` exited with code {{code}}:\n{{details}}",
  "backend.apiNotConfigured":
    "The api backend needs ANTHROPIC_API_KEY, or OPENAI_BASE_URL/OPENAI_API_KEY for an OpenAI-compatible endpoint.",
  "backend.apiModelRequired": "Set BAE_MODEL to the model to use with {{baseUrl}}.",
  "backend.apiProviderInvalid": "BAE_API_PROVIDER must be anthropic or openai, not {{provider}}.",
  "backend.apiHttp": "{{provider}} API error ({{status}}): {{details}}",
  "backend.apiNetwork": "Could not reach {{url}}: {{details}}",
  "backend.apiInteractive": "The api backend cannot run an interactive session.",
  "backend.refusal": "The model declined the request.",
  "backend.truncated": "The response hit the output token limit and is incomplete.",
  "manual.copied": "Prompt copied to the clipboard and saved to {{path}}.",
  "manual.notCopied": "Could not use the clipboard; the prompt is saved to {{path}}.",
  "manual.awaitingResponse":
    "Paste it into your AI. Then paste the full answer here and finish with Ctrl-D (Ctrl-Z, Enter on Windows), or save it to {{path}} and press Enter.",
  "manual.awaitingDone": "Run it with your agent and press Enter when the task is finished.",
  "manual.emptyResponse": "No answer received. Paste it here or save it to {{path}}.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
