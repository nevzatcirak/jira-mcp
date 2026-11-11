import type { ToolContext } from "./registry.js";
import { JiraMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";

/**
 * Shared helpers for the write tools (create/update/assign/comment/transition).
 * Handles the two deployment-specific differences:
 * - user references: Server/DC uses `{name}`, Cloud uses `{accountId}`
 * - comment bodies: Server/DC plain wiki string, Cloud ADF document
 */

/** Jira duration format: one or more "<number><w|d|h|m>" groups, e.g. "2h", "1d 4h", "1w 2d 3h 30m". */
export const DURATION_PATTERN = /^\d+\s*[wdhm](\s+\d+\s*[wdhm])*$/i;

/**
 * Build the `timetracking` field value for issue create/update from the
 * given estimate inputs. Both Server/DC and Cloud use the same camelCase
 * shape (verified against Atlassian docs — Cloud does NOT use a lowercase
 * ADF-style form for this field):
 *
 *   fields.timetracking = { originalEstimate: "2h", remainingEstimate: "1d" }
 *
 * Only the values that were provided are included (partial update semantics:
 * a field that is not given is not sent, so Jira leaves it untouched).
 * Returns undefined when neither estimate was provided.
 *
 * Note: duration units (w/d/h/m) are interpreted by the instance's time
 * tracking settings — "1d" is `workingHoursPerDay` hours, which can differ
 * per instance.
 */
export function timeTrackingFieldValue(
  originalEstimate?: string,
  remainingEstimate?: string,
): Record<string, unknown> | undefined {
  if (originalEstimate === undefined && remainingEstimate === undefined) return undefined;
  const timetracking: Record<string, unknown> = {};
  if (originalEstimate !== undefined) timetracking.originalEstimate = originalEstimate;
  if (remainingEstimate !== undefined) timetracking.remainingEstimate = remainingEstimate;
  return timetracking;
}

/**
 * Heuristic for "this looks like an Atlassian accountId" (24-hex chars,
 * optionally prefixed with a site id like "557058:"), as opposed to a
 * human-typed username / display name.
 */
export function isAccountIdLike(value: string): boolean {
  return /^accountid:/i.test(value) || /^(\d+:)?[0-9a-f]{24}$/i.test(value.trim());
}

/** GET /rest/api/2/user/search — works on Server 8+/DC (username=) and Cloud (query=); both params are sent for cross-version compatibility. */
export async function searchUsers(
  ctx: ToolContext,
  query: string,
  maxResults: number,
  startAt = 0,
): Promise<unknown[]> {
  const payload = await ctx.client.request<unknown>("api/2/user/search", {
    query: { username: query, query, startAt, maxResults },
  });
  return Array.isArray(payload) ? payload : [];
}

/** Project one /user/search item into the compact user card. */
export function projectUserCard(user: unknown): Record<string, unknown> {
  const record = asRecord(user);
  const nonEmpty = (v: unknown): string | null => {
    const s = asString(v);
    return s && s.length > 0 ? s : null; // Cloud returns name:"" — normalize to null
  };
  return {
    accountId: nonEmpty(record?.accountId),
    name: nonEmpty(record?.name),
    displayName: nonEmpty(record?.displayName),
    email: nonEmpty(record?.emailAddress),
    active: record?.active === true,
  };
}

/**
 * Build the `assignee` field value for issue create/update.
 * - accountId-like value -> `{accountId}` on every deployment
 * - name on Server/DC -> `{name}`
 * - name on Cloud -> resolved to `{accountId}` via user search
 */
export async function resolveUserFieldValue(
  ctx: ToolContext,
  value: string,
): Promise<Record<string, unknown>> {
  const candidate = value.trim();
  if (isAccountIdLike(candidate)) return { accountId: candidate };

  const { type } = await ctx.profile.resolve();
  if (type === "server") return { name: candidate };

  const users = await searchUsers(ctx, candidate, 10);
  const cards = users.map((u) => projectUserCard(u));
  const exact = cards.filter((card) => {
    const name = typeof card.name === "string" ? card.name.toLowerCase() : null;
    const displayName =
      typeof card.displayName === "string" ? card.displayName.toLowerCase() : null;
    const needle = candidate.toLowerCase();
    return name === needle || displayName === needle;
  });
  if (exact.length === 1) {
    const accountId = exact[0]?.accountId;
    if (!accountId) {
      throw new JiraMcpError({
        code: "USER_NOT_RESOLVABLE",
        message: `User '${candidate}' matched on this Cloud instance but has no accountId visible`,
        hint: "Provide the accountId explicitly instead of a name.",
      });
    }
    return { accountId };
  }
  if (exact.length === 0) {
    const candidates = cards
      .map((c) => `${c.name ?? c.accountId ?? "?"} (${c.displayName})`)
      .slice(0, 5)
      .join(", ");
    throw new JiraMcpError({
      code: "USER_NOT_FOUND",
      message: `No user exactly matching '${candidate}' was found`,
      hint: candidates
        ? `Use an accountId, or one of the partial matches: ${candidates}`
        : "Provide an accountId, or a username/display name that exactly matches one user.",
    });
  }
  throw new JiraMcpError({
    code: "AMBIGUOUS_USER",
    message: `Multiple users match '${candidate}': ${exact
      .map((c) => `${c.displayName} (${c.accountId})`)
      .join(", ")}`,
    hint: "Re-run with the specific accountId instead of the shared name.",
  });
}

/** Body for PUT /issue/{key}/assignee that unassigns, per deployment. */
export async function unassignBody(ctx: ToolContext): Promise<Record<string, unknown>> {
  const { type } = await ctx.profile.resolve();
  // Server/DC docs: a null name removes the assignee.
  // Cloud docs: accountId set to null unassigns.
  return type === "server" ? { name: null } : { accountId: null };
}

/**
 * Comment body value: plain/wiki string on Server/DC; ADF document on Cloud
 * (per project convention — Cloud v2 officially still documents strings, but
 * ADF is the forward-compatible form).
 */
export async function commentBody(ctx: ToolContext, text: string): Promise<unknown> {
  const { type } = await ctx.profile.resolve();
  return type === "cloud"
    ? {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      }
    : text;
}

/** Human-readable URL of an issue key. */
export function browseUrl(ctx: ToolContext, key: string): string {
  return `${ctx.config.baseUrl as string}/browse/${key}`;
}

/** Re-throw a 400 with a team-managed parent hint when parentKey was used. */
export function withParentHint(err: unknown, parentKey?: string): unknown {
  if (
    parentKey &&
    err instanceof JiraMcpError &&
    err.code === "JIRA_400"
  ) {
    return new JiraMcpError({
      code: err.code,
      message: err.message,
      hint:
        "parentKey may be rejected for Cloud team-managed (next-gen) projects or for " +
        "non-subtask hierarchy levels on Server/DC (classic-managed projects and " +
        "subtasks accept parent.key). Check the project type, or link the issues " +
        "instead of setting a parent.",
      jiraErrors: err.body.jiraErrors,
    });
  }
  return err;
}
