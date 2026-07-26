import { describe, expect, it } from "vitest";
import { assertDiffTarget, parseUnifiedDiff } from "../src/diff.js";

const DIFF = `diff --git a/src/math.ts b/src/math.ts
index 1111111..2222222 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -10,3 +10,4 @@ export function add(a: number, b: number) {
   const total = a + b;
-  return total;
+  return Number(total);
+  // Preserve numeric output.
 }
`;

describe("unified diff resolution", () => {
  it("maps added, deleted, and context lines to GitHub sides", () => {
    const lines = parseUnifiedDiff(DIFF);
    expect(lines).toContainEqual({
      path: "src/math.ts",
      side: "LEFT",
      line: 11,
      text: "  return total;"
    });
    expect(lines).toContainEqual({
      path: "src/math.ts",
      side: "RIGHT",
      line: 11,
      text: "  return Number(total);"
    });
    expect(lines).toContainEqual({
      path: "src/math.ts",
      side: "RIGHT",
      line: 12,
      text: "  // Preserve numeric output."
    });
  });

  it("rejects a line that is not part of the current diff", () => {
    expect(() =>
      assertDiffTarget(DIFF, "src/math.ts", "RIGHT", 200)
    ).toThrow(/not present in the current pull request diff/);
  });
});
