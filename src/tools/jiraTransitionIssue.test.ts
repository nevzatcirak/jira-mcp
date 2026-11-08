import { describe, expect, it } from "vitest";
import { matchTransition } from "./jiraTransitionIssue.js";

const transitions = [
  { id: "31", name: "Done", to: { id: "10001", name: "Done" } },
  { id: "41", name: "Block it", to: { id: "10002", name: "Blocked" } },
  { id: "11", name: "GO TO In Progress", to: { id: "10003", name: "In Progress" } },
  { id: "21", name: "Reopen", to: { id: "10003", name: "Reopened" } },
];

describe("matchTransition", () => {
  it("matches by transition name, case-insensitively", () => {
    expect(matchTransition(transitions, "block it")).toEqual({
      id: "41",
      name: "Block it",
      toStatus: "Blocked",
    });
  });

  it("matches by target status name, case-insensitively", () => {
    expect(matchTransition(transitions, "in progress")).toEqual({
      id: "11",
      name: "GO TO In Progress",
      toStatus: "In Progress",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(matchTransition(transitions, "  done  ")?.id).toBe("31");
  });

  it("returns null when nothing matches", () => {
    expect(matchTransition(transitions, "Deployed")).toBeNull();
  });

  it("throws AMBIGUOUS_TRANSITION listing every match", () => {
    const ambiguous = [
      { id: "31", name: "Done", to: { name: "Done" } },
      { id: "41", name: "Set Done", to: { name: "Done" } },
    ];
    let message = "";
    try {
      matchTransition(ambiguous, "done");
    } catch (err) {
      message = (err as { message: string }).message;
    }
    expect(message).toContain("Multiple transitions match 'done'");
    expect(message).toContain("[31 'Done']");
    expect(message).toContain("[41 'Set Done']");
  });

  it("ignores entries without an id", () => {
    expect(matchTransition([{ to: { name: "Done" } }], "done")).toBeNull();
  });
});
