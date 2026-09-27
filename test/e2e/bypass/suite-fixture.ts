export const SUITE_FILES = () => ({
  "tests/setup.js":
    'global.assertEqual = (a, b) => { if (a !== b) throw new Error(a + " !== " + b); };\n',
  "tests/a.test.js": 'it("a", () => assertEqual(1, 1));\n',
  "tests/b.test.js":
    'const f = require("../src/feature.js");\nit("b", () => assertEqual(f.value, 1));\n',
  "src/feature.js": "module.exports = { value: 1 };\n",
});

export const TEST_CMD = "node vitest.js run";
export const JEST_CMD = "node jest.js";
export const BROKEN_FEATURE = "module.exports = { value: 2 };\n";
