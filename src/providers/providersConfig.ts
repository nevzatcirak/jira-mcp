import { readFileSync } from "node:fs";
import { JiraMcpError } from "../util/errors.js";
import { parseJsonc } from "../util/jsonc.js";

export interface ProviderEndpointDef {
  method: "GET" | "POST";
  /** Path template under the instance root, e.g. "/rest/<plugin>/1.0/x?user={user}". */
  path: string;
  /** Optional projection: output field -> simple path into the response ("total", "items[].hour"). */
  responseMapping?: Record<string, string>;
  /** Optional response size guard in bytes (default: DEFAULT_MAX_RESPONSE_BYTES). */
  maxResponseBytes?: number;
}

export interface ProviderDef {
  description?: string;
  endpoints: Record<string, ProviderEndpointDef>;
}

export interface ProvidersConfig {
  providers: Record<string, ProviderDef>;
}

/**
 * Read + parse + validate a providers JSONC file. Loaded lazily on every
 * `jira_provider_call` so config edits take effect without a server restart.
 * Throws structured PROVIDERS_CONFIG_INVALID errors (with the file path).
 */
export function loadProvidersConfig(filePath: string): ProvidersConfig {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new JiraMcpError({
      code: "PROVIDERS_CONFIG_INVALID",
      message: `Cannot read providers config file: ${filePath}`,
      hint: `Check the JIRA_PROVIDERS_CONFIG path — it must point to an existing JSONC file (${err instanceof Error ? err.message : String(err)}).`,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseJsonc(raw);
  } catch (err) {
    throw new JiraMcpError({
      code: "PROVIDERS_CONFIG_INVALID",
      message: `Providers config file is not valid JSONC: ${filePath}`,
      hint: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return validateProvidersConfig(parsed, filePath);
}

function invalid(filePath: string, message: string, hint: string): JiraMcpError {
  return new JiraMcpError({
    code: "PROVIDERS_CONFIG_INVALID",
    message: `${message} (file: ${filePath})`,
    hint,
  });
}

function validateProvidersConfig(parsed: unknown, filePath: string): ProvidersConfig {
  const root = asPlainRecord(parsed);
  if (!root) {
    throw invalid(filePath, "Providers config root must be a JSON object", 'Expected {"providers": { ... }}');
  }
  const providersRaw = asPlainRecord(root.providers);
  if (!providersRaw) {
    throw invalid(filePath, 'Providers config must have a "providers" object', 'Expected {"providers": { "<name>": { "endpoints": { ... } } }}');
  }

  const providers: Record<string, ProviderDef> = {};
  for (const [name, value] of Object.entries(providersRaw)) {
    const provider = asPlainRecord(value);
    if (!provider) {
      throw invalid(filePath, `Provider "${name}" must be an object`, "Each provider needs { description?, endpoints }");
    }
    const endpointsRaw = asPlainRecord(provider.endpoints);
    if (!endpointsRaw || Object.keys(endpointsRaw).length === 0) {
      throw invalid(filePath, `Provider "${name}" must define at least one endpoint`, "Add an endpoints object with at least one entry");
    }

    const endpoints: Record<string, ProviderEndpointDef> = {};
    for (const [endpointName, endpointValue] of Object.entries(endpointsRaw)) {
      endpoints[endpointName] = validateEndpoint(name, endpointName, endpointValue, filePath);
    }
    providers[name] = {
      ...(typeof provider.description === "string" ? { description: provider.description } : {}),
      endpoints,
    };
  }
  return { providers };
}

function validateEndpoint(
  providerName: string,
  endpointName: string,
  value: unknown,
  filePath: string,
): ProviderEndpointDef {
  const where = `provider "${providerName}", endpoint "${endpointName}"`;
  const endpoint = asPlainRecord(value);
  if (!endpoint) {
    throw invalid(filePath, `Endpoint definition for ${where} must be a JSON object`, "Each endpoint needs { method, path }");
  }

  const method = endpoint.method;
  if (method !== "GET" && method !== "POST") {
    throw invalid(filePath, `Endpoint ${where} has invalid "method"`, 'method must be "GET" or "POST"');
  }
  const path = endpoint.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw invalid(filePath, `Endpoint ${where} is missing "path"`, 'path is required, e.g. "/rest/<plugin>/1.0/report?user={user}"');
  }

  let responseMapping: Record<string, string> | undefined;
  if (endpoint.responseMapping !== undefined) {
    const raw = asPlainRecord(endpoint.responseMapping);
    if (!raw || Object.values(raw).some((v) => typeof v !== "string")) {
      throw invalid(filePath, `Endpoint ${where} has invalid "responseMapping"`, "responseMapping must map output field names to response paths (strings)");
    }
    responseMapping = raw as Record<string, string>;
  }

  let maxResponseBytes: number | undefined;
  if (endpoint.maxResponseBytes !== undefined) {
    if (typeof endpoint.maxResponseBytes !== "number" || !Number.isInteger(endpoint.maxResponseBytes) || endpoint.maxResponseBytes <= 0) {
      throw invalid(filePath, `Endpoint ${where} has invalid "maxResponseBytes"`, "maxResponseBytes must be a positive integer (bytes)");
    }
    maxResponseBytes = endpoint.maxResponseBytes;
  }

  return {
    method,
    path,
    ...(responseMapping ? { responseMapping } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
  };
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
