export const FAKE_RUNNER = `const fs = require("fs");
const path = require("path");
const jest = path.basename(__filename).startsWith("jest");
const flag = (name) => (process.argv.find((arg) => arg.startsWith("--" + name + "=")) || "").slice(name.length + 3);
if (process.argv.includes("--crash")) { console.log("Error: the runner could not start"); process.exit(1); }
const cases = [];
const add = (file, title, status) => cases.push({ file: path.resolve(file), title, status });
if (flag("total") || flag("breaks") || flag("needs")) {
  const total = Number(flag("total") || 1);
  const failed = flag("breaks")
    ? (fs.existsSync(flag("breaks")) ? 1 : 0)
    : flag("needs")
      ? (fs.existsSync(flag("needs")) ? 0 : 1)
      : flag("worse")
        ? (fs.existsSync(flag("worse")) ? 5 : 1)
        : Number(flag("fails") || 0);
  for (let i = 0; i < total; i++) add("tests/fake.test.js", "t" + i, i < failed ? "failed" : "passed");
} else if (fs.existsSync("tests")) {
  let current = "";
  global.expect = (a) => ({ toBe: (b) => { if (a !== b) throw new Error(a + " !== " + b); } });
  global.it = (name, fn) => {
    try { fn(); add(current, name, "passed"); }
    catch (e) { add(current, name, "failed"); console.log("FAIL " + name + ": " + e.message); }
  };
  global.it.skip = (name) => add(current, name, "skipped");
  if (fs.existsSync("tests/setup.js")) require(path.resolve("tests/setup.js"));
  for (const name of fs.readdirSync("tests").filter((n) => n.endsWith(".test.js")).sort()) {
    current = path.join("tests", name);
    try { require(path.resolve(current)); }
    catch (e) { add(current, "loads", "failed"); console.log("FAIL " + current + ": " + e.message); }
  }
} else add("tests/fake.test.js", "t0", "passed");
const count = (status) => cases.filter((c) => c.status === status).length;
const passed = count("passed"), failed = count("failed"), skipped = count("skipped");
for (const c of cases) if (c.status === "failed") console.log(" FAIL  " + path.relative(".", c.file) + " > " + c.title);
if (jest) console.log("Tests:       " + [failed && failed + " failed", skipped && skipped + " skipped", passed + " passed"].filter(Boolean).join(", ") + ", " + cases.length + " total");
else console.log("      Tests  " + [failed && failed + " failed", passed + " passed", skipped && skipped + " skipped"].filter(Boolean).join(" | ") + " (" + cases.length + ")");
const out = flag("outputFile.json") || (process.argv.includes("--json") ? flag("outputFile") : "");
if (out) {
  const files = [...new Set(cases.map((c) => c.file))];
  const testResults = files.map((file) => {
    const own = cases.filter((c) => c.file === file);
    return {
      name: file,
      status: own.some((c) => c.status === "failed") ? "failed" : "passed",
      assertionResults: own.map((c) => ({ ancestorTitles: [], title: c.title, status: c.status })),
    };
  });
  fs.writeFileSync(out, JSON.stringify({ testResults }));
}
process.exit(failed ? 1 : 0);
`;

export const FAKE_FILES = { "vitest.js": FAKE_RUNNER, "jest.js": FAKE_RUNNER };

export const vitest = (...flags: string[]) => ["node vitest.js run", ...flags].join(" ");
