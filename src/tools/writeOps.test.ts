import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorklogRequest, decimalHoursToDuration } from "./jiraAddWorklog.js";
import { remoteLinkBody } from "./jiraAddRemoteLink.js";
import { assertFileSize } from "./jiraAddAttachment.js";
import { InstanceProfile } from "../client/InstanceProfile.js";
import { RestClient } from "../client/RestClient.js";
import { JiraMcpError, buildJiraHttpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";
import type { JiraConfig } from "../config.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonBody(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const serverConfig: JiraConfig = {
  baseUrl: "https://jira.example.com",
  apiToken: "test-token",
  email: null,
  instanceType: "server",
  providersConfigPath: null,
};

function makeContext(config: JiraConfig = serverConfig): ToolContext {
  const profile = new InstanceProfile({ ...config });
  return {
    config,
    profile,
    client: new RestClient({ ...config }, profile),
    agile: undefined as never,
  };
}

describe("buildWorklogRequest", () => {
  it("sends a duration string in the body by default (adjustEstimate=auto -> no query)", () => {
    const { body, query } = buildWorklogRequest(
      { timeSpent: "3h 30m", adjustEstimate: "auto" },
      "server",
      undefined,
    );
    expect(body).toEqual({ timeSpent: "3h 30m" });
    expect(query).toEqual({});
  });

  it("converts decimal hours to a duration rounded to the nearest minute", () => {
    expect(decimalHoursToDuration(7.71)).toBe("7h 43m");
    expect(decimalHoursToDuration(8.05)).toBe("8h 3m");
    expect(decimalHoursToDuration(0.5)).toBe("0h 30m");
    expect(decimalHoursToDuration(8.0)).toBe("8h");
    expect(decimalHoursToDuration(0.005)).toBe("0h 1m"); // minimum 1 minute
    expect(decimalHoursToDuration(0.999)).toBe("1h"); // 59.94m rounds up to a full hour
  });

  it("converts numeric and numeric-string timeSpent into a duration string", () => {
    const numeric = buildWorklogRequest({ timeSpent: 8.05, adjustEstimate: "auto" }, "server", undefined);
    expect(numeric.body).toEqual({ timeSpent: "8h 3m" });

    const numericString = buildWorklogRequest({ timeSpent: "7.71", adjustEstimate: "auto" }, "server", undefined);
    expect(numericString.body).toEqual({ timeSpent: "7h 43m" });
  });

  it("combines a date-only started with startedHour (default 07:30)", () => {
    const defaultHour = buildWorklogRequest(
      { timeSpent: "1h", started: "2026-01-14", adjustEstimate: "auto" },
      "server",
      undefined,
    );
    expect(defaultHour.body.started).toBe("2026-01-14T07:30:00");

    const customHour = buildWorklogRequest(
      { timeSpent: "1h", started: "2026-01-14", startedHour: "09:15", adjustEstimate: "auto" },
      "server",
      undefined,
    );
    expect(customHour.body.started).toBe("2026-01-14T09:15:00");
  });

  it("uses a full ISO started as-is and ignores startedHour", () => {
    const { body } = buildWorklogRequest(
      {
        timeSpent: "1h",
        started: "2026-01-14T10:33:00.000+0000",
        startedHour: "09:15",
        adjustEstimate: "auto",
      },
      "server",
      undefined,
    );
    expect(body.started).toBe("2026-01-14T10:33:00.000+0000");
  });

  it("includes started and the (deployment-formatted) comment", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "worked" }] }],
    };
    const { body } = buildWorklogRequest(
      { timeSpent: "1h", started: "2026-01-14T10:33:00.000+0000", comment: "worked", adjustEstimate: "auto" },
      "cloud",
      adf,
    );
    expect(body).toEqual({
      timeSpent: "1h",
      started: "2026-01-14T10:33:00.000+0000",
      comment: adf,
    });
  });

  it("maps adjustEstimate values to query params", () => {
    const leave = buildWorklogRequest({ timeSpent: "1h", adjustEstimate: "leave" }, "server", undefined);
    expect(leave.query).toEqual({ adjustEstimate: "leave" });

    const adjustNew = buildWorklogRequest({ timeSpent: "1h", adjustEstimate: "new", newValue: "1d 2h" }, "server", undefined);
    expect(adjustNew.query).toEqual({ adjustEstimate: "new", newEstimate: "1d 2h" });

    const manualServer = buildWorklogRequest({ timeSpent: "1h", adjustEstimate: "manual", newValue: "2h" }, "server", undefined);
    expect(manualServer.query).toEqual({ adjustEstimate: "manual", reduceEstimateBy: "2h" });

    const manualCloud = buildWorklogRequest({ timeSpent: "1h", adjustEstimate: "manual", newValue: "2h" }, "cloud", undefined);
    expect(manualCloud.query).toEqual({ adjustEstimate: "manual", reduceBy: "2h" });
  });

  it("rejects new/manual without newValue", () => {
    let code = "";
    try {
      buildWorklogRequest({ timeSpent: "1h", adjustEstimate: "new" }, "server", undefined);
    } catch (err) {
      code = (err as JiraMcpError).code;
    }
    expect(code).toBe("INVALID_ARGUMENT");
  });
});

describe("remoteLinkBody", () => {
  it("builds {object:{url,title}} and omits title when absent", () => {
    expect(remoteLinkBody("https://ci.example.com/build/42", "Build 42")).toEqual({
      object: { url: "https://ci.example.com/build/42", title: "Build 42" },
    });
    expect(remoteLinkBody("https://ci.example.com/build/42")).toEqual({
      object: { url: "https://ci.example.com/build/42" },
    });
  });
});

describe("attachment upload (multipart via RestClient)", () => {
  it("sends FormData with X-Atlassian-Token and no manual Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, [{ id: "10001", filename: "log.txt", size: 3 }]),
    );
    const ctx = makeContext();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])]), "log.txt");
    const payload = await ctx.client.request("api/2/issue/ABC-1/attachments", {
      method: "POST",
      body: form,
      headers: { "X-Atlassian-Token": "no-check" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(urlArg)).toBe("https://jira.example.com/rest/api/2/issue/ABC-1/attachments");
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Atlassian-Token"]).toBe("no-check");
    expect(headers["Content-Type"]).toBeUndefined(); // boundary set by fetch itself
    expect(headers.Authorization).toContain("Bearer");
    // The attachment endpoint returns a JSON array even for one file; the
    // tool handler projects only the first element.
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as unknown[])[0]).toEqual({ id: "10001", filename: "log.txt", size: 3 });
  });

  it("rejects files over 10 MB before upload", () => {
    let code = "";
    try {
      assertFileSize(10 * 1024 * 1024 + 1);
    } catch (err) {
      code = (err as JiraMcpError).code;
    }
    expect(code).toBe("FILE_TOO_LARGE");
    expect(() => assertFileSize(10 * 1024 * 1024)).not.toThrow();
  });
});

describe("move issues to sprint", () => {
  it("returns moved count on success (204)", async () => {
    // 204 empty response
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const ctx = makeContext();

    const payload = await ctx.client.request("agile/1.0/sprint/42/issue", {
      method: "POST",
      body: { issues: ["ABC-1"] },
    });
    expect(payload).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/rest/agile/1.0/sprint/42/issue");
    expect(String(init.body)).toContain('"issues":["ABC-1"]');
  });

  it("maps a 400 (all-or-nothing failure) onto an errors list", async () => {
    const { errorsFromJira400 } = await import("./jiraMoveIssuesToSprint.js");
    const err = buildJiraHttpError(400, {
      errorMessages: ["Cannot move issues to sprint 42"],
      errors: { "ABC-2": "Issue does not belong to the sprint's project" },
    });
    expect(errorsFromJira400(err)).toEqual([
      "Cannot move issues to sprint 42",
      "ABC-2: Issue does not belong to the sprint's project",
    ]);
  });
});
