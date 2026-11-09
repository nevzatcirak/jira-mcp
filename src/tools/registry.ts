import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RestClient } from "../client/RestClient.js";
import type { InstanceProfile } from "../client/InstanceProfile.js";
import type { AgileClient } from "../agile/agileClient.js";
import type { JiraConfig } from "../config.js";
import { registerJiraAddAttachment } from "./jiraAddAttachment.js";
import { registerJiraAddComment } from "./jiraAddComment.js";
import { registerJiraAddRemoteLink } from "./jiraAddRemoteLink.js";
import { registerJiraAddWorklog } from "./jiraAddWorklog.js";
import { registerJiraProviderCall } from "./jiraProviderCall.js";
import { registerJiraAssignIssue } from "./jiraAssignIssue.js";
import { registerJiraCreateIssue } from "./jiraCreateIssue.js";
import { registerJiraFindUser } from "./jiraFindUser.js";
import { registerJiraGetBoardBacklog } from "./jiraGetBoardBacklog.js";
import { registerJiraGetBoardIssues } from "./jiraGetBoardIssues.js";
import { registerJiraGetIssue } from "./jiraGetIssue.js";
import { registerJiraGetMyself } from "./jiraGetMyself.js";
import { registerJiraGetProjectMeta } from "./jiraGetProjectMeta.js";
import { registerJiraGetServerInfo } from "./jiraGetServerInfo.js";
import { registerJiraGetSprintIssues } from "./jiraGetSprintIssues.js";
import { registerJiraLinkIssues } from "./jiraLinkIssues.js";
import { registerJiraListBoards } from "./jiraListBoards.js";
import { registerJiraListProjects } from "./jiraListProjects.js";
import { registerJiraListSprints } from "./jiraListSprints.js";
import { registerJiraListTransitions } from "./jiraListTransitions.js";
import { registerJiraListWorklogs } from "./jiraListWorklogs.js";
import { registerJiraMoveIssuesToSprint } from "./jiraMoveIssuesToSprint.js";
import { registerJiraSearchIssues } from "./jiraSearchIssues.js";
import { registerJiraTransitionIssue } from "./jiraTransitionIssue.js";
import { registerJiraUpdateIssue } from "./jiraUpdateIssue.js";

export interface ToolContext {
  config: JiraConfig;
  profile: InstanceProfile;
  client: RestClient;
  agile: AgileClient;
}

/**
 * Tool registration center: every tool file registers itself here.
 * Add new tools by importing their register function and calling it below.
 */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  // Read tools
  registerJiraGetServerInfo(server, ctx);
  registerJiraGetMyself(server, ctx);
  registerJiraSearchIssues(server, ctx);
  registerJiraGetIssue(server, ctx);
  registerJiraListBoards(server, ctx);
  registerJiraGetBoardBacklog(server, ctx);
  registerJiraGetBoardIssues(server, ctx);
  registerJiraListSprints(server, ctx);
  registerJiraGetSprintIssues(server, ctx);
  registerJiraListTransitions(server, ctx);
  registerJiraFindUser(server, ctx);
  registerJiraListProjects(server, ctx);
  registerJiraGetProjectMeta(server, ctx);
  // Write tools
  registerJiraCreateIssue(server, ctx);
  registerJiraUpdateIssue(server, ctx);
  registerJiraTransitionIssue(server, ctx);
  registerJiraAssignIssue(server, ctx);
  registerJiraAddComment(server, ctx);
  registerJiraAddWorklog(server, ctx);
  registerJiraListWorklogs(server, ctx);
  registerJiraLinkIssues(server, ctx);
  registerJiraAddRemoteLink(server, ctx);
  registerJiraAddAttachment(server, ctx);
  registerJiraMoveIssuesToSprint(server, ctx);
  // Extensibility
  registerJiraProviderCall(server, ctx);
}
