/**
 * Benchmark: old-style search (no fields, maxResults 50) vs the jira-mcp card
 * projection (card fields only, maxResults 25). Prints a byte / token-estimate
 * table. Requires JIRA_* env vars (see .env.example).
 *
 * Usage: npm run benchmark ["<JQL>"]   (JQL arg or JIRA_BENCHMARK_JQL env)
 */
import { InstanceProfile } from "../src/client/InstanceProfile.js";
import { RestClient } from "../src/client/RestClient.js";
import { loadConfig, requireCompleteConfig } from "../src/config.js";
import { mergeFields, projectIssueCards } from "../src/projection/issueCard.js";
import { JiraMcpError } from "../src/util/errors.js";
import { asRecord } from "../src/util/json.js";

function approxTokens(bytes: number): number {
  return Math.round(bytes / 4);
}

async function main(): Promise<void> {
  const { config, problems } = loadConfig();
  try {
    requireCompleteConfig(config);
  } catch (err) {
    const body = (err as { body?: { message?: string; hint?: string } }).body;
    process.stderr.write(`benchmark: ${body?.message ?? "incomplete configuration"}\n`);
    if (body?.hint) process.stderr.write(`hint: ${body.hint}\n`);
    process.stderr.write(`(also reported at startup: ${problems.map((p) => p.field).join(", ")})\n`);
    process.exitCode = 1;
    return;
  }

  const jql = process.argv[2] ?? process.env.JIRA_BENCHMARK_JQL ?? "ORDER BY updated DESC";
  const profile = new InstanceProfile(config);
  const client = new RestClient(config, profile);

  process.stderr.write(`benchmark: running against ${config.baseUrl} (jql: "${jql}")\n`);

  // Old method: no fields param, 50 raw issues.
  const oldPayload = asRecord(
    await client.request("api/2/search", {
      method: "POST",
      body: { jql, startAt: 0, maxResults: 50 },
    }),
  );
  const oldItems = Array.isArray(oldPayload?.issues) ? oldPayload.issues : [];
  const oldBytes = Buffer.byteLength(JSON.stringify(oldPayload));

  // New method: card fields only, 25 issues, projected to cards.
  const newPayload = asRecord(
    await client.request("api/2/search", {
      method: "POST",
      body: { jql, startAt: 0, maxResults: 25, fields: mergeFields() },
    }),
  );
  const newItems = Array.isArray(newPayload?.issues) ? newPayload.issues : [];
  const newBody = {
    total: typeof newPayload?.total === "number" ? newPayload.total : newItems.length,
    startAt: 0,
    maxResults: 25,
    hasMore: 25 < (typeof newPayload?.total === "number" ? newPayload.total : newItems.length),
    nextStartAt: null as number | null,
    issues: projectIssueCards(newItems),
  };
  const newBytes = Buffer.byteLength(JSON.stringify(newBody));

  const reduction = oldBytes > 0 ? Math.round((1 - newBytes / oldBytes) * 100) : 0;

  process.stdout.write(
    [
      "",
      "search response size benchmark",
      "==============================",
      `jql: ${jql}`,
      "",
      "method                          items   bytes   ~tokens",
      "------------------------------  -----  -------  -------",
      `old (no fields, maxResults=50)  ${String(oldItems.length).padStart(5)}  ${String(oldBytes).padStart(7)}  ${String(approxTokens(oldBytes)).padStart(7)}`,
      `new (cards, maxResults=25)      ${String(newItems.length).padStart(5)}  ${String(newBytes).padStart(7)}  ${String(approxTokens(newBytes)).padStart(7)}`,
      "",
      `reduction vs old (bytes): ${reduction}%`,
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  if (err instanceof JiraMcpError) {
    process.stderr.write(`benchmark failed: ${JSON.stringify(err.body)}\n`);
  } else {
    process.stderr.write(`benchmark failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = 1;
});
