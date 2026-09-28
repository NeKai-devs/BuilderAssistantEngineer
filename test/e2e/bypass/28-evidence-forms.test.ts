import { describe, expect, it } from "vitest";
import { describeUnverified, findUnverified } from "../../../src/plan/evidence.js";
import { parsePlan } from "../../../src/plan/parser.js";
import { copyFixture } from "../../helpers.js";
import { defaultFiles, planOutput } from "../../plan-sample.js";

async function unverified(architecture: string): Promise<string[]> {
  const cwd = await copyFixture("node-app");
  const plan = parsePlan(
    planOutput({ files: { ...defaultFiles(), "docs/plan/02-architecture.md": architecture } }),
  );
  return (await findUnverified(cwd, plan)).map(describeUnverified);
}

describe("bypass 28: every form of a line citation is checked", () => {
  it("checks :line:col and #L ranges, and treats a directory with a line as wrong", async () => {
    const found = await unverified(
      "See `src/index.ts:99:5`, `src/index.ts#L3-L90`, `src/index.ts#L2` and `src/routes:3`.",
    );
    expect(found).toEqual([
      "`src/index.ts:99:5` in docs/plan/02-architecture.md (the file has 7 lines)",
      "`src/index.ts#L3-L90` in docs/plan/02-architecture.md (the file has 7 lines)",
      "`src/routes:3` in docs/plan/02-architecture.md (the file has 0 lines)",
    ]);
  });
});
