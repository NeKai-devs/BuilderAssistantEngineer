import { afterEach, describe, expect, it } from "vitest";
import { CLI } from "../src/core/invoked.js";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { isLang, setLang, t } from "../src/i18n/index.js";

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

  it("recognizes supported languages only", () => {
    expect(isLang("es")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});
