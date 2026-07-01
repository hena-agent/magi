import { describe, expect, it } from "vitest";
import { parseJsonObjectFromText } from "./json.js";

describe("parseJsonObjectFromText", () => {
  it("parses raw JSON objects", () => {
    expect(parseJsonObjectFromText('{"type":"finish","summary":"done"}')).toEqual({
      type: "finish",
      summary: "done",
    });
  });

  it("parses fenced JSON objects", () => {
    expect(parseJsonObjectFromText('```json\n{"type":"answer","content":"ok"}\n```')).toEqual({
      type: "answer",
      content: "ok",
    });
  });

  it("rejects arrays", () => {
    expect(() => parseJsonObjectFromText("[]")).toThrow(/object/);
  });
});
