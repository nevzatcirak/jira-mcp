import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, extractItems, asEnvelope } from "../agile/agileClient.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

/**
 * GET /rest/api/2/project (Server/DC, plain array) vs
 * GET /rest/api/3/project/search (Cloud, paginated) — deployment chosen by
 * the InstanceProfile. Cards: {key, name, id, style?/type?}.
 */
export function registerJiraListProjects(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_list_projects",
    {
      title: "List Jira projects",
      description:
        "List projects the user can browse (key, name, id, style). Use to " +
        "discover project keys before creating or searching issues.",
      inputSchema: {
        startAt: z.number().int().min(0).default(0).describe("Pagination offset (Cloud; Server slices locally)"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum projects to return (hard cap: 100)"),
        query: z
          .string()
          .min(1)
          .optional()
          .describe("Filter by name/key fragment (Cloud native; best-effort on Server)"),
      },
    },
    async (args) => {
      try {
        const { type } = await ctx.profile.resolve();
        let projects: unknown[];
        let meta: { total: number; startAt: number; maxResults: number; hasMore: boolean; nextStartAt: number | null };
        if (type === "cloud") {
          const payload = asEnvelope(
            await ctx.client.request("api/3/project/search", {
              query: {
                startAt: args.startAt,
                maxResults: args.maxResults,
                query: args.query,
              },
            }),
          );
          projects = extractItems(payload, ["values"]);
          meta = pageMeta(payload, args.startAt, args.maxResults, projects.length);
        } else {
          // Server/DC: plain array, no server-side pagination.
          const all = await ctx.client.request<unknown>("api/2/project", {
            query: args.query ? { query: args.query } : undefined,
          });
          const list = Array.isArray(all) ? all : [];
          projects = list.slice(args.startAt, args.startAt + args.maxResults);
          meta = pageMeta({ total: list.length }, args.startAt, args.maxResults, projects.length);
        }
        const body = { ...meta, projects: projects.map(projectProjectCard) };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}

function projectProjectCard(project: unknown): Record<string, unknown> {
  const record = asRecord(project);
  const style = asString(record?.style);
  const type = asString(record?.projectTypeKey);
  const out: Record<string, unknown> = {
    key: asString(record?.key),
    name: asString(record?.name),
    id: typeof record?.id === "number" ? String(record.id) : asString(record?.id),
  };
  if (style) out.style = style; // Cloud: "classic" | "next-gen"
  else if (record?.simplified === true) out.style = "simplified";
  if (type) out.type = type; // Server/DC: "software" | "business" | ...
  return out;
}
