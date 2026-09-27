import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECTS } from "../src/core/effects";

describe("effect preview thumbnails", () => {
  it.each(EFFECTS.map((e) => e.id))("%s has a rendered thumbnail (run `npm run previews`)", (id) => {
    expect(existsSync(join(__dirname, "..", "src/assets/fx", `${id}.jpg`))).toBe(true);
  });
});
