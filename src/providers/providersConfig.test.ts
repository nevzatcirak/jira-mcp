import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProvidersConfig } from "./providersConfig.js";
import { JiraMcpError } from "../util/errors.js";

const VALID_CONFIG = `{
  // workplace plugin endpoints (example)
  "providers": {
    "timesheet": {
      "description": "Timesheet plugin",
      "endpoints": {
        "dailyWorked": {
          "method": "GET",
          "path": "/rest/<plugin>/1.0/turnike?period={start}+-+{end}",
          "responseMapping": { "total": "total", "dailyHours": "items[].hour" },
          "maxResponseBytes": 20000
        },
        "approvedHours": {
          "method": "POST",
          "path": "/rest/<plugin>/1.0/puantaj"
        }
      }
    }
  }
}`;

let dir: string | null = null;

async function writeConfig(content: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "jira-mcp-providers-"));
  const filePath = join(dir, "providers.jsonc");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("loadProvidersConfig", () => {
  it("loads and validates a JSONC providers file", async () => {
    const config = loadProvidersConfig(await writeConfig(VALID_CONFIG));
    const daily = config.providers.timesheet.endpoints.dailyWorked;
    expect(daily.method).toBe("GET");
    expect(daily.maxResponseBytes).toBe(20000);
    expect(daily.responseMapping).toEqual({ total: "total", dailyHours: "items[].hour" });
    expect(config.providers.timesheet.endpoints.approvedHours.method).toBe("POST");
    expect(config.providers.timesheet.endpoints.approvedHours.responseMapping).toBeUndefined();
  });

  it("throws PROVIDERS_CONFIG_INVALID for a missing file", async () => {
    try {
      loadProvidersConfig("Z:/does/not/exist.jsonc");
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("PROVIDERS_CONFIG_INVALID");
      expect(e.body.message).toContain("Z:/does/not/exist.jsonc");
    }
  });

  it("throws PROVIDERS_CONFIG_INVALID for broken JSONC (with file path)", async () => {
    const filePath = await writeConfig("{ providers: { ");
    try {
      loadProvidersConfig(filePath);
      expect.unreachable();
    } catch (err) {
      const e = err as JiraMcpError;
      expect(e.code).toBe("PROVIDERS_CONFIG_INVALID");
      expect(e.body.message).toContain(filePath);
    }
  });

  it("rejects an endpoint without method or path", async () => {
    const filePath = await writeConfig(`{
      "providers": { "p": { "endpoints": { "e": { "path": "/rest/x" } } } }
    }`);
    expect(() => loadProvidersConfig(filePath)).toThrow(/method/);
  });

  it("rejects an invalid method and non-positive maxResponseBytes", async () => {
    const badMethod = await writeConfig(`{
      "providers": { "p": { "endpoints": { "e": { "method": "DELETE", "path": "/rest/x" } } } }
    }`);
    expect(() => loadProvidersConfig(badMethod)).toThrow(/invalid "method"/);

    const badBytes = await writeConfig(`{
      "providers": { "p": { "endpoints": { "e": { "method": "GET", "path": "/rest/x", "maxResponseBytes": -1 } } } }
    }`);
    expect(() => loadProvidersConfig(badBytes)).toThrow(/invalid "maxResponseBytes"/);
  });

  it("rejects a provider without endpoints", async () => {
    const filePath = await writeConfig(`{ "providers": { "p": { "description": "empty" } } }`);
    expect(() => loadProvidersConfig(filePath)).toThrow(/at least one endpoint/);
  });
});
