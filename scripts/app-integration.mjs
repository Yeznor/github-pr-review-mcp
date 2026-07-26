#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const required = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY_PATH"
];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required.`);
  }
}

const serverPath = new URL("../dist/index.js", import.meta.url).pathname;
const { GITHUB_TOKEN: _ignoredToken, ...appEnvironment } = process.env;
const client = new Client({
  name: "github-pr-review-mcp-app-test",
  version: "0.1.0"
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...appEnvironment,
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

try {
  await client.connect(transport);

  const pull = await call("get_pr", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1
  });
  const diff = await call("get_pr_diff", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1
  });
  const review = await call("request_changes", {
    owner: "Yeznor",
    repo: "mcp-review-testbed",
    pull_number: 1,
    body:
      "GitHub App authentication verified on this synthetic integration fixture.",
    comments: []
  });

  console.log(
    JSON.stringify(
      {
        authenticatedWith: "github-app",
        pullRequest: pull.data.url,
        diffCharacters: diff.data.originalCharacters,
        reviewUrl: review.data.url,
        reviewState: review.data.state,
        rateLimit: review.rateLimit
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}
