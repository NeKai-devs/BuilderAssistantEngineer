import { settings } from "@clack/prompts";
import { afterEach, describe, expect, it } from "vitest";
import { stuckLine } from "../src/commands/next.js";
import { CLI } from "../src/core/invoked.js";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { isLang, type Lang, setLang, t } from "../src/i18n/index.js";
import { secretFindings } from "../src/review/secrets.js";
import { parseTask } from "../src/tasks/schema.js";
import { confirmOptions, localized } from "../src/ui/clack.js";
import { taskFile } from "./plan-sample.js";

const SAME_IN_BOTH = [
  "md.brief",
  "plan.intro",
  "next.intro",
  "review.intro",
  "replan.intro",
  "progress.tool",
  "artifacts.updated",
  "ui.no",
  "secret.jwt",
];

const SHOWN: Record<
  Lang,
  { yes: string; blocked: string; waiting: string; secret: string; cancel: string }
> = {
  en: {
    yes: "Yes",
    blocked: "T-001 Do T-001 (blocked)",
    waiting: "T-002 Do T-002 (waiting on T-001)",
    secret:
      "Adds what looks like a credential (GitHub token); read it from the environment instead.",
    cancel: "Cancelled.",
  },
  es: {
    yes: "Sí",
    blocked: "T-001 Do T-001 (bloqueada)",
    waiting: "T-002 Do T-002 (espera a T-001)",
    secret: "Añade lo que parece una credencial (token de GitHub); léela del entorno.",
    cancel: "Cancelado.",
  },
};

function tokenFinding() {
  const token = `ghp_${"a1B2c3D4e5".repeat(4)}`;
  const changes = {
    files: ["src/client.ts"],
    added: [{ path: "src/client.ts", text: `const key = "${token}";` }],
    removed: [],
    deleted: [],
    untracked: [],
  };
  return secretFindings(changes, { allow: [] }).find((finding) => finding.id?.startsWith("secret"));
}

afterEach(() => setLang("en"));

describe("i18n", () => {
  it("interpolates variables in the active language", () => {
    setLang("es");
    expect(t("next.done", { id: "T-001", command: "bae next" })).toBe(
      "T-001 está hecha. Siguiente paso: bae next",
    );
  });

  it("keeps unknown placeholders visible", () => {
    expect(t("next.done")).toBe("{{id}} is done. Next: {{command}}");
  });

  it("names the command the user typed, never a slash command, when it tells them to run one", () => {
    const bare =
      /\b(run|Run|use|Use|corre|correr|ejecuta|Ejecuta|usa|Usa) (next|replan|plan|review|status|init)\b/;
    for (const text of [...Object.values(en), ...Object.values(es)]) {
      expect(text).not.toMatch(/(^|\s)\/next\b/);
      expect(text).not.toMatch(bare);
    }
    expect(t("next.unblock")).toContain(`or run ${CLI} replan.`);
    setLang("es");
    expect(t("regression.notFound", { command: "npm test" })).toContain(
      `y vuelve a correr ${CLI} next.`,
    );
  });

  it("has the same keys in every catalog", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("translates every message, except the few that read the same in both languages", () => {
    const same = (Object.keys(en) as (keyof typeof en)[]).filter((key) => en[key] === es[key]);
    expect(same.sort()).toEqual([...SAME_IN_BOTH].sort());
  });

  it.each(["en", "es"] as const)("shows the labels the CLI builds itself in %s", (lang) => {
    setLang(lang);
    const shown = SHOWN[lang];
    const blocked = parseTask("docs/plan/tasks/T-001.md", taskFile("T-001", { status: "blocked" }));
    const waiting = parseTask(
      "docs/plan/tasks/T-002.md",
      taskFile("T-002", { dependsOn: ["T-001"] }),
    );
    expect(confirmOptions("?", true)).toMatchObject({ active: shown.yes, inactive: "No" });
    expect(stuckLine(blocked, [blocked, waiting])).toBe(shown.blocked);
    expect(stuckLine(waiting, [blocked, waiting])).toBe(shown.waiting);
    expect(tokenFinding()?.message).toBe(shown.secret);
    localized({});
    expect(settings.messages.cancel).toBe(shown.cancel);
  });

  it("keeps a finding's id the same in every language, so --accept-finding works in both", () => {
    const english = tokenFinding()?.id;
    setLang("es");
    expect(tokenFinding()?.id).toBe(english);
  });

  it("recognizes supported languages only", () => {
    expect(isLang("es")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});
