import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "./errors.js";
import type { GitHubService } from "./github.js";

const repoSchema = {
  owner: z.string().min(1).describe("GitHub repository owner"),
  repo: z.string().min(1).describe("GitHub repository name")
};
const pullSchema = {
  ...repoSchema,
  pull_number: z.number().int().positive()
};
const paginationSchema = {
  per_page: z.number().int().min(1).max(100).default(50),
  max_items: z.number().int().min(1).max(500).default(100)
};
const sideSchema = z.enum(["LEFT", "RIGHT"]);
const inlineCommentSchema = z.object({
  path: z.string().min(1),
  body: z.string().min(1),
  line: z.number().int().positive(),
  side: sideSchema,
  start_line: z.number().int().positive().optional(),
  start_side: sideSchema.optional()
});

function success(data: unknown, service: GitHubService) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { ok: true, data, rateLimit: service.rateLimit },
          null,
          2
        )
      }
    ]
  };
}

function tool(
  service: GitHubService,
  handler: (args: any) => Promise<unknown>
) {
  return async (args: any) => {
    try {
      return success(await handler(args), service);
    } catch (error) {
      return toolError(error, service.rateLimit);
    }
  };
}

export function createServer(service: GitHubService): McpServer {
  const server = new McpServer(
    { name: "github-pr-review-mcp", version: "0.1.0" },
    {
      instructions:
        "Inspect a pull request and its current diff before writing. " +
        "Write tools are unavailable unless the operator explicitly enables " +
        "GITHUB_PERMISSION_MODE=write."
    }
  );

  server.registerTool(
    "list_prs",
    {
      title: "List pull requests",
      description:
        "List pull requests with bounded, automatic pagination. Handles repositories with 50+ PRs.",
      inputSchema: z.object({
        ...repoSchema,
        state: z.enum(["open", "closed", "all"]).default("open"),
        sort: z
          .enum(["created", "updated", "popularity", "long-running"])
          .default("updated"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        base: z.string().min(1).optional(),
        head: z.string().min(1).optional(),
        ...paginationSchema
      }),
      annotations: { readOnlyHint: true }
    },
    tool(service, (args) =>
      service.listPrs(
        args.owner,
        args.repo,
        {
          state: args.state,
          sort: args.sort,
          direction: args.direction,
          ...(args.base ? { base: args.base } : {}),
          ...(args.head ? { head: args.head } : {})
        },
        { perPage: args.per_page, maxItems: args.max_items }
      )
    )
  );

  server.registerTool(
    "get_pr",
    {
      title: "Get pull request",
      description:
        "Get PR metadata, branch SHAs, review requests, labels, and changed-file statistics.",
      inputSchema: z.object(pullSchema),
      annotations: { readOnlyHint: true }
    },
    tool(service, (args) =>
      service.getPr(args.owner, args.repo, args.pull_number)
    )
  );

  server.registerTool(
    "get_pr_diff",
    {
      title: "Get pull request diff",
      description:
        "Fetch the unified diff used to choose valid paths, sides, and line numbers for inline comments.",
      inputSchema: z.object({
        ...pullSchema,
        max_chars: z
          .number()
          .int()
          .min(1_000)
          .max(10_000_000)
          .default(500_000)
      }),
      annotations: { readOnlyHint: true }
    },
    tool(service, (args) =>
      service.getPrDiff(
        args.owner,
        args.repo,
        args.pull_number,
        args.max_chars
      )
    )
  );

  server.registerTool(
    "list_pr_comments",
    {
      title: "List PR comments and reviews",
      description:
        "List conversation comments, inline review comments, and submitted reviews with bounded pagination.",
      inputSchema: z.object({ ...pullSchema, ...paginationSchema }),
      annotations: { readOnlyHint: true }
    },
    tool(service, (args) =>
      service.listPrComments(
        args.owner,
        args.repo,
        args.pull_number,
        { perPage: args.per_page, maxItems: args.max_items }
      )
    )
  );

  server.registerTool(
    "post_review_comment",
    {
      title: "Post inline review comment",
      description:
        "Post a file-level or line-level review comment. Line targets are validated against the current diff before posting.",
      inputSchema: z.object({
        ...pullSchema,
        body: z.string().min(1),
        path: z.string().min(1),
        subject_type: z.enum(["line", "file"]).default("line"),
        line: z.number().int().positive().optional(),
        side: sideSchema.optional(),
        start_line: z.number().int().positive().optional(),
        start_side: sideSchema.optional(),
        commit_id: z.string().min(7).optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    },
    tool(service, (args) =>
      service.postReviewComment({
        owner: args.owner,
        repo: args.repo,
        pullNumber: args.pull_number,
        body: args.body,
        path: args.path,
        subjectType: args.subject_type,
        ...(args.line === undefined ? {} : { line: args.line }),
        ...(args.side ? { side: args.side } : {}),
        ...(args.start_line === undefined
          ? {}
          : { startLine: args.start_line }),
        ...(args.start_side ? { startSide: args.start_side } : {}),
        ...(args.commit_id ? { commitId: args.commit_id } : {})
      })
    )
  );

  server.registerTool(
    "submit_review",
    {
      title: "Submit pull request review",
      description:
        "Submit an approval, comment, or changes-requested review, optionally with validated inline comments.",
      inputSchema: z.object({
        ...pullSchema,
        event: z.enum(["APPROVE", "COMMENT", "REQUEST_CHANGES"]),
        body: z.string().optional(),
        commit_id: z.string().min(7).optional(),
        comments: z.array(inlineCommentSchema).max(50).default([])
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    },
    tool(service, (args) =>
      service.submitReview({
        owner: args.owner,
        repo: args.repo,
        pullNumber: args.pull_number,
        event: args.event,
        ...(args.body ? { body: args.body } : {}),
        ...(args.commit_id ? { commitId: args.commit_id } : {}),
        comments: args.comments.map((comment: any) => ({
          path: comment.path,
          body: comment.body,
          line: comment.line,
          side: comment.side,
          ...(comment.start_line === undefined
            ? {}
            : { start_line: comment.start_line }),
          ...(comment.start_side
            ? { start_side: comment.start_side }
            : {})
        }))
      })
    )
  );

  server.registerTool(
    "add_labels",
    {
      title: "Add labels",
      description: "Add one or more existing labels to a pull request.",
      inputSchema: z.object({
        ...pullSchema,
        labels: z.array(z.string().min(1)).min(1).max(20)
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    tool(service, (args) =>
      service.addLabels(
        args.owner,
        args.repo,
        args.pull_number,
        args.labels
      )
    )
  );

  server.registerTool(
    "request_changes",
    {
      title: "Request changes",
      description:
        "Submit a changes-requested review with a required explanation.",
      inputSchema: z.object({
        ...pullSchema,
        body: z.string().min(1),
        commit_id: z.string().min(7).optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    },
    tool(service, (args) =>
      service.requestChanges(
        args.owner,
        args.repo,
        args.pull_number,
        args.body,
        args.commit_id
      )
    )
  );

  server.registerPrompt(
    "triage_pull_request",
    {
      title: "Triage a pull request",
      description:
        "A cautious workflow for understanding and triaging a pull request.",
      argsSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        pull_number: z.string().regex(/^\d+$/)
      }
    },
    ({ owner, repo, pull_number }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Triage ${owner}/${repo}#${pull_number}. Call get_pr, ` +
              "get_pr_diff, and list_pr_comments. Summarize intent, risk, " +
              "missing tests, and likely labels. Do not mutate GitHub unless I " +
              "explicitly approve the exact action."
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "review_pull_request",
    {
      title: "Review a pull request",
      description:
        "A diff-first review workflow that avoids comments on stale or invalid lines.",
      argsSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        pull_number: z.string().regex(/^\d+$/)
      }
    },
    ({ owner, repo, pull_number }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Review ${owner}/${repo}#${pull_number}. Read metadata, the ` +
              "current unified diff, and prior discussion. Report only concrete " +
              "issues. Before any inline comment, confirm its path, side, and " +
              "line still occur in get_pr_diff. Ask before posting or submitting."
          }
        }
      ]
    })
  );

  return server;
}
