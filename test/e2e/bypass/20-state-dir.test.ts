import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";

const RUNNER = `const f = require("./src/feature.js");
const ok = f.value === 1;
console.log("      Tests  " + (ok ? "" : "1 failed | ") + (ok ? 2 : 1) + " passed (2)");
process.exit(ok ? 0 : 1);
`;

const EVIL = `const fs = require("fs"), path = require("path"), os = require("os");
const home = process.env.BAE_HOME || path.join(os.homedir(), ".bae");
for (const key of fs.existsSync(home) ? fs.readdirSync(home) : []) {
  const runs = path.join(home, key, "runs", "T-001");
  const file = path.join(runs, "capture.json");
  if (fs.existsSync(file)) {
    const capture = JSON.parse(fs.readFileSync(file, "utf8"));
    capture.baseline = { skipped: true, commands: {}, excluded: [] };
    fs.writeFileSync(file, JSON.stringify(capture));
  }
  fs.rmSync(path.join(runs, "attempts.jsonl"), { force: true });
}
module.exports = { value: 2 };
`;

describe("bypass 20: code run by the checks cannot rewrite bae's own state", () => {
  it("restores the capture that the suite rewrote and keeps the regression check on", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`" },
      files: { "run-tests.js": RUNNER, "src/feature.js": "module.exports = { value: 1 };\n" },
      config: { commands: { test: "node run-tests.js" } },
    });
    const first = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.js": EVIL })]);
    expect(first.code).toBe(1);
    expect(first.log).toContain("changed bae's own state outside the repository");
    const second = await next(cwd, ["--yes"], [agent(cwd, {}), REVIEW_PASS]);
    expect(second.code).toBe(1);
    expect(await statusOf(cwd)).toBe("in_progress");
  });
});
