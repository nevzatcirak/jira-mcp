#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InstanceProfile } from "./client/InstanceProfile.js";
import { RestClient } from "./client/RestClient.js";
import { AgileClient } from "./agile/agileClient.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/registry.js";
import { logger, registerSecrets } from "./util/logger.js";

const SERVER_NAME = "jira-mcp";
const SERVER_VERSION = "0.1.0";

interface PackageInfo {
  name: string;
  version: string;
}

function readPackageInfo(): PackageInfo {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    return {
      name: pkg.name ?? SERVER_NAME,
      version: pkg.version ?? SERVER_VERSION,
    };
  } catch {
    return { name: SERVER_NAME, version: SERVER_VERSION };
  }
}

function printVersion(): void {
  const pkg = readPackageInfo();
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
}

function printHelp(): void {
  process.stdout.write(
    `Kullanım: jira-mcp                     (MCP stdio server olarak başlar)\n` +
      `          jira-mcp --version           (sürüm bilgisi)\n` +
      `          jira-mcp --help              (bu yardım)\n` +
      `\n` +
      `Ortam değişkenleri:\n` +
      `  JIRA_BASE_URL        Jira instance taban URL'si (örn. https://jira.example.com)\n` +
      `  JIRA_API_TOKEN       PAT (Server/DC) veya API token (Cloud)\n` +
      `  JIRA_EMAIL           Cloud hesap e-postası (Cloud token ile birlikte zorunlu)\n` +
      `  JIRA_INSTANCE_TYPE   auto (varsayılan) | server | cloud\n`,
  );
}

/**
 * CLI flag'lerini işler (--version/--help). Flag işlendiyse true döner ve
 * process doğal olarak (stdout flush edildikten sonra) exit 0 ile kapanır.
 */
function handleCliArgs(args: readonly string[]): boolean {
  const flag = args[0];
  if (flag === "version" || flag === "--version" || flag === "-v") {
    printVersion();
    return true;
  }
  if (flag === "--help" || flag === "-h") {
    printHelp();
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  // 1. Load + validate config (never throws; problems are reported, not fatal).
  const { config, problems } = loadConfig();
  registerSecrets(config.apiToken, config.email);
  if (problems.length > 0) {
    logger.warn(
      `${SERVER_NAME} started with an incomplete configuration; tool calls will ` +
        "return CONFIG_MISSING errors until the environment is fixed",
      { problems: problems.map((p) => ({ field: p.field, message: p.message })) },
    );
  }

  // 2. HTTP layer + instance profile (Cloud vs Server/DC detection & caching).
  const profile = new InstanceProfile(config);
  const client = new RestClient(config, profile);
  const agile = new AgileClient(client, profile);

  // 3. Server + tool registration.
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, { config, profile, client, agile });

  // 4. stdio transport. stdout belongs to MCP; logging goes to stderr only.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} listening on stdio`);
}

if (!handleCliArgs(process.argv.slice(2))) {
  main().catch((err: unknown) => {
    logger.error("fatal error during server startup", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
