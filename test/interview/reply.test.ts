import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { parseInterviewReply } from "../../src/interview/reply.js";

describe("parseInterviewReply", () => {
  it("accepts a question or a final summary, even inside a code fence", () => {
    expect(
      parseInterviewReply(
        '{"done": false, "question": "Who pays?", "options": ["users", "companies"]}',
      ),
    ).toEqual({
      done: false,
      question: "Who pays?",
      options: ["users", "companies"],
    });
    expect(parseInterviewReply('```json\n{"done": true, "summary": "A CLI."}\n```')).toEqual({
      done: true,
      summary: "A CLI.",
    });
  });

  it.each([
    ["no JSON at all", "I have no more questions."],
    ["broken JSON", '{"done": false, "question": }'],
    ["missing fields", '{"done": false}'],
    ["wrong types", '{"done": "yes", "summary": 3}'],
  ])("rejects %s with a FormatError", (_, text) => {
    expect(() => parseInterviewReply(text)).toThrow(FormatError);
  });
});
