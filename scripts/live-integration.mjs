#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("GITHUB_TOKEN is required.");
}

const serverPath = new URL("../dist/index.js", import.meta.url).pathname;
const client = new Client({
  name: "github-pr-review-mcp-live-test",
  version: "0.1.0"
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...process.env,
    GITHUB_TOKEN: token,
    GITHUB_PERMISSION_MODE: "write"
  },
  stderr: "pipe"
});

function parseResult(result) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool returned no text payload.");
  const parsed = JSON.parse(text);
  if (!parsed.ok) throw new Error(parsed.error ?? "Tool call failed.");
  return parsed;
}

async function call(name, args) {
  return parseResult(await client.callTool({ name, arguments: args }));
}

const marker = `MCP latency test ${new Date().toISOString()}`;

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();

  const largeList = await call("list_prs", {
    owner: "microsoft",
    repo: "vscode",
    state: "open",
    per_page: 50,
    max_items: 75
  });

  const pull = await call("get_pr", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1
  });
  await call("get_pr_diff", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1
  });

  const started = performance.now();
  const posted = await call("post_review_comment", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1,
    body: `${marker}. This synthetic comment verifies inline diff resolution.`,
    path: "src/username.js",
    line: 6,
    side: "RIGHT"
  });
  const comments = await call("list_pr_comments", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1,
    per_page: 50,
    max_items: 100
  });
  const visible = comments.data.inline.some((comment) =>
    comment.body?.includes(marker)
  );
  const visibleAfterMs = Math.round(performance.now() - started);

  const review = await call("submit_review", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1,
    event: "COMMENT",
    body: "Automated MCP integration review completed.",
    comments: []
  });
  const labels = await call("add_labels", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1,
    labels: ["mcp-tested"]
  });

  const report = {
    tools: toolNames,
    largeRepositoryPrsReturned: largeList.data.length,
    privatePullRequest: pull.data.url,
    inlineCommentUrl: posted.data.url,
    inlineCommentVisible: visible,
    inlineCommentVisibleAfterMs: visibleAfterMs,
    underFiveSeconds: visible && visibleAfterMs < 5_000,
    reviewUrl: review.data.url,
    labels: labels.data.map((label) => label.name),
    rateLimit: labels.rateLimit
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.underFiveSeconds || report.largeRepositoryPrsReturned < 75) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
