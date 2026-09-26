export const RUNNER = (
  style: "vitest" | "jest" = "vitest",
) => `const fs = require("fs"); const path = require("path");
let passed = 0, failed = 0, skipped = 0;
global.it = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); } };
global.it.skip = () => { skipped++; };
if (fs.existsSync("tests/setup.js")) require(path.resolve("tests/setup.js"));
for (const f of fs.readdirSync("tests").filter((n) => n.endsWith(".test.js")).sort()) require(path.resolve("tests", f));
const total = passed + failed + skipped;
${
  style === "vitest"
    ? 'const parts = [failed && failed + " failed", passed + " passed", skipped && skipped + " skipped"].filter(Boolean); console.log("      Tests  " + parts.join(" | ") + " (" + total + ")");'
    : 'console.log("Tests:       " + failed + " failed, " + passed + " passed, " + total + " total");'
}
process.exit(failed ? 1 : 0);
`;

export const SUITE_FILES = (style: "vitest" | "jest" = "vitest") => ({
  "run-tests.js": RUNNER(style),
  "tests/setup.js":
    'global.assertEqual = (a, b) => { if (a !== b) throw new Error(a + " !== " + b); };\n',
  "tests/a.test.js": 'it("a", () => assertEqual(1, 1));\n',
  "tests/b.test.js":
    'const f = require("../src/feature.js");\nit("b", () => assertEqual(f.value, 1));\n',
  "src/feature.js": "module.exports = { value: 1 };\n",
});

export const TEST_CMD = "node run-tests.js";
export const BROKEN_FEATURE = "module.exports = { value: 2 };\n";
