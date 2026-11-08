/**
 * Small, dependency-free helpers for reading values out of untyped Jira
 * JSON payloads without resorting to `any` everywhere.
 */

export type JiraJson = Record<string, unknown>;

export function asRecord(value: unknown): JiraJson | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JiraJson)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
