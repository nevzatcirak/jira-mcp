import type { JiraConfig } from "../config.js";
import { requireCompleteConfig } from "../config.js";
import { buildJiraHttpError, JiraMcpError, readJsonBody } from "../util/errors.js";
import { asRecord, asString, type JiraJson } from "../util/json.js";

export type DeploymentType = "cloud" | "server";

/** Base path for the Agile REST API (see src/agile/agileClient.ts fallback). */
export type AgileApiBase = "agile/1.0" | "greenhopper/1.0";

export interface ProfileSnapshot {
  type: DeploymentType;
  /** Raw serverInfo payload when it has been fetched, otherwise null. */
  serverInfo: JiraJson | null;
}

const DETECT_TIMEOUT_MS = 30_000;

/**
 * Detects (and caches) whether the target is Jira Cloud or Jira Server/DC,
 * and produces the matching Authorization header.
 *
 * - "auto": first call performs GET /rest/api/2/serverInfo and reads
 *   `deploymentType` ("Cloud" -> cloud, anything else -> server). Cached.
 * - Server/DC auth: `Authorization: Bearer <token>`
 * - Cloud auth: `Authorization: Basic base64(<email>:<token>)`
 */
export class InstanceProfile {
  private snapshot: ProfileSnapshot | null = null;
  private detection: Promise<ProfileSnapshot> | null = null;
  private agileApiBase: AgileApiBase | null = null;

  constructor(private readonly config: JiraConfig) {}

  get cached(): ProfileSnapshot | null {
    return this.snapshot;
  }

  /** Feed a freshly fetched serverInfo into the cache (used by jira_get_server_info). */
  cacheServerInfo(serverInfo: JiraJson): ProfileSnapshot {
    const type = normalizeDeploymentType(asString(serverInfo.deploymentType));
    this.snapshot = { type, serverInfo };
    return this.snapshot;
  }

  /** Remember the working Agile API base after a successful greenhopper fallback. */
  cacheAgileApiBase(base: AgileApiBase): void {
    this.agileApiBase = base;
  }

  get cachedAgileApiBase(): AgileApiBase | null {
    return this.agileApiBase;
  }

  /** Cache a deployment type that was configured explicitly (no HTTP call). */
  cacheExplicit(type: DeploymentType): void {
    this.snapshot = { type, serverInfo: this.snapshot?.serverInfo ?? null };
  }

  /** Resolve (with caching) the deployment type. */
  async resolve(): Promise<ProfileSnapshot> {
    if (this.snapshot) return this.snapshot;
    if (this.detection) return this.detection;
    this.detection = this.detect().finally(() => {
      this.detection = null;
    });
    return this.detection;
  }

  /** Authorization header value for the resolved deployment type. */
  async authorizationHeader(): Promise<string> {
    const { type } = await this.resolve();
    const token = this.config.apiToken ?? "";
    if (type === "cloud") {
      if (!this.config.email) {
        throw new JiraMcpError({
          code: "CONFIG_MISSING",
          message: "JIRA_EMAIL is required for Jira Cloud authentication",
          hint: "Set JIRA_EMAIL (account e-mail) together with JIRA_API_TOKEN (Cloud API token), or set JIRA_INSTANCE_TYPE=server if this is actually a Server/DC instance.",
        });
      }
      return `Basic ${Buffer.from(`${this.config.email}:${token}`).toString("base64")}`;
    }
    if (!token) {
      throw new JiraMcpError({
        code: "CONFIG_MISSING",
        message: "JIRA_API_TOKEN is required for Jira Server/DC authentication",
        hint: "Set JIRA_API_TOKEN to a Personal Access Token (Administration > Personal Access Tokens).",
      });
    }
    return `Bearer ${token}`;
  }

  private async detect(): Promise<ProfileSnapshot> {
    if (this.config.instanceType !== "auto") {
      this.snapshot = { type: this.config.instanceType, serverInfo: null };
      return this.snapshot;
    }
    const serverInfo = await this.fetchServerInfoForDetection();
    return this.cacheServerInfo(serverInfo);
  }

  /**
   * GET /rest/api/2/serverInfo with best-effort auth (Basic when an e-mail is
   * configured, otherwise Bearer). Runs outside RestClient to avoid a
   * client <-> profile dependency cycle.
   */
  private async fetchServerInfoForDetection(): Promise<JiraJson> {
    if (!this.config.baseUrl || !this.config.apiToken) {
      // requireCompleteConfig runs before every HTTP call; this is a safety net.
      requireCompleteConfig(this.config);
    }
    const baseUrl = this.config.baseUrl as string;
    const url = `${baseUrl}/rest/api/2/serverInfo`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.config.email && this.config.apiToken) {
        headers.Authorization = `Basic ${Buffer.from(
          `${this.config.email}:${this.config.apiToken}`,
        ).toString("base64")}`;
      } else if (this.config.apiToken) {
        headers.Authorization = `Bearer ${this.config.apiToken}`;
      }
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw buildJiraHttpError(response.status, await readJsonBody(response));
      }
      return asRecord(await response.json()) ?? {};
    } catch (err) {
      if (err instanceof JiraMcpError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new JiraMcpError({
          code: "JIRA_TIMEOUT",
          message: "Timed out while detecting the instance type via /rest/api/2/serverInfo",
        });
      }
      throw new JiraMcpError({
        code: "JIRA_NETWORK",
        message: `Failed to reach ${baseUrl}/rest/api/2/serverInfo: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeDeploymentType(raw: string | null): DeploymentType {
  return raw?.toLowerCase() === "cloud" ? "cloud" : "server";
}
