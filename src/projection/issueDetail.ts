import { asRecord, asString, type JiraJson } from "../util/json.js";
import { projectIssueCard } from "./issueCard.js";

/**
 * Projection for jira_get_issue: card fields + truncated description and,
 * optionally, paginated comments/worklogs (each text body truncated).
 */

const BODY_TRUNCATE_CHARS = 500;
const PAGE_SIZE = 100;
const MAX_ITEMS = 1000;

export interface PageFetcher {
  /** Fetch a /rest/... sub-path (may contain its own query string). */
  (apiPath: string): Promise<JiraJson>;
}

export interface IssueDetailOptions {
  maxDescriptionChars: number;
  includeComments: boolean;
  includeWorklogs: boolean;
  fetchPage: PageFetcher;
}

export interface CommentView {
  id: string | null;
  author: string | null;
  created: string | null;
  body: string | null;
  truncated: boolean;
  totalLength: number;
}

export interface WorklogView {
  id: string | null;
  author: string | null;
  started: string | null;
  timeSpent: string | null;
  comment: string | null;
  truncated: boolean;
  totalLength: number;
}

export async function projectIssueDetail(
  issue: unknown,
  options: IssueDetailOptions,
): Promise<Record<string, unknown>> {
  const card = projectIssueCard(issue);
  const fields = asRecord(asRecord(issue)?.fields);

  const result: Record<string, unknown> = { ...card };

  const description = asString(fields?.description);
  const descriptionView = truncateText(description ?? "", options.maxDescriptionChars);
  result.description = description === null ? null : descriptionView.text;
  result.descriptionTruncated = description !== null && descriptionView.truncated;
  result.descriptionTotalLength = description?.length ?? 0;

  if (options.includeComments) {
    result.comments = await fetchAllComments(options.fetchPage, card.key);
  }
  if (options.includeWorklogs) {
    result.worklogs = await fetchAllWorklogs(options.fetchPage, card.key);
  }
  return result;
}

export async function fetchAllComments(
  fetchPage: PageFetcher,
  issueKey: string,
): Promise<CommentView[]> {
  const out: CommentView[] = [];
  let startAt = 0;
  let total = Number.POSITIVE_INFINITY;
  while (startAt < total && out.length < MAX_ITEMS) {
    const page = await fetchPage(
      `api/2/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
    );
    const { items, total: pageTotal } = extractPage(page, "comments");
    if (pageTotal !== null) total = pageTotal;
    else total = startAt + items.length;
    if (items.length === 0) break;
    out.push(...items.map(projectComment));
    if (items.length < PAGE_SIZE) break;
    startAt += items.length;
  }
  return out;
}

export async function fetchAllWorklogs(
  fetchPage: PageFetcher,
  issueKey: string,
): Promise<WorklogView[]> {
  const out: WorklogView[] = [];
  let startAt = 0;
  let total = Number.POSITIVE_INFINITY;
  while (startAt < total && out.length < MAX_ITEMS) {
    const page = await fetchPage(
      `api/2/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
    );
    const { items, total: pageTotal } = extractPage(page, "worklogs");
    if (pageTotal !== null) total = pageTotal;
    else total = startAt + items.length;
    if (items.length === 0) break;
    out.push(...items.map(projectWorklog));
    if (items.length < PAGE_SIZE) break;
    startAt += items.length;
  }
  return out;
}

function extractPage(
  page: unknown,
  key: "comments" | "worklogs",
): { items: unknown[]; total: number | null } {
  if (Array.isArray(page)) return { items: page, total: null }; // very old servers: bare array
  const record = asRecord(page);
  if (!record) return { items: [], total: null };
  const items = Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
  const total = typeof record.total === "number" ? record.total : null;
  return { items, total };
}

function projectComment(comment: unknown): CommentView {
  const record = asRecord(comment);
  const body = asString(record?.body) ?? "";
  const view = truncateText(body, BODY_TRUNCATE_CHARS);
  return {
    id: asString(record?.id),
    author: asString(asRecord(record?.author)?.displayName),
    created: asString(record?.created),
    body: view.text,
    truncated: view.truncated,
    totalLength: body.length,
  };
}

function projectWorklog(worklog: unknown): WorklogView {
  const record = asRecord(worklog);
  const comment = asString(record?.comment) ?? "";
  const view = truncateText(comment, BODY_TRUNCATE_CHARS);
  return {
    id: asString(record?.id),
    author: asString(asRecord(record?.author)?.displayName),
    started: asString(record?.started),
    timeSpent: asString(record?.timeSpent),
    comment: view.text,
    truncated: view.truncated,
    totalLength: comment.length,
  };
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, Math.max(0, maxChars)), truncated: true };
}
