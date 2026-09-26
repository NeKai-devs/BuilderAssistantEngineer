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
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
