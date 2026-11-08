import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";
import { commentBody } from "./writeFields.js";

export interface TransitionMatch {
  id: string;
  name: string;
  toStatus: string;
}

/**
 * Match a requested status against transition `name` AND `to.name`,
 * case-insensitively. Throws AMBIGUOUS_TRANSITION when several transitions
 * match; returns null when none does.
 */
export function matchTransition(
  transitions: readonly unknown[],
  toStatus: string,
): TransitionMatch | null {
  const needle = toStatus.trim().toLowerCase();
  const matches: TransitionMatch[] = [];
  for (const raw of transitions) {
    const record = asRecord(raw);
    const id = asString(record?.id);
    if (!id) continue;
    const name = asString(record?.name);
    const toStatusName = asString(asRecord(record?.to)?.name);
    if (name?.toLowerCase() === needle || toStatusName?.toLowerCase() === needle) {
      matches.push({ id, name: name ?? "", toStatus: toStatusName ?? name ?? "" });
    }
  }
  if (matches.length > 1) {
    throw new JiraMcpError({
      code: "AMBIGUOUS_TRANSITION",
      message: `Multiple transitions match '${toStatus}': ${matches
        .map((m) => `[${m.id} '${m.name}']`)
        .join(", ")}`,
      hint: "Pick one and re-run with transitionId (see jira_list_transitions).",
    });
  }
  return matches[0] ?? null;
}

async function currentStatus(ctx: ToolContext, issueKey: string): Promise<string> {
  try {
    const payload = asRecord(
      await ctx.client.request(`api/2/issue/${encodeURIComponent(issueKey)}`, {
        query: { fields: "status" },
      }),
    );
    return asString(asRecord(asRecord(payload?.fields)?.status)?.name) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function availableList(transitions: readonly unknown[]): string {
  const parts: string[] = [];
  for (const raw of transitions) {
    const record = asRecord(raw);
    const id = asString(record?.id);
    const name = asString(record?.name);
    if (id && name) parts.push(`[${id} '${name}']`);
  }
  return parts.join(", ");
}

/**
 * POST /rest/api/2/issue/{key}/transitions — semantic status transition:
 * resolve `toStatus` against the live workflow (name or target status,
 * case-insensitive) or use an explicit `transitionId`.
 */
export function registerJiraTransitionIssue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_transition_issue",
    {
      title: "Transition Jira issue",
      description:
        "Move an issue through its workflow. Give toStatus (target status or " +
        "transition name, case-insensitive; ambiguous matches are rejected with " +
        "the candidate list) or an explicit transitionId from jira_list_transitions. " +
        "Optionally add a comment with the transition.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        toStatus: z
          .string()
          .min(1)
          .optional()
          .describe("Target status or transition name, e.g. 'Done' (case-insensitive)"),
        transitionId: z
          .union([z.string().min(1), z.number().int().min(1)])
          .optional()
          .describe("Explicit transition id from jira_list_transitions"),
        comment: z.string().min(1).optional().describe("Optional comment added with the transition"),
      },
    },
    async (args) => {
      try {
        if (!args.toStatus && !args.transitionId) {
          throw new JiraMcpError({
            code: "INVALID_ARGUMENT",
            message: "Either toStatus or transitionId must be provided",
            hint: "Use jira_list_transitions to discover valid transitions and their ids.",
          });
        }

        let transitionId: string;
        let matched: TransitionMatch | null = null;
        if (args.toStatus) {
          const payload = asRecord(
            await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/transitions`),
          );
          const list = Array.isArray(payload?.transitions) ? payload.transitions : [];
          const match = matchTransition(list, args.toStatus);
          if (!match) {
            const status = await currentStatus(ctx, args.issueKey);
            const available = availableList(list);
            throw new JiraMcpError({
              code: "TRANSITION_NOT_FOUND",
              message:
                `No transition to '${args.toStatus}' from status '${status}'. ` +
                `Available transitions from '${status}': ${available || "(none)"}`,
              hint: "Use jira_list_transitions for exact names/ids, or check user permissions.",
            });
          }
          matched = match;
          transitionId = match.id;
        } else {
          transitionId = String(args.transitionId);
        }

        const body: Record<string, unknown> = { transition: { id: transitionId } };
        if (args.comment) {
          body.update = { comment: [{ add: { body: await commentBody(ctx, args.comment) } }] };
        }
        await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/transitions`, {
          method: "POST",
          body,
        });
        const result = {
          key: args.issueKey,
          transitionId,
          toStatus: matched?.toStatus ?? null,
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
