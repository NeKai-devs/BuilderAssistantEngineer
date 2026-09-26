import type { MessageKey } from "../i18n/index.js";

export const BASE_QUESTIONS: MessageKey[] = [
  "interview.q.what",
  "interview.q.problem",
  "interview.q.scope",
  "interview.q.constraints",
  "interview.q.team",
  "interview.q.rules",
];

export const OBJECTIVES = ["feature", "refactor", "migration", "bugs", "docs", "skip"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const OBJECTIVE_LABELS: Record<Objective, MessageKey> = {
  feature: "objective.feature",
  refactor: "objective.refactor",
  migration: "objective.migration",
  bugs: "objective.bugs",
  docs: "objective.docs",
  skip: "interview.skip",
};

export const MAX_FOLLOW_UPS = 5;
