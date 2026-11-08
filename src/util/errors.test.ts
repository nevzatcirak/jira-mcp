import { describe, expect, it } from "vitest";
import { buildJiraHttpError, toMcpError } from "./errors.js";

const fakeBadRequest = {
  status: 400,
  body: {
    errorMessages: ["The value 'xxx' does not exist for the field 'project'."],
    errors: { project: "project is required" },
  },
};

describe("buildJiraHttpError", () => {
  it("converts a 400 response with errorMessages + errors into a structured error", () => {
    const err = buildJiraHttpError(fakeBadRequest.status, fakeBadRequest.body);
    expect(err.code).toBe("JIRA_400");
    expect(err.message).toContain("does not exist for the field 'project'");
    expect(err.body.jiraErrors?.errorMessages).toEqual([
      "The value 'xxx' does not exist for the field 'project'.",
    ]);
    expect(err.body.jiraErrors?.errors).toEqual({ project: "project is required" });
    expect(err.body.jiraErrors?.raw).toBeUndefined();
  });

  it("keeps a raw body when it has neither errorMessages nor errors", () => {
    const err = buildJiraHttpError(502, { oops: true });
    expect(err.code).toBe("JIRA_502");
    expect(err.body.jiraErrors?.raw).toEqual({ oops: true });
  });

  it("handles plain-text bodies (proxies, HTML error pages)", () => {
    const err = buildJiraHttpError(503, "<html>Bad Gateway</html>");
    expect(err.code).toBe("JIRA_503");
    expect(err.body.jiraErrors?.errorMessages).toEqual(["<html>Bad Gateway</html>"]);
  });
});

describe("toMcpError", () => {
  it("renders a JiraMcpError as an MCP error result with structured content", () => {
    const err = buildJiraHttpError(400, fakeBadRequest.body);
    const result = toMcpError(err);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text) as {
      error: { code: string; message: string; jiraErrors: unknown };
    };
    expect(parsed.error.code).toBe("JIRA_400");
    expect(parsed.error.jiraErrors).toEqual({
      errorMessages: ["The value 'xxx' does not exist for the field 'project'."],
      errors: { project: "project is required" },
    });
  });

  it("maps unknown errors onto a generic structured code", () => {
    const result = toMcpError(new Error("socket hang up"));
    const parsed = JSON.parse(result.content[0].text) as { error: { code: string } };
    expect(result.isError).toBe(true);
    expect(parsed.error.code).toBe("JIRA_NETWORK");
  });

  it("never throws for non-Error values", () => {
    const result = toMcpError("boom");
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toHaveProperty("error.code", "JIRA_INTERNAL");
  });
});
