import { describe, expect, it, vi } from "vitest";
import { GitHubService } from "../src/github.js";

describe("pull request pagination", () => {
  it("continues beyond GitHub's first page and obeys max_items", async () => {
    const service = new GitHubService({
      permissionMode: "read",
      baseUrl: "https://api.github.com",
      pat: "github_pat_test"
    });
    const list = vi.fn(
      async ({ page, per_page }: { page: number; per_page: number }) => ({
        data: Array.from(
          { length: page <= 2 ? per_page : 25 },
          (_, offset) => {
            const number = (page - 1) * 50 + offset + 1;
            return {
              number,
              title: `PR ${number}`,
              state: "open",
              draft: false,
              user: { login: "octocat" },
              html_url: `https://github.com/example/repo/pull/${number}`,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
              head: { ref: `branch-${number}` },
              base: { ref: "main" },
              labels: []
            };
          }
        )
      })
    );
    (service as any).readClient = { rest: { pulls: { list } } };

    const result = await service.listPrs(
      "example",
      "repo",
      {
        state: "open",
        sort: "updated",
        direction: "desc"
      },
      { perPage: 50, maxItems: 125 }
    );

    expect(result).toHaveLength(125);
    expect(list).toHaveBeenCalledTimes(3);
  });
});
