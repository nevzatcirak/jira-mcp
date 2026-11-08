import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredSecrets, logger, redact, registerSecrets } from "./logger.js";

const SECRET = "super-secret-token-123";

beforeEach(() => {
  clearRegisteredSecrets();
});

afterEach(() => {
  clearRegisteredSecrets();
  vi.restoreAllMocks();
});

describe("redact", () => {
  it("replaces registered token values", () => {
    registerSecrets(SECRET);
    const out = redact(`Authorization: Bearer ${SECRET}`);
    expect(out).not.toContain(SECRET);
    expect(out).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts Bearer/Basic header values even when not registered", () => {
    const out = redact("Authorization: Basic dXNlckBleGFtcGxlLmNvbTp0b2tlbg==");
    expect(out).not.toContain("dXNlckBleGFtcGxlLmNvbTp0b2tlbg==");
    expect(out).toContain("Basic [REDACTED]");
  });

  it("redacts every occurrence of a registered secret", () => {
    registerSecrets(SECRET);
    const out = redact(`token=${SECRET}&token2=${SECRET}`);
    expect(out).not.toContain(SECRET);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it("leaves normal log text untouched", () => {
    expect(redact("search returned 25 issues")).toBe("search returned 25 issues");
  });
});

describe("logger", () => {
  it("writes redacted JSON lines to stderr (never stdout)", () => {
    registerSecrets(SECRET);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    logger.info(`authenticated with ${SECRET}`, {
      Authorization: `Bearer ${SECRET}`,
    });

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);

    const line = String(write.mock.calls[0]?.[0]);
    expect(line).not.toContain(SECRET);

    const parsed = JSON.parse(line) as {
      level: string;
      message: string;
      meta: { Authorization: string };
    };
    expect(parsed.level).toBe("info");
    expect(parsed.message).not.toContain(SECRET);
    expect(parsed.meta.Authorization).toBe("Bearer [REDACTED]");
  });

  it("keeps error-level logging on stderr as well", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("request failed");
    const parsed = JSON.parse(String(write.mock.calls[0]?.[0])) as { level: string };
    expect(parsed.level).toBe("error");
  });
});
