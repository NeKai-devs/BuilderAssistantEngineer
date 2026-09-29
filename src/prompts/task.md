{{context}}

---

{{task}}

---

Note from builder-assistant-engineer: do not edit this task file except its `## Log` section; the CLI tracks the task's status. Before you finish, write a handoff note of at most {{max_log_lines}} lines under `## Log` in {{task_path}}: what changed, the decisions you made and why, and the traps whoever continues should know about. When you finish, the CLI runs the Verification commands above{{suite}}, checks the handoff note and reviews your changes against the acceptance criteria with the project's reviewer subagent. The task is done only if all of that passes. That review always happens after you, so do not run the reviewer subagent yourself.{{permissions}}
