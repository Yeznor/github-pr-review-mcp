import type { DiffLine, DiffSide } from "./types.js";

const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let path = "";
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let position = 0;

  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      path = "";
      inHunk = false;
      position = 0;
      continue;
    }
    if (rawLine.startsWith("+++ b/")) {
      path = rawLine.slice(6);
      continue;
    }
    if (rawLine === "+++ /dev/null") {
      path = "";
      continue;
    }

    const header = HUNK_HEADER.exec(rawLine);
    if (header?.groups) {
      if (inHunk) position += 1;
      oldLine = Number(header.groups.oldStart);
      newLine = Number(header.groups.newStart);
      inHunk = true;
      continue;
    }
    if (!inHunk || !path) continue;
    position += 1;
    if (rawLine.startsWith("\\ No newline")) continue;

    if (rawLine.startsWith("+")) {
      result.push({
        path,
        side: "RIGHT",
        line: newLine,
        position,
        text: rawLine.slice(1)
      });
      newLine += 1;
    } else if (rawLine.startsWith("-")) {
      result.push({
        path,
        side: "LEFT",
        line: oldLine,
        position,
        text: rawLine.slice(1)
      });
      oldLine += 1;
    } else if (rawLine.startsWith(" ")) {
      const text = rawLine.slice(1);
      result.push({ path, side: "LEFT", line: oldLine, position, text });
      result.push({ path, side: "RIGHT", line: newLine, position, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  return result;
}

export function resolveDiffPosition(
  diff: string,
  path: string,
  side: DiffSide,
  line: number
): number {
  const target = parseUnifiedDiff(diff).find(
    (candidate) =>
      candidate.path === path &&
      candidate.side === side &&
      candidate.line === line
  );
  if (!target) {
    throw new Error(
      `Line ${line} on ${side} of ${path} is not present in the current pull ` +
        "request diff. Call get_pr_diff again and choose a line from a shown hunk."
    );
  }
  return target.position;
}

export function assertDiffTarget(
  diff: string,
  path: string,
  side: DiffSide,
  line: number
): void {
  resolveDiffPosition(diff, path, side, line);
}
