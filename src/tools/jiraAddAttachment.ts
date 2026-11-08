import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB (Server/DC default limit)

/** Reject files over the 10 MB limit before reading them (exported for tests). */
export function assertFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new JiraMcpError({
      code: "FILE_TOO_LARGE",
      message: `Attachment is ${sizeBytes} bytes; the limit is ${MAX_ATTACHMENT_BYTES} bytes (10 MB)`,
      hint: "Compress or split the file, or raise the attachment size limit on the Jira side.",
    });
  }
}

/**
 * POST /rest/api/2/issue/{key}/attachments — multipart/form-data upload with
 * the X-Atlassian-Token: no-check CSRF header. The response is a JSON ARRAY
 * of attachment objects even for a single file; only the first is projected:
 * {id, filename, size}.
 */
export function registerJiraAddAttachment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_add_attachment",
    {
      title: "Add attachment",
      description:
        "Upload a local file as an attachment to an issue (max 10 MB). " +
        "Returns {id, filename, size}.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        filePath: z
          .string()
          .min(1)
          .describe("Absolute or relative path of the local file to upload"),
        fileName: z
          .string()
          .min(1)
          .optional()
          .describe("Override the file name shown in Jira (defaults to the local file name)"),
      },
    },
    async (args) => {
      try {
        const info = await stat(args.filePath);
        if (!info.isFile()) {
          throw new JiraMcpError({
            code: "INVALID_ARGUMENT",
            message: `Path is not a regular file: ${args.filePath}`,
            hint: "Provide the path of an existing file.",
          });
        }
        assertFileSize(info.size);
        const buffer = await readFile(args.filePath);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buffer)]), args.fileName ?? basename(args.filePath));
        const payload = await ctx.client.request(
          `api/2/issue/${encodeURIComponent(args.issueKey)}/attachments`,
          {
            method: "POST",
            body: form,
            headers: { "X-Atlassian-Token": "no-check" },
          },
        );
        const attachment = Array.isArray(payload) ? payload[0] : payload;
        const record = asRecord(attachment);
        const result = {
          id: asString(record?.id) ?? null,
          filename: asString(record?.filename),
          size: typeof record?.size === "number" ? record.size : null,
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
