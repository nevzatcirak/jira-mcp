#!/usr/bin/env node
/**
 * Guard used by CI: fails when forbidden organization references appear in
 * sources, docs, tests or workflows, when the npm lockfile resolves against a
 * non-public registry, or when the repo-root .npmrc does not pin the public
 * registry. Real organization names and internal mirrors must never appear in
 * this repository.
 *
 * Note: this script never spells the forbidden terms out in the repo — the
 * pattern is assembled from fragments so the guard does not match itself.
 *
 * Usage: node scripts/check-org.mjs [paths...]
 *
 * Exported pure functions (scanLockfileRegistry, checkNpmrcContent) are unit
 * tested in test/check-org.test.ts.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

const F1 = "comp";
const F2 = "any";
const F3 = "corpor";
const F4 = "ate";
const F5 = "\u015firk";
const F6 = "et";
const F7 = "kur";
const F8 = "um";

const FORBIDDEN = [F1 + F2, F3 + F4, F5 + F6, F7 + F8];

const PUBLIC_REGISTRY_HOST = "registry.npmjs.org";
const PUBLIC_REGISTRY_LINE = /^registry\s*=\s*https:\/\/registry\.npmjs\.org\/?\s*$/m;

const DEFAULT_TARGETS = [
  "src",
  "scripts",
  "test",
  "README.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  "eslint.config.js",
  ".env.example",
  ".github/workflows",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".idea"]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".example", "", ".html", ".css", ".sh", ".txt", // "" covers extensionless files like LICENSE
]);

/**
 * Scan lockfile content for resolved tarball URLs that point to a registry
 * other than the public npm registry. Only "resolved" fields are checked —
 * other URLs in the lockfile (e.g. funding/repository links) are not
 * registry leaks. Returns one violation string per offending URL, or an
 * empty array when clean.
 */
export function scanLockfileRegistry(content) {
  const violations = [];
  const urlPattern = /"resolved":\s*"([^"]+)"/g;
  for (const match of content.matchAll(urlPattern)) {
    let host;
    try {
      host = new URL(match[1]).host;
    } catch {
      violations.push(`unparseable URL in resolved/url field: ${match[1]}`);
      continue;
    }
    if (host !== PUBLIC_REGISTRY_HOST) {
      violations.push(`lockfile leaking non-public registry (${host}): ${match[1]}`);
    }
  }
  return violations;
}

/**
 * Validate repo-root .npmrc content (null = file missing). Returns a
 * violation string when the public registry is not pinned, else null.
 */
export function checkNpmrcContent(content) {
  if (content === null || content === undefined) {
    return "missing repo-root .npmrc — add it with 'registry=https://registry.npmjs.org/' so lockfiles always resolve against the public registry";
  }
  const lines = content.split(/\r?\n/);
  const registryLines = lines.filter((line) => /^\s*registry\s*=/.test(line));
  if (registryLines.length === 0) {
    return ".npmrc has no registry= line — add 'registry=https://registry.npmjs.org/'";
  }
  const pinned = registryLines.some((line) => PUBLIC_REGISTRY_LINE.test(line));
  if (!pinned) {
    return `.npmrc does not pin the public registry (found: ${registryLines.map((l) => l.trim()).join("; ")})`;
  }
  return null;
}

function scanFile(file, findings) {
  if (selfPathMatches(file)) return;
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) return;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return; // unreadable (binary or permission) — skip
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const term of FORBIDDEN) {
      if (line.toLowerCase().includes(term)) {
        findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
        break;
      }
    }
  });
}

function selfPathMatches(file) {
  const norm = file.split(sep).join("/");
  return norm.endsWith("scripts/check-org.mjs");
}

function collectFiles(target, findings) {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (SKIP_DIRS.has(entry)) continue;
      collectFiles(join(target, entry), findings);
    }
  } else {
    scanFile(target, findings);
  }
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : DEFAULT_TARGETS;

  const findings = [];
  let missing = 0;
  for (const target of targets) {
    try {
      collectFiles(target, findings);
    } catch {
      missing += 1; // optional target that does not exist yet
    }
  }

  // Lockfile registry guard: every resolved/url entry must point at the
  // public npm registry (case no.2 of organization-name leaks).
  try {
    const lockfile = readFileSync("package-lock.json", "utf8");
    findings.push(...scanLockfileRegistry(lockfile));
  } catch {
    console.error("package-lock.json not found — run npm install and commit the lockfile.");
    process.exit(1);
  }

  // Repo-root .npmrc must exist and pin the public registry.
  let npmrc = null;
  try {
    npmrc = readFileSync(".npmrc", "utf8");
  } catch {
    npmrc = null;
  }
  const npmrcViolation = checkNpmrcContent(npmrc);
  if (npmrcViolation) findings.push(npmrcViolation);

  if (findings.length > 0) {
    console.error("Guard violations found:\n" + findings.join("\n"));
    console.error("Fix these — they must never appear in this repository.");
    process.exit(1);
  }

  if (missing > 0) {
    console.log(`OK: no forbidden references, lockfile registry public, .npmrc pinned (${missing} optional target(s) not present yet).`);
  } else {
    console.log("OK: no forbidden references, lockfile registry public, .npmrc pinned.");
  }
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
