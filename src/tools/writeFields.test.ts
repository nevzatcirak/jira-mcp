import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceProfile } from "../client/InstanceProfile.js";
import { RestClient } from "../client/RestClient.js";
import { JiraMcpError } from "../util/errors.js";
import {
  commentBody,
  isAccountIdLike,
  projectUserCard,
  resolveUserFieldValue,
  unassignBody,
} from "./writeFields.js";
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

function makeContext(config: JiraConfig): ToolContext {
  const profile = new InstanceProfile({ ...config });
  return {
    config,
    profile,
    client: new RestClient({ ...config }, profile),
    agile: undefined as never, // write tools do not use the agile client
  };
}

const serverConfig: JiraConfig = {
  baseUrl: "https://jira.example.com",
  apiToken: "test-token",
  email: null,
  instanceType: "server",
};

const cloudConfig: JiraConfig = {
  baseUrl: "https://example.atlassian.net",
  apiToken: "test-token",
  email: "bot@example.com",
  instanceType: "cloud",
};

describe("isAccountIdLike", () => {
  it("accepts 24-char hex and site-prefixed account ids", () => {
    expect(isAccountIdLike("5b10ac8d82e05b22cc7d4ef5")).toBe(true);
    expect(isAccountIdLike("557058:5b10ac8d82e05b22cc7d4ef5")).toBe(true);
    expect(isAccountIdLike("accountid:5b10ac8d82e05b22cc7d4ef5")).toBe(true);
  });

  it("rejects plain names and short strings", () => {
    expect(isAccountIdLike("jdoe")).toBe(false);
    expect(isAccountIdLike("Jane Doe")).toBe(false);
    expect(isAccountIdLike("short12")).toBe(false);
  });
});

describe("resolveUserFieldValue (Server/DC)", () => {
  it("sends {name} without any lookup call", async () => {
    const ctx = makeContext(serverConfig);
    const value = await resolveUserFieldValue(ctx, "jdoe");
    expect(value).toEqual({ name: "jdoe" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes accountId-like values through as {accountId}", async () => {
    const ctx = makeContext(serverConfig);
    const value = await resolveUserFieldValue(ctx, "5b10ac8d82e05b22cc7d4ef5");
    expect(value).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef5" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveUserFieldValue (Cloud)", () => {
  it("passes accountId-like values through without lookup", async () => {
    const ctx = makeContext(cloudConfig);
    const value = await resolveUserFieldValue(ctx, "557058:5b10ac8d82e05b22cc7d4ef5");
    expect(value).toEqual({ accountId: "557058:5b10ac8d82e05b22cc7d4ef5" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a display name via user search to {accountId}", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, [
        {
          accountId: "5b10ac8d82e05b22cc7d4ef5",
          name: "",
          displayName: "Jane Doe",
          active: true,
        },
      ]),
    );
    const ctx = makeContext(cloudConfig);

    const value = await resolveUserFieldValue(ctx, "Jane Doe");

    expect(value).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef5" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/rest/api/2/user/search");
    expect(url).toContain("query=Jane");
  });

  it("throws USER_NOT_FOUND when search returns no exact match", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, [{ accountId: "a".repeat(24), name: "", displayName: "Jane Smith", active: true }]),
    );
    const ctx = makeContext(cloudConfig);

    let code = "";
    try {
      await resolveUserFieldValue(ctx, "Jane Doe");
    } catch (err) {
      code = (err as JiraMcpError).code;
    }
    expect(code).toBe("USER_NOT_FOUND");
  });

  it("throws AMBIGUOUS_USER when several exact matches exist", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(200, [
        { accountId: "a".repeat(24), name: "", displayName: "Jane Doe", active: true },
        { accountId: "b".repeat(24), name: "", displayName: "Jane Doe", active: true },
      ]),
    );
    const ctx = makeContext(cloudConfig);

    let code = "";
    try {
      await resolveUserFieldValue(ctx, "Jane Doe");
    } catch (err) {
      code = (err as JiraMcpError).code;
    }
    expect(code).toBe("AMBIGUOUS_USER");
  });
});

describe("unassignBody", () => {
  it("uses {name: null} on Server/DC and {accountId: null} on Cloud", async () => {
    expect(await unassignBody(makeContext(serverConfig))).toEqual({ name: null });
    expect(await unassignBody(makeContext(cloudConfig))).toEqual({ accountId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deployment-specific comment bodies", () => {
  it("sends a plain string on Server/DC and an ADF doc on Cloud", async () => {
    expect(await commentBody(makeContext(serverConfig), "hi")).toBe("hi");
    expect(await commentBody(makeContext(cloudConfig), "hi")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
  });
});

describe("projectUserCard", () => {
  it("normalizes empty Cloud name/email fields to null", () => {
    const card = projectUserCard({
      accountId: "5b10ac8d82e05b22cc7d4ef5",
      name: "",
      key: "",
      displayName: "Jane Doe",
      active: true,
    });
    expect(card).toEqual({
      accountId: "5b10ac8d82e05b22cc7d4ef5",
      name: null,
      displayName: "Jane Doe",
      email: null,
      active: true,
    });
  });
});
