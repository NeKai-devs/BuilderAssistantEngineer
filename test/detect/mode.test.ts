import { describe, expect, it } from "vitest";
import { detectMode, detectProjectMode } from "../../src/detect/mode.js";
import { copyFixture, tempDir } from "../helpers.js";

describe("mode detection", () => {
  it("is greenfield for an empty folder or docs only", async () => {
    expect(await detectProjectMode(await tempDir())).toBe("greenfield");
    expect(await detectProjectMode(await copyFixture("docs-only"))).toBe("greenfield");
  });

  it("is brownfield when there is a manifest or source code", async () => {
    expect(await detectProjectMode(await copyFixture("node-app"))).toBe("brownfield");
    expect(detectMode(["Cargo.toml"])).toBe("brownfield");
    expect(detectMode(["scripts/setup.sh"])).toBe("brownfield");
    expect(detectMode(["README.md", ".claude/agents/reviewer.md"])).toBe("greenfield");
  });
});
