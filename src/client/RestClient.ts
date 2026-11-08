import type { JiraConfig } from "../config.js";
import { requireCompleteConfig } from "../config.js";
import { buildJiraHttpError, JiraMcpError, readJsonBody } from "../util/errors.js";
import type { InstanceProfile } from "./InstanceProfile.js";

const DEFAULT_TIMEOUT_MS = 30_000;
/** Retries for 429/5xx, on top of the initial attempt. */
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON-serializable request body, or a FormData instance (sent as multipart). */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Extra headers (e.g. X-Atlassian-Token for attachment uploads). */
  headers?: Record<string, string>;
  /** Caller-provided abort signal (combined with the per-request timeout). */
  signal?: AbortSignal;
}

/**
 * The single HTTP layer of jira-mcp.
 *
 * - Every request goes to `${baseUrl}/rest/<apiPath>`.
 * - 30s timeout per attempt (AbortController).
 * - Up to 2 retries for 429/5xx with 1s/2s backoff, honouring Retry-After.
 * - Non-OK responses are converted into structured JiraMcpError objects that
 *   preserve Jira's `errorMessages` + `errors` content.
 */
export class RestClient {
  constructor(
    private readonly config: JiraConfig,
    private readonly profile: InstanceProfile,
  ) {}

  async request<T = unknown>(apiPath: string, options: RequestOptions = {}): Promise<T> {
    requireCompleteConfig(this.config, this.profile.cached?.type);
    const method = options.method ?? "GET";
    const url = this.buildUrl(apiPath, options.query);
    const authorization = await this.profile.authorizationHeader();
    const totalAttempts = MAX_RETRIES + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const onCallerAbort = (): void => controller.abort();
      options.signal?.addEventListener("abort", onCallerAbort, { once: true });

      let response: Response;
      const isForm =
        typeof FormData !== "undefined" && options.body instanceof FormData;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            // FormData sets its own multipart Content-Type (with boundary).
            ...(options.body !== undefined && !isForm
              ? { "Content-Type": "application/json" }
              : {}),
            ...(options.headers ?? {}),
            Authorization: authorization,
          },
          body: isForm ? (options.body as FormData) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        throw this.wrapTransportError(err, method, url);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onCallerAbort);
      }

      if (response.ok) {
        return (await this.parseSuccess<T>(response));
      }

      const jiraError = buildJiraHttpError(response.status, await readJsonBody(response));
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= totalAttempts) {
        throw jiraError;
      }
      await delay(this.retryDelayMs(response.headers.get("retry-after"), attempt));
    }
    // Unreachable: the loop either returns or throws on its last attempt.
    throw new JiraMcpError({ code: "JIRA_INTERNAL", message: "Retry loop exited unexpectedly" });
  }

  private buildUrl(
    apiPath: string,
    query?: Record<string, string | number | undefined>,
  ): URL {
    const path = apiPath.replace(/^\/+/, "");
    const url = new URL(`${this.config.baseUrl as string}/rest/${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async parseSuccess<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
    const parsed = retryAfterHeader !== null ? Number(retryAfterHeader) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
    }
    return attempt === 1 ? 1_000 : 2_000;
  }

  private wrapTransportError(err: unknown, method: string, url: URL): JiraMcpError {
    if (err instanceof JiraMcpError) return err;
    if (err instanceof Error && err.name === "AbortError") {
      return new JiraMcpError({
        code: "JIRA_TIMEOUT",
        message: `Jira request timed out after ${DEFAULT_TIMEOUT_MS} ms: ${method} ${url.pathname}`,
      });
    }
    return new JiraMcpError({
      code: "JIRA_NETWORK",
      message: `Jira request failed: ${method} ${url.pathname} (${
        err instanceof Error ? err.message : String(err)
      })`,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
