import { rawBlocks } from "./continuation.js";
import { MARKER } from "./parser.js";

export type Repair = { text: string; repairs: string[] };

const LOOSE_MARKER =
  /^[ \t]*<<<[ \t]*(end[ \t]+)?(summary|questions|config|file)[ \t]*(?::[ \t]*([^>\n]*?))?[ \t]*>>>[ \t]*$/gim;

export function repairPlan(text: string, truncated: boolean | undefined): Repair {
  const spaced = normalizeMarkers(text);
  const closed =
    truncated === false ? closeLastFile(spaced.text) : { text: spaced.text, repairs: [] };
  return { text: closed.text, repairs: [...spaced.repairs, ...closed.repairs] };
}

function normalizeMarkers(text: string): Repair {
  const strict = new RegExp(MARKER.source, "m");
  let count = 0;
  const fixed = text.replace(LOOSE_MARKER, (line, end: string | undefined, kind: string, path) => {
    if (strict.test(line)) return line;
    count++;
    const name = kind.toUpperCase();
    if (end) return `<<<END ${name}>>>`;
    return name === "FILE" ? `<<<FILE: ${String(path ?? "").trim()}>>>` : `<<<${name}>>>`;
  });
  const repairs = count > 0 ? [`normalized ${count} marker(s) with extra spaces or lowercase`] : [];
  return { text: fixed, repairs };
}

function closeLastFile(text: string): Repair {
  const last = rawBlocks(text).at(-1);
  if (!last || last.closed || !last.key.startsWith("FILE:")) return { text, repairs: [] };
  const path = last.key.slice("FILE:".length).trim();
  return {
    text: `${text.trimEnd()}\n<<<END FILE>>>\n`,
    repairs: [`closed the last FILE block (${path}) that was missing <<<END FILE>>>`],
  };
}
