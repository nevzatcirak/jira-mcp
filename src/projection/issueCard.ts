import { asRecord, asString, asStringArray } from "../util/json.js";

/**
 * The single place where search-result issues are projected into compact
 * "cards". Jira is asked for EXACTLY the card fields (see CARD_FIELDS);
 * `expand` is never sent, and avatarUrls / names / schema / changelog are
 * never forwarded to the LLM.
 */

export const CARD_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "assignee",
  "priority",
  "updated",
  "labels",
  "parent",
] as const;

export interface IssueCard {
  key: string;
  summary: string | null;
  type: string | null;
  status: string | null;
  assignee: string | null;
  priority: string | null;
  labels: string[];
  parent: string | null;
  updated: string | null;
}

export function projectIssueCard(issue: unknown): IssueCard {
  const record = asRecord(issue);
  const fields = asRecord(record?.fields);
  return {
    key: asString(record?.key) ?? "",
    summary: asString(fields?.summary),
    type: asString(asRecord(fields?.issuetype)?.name),
    status: asString(asRecord(fields?.status)?.name),
    assignee: asString(asRecord(fields?.assignee)?.displayName),
    priority: asString(asRecord(fields?.priority)?.name),
    labels: asStringArray(fields?.labels),
    parent: asString(asRecord(fields?.parent)?.key),
    updated: toDateOnly(asString(fields?.updated)),
  };
}

export function projectIssueCards(issues: readonly unknown[]): IssueCard[] {
  return issues.map((issue) => projectIssueCard(issue));
}

/**
 * Merge the mandatory card fields with user-requested extra field names for
 * the request sent to Jira. Raw pass-through ("*all") is not allowed on list
 * endpoints, so it is dropped here (jira_get_issue handles it explicitly).
 */
export function mergeFields(extraFields?: readonly string[]): string[] {
  const merged: string[] = [...CARD_FIELDS];
  for (const field of extraFields ?? []) {
    if (field === "*all" || field === "*navigable") continue;
    if (!merged.includes(field)) merged.push(field);
  }
  return merged;
}

/** "2026-01-14T10:33:00.000+0000" -> "2026-01-14" (keeps cards small). */
function toDateOnly(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}
