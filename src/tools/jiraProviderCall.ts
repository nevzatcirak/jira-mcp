import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import { loadProvidersConfig, type ProviderEndpointDef } from "../providers/providersConfig.js";
import { applyResponseMapping } from "../providers/responseMapping.js";
import type { ToolContext } from "./registry.js";

/** Protective cap applied when an endpoint does not configure its own limit. */
const DEFAULT_MAX_RESPONSE_BYTES = 200_000;

export interface ResolvedProviderPath {
  /** apiPath for RestClient (which prefixes `${baseUrl}/rest/`). */
  apiPath: string;
  query: Record<string, string>;
  /** Params not consumed by the path template (sent as the POST body). */
  unusedParams: string[];
}

/**
 * Pure: substitute `{param}` placeholders in an endpoint path template.
 * Path segments are URL-encoded; query values are left raw — RestClient's
 * URLSearchParams encodes them exactly once. Exported for tests.
 */
export function resolveProviderPath(
  template: string,
  params: Record<string, string | number> | undefined,
): ResolvedProviderPath {
  const used = new Set<string>();
  const substitute = (raw: string, encode: boolean): string =>
    raw.replace(/\{([^}]+)\}/g, (_all, name: string) => {
      const key = name.trim();
      const value = params?.[key];
      if (value === undefined) {
        throw new JiraMcpError({
          code: "INVALID_ARGUMENT",
          message: `Missing parameter '{${key}}' required by the endpoint path template`,
          hint: "Pass it in the tool's 'params' object.",
        });
      }
      used.add(key);
      const text = String(value);
      return encode ? encodeURIComponent(text) : text;
    });

  const question = template.indexOf("?");
  const rawPath = question === -1 ? template : template.slice(0, question);
  const rawQuery = question === -1 ? null : template.slice(question + 1);

  // RestClient builds `${baseUrl}/rest/<apiPath>` — strip a leading "/rest/".
  const apiPath = substitute(rawPath, true).replace(/^\/+/, "").replace(/^rest\//, "");

  const query: Record<string, string> = {};
  if (rawQuery !== null) {
    for (const pair of rawQuery.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? "" : pair.slice(eq + 1);
      query[substitute(key, false)] = substitute(value, false);
    }
  }

  const unusedParams = Object.keys(params ?? {}).filter((key) => !used.has(key));
  return { apiPath, query, unusedParams };
}

export interface ProviderCallArgs {
  provider: string;
  endpoint: string;
  params?: Record<string, string | number>;
}

/**
 * The provider-call core: resolve config -> endpoint -> path, execute the
 * request through the shared RestClient, enforce the size guard and apply
 * the responseMapping. Pure enough to test directly (fetch is stubbed).
 * Throws JiraMcpError; the tool handler wraps it with toMcpError.
 */
export async function runProviderCall(
  args: ProviderCallArgs,
  ctx: Pick<ToolContext, "config" | "client">,
): Promise<unknown> {
  const configPath = ctx.config.providersConfigPath ?? null;
  if (!configPath) {
    throw new JiraMcpError({
      code: "CONFIG_MISSING",
      message: "JIRA_PROVIDERS_CONFIG is not set — no custom providers are defined",
      hint: "Set JIRA_PROVIDERS_CONFIG to a providers JSONC file; see examples/providers.example.jsonc for the schema.",
    });
  }

  const providers = loadProvidersConfig(configPath).providers;
  const provider = providers[args.provider];
  if (!provider) {
    const available = Object.entries(providers)
      .map(([name, def]) => (def.description ? `${name} (${def.description})` : name))
      .join(", ");
    throw new JiraMcpError({
      code: "PROVIDER_UNKNOWN",
      message: `Unknown provider '${args.provider}' (config file: ${configPath})`,
      hint: available ? `Available providers: ${available}` : "The config file defines no providers.",
    });
  }

  const endpoint: ProviderEndpointDef | undefined = provider.endpoints[args.endpoint];
  if (!endpoint) {
    const available = Object.keys(provider.endpoints).join(", ") || "(none)";
    throw new JiraMcpError({
      code: "ENDPOINT_UNKNOWN",
      message: `Unknown endpoint '${args.endpoint}' on provider '${args.provider}'`,
      hint: `Available endpoints on '${args.provider}': ${available}`,
    });
  }

  const { apiPath, query, unusedParams } = resolveProviderPath(endpoint.path, args.params);
  const body =
    endpoint.method === "POST" && unusedParams.length > 0
      ? Object.fromEntries(unusedParams.map((key) => [key, (args.params ?? {})[key]]))
      : undefined;

  const payload = await ctx.client.request(apiPath, {
    method: endpoint.method,
    query,
    ...(body !== undefined ? { body } : {}),
  });

  const maxBytes = endpoint.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const serialized = JSON.stringify(payload ?? null) ?? "null";
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > maxBytes) {
    throw new JiraMcpError({
      code: "RESPONSE_TOO_LARGE",
      message: `Response from provider '${args.provider}', endpoint '${args.endpoint}' is ${byteLength} bytes (limit ${maxBytes})`,
      hint: "Raise maxResponseBytes for this endpoint in the providers config, or narrow the request params.",
    });
  }

  if (endpoint.responseMapping) {
    return applyResponseMapping(payload, endpoint.responseMapping);
  }
  return payload ?? null;
}

/**
 * Generic, config-driven call to a workplace-specific Jira plugin endpoint.
 * The core package knows no endpoint itself — everything comes from the
 * JSONC file pointed to by JIRA_PROVIDERS_CONFIG. Requests go through the
 * shared RestClient (auth, 30s timeout, 429/5xx retry).
 */
export function registerJiraProviderCall(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_provider_call",
    {
      title: "Call custom provider endpoint",
      description:
        "Call a custom (workplace-specific) Jira plugin endpoint defined in the " +
        "JIRA_PROVIDERS_CONFIG JSONC file. Params fill the endpoint's {param} " +
        "path templates. Optional responseMapping projects the raw response.",
      inputSchema: {
        provider: z.string().min(1).describe("Provider name from the providers config (a key under \"providers\")"),
        endpoint: z.string().min(1).describe("Endpoint name defined for that provider"),
        params: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe("Values for the endpoint's {param} path placeholders; leftover params become the POST body"),
      },
    },
    async (args) => {
      try {
        const data = await runProviderCall(args, ctx);
        return { content: [{ type: "text", text: JSON.stringify(data ?? null) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
