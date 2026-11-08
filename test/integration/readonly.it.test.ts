import { describe, expect, it } from "vitest";
import { InstanceProfile } from "../../src/client/InstanceProfile.js";
import { RestClient } from "../../src/client/RestClient.js";
import { loadConfig } from "../../src/config.js";
import { projectIssueCards } from "../../src/projection/issueCard.js";
import { asRecord } from "../../src/util/json.js";
import type { JiraConfig } from "../../src/config.js";

/**
 * OPTIONAL integration tests against a REAL Jira instance.
 * Enabled only when JIRA_IT=1 is set (plus JIRA_BASE_URL/JIRA_API_TOKEN and,
 * for Cloud, JIRA_EMAIL). Read-only scenario.
 */
const { config, problems } = loadConfig();
const enabled = process.env.JIRA_IT === "1" && problems.length === 0;

function makeContext(config: JiraConfig) {
  const profile = new InstanceProfile(config);
  return { profile, client: new RestClient(config, profile) };
}

describe.skipIf(!enabled)("read-only integration (JIRA_IT=1)", () => {
  it("fetches server info", async () => {
    const { client } = makeContext(config);
    const info = asRecord(await client.request("api/2/serverInfo"));
    expect(typeof info?.version).toBe("string");
    expect(info?.deploymentType).toBeDefined();
  });

  it("runs a one-page search with cards", async () => {
    const { client } = makeContext(config);
    const payload = asRecord(
      await client.request("api/2/search", {
        method: "POST",
        body: { jql: "ORDER BY updated DESC", startAt: 0, maxResults: 1, fields: ["summary"] },
      }),
    );
    const cards = projectIssueCards(Array.isArray(payload?.issues) ? payload.issues : []);
    expect(cards.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(cards)).not.toContain("avatarUrls");
  });

  it("lists boards and one backlog page", async () => {
    const { client } = makeContext(config);
    const boards = asRecord(await client.request("agile/1.0/board", { query: { maxResults: 1 } }));
    const first = asRecord(Array.isArray(boards?.values) ? boards.values[0] : undefined);
    if (!first || typeof first.id !== "number") {
      process.stderr.write("integration: no boards visible; skipping backlog check\n");
      return;
    }
    const backlog = asRecord(
      await client.request(`agile/1.0/board/${first.id}/backlog`, {
        query: { startAt: 0, maxResults: 1 },
      }),
    );
    expect(backlog).not.toBeNull();
    expect(Array.isArray(backlog?.issues) ?? Array.isArray(backlog?.values)).toBe(true);
  });
});
