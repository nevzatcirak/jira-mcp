import { describe, expect, it } from "vitest";
import { checkNpmrcContent, scanLockfileRegistry } from "../scripts/check-org.mjs";

describe("scanLockfileRegistry", () => {
  it("accepts a clean lockfile resolving only against the public registry", () => {
    const clean = JSON.stringify({
      name: "pkg",
      lockfileVersion: 3,
      packages: {
        "": { name: "pkg" },
        "node_modules/zod": {
          version: "3.24.1",
          resolved: "https://registry.npmjs.org/zod/-/zod-3.24.1.tgz",
        },
        "node_modules/@esbuild/linux-x64": {
          version: "0.25.12",
          resolved: "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.25.12.tgz",
        },
      },
    });
    expect(scanLockfileRegistry(clean)).toEqual([]);
  });

  it("catches resolved URLs pointing at a non-public mirror", () => {
    const leaked = JSON.stringify({
      packages: {
        "node_modules/esbuild": {
          version: "0.25.12",
          resolved: "http://internal-mirror.invalid/repository/npm-public/esbuild/-/esbuild-0.25.12.tgz",
        },
      },
    });
    const violations = scanLockfileRegistry(leaked);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("lockfile leaking non-public registry");
    expect(violations[0]).toContain("internal-mirror.invalid");
  });

  it("catches every leaked URL, not just the first", () => {
    const leaked = JSON.stringify([
      { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
      { resolved: "http://mirror-one.invalid/a.tgz" },
      { resolved: "http://mirror-two.invalid/b.tgz" },
    ]);
    const violations = scanLockfileRegistry(leaked);
    expect(violations).toHaveLength(2);
  });

  it("ignores non-registry URLs like funding links", () => {
    const lockfile = JSON.stringify({
      packages: {
        "node_modules/zod": {
          version: "3.24.1",
          resolved: "https://registry.npmjs.org/zod/-/zod-3.24.1.tgz",
          funding: { url: "https://github.com/sponsors/someone" },
        },
      },
    });
    expect(scanLockfileRegistry(lockfile)).toEqual([]);
  });

  it("flags unparseable resolved URLs instead of skipping them", () => {
    const violations = scanLockfileRegistry(JSON.stringify({ resolved: "not-a-url" }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("unparseable URL");
  });
});

describe("checkNpmrcContent", () => {
  it("accepts the repo .npmrc pattern that pins the public registry", () => {
    const npmrc = "# comment explaining the pin\nregistry=https://registry.npmjs.org/\n";
    expect(checkNpmrcContent(npmrc)).toBeNull();
  });

  it("fails when .npmrc is missing", () => {
    const violation = checkNpmrcContent(null);
    expect(violation).toContain("missing repo-root .npmrc");
  });

  it("fails when .npmrc has no registry line", () => {
    expect(checkNpmrcContent("# only a comment\n")).toContain("no registry= line");
  });

  it("fails when .npmrc pins a non-public registry", () => {
    const violation = checkNpmrcContent("registry=http://internal-mirror.invalid/repository/npm-public/\n");
    expect(violation).toContain("does not pin the public registry");
    expect(violation).toContain("internal-mirror.invalid");
  });
});
