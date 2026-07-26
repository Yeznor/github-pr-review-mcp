import type { PermissionMode } from "./types.js";

export function requireWrite(mode: PermissionMode, operation: string): void {
  if (mode !== "write") {
    throw new Error(
      `${operation} is disabled because GITHUB_PERMISSION_MODE is "read". ` +
        'Set it to "write" only after reviewing the requested action.'
    );
  }
}
