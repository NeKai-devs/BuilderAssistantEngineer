import { z } from "zod";
import { FormatError } from "../core/errors.js";

const replySchema = z.discriminatedUnion("done", [
  z.object({
    done: z.literal(false),
    question: z.string().min(1),
    why: z.string().optional(),
    options: z.array(z.string().min(1)).optional(),
  }),
  z.object({ done: z.literal(true), summary: z.string().min(1) }),
]);

export type InterviewReply = z.infer<typeof replySchema>;

export const INTERVIEW_FORMAT = [
  "JSON only, one of:",
  '{"done": false, "question": "...", "why": "one line on what this unblocks", "options": ["...", "..."]}',
  '{"done": true, "summary": "3-6 lines restating goal, users, scope, constraints and success criteria"}',
].join("\n");

export function parseInterviewReply(text: string): InterviewReply {
  const result = replySchema.safeParse(extractJson(text));
  if (!result.success) throw new FormatError(z.prettifyError(result.error));
  return result.data;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new FormatError("no JSON object found");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new FormatError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
