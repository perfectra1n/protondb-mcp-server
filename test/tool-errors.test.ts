import { describe, it, expect } from "vitest";
import { textResult, errorResult, withResolvedAppId } from "../src/tools/result.js";

describe("textResult", () => {
  it("builds a plain text result", () => {
    expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
  });
  it("attaches structured content when provided", () => {
    const r = textResult("hi", { a: 1 });
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.isError).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("marks the result as an error", () => {
    const r = errorResult("bad");
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: "bad" }]);
  });
});

describe("withResolvedAppId", () => {
  const textOf = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("runs the callback with a directly-supplied appId (no lookup)", async () => {
    const r = await withResolvedAppId({ appId: "620" }, async ({ appId, name }) =>
      textResult(`got ${appId}/${name}`),
    );
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toBe("got 620/null");
  });

  it("returns an error result (not a throw) when nothing is provided", async () => {
    let called = false;
    const r = await withResolvedAppId({}, async () => {
      called = true;
      return textResult("should not run");
    });
    expect(called).toBe(false);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/appId or a game name/);
  });
});
