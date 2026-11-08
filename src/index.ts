#!/usr/bin/env node
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

main().catch((err: unknown) => {
  logger.error("fatal error during server startup", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
