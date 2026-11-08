import { stderr } from "node:process";

/**
 * Minimal structured logger that ALWAYS writes to stderr.
 *
 * stdout is reserved for the MCP stdio transport and must never be touched.
 * Secret values registered via `registerSecrets` (tokens, e-mails) and
 * well-formed Basic/Bearer header values are redacted from every log line.
 */

const REDACTED = "[REDACTED]";

const registeredSecrets: string[] = [];

/** Register secret values (tokens, e-mails used as credentials) for redaction. */
export function registerSecrets(...values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length >= 4) {
      const secret = value.trim();
      if (!registeredSecrets.includes(secret)) {
        registeredSecrets.push(secret);
      }
    }
  }
}

/** Test-only helper: forget all registered secrets. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.length = 0;
}

/** Redact registered secrets and Basic/Bearer header values from free text. */
export function redact(text: string): string {
  let output = text;
  for (const secret of registeredSecrets) {
    output = output.split(secret).join(REDACTED);
  }
  // Defense in depth: never print a raw credential-looking header value,
  // even if it was not registered. "[REDACTED]" itself must not be re-matched,
  // so `[` is excluded from the value character class.
  return output.replace(/\b(Bearer|Basic)\s+[^\s"',;)[\]}]+/gi, `$1 ${REDACTED}`);
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message: redact(message),
  };
  if (meta !== undefined) {
    try {
      entry.meta = JSON.parse(redact(JSON.stringify(meta)));
    } catch {
      entry.meta = "[unserializable meta]";
    }
  }
  stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>): void => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>): void => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>): void => write("error", message, meta),
};
