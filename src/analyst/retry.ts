import { join, relative } from "node:path";
import type { Backend, RunOptions } from "../backends/types.js";
import { FormatError, UserError } from "../core/errors.js";
import { writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import { loadPrompt, type Prompt, renderPrompt } from "../core/prompt-loader.js";
import { t } from "../i18n/index.js";

export type FormatRequest<T> = {
  backend: Backend;
  prompt: string;
  options: RunOptions;
  parse: (text: string) => T;
  format: string;
  fixPrompt?: Prompt;
  onRetry?: (error: FormatError) => void;
  complete?: (text: string) => Promise<string>;
  retryPrompt?: (first: string, error: FormatError) => Promise<string | undefined>;
};

export async function runWithFormatRetry<T>(request: FormatRequest<T>): Promise<T> {
  const { backend, options, parse } = request;
  const complete = request.complete ?? (async (text: string) => text);
  const first = await complete(await backend.run(request.prompt, options));
  try {
    return parse(first);
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    const instead = await request.retryPrompt?.(first, error);
    if (!instead) request.onRetry?.(error);
    const fix =
      instead ??
      renderPrompt(request.fixPrompt ?? (await loadPrompt("fix-format", options.cwd)), {
        error: error.message,
        format: request.format,
        previous_response: first,
      });
    return parseOrReport(await complete(await backend.run(fix, options)), parse, options.cwd);
  }
}

async function parseOrReport<T>(text: string, parse: (text: string) => T, cwd: string): Promise<T> {
  try {
    return parse(text);
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    const path = join(baePaths(cwd).tmp, "last-response.md");
    await writeText(path, text);
    const shown = relative(cwd, path).split("\\").join("/");
    throw new UserError(t("format.failed", { details: error.message, path: shown }));
  }
}
