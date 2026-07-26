import type { RateLimitSnapshot } from "./types.js";

export function formatRateLimit(rateLimit: RateLimitSnapshot): string {
  if (rateLimit.remaining === undefined) return "rate limit unavailable";
  const reset = rateLimit.resetAt ? `; resets ${rateLimit.resetAt}` : "";
  const resource = rateLimit.resource ? ` for ${rateLimit.resource}` : "";
  return `${rateLimit.remaining}/${rateLimit.limit ?? "?"} remaining${resource}${reset}`;
}

export function toolError(error: unknown, rateLimit: RateLimitSnapshot): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: false,
            error: message,
            rateLimit,
            rateLimitSummary: formatRateLimit(rateLimit)
          },
          null,
          2
        )
      }
    ],
    isError: true
  };
}
