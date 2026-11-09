import { describe, expect, it } from "vitest";
import { resolveMappingPath, applyResponseMapping } from "./responseMapping.js";

const payload = {
  total: 28.66,
  weekHours: 8.5,
  items: [
    { day: "2026-11-02", hour: 7.71, weekend: false },
    { day: "2026-11-03", hour: 8.05, weekend: false },
  ],
};

describe("resolveMappingPath", () => {
  it("resolves a top-level field", () => {
    expect(resolveMappingPath(payload, "total")).toBe(28.66);
  });

  it("resolves nested object paths", () => {
    expect(resolveMappingPath({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
  });

  it("maps over arrays with []", () => {
    expect(resolveMappingPath(payload, "items[].hour")).toEqual([7.71, 8.05]);
    expect(resolveMappingPath(payload, "items[].day")).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("returns undefined for missing paths and null steps", () => {
    expect(resolveMappingPath(payload, "missing.deep")).toBeUndefined();
    expect(resolveMappingPath(null, "total")).toBeUndefined();
  });
});

describe("applyResponseMapping", () => {
  it("projects only the mapped fields", () => {
    expect(
      applyResponseMapping(payload, {
        total: "total",
        dailyHours: "items[].hour",
        weekend: "items[].weekend",
      }),
    ).toEqual({
      total: 28.66,
      dailyHours: [7.71, 8.05],
      weekend: [false, false],
    });
  });

  it("omits fields that do not resolve", () => {
    expect(applyResponseMapping(payload, { total: "total", nope: "nope" })).toEqual({ total: 28.66 });
  });
});
