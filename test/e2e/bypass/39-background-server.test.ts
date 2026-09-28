import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";

const server = (port: number, body: string) =>
  `require("http").createServer((req, res) => res.end(${JSON.stringify(body)})).listen(${port}, "127.0.0.1");\n`;
const verification = (port: number) =>
  [
    "node src/server.js &",
    "trap 'kill $!' EXIT",
    "sleep 1",
    `curl -sf http://127.0.0.1:${port}/ | grep -q ready`,
  ].join("\n");

describe("false positive 39: a Verification may start a server in the background", () => {
  it("runs the server check unattended and ends done", async () => {
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    const cwd = await bypassRepo({
      task: { command: verification(port), scope: "- `src/server.js`" },
    });
    const work = agent(cwd, { "src/server.js": server(port, "ready") });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).not.toContain("hides failures");
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("still fails when the server answers with something else", async () => {
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    const cwd = await bypassRepo({
      task: { command: verification(port), scope: "- `src/server.js`" },
    });
    const work = agent(cwd, { "src/server.js": server(port, "broken") });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Verification failed");
  });
});
