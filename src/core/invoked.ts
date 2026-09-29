export const CLI = invokedAs(process.argv[1]);

export function invokedAs(script: string | undefined): string {
  const name = (script ?? "")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(c?js|mjs|cmd|ps1|exe)$/i, "");
  return name === "bae" ? "bae" : "npx builder-assistant-engineer";
}
