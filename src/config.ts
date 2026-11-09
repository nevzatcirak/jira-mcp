import { JiraMcpError } from "./util/errors.js";

export type InstanceTypePref = "auto" | "server" | "cloud";

export interface JiraConfig {
  /** Normalized base URL (no trailing slash), or null when missing/invalid. */
  baseUrl: string | null;
  apiToken: string | null;
  /** Required for Jira Cloud only. */
  email: string | null;
  instanceType: InstanceTypePref;
  /** Path to the custom providers JSONC file (jira_provider_call), or null. */
  providersConfigPath: string | null;
}

export interface ConfigProblem {
  field: string;
  message: string;
  hint: string;
}

const VALID_INSTANCE_TYPES = new Set(["auto", "server", "cloud"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): {
  config: JiraConfig;
  problems: ConfigProblem[];
} {
  const problems: ConfigProblem[] = [];

  // --- base URL ---
  const baseUrlRaw = env.JIRA_BASE_URL?.trim() || null;
  let baseUrl: string | null = null;
  if (!baseUrlRaw) {
    problems.push({
      field: "JIRA_BASE_URL",
      message: "JIRA_BASE_URL is required",
      hint: "Set JIRA_BASE_URL to your Jira base URL, e.g. https://jira.example.com",
    });
  } else {
    const normalized = baseUrlRaw.replace(/\/+$/, "");
    let valid = false;
    try {
      const parsed = new URL(normalized);
      valid = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      valid = false;
    }
    if (valid) {
      baseUrl = normalized;
    } else {
      problems.push({
        field: "JIRA_BASE_URL",
        message: `JIRA_BASE_URL is not a valid absolute http(s) URL: "${baseUrlRaw}"`,
        hint: "Use an absolute URL such as https://jira.example.com",
      });
    }
  }

  // --- token ---
  const apiToken = env.JIRA_API_TOKEN?.trim() || null;
  if (!apiToken) {
    problems.push({
      field: "JIRA_API_TOKEN",
      message: "JIRA_API_TOKEN is required",
      hint: "Use a Personal Access Token for Jira Server/DC, or an API token for Jira Cloud",
    });
  }

  // --- email (Cloud only) ---
  const email = env.JIRA_EMAIL?.trim() || null;

  // --- instance type ---
  const typeRaw = env.JIRA_INSTANCE_TYPE?.trim() || "auto";
  let instanceType: InstanceTypePref = "auto";
  if (VALID_INSTANCE_TYPES.has(typeRaw)) {
    instanceType = typeRaw as InstanceTypePref;
  } else {
    problems.push({
      field: "JIRA_INSTANCE_TYPE",
      message: `JIRA_INSTANCE_TYPE must be one of "auto", "server", "cloud" (got "${typeRaw}")`,
      hint: 'Remove JIRA_INSTANCE_TYPE or set it to "auto" to auto-detect the deployment type',
    });
  }
  if (instanceType === "cloud" && !email) {
    problems.push({
      field: "JIRA_EMAIL",
      message: "JIRA_EMAIL is required when JIRA_INSTANCE_TYPE=cloud",
      hint: "Set JIRA_EMAIL to the account e-mail that owns the Cloud API token",
    });
  }

  // --- custom providers config (optional, for jira_provider_call) ---
  const providersConfigPath = env.JIRA_PROVIDERS_CONFIG?.trim() || null;

  return { config: { baseUrl, apiToken, email, instanceType, providersConfigPath }, problems };
}

/**
 * Throw a structured CONFIG_MISSING error when the configuration cannot serve
 * a tool call. Called at the start of every tool request path, so the server
 * keeps running (it never crashes) while its tools fail with a structured hint.
 */
export function requireCompleteConfig(
  config: JiraConfig,
  resolvedType?: "cloud" | "server",
): void {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push("JIRA_BASE_URL");
  if (!config.apiToken) missing.push("JIRA_API_TOKEN");
  const needsEmail = config.instanceType === "cloud" || resolvedType === "cloud";
  if (needsEmail && !config.email) missing.push("JIRA_EMAIL");
  if (missing.length === 0) return;

  const cloudHint =
    resolvedType === "cloud" || missing.includes("JIRA_EMAIL")
      ? " This instance uses Jira Cloud authentication: set JIRA_EMAIL together with JIRA_API_TOKEN."
      : "";
  throw new JiraMcpError({
    code: "CONFIG_MISSING",
    message: `Missing or invalid configuration: ${missing.join(", ")}`,
    hint: `Set the listed environment variables (see .env.example) and restart the server. The server stays up; only tool calls fail until the configuration is complete.${cloudHint}`,
  });
}
