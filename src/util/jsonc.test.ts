import { describe, expect, it } from "vitest";
import { parseJsonc, stripJsoncComments } from "./jsonc.js";

describe("stripJsoncComments", () => {
  it("removes line comments", () => {
    expect(stripJsoncComments('{\n  // a comment\n  "a": 1\n}')).toBe('{\n  \n  "a": 1\n}');
  });

  it("removes block comments", () => {
    expect(stripJsoncComments('{ /* header\n   spans lines */ "a": 1 }')).toBe('{  "a": 1 }');
  });

  it("keeps comment-like sequences inside strings", () => {
    const input = '{ "url": "https://x.example.com/a//b", "c": "/* not a comment */" }';
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("keeps escaped quotes inside strings", () => {
    const input = '{ "text": "say \\"// hi\\"", "n": 1 } // trailing';
    expect(stripJsoncComments(input)).toBe('{ "text": "say \\"// hi\\"", "n": 1 } ');
  });
});

describe("parseJsonc", () => {
  it("parses a config with comments and trailing commas", () => {
    const text = `{
      // providers
      "providers": {
        "demo": {
          "description": "example", /* inline */
          "endpoints": {
            "daily": { "method": "GET", "path": "/rest/<plugin>/1.0/daily", },
          },
        },
      },
    }`;
    const parsed = parseJsonc(text) as {
      providers: { demo: { endpoints: { daily: { method: string } } } };
    };
    expect(parsed.providers.demo.endpoints.daily.method).toBe("GET");
  });

  it("throws on genuinely broken JSON", () => {
    expect(() => parseJsonc("{ providers: ")).toThrow();
  });
});
