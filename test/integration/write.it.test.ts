import { describe, expect, it } from "vitest";
import { InstanceProfile } from "../../src/client/InstanceProfile.js";
import { RestClient } from "../../src/client/RestClient.js";
import { AgileClient } from "../../src/agile/agileClient.js";
import { loadConfig, requireCompleteConfig } from "../../src/config.js";
import { asRecord, asString } from "../../src/util/json.js";
import type { JiraConfig } from "../../src/config.js";

/**
 * OPTIONAL write-scenario integration test. Requires:
 *   JIRA_IT=1                      (enables integration tests)
 *   JIRA_E2E_PROJECT=<KEY>         (project where issues may be created AND deleted)
 *   JIRA_E2E_ISSUE_TYPE=<name>     (optional, default "Task")
 * Creates two issues, exercises comment/worklog/transition/link, then DELETES them.
 */
const { config, problems } = loadConfig();
const enabled =
  process.env.JIRA_IT === "1" &&
  typeof process.env.JIRA_E2E_PROJECT === "string" &&
  problems.length === 0;

function makeContext(config: JiraConfig) {
  const profile = new InstanceProfile(config);
  const client = new RestClient(config, profile);
  return { profile, client, agile: new AgileClient(client, profile) };
}

describe.skipIf(!enabled)("write scenario integration (JIRA_IT=1 + JIRA_E2E_PROJECT)", () => {
  it("create -> comment -> worklog -> transition -> link -> cleanup", async () => {
    requireCompleteConfig(config);
    const project = process.env.JIRA_E2E_PROJECT as string;
    const issueType = process.env.JIRA_E2E_ISSUE_TYPE ?? "Task";
    const { client, agile } = makeContext(config);

    const create = async (summary: string): Promise<string> => {
      const payload = asRecord(
        await client.request("api/2/issue", {
          method: "POST",
          body: {
            fields: {
              project: /^\d+$/.test(project) ? { id: project } : { key: project },
              issuetype: { name: issueType },
              summary,
            },
          },
        }),
      );
      const key = asString(payload?.key);
      expect(key).toBeTruthy();
      createdKeys.push(key as string);
      return key as string;
    };
    const remove = async (key: string): Promise<void> => {
      await client.request(`api/2/issue/${key}?deleteSubtasks=true`, { method: "DELETE" });
    };

    try {
      // 1. create two issues
      const keyA = await create("jira-mcp IT issue A (safe to delete)");
      const keyB = await create("jira-mcp IT issue B (safe to delete)");

      // 2. comment
      const comment = asRecord(
        await client.request(`api/2/issue/${keyA}/comment`, {
          method: "POST",
          body: { body: "integration test comment" },
        }),
      );
      expect(asString(comment?.id)).toBeTruthy();

      // 3. worklog
      const worklog = asRecord(
        await client.request(`api/2/issue/${keyA}/worklog`, {
          method: "POST",
          body: { timeSpent: "5m" },
        }),
      );
      expect(asString(worklog?.id)).toBeTruthy();

      // 4. transition via toStatus (first available transition)
      const transitions = asRecord(
        await client.request(`api/2/issue/${keyA}/transitions`),
      );
      const list = Array.isArray(transitions?.transitions) ? transitions.transitions : [];
      const firstTo = asString(asRecord(asRecord(list[0])?.to)?.name);
      if (firstTo) {
        await client.request(`api/2/issue/${keyA}/transitions`, {
          method: "POST",
          body: { transition: { id: asString(asRecord(list[0])?.id) } },
        });
      }

      // 5. link (type must exist on the instance; 'Relates' is standard)
      await client.request("api/2/issueLink", {
        method: "POST",
        body: {
          type: { name: "Relates" },
          inwardIssue: { key: keyA },
          outwardIssue: { key: keyB },
        },
      });

      // sanity: agile API reachable through the fallback wrapper
      await agile.request("board", { query: { maxResults: 1 } });
    } finally {
      // 6. cleanup (Cloud keeps them in trash for ~60 days; Server deletes immediately)
      for (const key of createdKeys.splice(0)) {
        await remove(key).catch(() => undefined);
      }
    }
  });
});

const createdKeys: string[] = [];
