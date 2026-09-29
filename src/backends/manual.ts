import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import clipboard from "clipboardy";
import { UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import { t } from "../i18n/index.js";
import { type Backend, withSystem } from "./types.js";

export type ManualIo = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  copy(text: string): Promise<void>;
};

const defaultIo: ManualIo = {
  input: process.stdin,
  output: process.stdout,
  copy: (text) => clipboard.write(text),
};

export function createManualBackend(overrides: Partial<ManualIo> = {}): Backend {
  const io = { ...defaultIo, ...overrides };
  return {
    name: "manual",
    run: async (request, options) => {
      const prompt = withSystem(request, options);
      const tmp = baePaths(options.cwd).tmp;
      const promptFile = join(tmp, "prompt.md");
      const responseFile = join(tmp, "response.md");
      await writeText(promptFile, prompt);
      await rm(responseFile, { force: true });
      const copied = await io.copy(prompt).then(
        () => true,
        () => false,
      );
      const show = (path: string) => relative(options.cwd, path).split("\\").join("/");
      io.output.write(`${prompt}\n\n`);
      io.output.write(
        `${t(copied ? "manual.copied" : "manual.notCopied", { path: show(promptFile) })}\n`,
      );
      if (options.interactive) {
        io.output.write(`${t("manual.awaitingDone")}\n`);
        await readPasted(io.input);
        return "";
      }
      io.output.write(`${t("manual.awaitingResponse", { path: show(responseFile) })}\n`);
      const pasted = await readPasted(io.input);
      const answer = pasted || ((await readTextIfExists(responseFile)) ?? "");
      if (!answer.trim())
        throw new UserError(t("manual.emptyResponse", { path: show(responseFile) }));
      return answer;
    },
  };
}

async function readPasted(input: NodeJS.ReadableStream): Promise<string> {
  const reader = createInterface({ input, terminal: false });
  const lines: string[] = [];
  for await (const line of reader) {
    if (lines.length === 0 && line.trim() === "") break;
    lines.push(line);
  }
  reader.close();
  return lines.join("\n");
}
