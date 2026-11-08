/**
 * Structured error type shared by every tool. Tool handlers must never throw
 * raw errors across the MCP boundary; they catch and convert via `toMcpError`,
 * producing:
 *
 *   { "error": { "code": "...", "message": "...", "hint": "...", "jiraErrors": {...} } }
 */

export interface JiraErrorPayload {
  /** Jira's `errorMessages` array (Server/DC and Cloud both use this). */
  errorMessages?: string[];
  /** Jira's per-field `errors` map (field name -> human readable message). */
  errors?: Record<string, string>;
  /** Raw body, only when it contained neither `errorMessages` nor `errors`. */
  raw?: unknown;
}

export interface StructuredErrorBody {
  code: string;
  message: string;
  hint?: string;
  jiraErrors?: JiraErrorPayload;
}

export class JiraMcpError extends Error {
  readonly body: StructuredErrorBody;

  constructor(body: StructuredErrorBody, options?: { cause?: unknown }) {
    super(body.message, options);
    this.name = "JiraMcpError";
    this.body = body;
  }

  get code(): string {
    return this.body.code;
  }
}

/** Read a response body without letting a non-JSON body break error handling. */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text().catch(() => "");
  }
}

/**
 * Convert a non-OK Jira HTTP response into a structured error, preserving
 * Jira's `errorMessages` and per-field `errors` content. The raw body is never
 * handed to the LLM verbatim; only its error fields are kept.
 */
export function buildJiraHttpError(status: number, body: unknown): JiraMcpError {
  let errorMessages: string[] | undefined;
  let errors: Record<string, string> | undefined;
  let raw: unknown;

  if (Array.isArray(body)) {
    errorMessages = body.map((item) => String(item));
  } else if (typeof body === "string" && body.trim().length > 0) {
    errorMessages = [body];
  } else if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.errorMessages)) {
      errorMessages = record.errorMessages.map((item) => String(item));
    }
    if (record.errors !== null && typeof record.errors === "object" && !Array.isArray(record.errors)) {
      errors = {};
      for (const [field, message] of Object.entries(record.errors as Record<string, unknown>)) {
        errors[field] = typeof message === "string" ? message : JSON.stringify(message);
      }
    }
    if (errorMessages === undefined && errors === undefined) {
      if (typeof record.message === "string" && record.message.length > 0) {
        errorMessages = [record.message];
      } else {
        raw = body; // unknown body shape: keep it so nothing is silently lost
      }
    }
  }

  const first =
    errorMessages?.[0] ?? (errors !== undefined ? Object.values(errors)[0] : undefined);
  const message = first
    ? `Jira HTTP ${status}: ${first}`
    : `Jira request failed with HTTP ${status}`;

  return new JiraMcpError({
    code: `JIRA_${status}`,
    message,
    jiraErrors: { errorMessages, errors, raw },
  });
}

/**
 * Convert any thrown error into an MCP tool result with `isError: true` and a
 * structured JSON payload. Used in every tool's catch block.
 */
export function toMcpError(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  let body: StructuredErrorBody;
  if (err instanceof JiraMcpError) {
    body = err.body;
  } else if (err instanceof Error && err.name === "AbortError") {
    body = { code: "JIRA_TIMEOUT", message: "Jira request timed out after 30000 ms" };
  } else if (err instanceof Error) {
    body = { code: "JIRA_NETWORK", message: err.message };
  } else {
    body = { code: "JIRA_INTERNAL", message: "Unknown error" };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ error: body }) }],
    isError: true,
  };
}
