import { describe, expect, it } from "vitest";
import { agentLoads } from "../../src/next/agent-loads.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("agentLoads", () => {
  it("lists the hooks, plugins and MCP servers an agent loads from the repository", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, {
      ".claude/settings.json": JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "node .claude/start.js" }] }],
        },
        enabledPlugins: { "formatter@team": true, "off@team": false },
      }),
      ".mcp.json": JSON.stringify({
        mcpServers: { docs: { type: "http", url: "https://x.test/mcp" } },
      }),
      "opencode.jsonc":
        '{\n  // local tools\n  "mcp": {"db": {"type": "local", "command": ["npx", "db-mcp"]}},\n  "plugin": ["opencode-notify"]\n}\n',
      ".opencode/plugin/audit.ts": "export default {};\n",
      ".gemini/settings.json": "{ not json",
    });
    expect(await agentLoads(cwd)).toEqual([
      ".claude/settings.json hook SessionStart: node .claude/start.js",
      ".claude/settings.json plugin formatter@team",
      ".mcp.json MCP server docs: https://x.test/mcp",
      ".gemini/settings.json (not valid JSON, so bae cannot list what it loads)",
      "opencode.jsonc MCP server db: npx db-mcp",
      "opencode.jsonc plugin opencode-notify",
      ".opencode/plugin/audit.ts",
    ]);
  });

  it("finds nothing in a repository without agent settings", async () => {
    expect(await agentLoads(await tempDir())).toEqual([]);
  });
});
