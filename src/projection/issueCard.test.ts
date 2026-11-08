import { describe, expect, it } from "vitest";
import {
  CARD_FIELDS,
  mergeFields,
  projectIssueCard,
  projectIssueCards,
} from "./issueCard.js";

/** Representative Jira search response issue (v2 API), including payload noise. */
const sampleIssue = {
  id: "10001",
  key: "ABC-123",
  expand: "renderedFields,names,schema,operations",
  names: { summary: "Summary", status: "Status" },
  schema: { fields: { summary: { type: "string" } } },
  fields: {
    summary: "Fix login redirect loop",
    status: {
      name: "In Progress",
      statusCategory: { key: "indeterminate", colorName: "yellow" },
    },
    issuetype: {
      name: "Bug",
      subtask: false,
      avatarUrls: {
        "48x48": "https://jira.example.com/avatars/bug.png",
        "24x24": "https://jira.example.com/avatars/bug24.png",
      },
    },
    assignee: {
      displayName: "jdoe",
      emailAddress: "jdoe@example.com",
      avatarUrls: { "48x48": "https://jira.example.com/avatars/jdoe.png" },
    },
    priority: { name: "High", iconUrl: "https://jira.example.com/icons/high.png" },
    updated: "2026-01-14T10:33:00.000+0000",
    labels: ["backend", "auth"],
    parent: { key: "ABC-100", fields: { summary: "Epic parent" } },
    description: "A long description that must not leak into search cards...",
    comment: { comments: [], maxResults: 0 },
  },
};

const secondIssue = {
  id: "10002",
  key: "ABC-124",
  fields: {
    summary: "Unassigned issue without priority or parent",
    status: { name: "Open" },
    issuetype: { name: "Task" },
    assignee: null,
    priority: null,
    updated: "2026-02-01T08:00:00.000+0000",
    labels: [],
  },
};

describe("projectIssueCard", () => {
  it("projects a search issue into the exact card shape", () => {
    const card = projectIssueCard(sampleIssue);
    expect(card).toEqual({
      key: "ABC-123",
      summary: "Fix login redirect loop",
      type: "Bug",
      status: "In Progress",
      assignee: "jdoe",
      priority: "High",
      labels: ["backend", "auth"],
      parent: "ABC-100",
      updated: "2026-01-14",
    });
  });

  it("stays null-safe for missing optional fields", () => {
    const card = projectIssueCard(secondIssue);
    expect(card).toEqual({
      key: "ABC-124",
      summary: "Unassigned issue without priority or parent",
      type: "Task",
      status: "Open",
      assignee: null,
      priority: null,
      labels: [],
      parent: null,
      updated: "2026-02-01",
    });
  });

  it("produces cards under 500 bytes (target ~250-400)", () => {
    const json = JSON.stringify(projectIssueCard(sampleIssue));
    expect(json.length).toBeLessThan(500);
  });

  it("never leaks avatarUrls, names, schema or other payload noise", () => {
    const json = JSON.stringify(projectIssueCards([sampleIssue, secondIssue]));
    expect(json).not.toContain("avatarUrls");
    expect(json).not.toContain('"names"');
    expect(json).not.toContain('"schema"');
    expect(json).not.toContain("changelog");
    expect(json).not.toContain("description");
    expect(json).not.toContain("statusCategory");
  });

  it("returns exactly the card keys, nothing more", () => {
    const card = projectIssueCard(sampleIssue);
    expect(Object.keys(card).sort()).toEqual(
      ["assignee", "key", "labels", "parent", "priority", "status", "summary", "type", "updated"].sort(),
    );
  });

  it("handles a malformed/empty issue without throwing", () => {
    expect(projectIssueCard(null)).toEqual({
      key: "",
      summary: null,
      type: null,
      status: null,
      assignee: null,
      priority: null,
      labels: [],
      parent: null,
      updated: null,
    });
  });
});

describe("mergeFields", () => {
  it("always contains the card field set", () => {
    expect(mergeFields()).toEqual([...CARD_FIELDS]);
  });

  it("appends extra fields without duplicating card fields", () => {
    expect(mergeFields(["customfield_10001", "status", "reporter"])).toEqual([
      ...CARD_FIELDS,
      "customfield_10001",
      "reporter",
    ]);
  });

  it("drops raw pass-through wildcards on list endpoints", () => {
    expect(mergeFields(["*all"])).toEqual([...CARD_FIELDS]);
  });
});
