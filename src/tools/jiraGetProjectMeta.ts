import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import { asRecord, asString, type JiraJson } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const MAX_ISSUETYPES = 10; // bounds the per-issuetype field fetches on Cloud
const MAX_ALLOWED_VALUES = 20;

const inputSchema = {
  project: z
    .string()
    .min(1)
    .optional()
    .describe("Project key or id (use this OR issueKey)"),
  issueKey: z
    .string()
    .min(1)
    .optional()
    .describe("Existing issue key; on Cloud the edit metadata of this issue is used"),
};

/**
 * Create/edit field metadata, shrunken for LLM consumption:
 * {projectKey, issueTypes: [{id, name, requiredFields: [{key, name, schema, allowedValues(<=20)}]}]}.
 *
 * - Server/DC: GET /rest/api/2/issue/createmeta?projectKeys=X&expand=projects.issuetypes.fields
 * - Cloud + issueKey: GET /rest/api/2/issue/{key}/editmeta (createmeta is deprecated there)
 * - Cloud + project: GET /rest/api/2/issue/createmeta/{project}/issuetypes (+ per-type field fetch, capped)
 */
export function registerJiraGetProjectMeta(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_project_meta",
    {
      title: "Get project field metadata",
      description:
        "Show the required fields (key, name, schema, allowed values) per issue " +
        "type for a project — call before jira_create_issue / jira_update_issue " +
        "to use correct field names and formats.",
      inputSchema,
    },
    async (args) => {
      try {
        if (!args.project && !args.issueKey) {
          throw new JiraMcpError({
            code: "INVALID_ARGUMENT",
            message: "Provide either 'project' or 'issueKey'",
            hint: "project is the key of the project to inspect; issueKey can be used on Cloud to get edit metadata.",
          });
        }
        const { type } = await ctx.profile.resolve();
        const projectKey = args.project ?? extractProjectKey(args.issueKey as string);
        const issueTypes =
          type === "cloud" ? await cloudIssueTypes(ctx, args, projectKey) : await serverIssueTypes(ctx, projectKey);
        const body = { projectKey, issueTypes };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}

function extractProjectKey(issueKey: string): string {
  const match = /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(issueKey.trim());
  if (!match) {
    return issueKey.trim(); // maybe a numeric id; pass through
  }
  return match[1] as string;
}

/** Server/DC: single createmeta call with expanded issuetype fields. */
async function serverIssueTypes(
  ctx: ToolContext,
  projectKey: string,
): Promise<Record<string, unknown>[]> {
  const payload = asRecord(
    await ctx.client.request("api/2/issue/createmeta", {
      query: { projectKeys: projectKey, expand: "projects.issuetypes.fields" },
    }),
  );
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const project = asRecord(projects[0]);
  const issuetypes = Array.isArray(project?.issuetypes) ? project.issuetypes : [];
  return issuetypes.map((raw) => {
    const it = asRecord(raw);
    return {
      id: asString(it?.id),
      name: asString(it?.name),
      requiredFields: requiredFieldsFromMap(asRecord(it?.fields)),
    };
  });
}

/** Cloud: editmeta for an issue key, or per-issue-type createmeta for a project. */
async function cloudIssueTypes(
  ctx: ToolContext,
  args: { project?: string; issueKey?: string },
  projectKey: string,
): Promise<Record<string, unknown>[]> {
  if (args.issueKey) {
    const payload = asRecord(
      await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/editmeta`),
    );
    return [
      {
        id: null,
        name: "edit",
        requiredFields: requiredFieldsFromMap(asRecord(payload?.fields)),
      },
    ];
  }
  const projectPath = `api/2/issue/createmeta/${encodeURIComponent(projectKey)}`;
  const listPayload = asRecord(await ctx.client.request(`${projectPath}/issuetypes`));
  const types = extractIssueTypes(listPayload).slice(0, MAX_ISSUETYPES);
  const result: Record<string, unknown>[] = [];
  for (const raw of types) {
    const it = asRecord(raw);
    const id = asString(it?.id);
    if (!id) continue;
    const fieldsPayload = asRecord(
      await ctx.client.request(`${projectPath}/issuetypes/${encodeURIComponent(id)}`),
    );
    const fieldsMap = asRecord(fieldsPayload?.fields);
    const requiredFields = fieldsMap
      ? requiredFieldsFromMap(fieldsMap)
      : requiredFieldsFromList(Array.isArray(fieldsPayload?.values) ? fieldsPayload.values : []);
    result.push({ id, name: asString(it?.name), requiredFields });
  }
  return result;
}

function extractIssueTypes(payload: Record<string, unknown> | null): unknown[] {
  for (const key of ["issueTypes", "values"]) {
    const items = payload?.[key];
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** createmeta expand / editmeta shape: fields keyed by field id. */
function requiredFieldsFromMap(fieldsMap: JiraJson | null): Record<string, unknown>[] {
  if (!fieldsMap) return [];
  return Object.entries(fieldsMap)
    .filter(([, f]) => asRecord(f)?.required === true)
    .map(([key, f]) => projectField(key, asRecord(f)))
    .filter((f): f is Record<string, unknown> => f !== null);
}

/** Newer paginated shape: FieldCreateMetaBean values[]. */
function requiredFieldsFromList(values: unknown[]): Record<string, unknown>[] {
  return values
    .map((f) => {
      const record = asRecord(f);
      const key = asString(record?.fieldId) ?? asString(record?.key);
      return key ? projectField(key, record) : null;
    })
    .filter((f): f is Record<string, unknown> => f !== null);
}

function projectField(
  key: string,
  field: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!field) return null;
  const schema = asRecord(field.schema);
  const allowedValues = Array.isArray(field.allowedValues)
    ? field.allowedValues.slice(0, MAX_ALLOWED_VALUES)
    : undefined;
  const out: Record<string, unknown> = {
    key,
    name: asString(field.name),
    schema: {
      type: asString(schema?.type),
      ...(asString(schema?.items) ? { items: asString(schema?.items) } : {}),
      ...(asString(schema?.system) ? { system: asString(schema?.system) } : {}),
      ...(asString(schema?.custom) ? { custom: asString(schema?.custom) } : {}),
    },
  };
  if (allowedValues) out.allowedValues = allowedValues; // first 20 only
  return out;
}
