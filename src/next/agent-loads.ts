import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { asRecord, parseObject } from "../core/json.js";

const CLAUDE_SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];
const OPENCODE_CONFIGS = ["opencode.json", "opencode.jsonc"];
const MCP_FILES = [".mcp.json", ".gemini/settings.json"];
const PLUGIN_DIRS = [".opencode/plugin", ".opencode/plugins"];

export async function agentLoads(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const path of CLAUDE_SETTINGS) {
    const settings = await readJson(cwd, path, found);
    if (!settings) continue;
    found.push(...hookLines(path, asRecord(settings.hooks)));
    for (const [name, on] of Object.entries(asRecord(settings.enabledPlugins))) {
      if (on) found.push(`${path} plugin ${name}`);
    }
  }
  for (const path of MCP_FILES) {
    const data = await readJson(cwd, path, found);
    if (data) found.push(...serverLines(path, asRecord(data.mcpServers)));
  }
  for (const path of OPENCODE_CONFIGS) {
    const data = await readJson(cwd, path, found);
    if (!data) continue;
    found.push(...serverLines(path, asRecord(data.mcp)));
    const plugins = Array.isArray(data.plugin) ? data.plugin : [];
    found.push(...plugins.map((plugin) => `${path} plugin ${String(plugin)}`));
  }
  for (const dir of PLUGIN_DIRS) {
    const names = await readdir(join(cwd, ...dir.split("/"))).catch(() => []);
    found.push(...names.sort().map((name) => `${dir}/${name}`));
  }
  return found;
}

async function readJson(
  cwd: string,
  path: string,
  found: string[],
): Promise<Record<string, unknown> | undefined> {
  const text = await readTextIfExists(join(cwd, ...path.split("/")));
  if (text === undefined) return undefined;
  const data = parseObject(text) ?? parseObject(withoutComments(text));
  if (!data) found.push(`${path} (not valid JSON, so bae cannot list what it loads)`);
  return data;
}

function hookLines(path: string, hooks: Record<string, unknown>): string[] {
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group) => {
      const entries = asRecord(group).hooks;
      return (Array.isArray(entries) ? entries : []).map((entry) => {
        const hook = asRecord(entry);
        const run = hook.command ?? hook.url ?? hook.prompt ?? hook.type;
        return `${path} hook ${event}: ${String(run)}`;
      });
    }),
  );
}

function serverLines(path: string, servers: Record<string, unknown>): string[] {
  return Object.entries(servers).map(([name, value]) => {
    const server = asRecord(value);
    const command = Array.isArray(server.command)
      ? server.command.join(" ")
      : [server.command, ...(Array.isArray(server.args) ? server.args : [])]
          .filter((part) => part !== undefined)
          .join(" ");
    return `${path} MCP server ${name}: ${command || String(server.url ?? server.httpUrl ?? "")}`;
  });
}

function withoutComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
