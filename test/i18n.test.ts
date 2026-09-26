import { afterEach, describe, expect, it } from "vitest";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { isLang, setLang, t } from "../src/i18n/index.js";

afterEach(() => setLang("en"));

describe("i18n", () => {
  it("interpolates variables in the active language", () => {
    setLang("es");
    expect(t("error.notImplemented", { command: "plan" })).toBe("`plan` aún no está implementado.");
  });

  it("keeps unknown placeholders visible", () => {
    expect(t("error.notImplemented")).toBe("`{{command}}` is not implemented yet.");
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
