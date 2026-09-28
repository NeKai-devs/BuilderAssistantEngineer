import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    exclude: [...configDefaults.exclude, "test/fixtures/**"],
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
