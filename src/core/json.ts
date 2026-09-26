export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}
