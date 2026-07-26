export type PermissionMode = "read" | "write";

export interface RateLimitSnapshot {
  limit?: number | undefined;
  remaining?: number | undefined;
  used?: number | undefined;
  resetAt?: string | undefined;
  resource?: string | undefined;
}

export interface PageOptions {
  perPage: number;
  maxItems: number;
}

export interface ToolEnvelope<T> {
  ok: true;
  data: T;
  rateLimit: RateLimitSnapshot;
}

export type DiffSide = "LEFT" | "RIGHT";

export interface DiffLine {
  path: string;
  side: DiffSide;
  line: number;
  position: number;
  text: string;
}
