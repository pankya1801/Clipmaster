import { describe, expect, test } from "vitest";
import { SHORTCUTS } from "../src/components/shortcuts";

describe("SHORTCUTS", () => {
  test("every entry has a key and a label", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const [key, label] of SHORTCUTS) {
      expect(key.trim().length).toBeGreaterThan(0);
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  test("keys are unique so the cheat-sheet and the Inspector agree", () => {
    const keys = SHORTCUTS.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the cheat-sheet key itself is listed", () => {
    expect(SHORTCUTS).toContainEqual(["?", "This cheat-sheet"]);
  });
});
