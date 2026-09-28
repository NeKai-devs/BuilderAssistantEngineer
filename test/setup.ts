import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "bae-home-"));
process.env.BAE_HOME = home;

afterAll(() => rmSync(home, { recursive: true, force: true }));
