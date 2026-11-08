# ⚡ JIRA-MCP

A **deployment-agnostic Jira MCP server** over stdio — works with **Jira Server, Data Center and Cloud** with zero hardcoded board IDs, project keys, status names or customfield IDs.

╔══════════════════════════════════════════════════════════╗
║  📦 **Compact output**   ·   issue cards, not raw payloads ║
║  🧠 **Semantic actions**  ·   transition by status name     ║
║  📋 **Full board support**·   boards, backlog, sprints      ║
╚══════════════════════════════════════════════════════════╝

[![npm version](https://img.shields.io/npm/v/@nevzatcirak/jira-mcp.svg)](https://www.npmjs.com/package/@nevzatcirak/jira-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@nevzatcirak/jira-mcp.svg)](https://www.npmjs.com/package/@nevzatcirak/jira-mcp)
[![CI](https://github.com/nevzatcirak/jira-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/nevzatcirak/jira-mcp/actions/workflows/ci.yml)
[![Publish](https://github.com/nevzatcirak/jira-mcp/actions/workflows/publish.yml/badge.svg)](https://github.com/nevzatcirak/jira-mcp/actions/workflows/publish.yml)
[![node](https://img.shields.io/node/v/@nevzatcirak/jira-mcp.svg)](https://www.npmjs.com/package/@nevzatcirak/jira-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 🎯 Why this package

Raw Jira REST payloads are enormous — every issue drags avatars, schemas, changelogs, expand lists and renderer metadata into your LLM's context window. This server projects each issue into a **~230 byte card**, cutting context cost by **~99%** while keeping every field an agent actually needs.

| | Raw Jira REST payload | jira-mcp card projection |
|---|---|---|
| Size per issue | ~40 KB *(typical)* | ~230 bytes *(measured)* |
| Context cost (25 issues) | ~1 MB / ~250K tokens *(typical)* | ~5.7 KB / ~1.4K tokens *(measured)* |
| Reduction | — | **~99% smaller** |

**Measurement context** (measured values): Jira Server/DC instance, Scrum board
(`boardId: 10212`), `jira_get_board_backlog` with `maxResults=25` — 25 issue cards
from the real response, ~230 bytes per issue on average. The raw-payload column has
**no measured baseline for this instance**: it uses the typical v2 search response
size of ~40 KB per issue, so those numbers are labeled *typical*, not measured.
Card fields used in the measurement: `key`, `summary`, `type`, `status`, `assignee`,
`priority`, `labels`, `parent`, `updated`.

An example card from that measurement, verbatim:

```json
{
  "key": "KAPI-215",
  "summary": "Sync servisindeki OPA güncelleme yeteneğin Kapı tarafından sağlanması",
  "type": "Task",
  "status": "Resolved",
  "assignee": "Barış Buğra ÖZDEMİR",
  "priority": "Medium",
  "labels": [],
  "parent": null,
  "updated": "2026-10-02"
}
```

Run it yourself with `npm run benchmark -- "<your JQL>"` — numbers depend on your instance, fields and issue size.

---

## ✨ Features (24 tools)

### 🔍 Discovery

| Tool | Purpose | Key parameters |
|---|---|---|
| `jira_get_server_info` | Instance version, deployment type, build number | — |
| `jira_get_myself` | Authenticated user (accountId, name, displayName, timeZone) | — |
| `jira_list_projects` | Projects the user can browse | `query?`, `startAt?`, `maxResults?` |
| `jira_get_project_meta` | Required fields + allowed values per issue type — call before create/update | `project?` or `issueKey?` |
| `jira_find_user` | Find users by username / display name before assigning | `query`, `maxResults?`, `startAt?` |
| `jira_list_transitions` | Available workflow transitions for an issue | `issueKey` |

### 📖 Reading

| Tool | Purpose | Key parameters |
|---|---|---|
| `jira_search_issues` | JQL search returning compact issue cards | `jql`, `fields?`, `startAt?`, `maxResults?` |
| `jira_get_issue` | One issue + truncated description, optional comments/worklogs | `issueKey`, `fields?`, `maxDescriptionChars?`, `includeComments?`, `includeWorklogs?` |
| `jira_list_boards` | Agile boards, filter by project / type / name | `projectKeyOrId?`, `type?: scrum\|kanban`, `name?` |
| `jira_get_board_backlog` | Board backlog as issue cards, optional JQL | `boardId`, `jql?`, pagination |
| `jira_list_sprints` | Sprints of a board, filter by state | `boardId`, `state?: future,active,closed` |

*(also: `jira_get_board_issues` — issues currently on a board, `jira_get_sprint_issues` — issues of one sprint)*

### ✍️ Writing

| Tool | Purpose | Key parameters |
|---|---|---|
| `jira_create_issue` | Create an issue; returns `{key, id, url}` | `project`, `issueType`, `summary`, `description?`, `assignee?`, `priority?`, `labels?`, `parentKey?` |
| `jira_update_issue` | Partial update — only provided fields change | `issueKey` + any create field |
| `jira_transition_issue` | Semantic move: by target status **or** transition id | `issueKey`, `toStatus?` / `transitionId?`, `comment?` |
| `jira_assign_issue` | Assign a user, or unassign with `"-none-"` | `issueKey`, `assignee` |
| `jira_add_comment` | Add a comment (wiki string on Server/DC, ADF on Cloud — automatic) | `issueKey`, `comment` |

### ⏱️ Time & Links

| Tool | Purpose | Key parameters |
|---|---|---|
| `jira_add_worklog` | Log work: `'3h 30m'` or seconds; estimate adjust modes | `issueKey`, `timeSpent`, `started?`, `adjustEstimate?: auto\|leave\|new\|manual` |
| `jira_list_worklogs` | Paginated worklog list | `issueKey`, pagination |
| `jira_link_issues` | Link two issues (`Relates`, `Blocks`, …) | `linkType`, `inwardIssueKey` / `outwardIssueKey` |
| `jira_add_remote_link` | Attach an external URL to an issue | `issueKey`, `url`, `title?` |
| `jira_add_attachment` | Upload a local file (max 10 MB) | `issueKey`, `filePath`, `fileName?` |

### 🏃 Sprint

| Tool | Purpose | Key parameters |
|---|---|---|
| `jira_move_issues_to_sprint` | Move up to 50 issues into a sprint; returns `{moved, errors}` | `sprintId`, `issueKeys[1..50]` |

---

## 📥 Installation

**1 · Run directly with npx (recommended):**

```bash
npx @nevzatcirak/jira-mcp
```

**2 · Install globally:**

```bash
npm install -g @nevzatcirak/jira-mcp
jira-mcp
```

**3 · From source:**

```bash
git clone https://github.com/nevzatcirak/jira-mcp.git
cd jira-mcp
npm install && npm run build
node dist/index.js
```

**Doğrulama:**

```bash
jira-mcp --version
# @nevzatcirak/jira-mcp 1.0.1
```

---

## 🔁 Migrating from other jira-mcp packages

If a different jira-mcp package was installed earlier — one that registers the same
`jira-mcp` bin name — a global install of this package fails with an `EEXIST` error.
Find and remove the old package first:

```bash
# unix
npm ls -g | grep jira
npm rm -g <old-package-name>
```

```powershell
# Windows (PowerShell)
npm ls -g | findstr jira
npm rm -g <old-package-name>
```

If a leftover bin shim remains, check which package it points to with
`where jira-mcp` (Windows) or `which -a jira-mcp` (unix).

> MCP clients that run the server through `npx` (the recommended setup) are **not**
> affected by this conflict — `npx` resolves the package by full name and does not use
> the global bin shim.

---

## 🩺 Troubleshooting

**`npx` crashes on every run.**
Corrupted `npx` cache. Delete the cached package folder and `npx` re-downloads it on the
next run:

- Windows: `%LocalAppData%\npm-cache\_npx`
- unix: `~/.npm/_npx`

**The old 6-tool server still seems to run.**
A leftover global bin shim may still resolve to the old package. Check which package the
shim points to with `where jira-mcp` (Windows) or `which jira-mcp` (unix), remove the old
package (`npm rm -g <old-package>`), then reinstall this one.

**`"The backlog is not available on Kanban boards"`**
Jira platform restriction: the backlog endpoint exists only on **Scrum** boards. For a
Kanban board, use `jira_get_board_issues` with a JQL filter instead.

---

## ⚙️ Configuration

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | ✅ | Instance base URL, e.g. `https://acme-jira.example.com` |
| `JIRA_API_TOKEN` | ✅ | PAT (Server/DC) or API token (Cloud) |
| `JIRA_EMAIL` | Cloud only | Cloud account email (required when instance type is cloud) |
| `JIRA_INSTANCE_TYPE` | — | `auto` (default) \| `server` \| `cloud` |

**Server/DC vs Cloud authentication:**

| | Jira Server / Data Center | Jira Cloud |
|---|---|---|
| Auth scheme | `Authorization: Bearer <token>` | `Authorization: Basic base64(email:token)` |
| `JIRA_EMAIL` | not used | **required** |
| User identity | username | accountId |
| Comments | wiki string | ADF document |
| Auto-detect | `JIRA_INSTANCE_TYPE=auto` probes `/rest/api/2/serverInfo` once and caches the deployment type | |

Config problems never crash the server — the tool call fails with a structured `CONFIG_MISSING` error listing the missing fields.

---

## 🔌 MCP client configuration

### OpenCode (`opencode.json`)

```json
{
  "mcp": {
    "jira": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "@nevzatcirak/jira-mcp"
      ],
      "environment": {
        "JIRA_BASE_URL": "https://acme-jira.example.com",
        "JIRA_API_TOKEN": "your-personal-access-token",
        "JIRA_INSTANCE_TYPE": "server"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@nevzatcirak/jira-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://acme-jira.example.com",
        "JIRA_API_TOKEN": "your-personal-access-token",
        "JIRA_INSTANCE_TYPE": "server"
      }
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@nevzatcirak/jira-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://acme-jira.example.com",
        "JIRA_API_TOKEN": "your-personal-access-token",
        "JIRA_INSTANCE_TYPE": "server"
      }
    }
  }
}
```

> ☁️ **Cloud:** add `"JIRA_EMAIL": "you@example.com"`, set `JIRA_INSTANCE_TYPE` to `cloud` (or leave `auto`), and use an API token from `id.atlassian.com`.

---

## 🧪 Tool usage examples

**1 · Pull a board backlog:**

```json
{ "tool": "jira_get_board_backlog", "arguments": { "boardId": 42, "maxResults": 25 } }
```

**2 · JQL search with extra fields:**

```json
{ "tool": "jira_search_issues", "arguments": { "jql": "project = ABC AND status != Done ORDER BY updated DESC", "fields": ["storypoints"], "maxResults": 25 } }
```

**3 · Issue details with comments:**

```json
{ "tool": "jira_get_issue", "arguments": { "issueKey": "ABC-123", "includeComments": true } }
```

**4 · Log work:**

```json
{ "tool": "jira_add_worklog", "arguments": { "issueKey": "ABC-123", "timeSpent": "3h 30m", "comment": "Implemented retry logic and tests" } }
```

**5 · Attach a web link:**

```json
{ "tool": "jira_add_remote_link", "arguments": { "issueKey": "ABC-123", "url": "https://design.example.com/spec-7", "title": "Design spec" } }
```

**6 · Semantic transition (no transition IDs needed):**

```json
{ "tool": "jira_transition_issue", "arguments": { "issueKey": "ABC-123", "toStatus": "Done", "comment": "Verified on staging" } }
```

**7 · Move issues into a sprint:**

```json
{ "tool": "jira_move_issues_to_sprint", "arguments": { "sprintId": 318, "issueKeys": ["ABC-123", "ABC-124", "ABC-125"] } }
```

**8 · Find a user, then assign:**

```json
{ "tool": "jira_find_user", "arguments": { "query": "Jane Doe" } }
```

```json
{ "tool": "jira_assign_issue", "arguments": { "issueKey": "ABC-123", "assignee": "jdoe" } }
```

---

## 📝 Behavior notes

**Card projection.** Every list/search result is a compact card — never avatars, schemas, changelogs or raw payloads:

```json
{
  "key": "ABC-123",
  "summary": "Fix login redirect loop",
  "type": "Bug",
  "status": "In Progress",
  "assignee": "jdoe",
  "priority": "High",
  "labels": ["backend", "auth"],
  "parent": "ABC-100",
  "updated": "2026-01-14"
}
```

Extra fields can be merged in via `fields` (deduplicated; `*all`/`*navigable` are dropped on list endpoints).

**Pagination.** All paginated tools return top-level meta:

```json
{ "total": 120, "startAt": 0, "maxResults": 25, "hasMore": true, "nextStartAt": 25 }
```

Keep passing `startAt: nextStartAt` until `hasMore` is `false`.

**Truncation rules.**

- Issue descriptions: capped by `maxDescriptionChars` (default 500, max 20000)
- Comments / worklog bodies in `jira_get_issue`: 500 chars each, capped at 1000 items
- Worklog comments in `jira_list_worklogs`: 300 chars
- Every truncated item reports `{ "truncated": true, "totalLength": 4211 }`
- `maxResults` is hard-capped at 100 on every list tool

**Structured errors.** Failures never throw raw stack traces — every error is a structured payload:

```json
{
  "error": {
    "code": "JIRA_400",
    "message": "Jira HTTP 400: ...",
    "hint": "parentKey may be rejected for Cloud team-managed projects...",
    "jiraErrors": {
      "errorMessages": ["Issue does not exist or you do not have permission to see it."],
      "errors": { "assignee": "User 'jdoe' does not exist." }
    }
  }
}
```

Fixed codes include `CONFIG_MISSING`, `INVALID_ARGUMENT`, `JIRA_TIMEOUT`, `JIRA_NETWORK`, `AMBIGUOUS_TRANSITION`, `TRANSITION_NOT_FOUND`, `USER_NOT_FOUND`, `AMBIGUOUS_USER`, `FILE_TOO_LARGE`. Jira's own field errors are preserved verbatim in `jiraErrors`.

**Resilience.** 30s per-request timeout, up to 2 retries on 429/5xx with `Retry-After` awareness, and an automatic `agile/1.0` → `greenhopper/1.0` fallback for older Server instances.

---

## 🛠️ Development

```bash
npm install          # install dependencies
npm test             # unit tests (vitest, no Jira connection needed)
npm run build        # compile to dist/
npm run lint         # eslint
npm run benchmark    # payload-size benchmark (needs a live Jira)
```

**Integration tests (optional, against a real instance):**

| Variable | Purpose |
|---|---|
| `JIRA_IT=1` | Enables integration tests (read-only scenario — connection env only) |
| `JIRA_E2E_PROJECT` | Project key for the write scenario (issues are created **and deleted**) |
| `JIRA_E2E_ISSUE_TYPE` | Optional issue type for the write scenario (default: `Task`) |

---

## 🚀 Publishing

Releases are published to npm **automatically by CI** — never publish manually from a laptop.

**Flow:**

1. **Release workflow** (`.github/workflows/release.yml`, manual `workflow_dispatch`):
   give it a semver version (e.g. `1.0.1`) — it bumps `package.json` + `package-lock.json`,
   commits as `github-actions[bot]` with `chore: release vX`, creates tag `vX` and pushes both.
2. The `v*` tag push triggers the **Publish workflow** (`.github/workflows/publish.yml`),
   which runs tests + build and then `npm publish --access public` to
   <https://registry.npmjs.org/>.

**One-time setup (required):**

- Create an npm **automation** token with **Read & Write** permission at
  [npmjs.com → Access Tokens](https://www.npmjs.com/settings/~/tokens) (Classic Tokens section).
- Add it as a repository secret: **GitHub repo → Settings → Secrets and variables →
  Actions → New repository secret**, name it `NPM_TOKEN`.
- The publish job uses `registry-url: https://registry.npmjs.org/` and passes the token
  via `NODE_AUTH_TOKEN`.

**Guards (the publish job fails fast on):**

- **Version ↔ tag mismatch:** `package.json` version must match the pushed tag
  (`v` + version, e.g. version `1.0.0` ↔ tag `v1.0.0`).
- **Package name check:** `package.json` `name` must be exactly
  `@nevzatcirak/jira-mcp` — prevents accidentally publishing the wrong package.

> 📌 **Scoped package note:** `@nevzatcirak/jira-mcp` is a scoped package, so
> `npm publish --access public` is **mandatory** (scoped packages default to
> restricted, which requires a paid plan).
>
> 🖐️ **Manual dispatch note:** the Publish workflow also supports `workflow_dispatch`,
> but a manual run skips the tag guard — it publishes whatever `version` is currently in
> `package.json` (tests + build still run). Prefer the Release workflow so tags and
> versions stay in sync.

---

## 📄 License

[MIT](./LICENSE) © Nevzat Cirak
