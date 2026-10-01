import { configDefaults, defineConfig } from "vitest/config";

const WINDOWS = process.platform === "win32";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    exclude: [...configDefaults.exclude, "test/fixtures/**"],
    restoreMocks: true,
    testTimeout: WINDOWS ? 120_000 : 30_000,
  },
});
