import type { AgileApiBase, InstanceProfile } from "../client/InstanceProfile.js";
import type { RestClient, RequestOptions } from "../client/RestClient.js";
import { JiraMcpError } from "../util/errors.js";
import { asRecord, type JiraJson } from "../util/json.js";

const DEFAULT_AGILE_BASE: AgileApiBase = "agile/1.0";

/**
 * Thin wrapper around RestClient for the Jira Agile REST API
 * (/rest/agile/1.0/...). Some older Jira versions only answer under
 * /rest/greenhopper/1.0 — on a 404 we retry once against greenhopper with the
 * same sub-path and remember the working base on the instance profile.
 */
export class AgileClient {
  constructor(
    private readonly client: RestClient,
    private readonly profile: InstanceProfile,
  ) {}

  async request<T = unknown>(subPath: string, options: RequestOptions = {}): Promise<T> {
    const base = this.profile.cachedAgileApiBase ?? DEFAULT_AGILE_BASE;
    try {
      return await this.client.request<T>(`${base}/${subPath}`, options);
    } catch (err) {
      if (base !== DEFAULT_AGILE_BASE || !isNotFound(err)) throw err;
      // One-shot fallback: agile/1.0 -> greenhopper/1.0, cached on success.
      const result = await this.client.request<T>(`greenhopper/1.0/${subPath}`, options);
      this.profile.cacheAgileApiBase("greenhopper/1.0");
      return result;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof JiraMcpError && err.code === "JIRA_404";
}

/**
 * Standard pagination metadata derived from an Agile API envelope.
 * `isLast` is not reliably present (especially on issue endpoints), so
 * hasMore is computed from total when available.
 */
export function pageMeta(
  payload: JiraJson | null,
  fallbackStartAt: number,
  fallbackMaxResults: number,
  returnedCount: number,
): { total: number; startAt: number; maxResults: number; hasMore: boolean; nextStartAt: number | null } {
  const total = typeof payload?.total === "number" ? payload.total : returnedCount;
  const startAt = typeof payload?.startAt === "number" ? payload.startAt : fallbackStartAt;
  const maxResults =
    typeof payload?.maxResults === "number" ? payload.maxResults : fallbackMaxResults;
  const hasMore = startAt + returnedCount < total;
  return { total, startAt, maxResults, hasMore, nextStartAt: hasMore ? startAt + returnedCount : null };
}

/**
 * Extract the item array from an Agile API envelope. Board/sprint lists use
 * `values`, issue endpoints use `issues`; both are probed for robustness.
 */
export function extractItems(payload: JiraJson | null, keys: string[]): unknown[] {
  for (const key of keys) {
    const items = payload?.[key];
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** Parse an Agile envelope into a JiraJson-or-null without throwing. */
export function asEnvelope(payload: unknown): JiraJson | null {
  return asRecord(payload);
}
