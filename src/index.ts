#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GitHubService } from "./github.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const service = new GitHubService(config);
  const server = createServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`github-pr-review-mcp failed to start: ${message}\n`);
  process.exitCode = 1;
});
