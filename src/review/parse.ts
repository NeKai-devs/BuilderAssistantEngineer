import { z } from "zod";
import { FormatError } from "../core/errors.js";

const reviewSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocker", "major", "minor"]),
        id: z.string().optional(),
        file: z.string().optional(),
        message: z.string().min(1),
        justify: z.boolean().optional(),
      }),
    )
    .default([]),
});

export type ReviewReply = z.output<typeof reviewSchema>;
export type ReviewFinding = ReviewReply["findings"][number];

export const REVIEW_FORMAT =
  'JSON only: {"verdict": "pass" | "fail", "findings": [{"severity": "blocker" | "major" | "minor", "file": "optional path", "message": "..."}]}';

export function parseReview(text: string): ReviewReply {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new FormatError("no JSON object found");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new FormatError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = reviewSchema.safeParse(data);
  if (!result.success) throw new FormatError(z.prettifyError(result.error));
  const object = text.slice(start, end + 1);
  if ((object.match(/"verdict"\s*:/g) ?? []).length > 1) {
    throw new FormatError("more than one verdict");
  }
  const outside = `${text.slice(0, start)} ${text.slice(end + 1)}`;
  if (result.data.verdict === "pass" && /\bverdict\b[^\n{]{0,20}\bfail/i.test(outside)) {
    throw new FormatError("the text around the JSON contradicts its verdict");
  }
  return result.data;
}
