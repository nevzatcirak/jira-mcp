import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgileClient } from "./agileClient.js";
import { InstanceProfile } from "../client/InstanceProfile.js";
import { RestClient } from "../client/RestClient.js";
import { JiraMcpError } from "../util/errors.js";
import type { JiraConfig } from "../config.js";

const config: JiraConfig = {
  baseUrl: "https://jira.example.com",
  apiToken: "test-token",
  email: null,
  instanceType: "server",
  providersConfigPath: null,
};

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

function makeAgile(): { agile: AgileClient; profile: InstanceProfile } {
  const profile = new InstanceProfile({ ...config });
  const agile = new AgileClient(new RestClient({ ...config }, profile), profile);
  return { agile, profile };
}

describe("AgileClient", () => {
  it("builds /rest/agile/1.0 URLs from sub-paths", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, { total: 0, startAt: 0, maxResults: 25, values: [] }),
    );
    const { agile } = makeAgile();

    await agile.request("board?startAt=0&maxResults=25");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://jira.example.com/rest/agile/1.0/board?startAt=0&maxResults=25",
    );
  });

  it("sends issue field requests (no expand) through the query builder", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, { total: 0, startAt: 0, maxResults: 25, issues: [] }),
    );
    const { agile } = makeAgile();

    await agile.request("board/1/backlog", {
      query: { startAt: 0, maxResults: 25, fields: "summary,status" },
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/rest/agile/1.0/board/1/backlog");
    expect(url).toContain("fields=summary%2Cstatus");
    expect(url).not.toContain("expand");
  });

  it("falls back to greenhopper once on 404 and caches the base on the profile", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonBody(404, { errorMessages: ["No agile API here"] }))
      .mockResolvedValueOnce(
        jsonBody(200, { total: 1, startAt: 0, maxResults: 25, values: [{ id: 7, name: "B" }] }),
      );
    const { agile, profile } = makeAgile();

    const result = (await agile.request("board")) as { total: number };

    expect(result.total).toBe(1);
    expect(profile.cachedAgileApiBase).toBe("greenhopper/1.0");

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("/rest/agile/1.0/board");
    expect(urls[1]).toContain("/rest/greenhopper/1.0/board");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses the cached greenhopper base on subsequent requests", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonBody(404, { errorMessages: ["not here"] }))
      .mockResolvedValueOnce(jsonBody(200, { values: [] }))
      .mockResolvedValueOnce(jsonBody(200, { values: [] }));
    const { agile, profile } = makeAgile();

    await agile.request("board");
    expect(profile.cachedAgileApiBase).toBe("greenhopper/1.0");
    await agile.request("board/1/sprint");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(thirdUrl).toContain("/rest/greenhopper/1.0/board/1/sprint");
  });

  it("propagates JIRA_404 when both agile and greenhopper return 404", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonBody(404, { errorMessages: ["no board"] }))
      .mockResolvedValueOnce(jsonBody(404, { errorMessages: ["no board either"] }));
    const { agile } = makeAgile();

    let caught: unknown;
    try {
      await agile.request("board/999/backlog");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JiraMcpError);
    expect((caught as JiraMcpError).code).toBe("JIRA_404");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back for non-404 errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonBody(400, { errorMessages: ["bad jql"] }));
    const { agile, profile } = makeAgile();

    let caught: unknown;
    try {
      await agile.request("board/1/backlog?jql=x");
    } catch (err) {
      caught = err;
    }
    expect((caught as JiraMcpError).code).toBe("JIRA_400");
    expect(profile.cachedAgileApiBase).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pageMeta / extractItems", () => {
  it("computes hasMore/nextStartAt from total", async () => {
    const { pageMeta } = await import("./agileClient.js");
    const meta = pageMeta({ total: 60, startAt: 25, maxResults: 25 }, 25, 25, 25);
    expect(meta).toEqual({
      total: 60,
      startAt: 25,
      maxResults: 25,
      hasMore: true,
      nextStartAt: 50,
    });
    expect(pageMeta({ total: 50, startAt: 25, maxResults: 25 }, 25, 25, 25).hasMore).toBe(false);
    expect(pageMeta({ total: 50, startAt: 25, maxResults: 25 }, 25, 25, 25).nextStartAt).toBeNull();
  });

  it("extracts values for board/sprint lists and issues for issue endpoints", async () => {
    const { extractItems } = await import("./agileClient.js");
    expect(extractItems({ values: [{ id: 1 }] }, ["values", "issues"])).toEqual([{ id: 1 }]);
    expect(extractItems({ issues: [{ key: "A-1" }] }, ["issues", "values"])).toEqual([
      { key: "A-1" },
    ]);
    expect(extractItems(null, ["issues"])).toEqual([]);
  });
});
