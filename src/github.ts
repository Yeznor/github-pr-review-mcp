import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import type { Config } from "./config.js";
import { assertDiffTarget } from "./diff.js";
import { requireWrite } from "./permissions.js";
import type {
  DiffSide,
  PageOptions,
  PermissionMode,
  RateLimitSnapshot
} from "./types.js";

type GitHubClient = InstanceType<typeof Octokit>;

interface InlineComment {
  path: string;
  body: string;
  line: number;
  side: DiffSide;
  start_line?: number;
  start_side?: DiffSide;
}

function numberHeader(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addRateLimitTracking(
  client: GitHubClient,
  snapshot: RateLimitSnapshot
): void {
  client.hook.wrap("request", async (request, options) => {
    try {
      const response = await request(options);
      updateRateLimit(snapshot, response.headers);
      return response;
    } catch (error) {
      const response = (
        error as { response?: { headers?: Record<string, string | number> } }
      ).response;
      if (response?.headers) updateRateLimit(snapshot, response.headers);
      throw error;
    }
  });
}

function updateRateLimit(
  snapshot: RateLimitSnapshot,
  headers: Record<string, string | number | undefined>
): void {
  snapshot.limit = numberHeader(headers["x-ratelimit-limit"]);
  snapshot.remaining = numberHeader(headers["x-ratelimit-remaining"]);
  snapshot.used = numberHeader(headers["x-ratelimit-used"]);
  snapshot.resource =
    typeof headers["x-ratelimit-resource"] === "string"
      ? headers["x-ratelimit-resource"]
      : undefined;
  const reset = numberHeader(headers["x-ratelimit-reset"]);
  snapshot.resetAt = reset
    ? new Date(reset * 1000).toISOString()
    : undefined;
}

function makeClient(config: Config, token?: string): GitHubClient {
  const base = {
    baseUrl: config.baseUrl,
    userAgent: "github-pr-review-mcp/0.1.0",
    previews: [],
    request: {
      headers: {
        "X-GitHub-Api-Version": "2026-03-10"
      }
    }
  };

  if (token) return new Octokit({ ...base, auth: token });
  if (!config.app) throw new Error("No GitHub authentication is configured.");
  return new Octokit({
    ...base,
    authStrategy: createAppAuth,
    auth: {
      appId: config.app.appId,
      privateKey: config.app.privateKey,
      installationId: config.app.installationId
    }
  });
}

export class GitHubService {
  readonly rateLimit: RateLimitSnapshot = {};
  readonly permissionMode: PermissionMode;
  private readonly readClient: GitHubClient;
  private readonly writeClient: GitHubClient;

  constructor(config: Config) {
    this.permissionMode = config.permissionMode;
    this.readClient = makeClient(config, config.pat);
    this.writeClient = config.writePat
      ? makeClient(config, config.writePat)
      : this.readClient;
    addRateLimitTracking(this.readClient, this.rateLimit);
    if (this.writeClient !== this.readClient) {
      addRateLimitTracking(this.writeClient, this.rateLimit);
    }
  }

  async listPrs(
    owner: string,
    repo: string,
    filters: {
      state: "open" | "closed" | "all";
      sort: "created" | "updated" | "popularity" | "long-running";
      direction: "asc" | "desc";
      base?: string;
      head?: string;
    },
    page: PageOptions
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let current = 1; items.length < page.maxItems; current += 1) {
      const requested = Math.min(
        page.perPage,
        page.maxItems - items.length
      );
      const response = await this.readClient.rest.pulls.list({
        owner,
        repo,
        ...filters,
        per_page: requested,
        page: current
      });
      items.push(
        ...response.data.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          author: pr.user?.login,
          url: pr.html_url,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          head: pr.head.ref,
          base: pr.base.ref,
          labels: pr.labels.map((label) =>
            typeof label === "string" ? label : label.name
          )
        }))
      );
      if (response.data.length < requested) break;
    }
    return items.slice(0, page.maxItems);
  }

  async getPr(owner: string, repo: string, pullNumber: number): Promise<unknown> {
    const [pull, files, requested] = await Promise.all([
      this.readClient.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber
      }),
      this.collectPages({ perPage: 100, maxItems: 3_000 }, (perPage, page) =>
        this.readClient.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: pullNumber,
          per_page: perPage,
          page
        })
      ),
      this.readClient.rest.pulls.listRequestedReviewers({
        owner,
        repo,
        pull_number: pullNumber
      })
    ]);
    const pr = pull.data;
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      author: pr.user?.login,
      url: pr.html_url,
      head: { ref: pr.head.ref, sha: pr.head.sha },
      base: { ref: pr.base.ref, sha: pr.base.sha },
      commits: pr.commits,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
      labels: pr.labels.map((label) =>
        typeof label === "string" ? label : label.name
      ),
      requested_reviewers: requested.data.users.map((user) => user.login),
      requested_teams: requested.data.teams.map((team) => team.slug),
      files: files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes
      }))
    };
  }

  async getPrDiff(
    owner: string,
    repo: string,
    pullNumber: number,
    maxChars: number
  ): Promise<{ diff: string; truncated: boolean; originalCharacters: number }> {
    const response = await this.readClient.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: pullNumber,
        headers: { accept: "application/vnd.github.v3.diff" }
      }
    );
    const diff = String(response.data);
    return {
      diff: diff.slice(0, maxChars),
      truncated: diff.length > maxChars,
      originalCharacters: diff.length
    };
  }

  async listPrComments(
    owner: string,
    repo: string,
    pullNumber: number,
    page: PageOptions
  ): Promise<unknown> {
    const [conversation, inline, reviews] = await Promise.all([
      this.collectPages(page, (perPage, current) =>
        this.readClient.rest.issues.listComments({
          owner,
          repo,
          issue_number: pullNumber,
          per_page: perPage,
          page: current
        })
      ),
      this.collectPages(page, (perPage, current) =>
        this.readClient.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: pullNumber,
          per_page: perPage,
          page: current
        })
      ),
      this.collectPages(page, (perPage, current) =>
        this.readClient.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pullNumber,
          per_page: perPage,
          page: current
        })
      )
    ]);
    return {
      conversation: conversation.map((comment: any) => ({
        id: comment.id,
        author: comment.user?.login,
        body: comment.body,
        created_at: comment.created_at,
        url: comment.html_url
      })),
      inline: inline.map((comment: any) => ({
        id: comment.id,
        review_id: comment.pull_request_review_id,
        author: comment.user?.login,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: comment.side,
        start_line: comment.start_line,
        start_side: comment.start_side,
        diff_hunk: comment.diff_hunk,
        created_at: comment.created_at,
        url: comment.html_url
      })),
      reviews: reviews.map((review: any) => ({
        id: review.id,
        author: review.user?.login,
        body: review.body,
        state: review.state,
        submitted_at: review.submitted_at,
        url: review.html_url
      }))
    };
  }

  async postReviewComment(input: {
    owner: string;
    repo: string;
    pullNumber: number;
    body: string;
    path: string;
    line?: number;
    side?: DiffSide;
    startLine?: number;
    startSide?: DiffSide;
    subjectType: "line" | "file";
    commitId?: string;
  }): Promise<unknown> {
    requireWrite(this.permissionMode, "post_review_comment");
    const commitId = input.commitId ?? (await this.headSha(input));
    if (input.subjectType === "line") {
      if (input.line === undefined || !input.side) {
        throw new Error("line and side are required for a line comment.");
      }
      const fullDiff = await this.getPrDiff(
        input.owner,
        input.repo,
        input.pullNumber,
        10_000_000
      );
      if (fullDiff.truncated) {
        throw new Error("The pull request diff is too large to validate safely.");
      }
      assertDiffTarget(fullDiff.diff, input.path, input.side, input.line);
      if (input.startLine !== undefined) {
        assertDiffTarget(
          fullDiff.diff,
          input.path,
          input.startSide ?? input.side,
          input.startLine
        );
      }
    }
    const response = await this.writeClient.rest.pulls.createReviewComment({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      body: input.body,
      commit_id: commitId,
      path: input.path,
      subject_type: input.subjectType,
      ...(input.line === undefined ? {} : { line: input.line }),
      ...(input.side ? { side: input.side } : {}),
      ...(input.startLine === undefined ? {} : { start_line: input.startLine }),
      ...(input.startSide ? { start_side: input.startSide } : {})
    });
    return {
      id: response.data.id,
      url: response.data.html_url,
      path: response.data.path,
      line: response.data.line,
      side: response.data.side
    };
  }

  async submitReview(input: {
    owner: string;
    repo: string;
    pullNumber: number;
    event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
    body?: string;
    commitId?: string;
    comments: InlineComment[];
  }): Promise<unknown> {
    requireWrite(this.permissionMode, "submit_review");
    if (
      (input.event === "COMMENT" || input.event === "REQUEST_CHANGES") &&
      !input.body?.trim()
    ) {
      throw new Error(`${input.event} requires a non-empty review body.`);
    }
    const commitId = input.commitId ?? (await this.headSha(input));
    if (input.comments.length) {
      const fullDiff = await this.getPrDiff(
        input.owner,
        input.repo,
        input.pullNumber,
        10_000_000
      );
      if (fullDiff.truncated) {
        throw new Error("The pull request diff is too large to validate safely.");
      }
      for (const comment of input.comments) {
        assertDiffTarget(
          fullDiff.diff,
          comment.path,
          comment.side,
          comment.line
        );
      }
    }
    const response = await this.writeClient.rest.pulls.createReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      event: input.event,
      commit_id: commitId,
      ...(input.body ? { body: input.body } : {}),
      comments: input.comments
    });
    return {
      id: response.data.id,
      state: response.data.state,
      url: response.data.html_url,
      submitted_at: response.data.submitted_at
    };
  }

  async addLabels(
    owner: string,
    repo: string,
    pullNumber: number,
    labels: string[]
  ): Promise<unknown> {
    requireWrite(this.permissionMode, "add_labels");
    const response = await this.writeClient.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pullNumber,
      labels
    });
    return response.data.map((label) => ({
      name: label.name,
      color: label.color,
      description: label.description
    }));
  }

  async requestChanges(
    owner: string,
    repo: string,
    pullNumber: number,
    body: string,
    commitId?: string
  ): Promise<unknown> {
    return this.submitReview({
      owner,
      repo,
      pullNumber,
      event: "REQUEST_CHANGES",
      body,
      ...(commitId ? { commitId } : {}),
      comments: []
    });
  }

  private async headSha(input: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<string> {
    const response = await this.readClient.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber
    });
    return response.data.head.sha;
  }

  private async collectPages<T>(
    page: PageOptions,
    request: (
      perPage: number,
      current: number
    ) => Promise<{ data: T[] }>
  ): Promise<T[]> {
    const items: T[] = [];
    for (let current = 1; items.length < page.maxItems; current += 1) {
      const perPage = Math.min(page.perPage, page.maxItems - items.length);
      const response = await request(perPage, current);
      items.push(...response.data);
      if (response.data.length < perPage) break;
    }
    return items.slice(0, page.maxItems);
  }
}
