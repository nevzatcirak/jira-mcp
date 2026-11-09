import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstanceProfile } from "../client/InstanceProfile.js";
import { RestClient } from "../client/RestClient.js";
import { resolveProviderPath, runProviderCall } from "./jiraProviderCall.js";
import { JiraMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";
import type { JiraConfig } from "../config.js";

const CONFIG = `{
  "providers": {
    "timesheet": {
      "description": "Timesheet plugin example",
      "endpoints": {
        "dailyWorked": {
          "method": "GET",
          "path": "/rest/<plugin>/1.0/daily?period={start}+-+{end}&user=currentUser()",
          "responseMapping": { "total": "total", "dailyHours": "items[].hour" },
          "maxResponseBytes": 100
        },
        "submitTimesheet": {
          "method": "POST",
          "path": "/rest/<plugin>/1.0/submit/{month}"
        }
      }
    },
    "other": {
      "endpoints": { "ping": { "method": "GET", "path": "/rest/<other>/1.0/ping" } }
    }
  }
}`;

const PAYLOAD = {
  total: 28.66,
  items: [
    { day: "2026-11-02", hour: 7.71 },
    { day: "2026-11-03", hour: 8.05 },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let dir: string | null = null;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = null;
  }
});

function jsonBody(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const baseConfig: JiraConfig = {
  baseUrl: "https://jira.example.com",
  apiToken: "test-token",
  email: null,
  instanceType: "server",
  providersConfigPath: null,
};

function makeContext(providersConfigPath: string | null): ToolContext {
  const config: JiraConfig = { ...baseConfig, providersConfigPath };
  const profile = new InstanceProfile({ ...config });
  return {
    config,
    profile,
    client: new RestClient({ ...config }, profile),
    agile: undefined as never,
  };
}

async function contextWithConfigFile(): Promise<ToolContext> {
  dir = await mkdtemp(join(tmpdir(), "jira-mcp-provider-call-"));
  const filePath = join(dir, "providers.jsonc");
  await writeFile(filePath, CONFIG, "utf8");
  return makeContext(filePath);
}

describe("resolveProviderPath", () => {
  it("substitutes path params (encoded) and query params (raw)", () => {
    const { apiPath, query, unusedParams } = resolveProviderPath(
      "/rest/<plugin>/1.0/daily?period={start}+-+{end}",
      { start: "2026-11-02", end: "2026-11-08" },
    );
    expect(apiPath).toBe("<plugin>/1.0/daily");
    expect(query).toEqual({ period: "2026-11-02+-+2026-11-08" });
    expect(unusedParams).toEqual([]);
  });

  it("reports params not used by the template and rejects missing ones", () => {
    const { unusedParams } = resolveProviderPath("/rest/<plugin>/1.0/x", { extra: 1 });
    expect(unusedParams).toEqual(["extra"]);

    expect(() => resolveProviderPath("/rest/x/{missing}", {})).toThrow(/Missing parameter/);
  });
});

describe("jira_provider_call behaviour", () => {
  it("fails with CONFIG_MISSING + hint when JIRA_PROVIDERS_CONFIG is not set", async () => {
    const ctx = makeContext(null);
    try {
      await runProviderCall({ provider: "timesheet", endpoint: "dailyWorked" }, ctx);
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("CONFIG_MISSING");
      expect(e.body.hint).toContain("JIRA_PROVIDERS_CONFIG");
      expect(e.body.hint).toContain("examples/providers.example.jsonc");
    }
  });

  it("fails with PROVIDER_UNKNOWN and lists available providers", async () => {
    const ctx = await contextWithConfigFile();
    try {
      await runProviderCall({ provider: "nope", endpoint: "dailyWorked" }, ctx);
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("PROVIDER_UNKNOWN");
      expect(e.body.hint).toContain("timesheet");
      expect(e.body.hint).toContain("other");
    }
  });

  it("fails with ENDPOINT_UNKNOWN and lists the provider's endpoints", async () => {
    const ctx = await contextWithConfigFile();
    try {
      await runProviderCall({ provider: "timesheet", endpoint: "nope" }, ctx);
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("ENDPOINT_UNKNOWN");
      expect(e.body.hint).toContain("dailyWorked");
      expect(e.body.hint).toContain("submitTimesheet");
    }
  });

  it("calls the endpoint through RestClient with auth and applies responseMapping", async () => {
    fetchMock.mockResolvedValueOnce(jsonBody(PAYLOAD));
    const ctx = await contextWithConfigFile();

    const result = await runProviderCall(
      { provider: "timesheet", endpoint: "dailyWorked", params: { start: "2026-11-02", end: "2026-11-08" } },
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://jira.example.com/rest/%3Cplugin%3E/1.0/daily?period=2026-11-02%2B-%2B2026-11-08&user=currentUser%28%29",
    );
    expect((init.headers as Record<string, string>).Authorization).toContain("Bearer");
    expect(result).toEqual({ total: 28.66, dailyHours: [7.71, 8.05] });
  });

  it("returns the raw JSON when the endpoint has no responseMapping", async () => {
    fetchMock.mockResolvedValueOnce(jsonBody({ ok: true, detail: { a: 1 } }));
    const ctx = await contextWithConfigFile();

    const result = await runProviderCall({ provider: "other", endpoint: "ping" }, ctx);
    expect(result).toEqual({ ok: true, detail: { a: 1 } });
  });

  it("fails with RESPONSE_TOO_LARGE when maxResponseBytes is exceeded", async () => {
    fetchMock.mockResolvedValueOnce(jsonBody({ ...PAYLOAD, blob: "x".repeat(500) }));
    const ctx = await contextWithConfigFile();

    try {
      // dailyWorked has maxResponseBytes: 100; the payload is much larger.
      await runProviderCall({ provider: "timesheet", endpoint: "dailyWorked", params: { start: "a", end: "b" } }, ctx);
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("RESPONSE_TOO_LARGE");
      expect(e.body.message).toMatch(/\d+ bytes \(limit 100\)/);
    }
  });

  it("sends leftover params as the POST body", async () => {
    fetchMock.mockResolvedValueOnce(jsonBody({ ok: true }));
    const ctx = await contextWithConfigFile();

    await runProviderCall(
      { provider: "timesheet", endpoint: "submitTimesheet", params: { month: "2026-11", note: "auto" } },
      ctx,
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/rest/%3Cplugin%3E/1.0/submit/2026-11");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ note: "auto" });
  });
});
