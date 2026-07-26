import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubService } from "../src/github.js";
import { createServer } from "../src/server.js";

const REQUIRED_TOOLS = [
  "add_labels",
  "get_pr",
  "get_pr_diff",
  "list_pr_comments",
  "list_prs",
  "post_review_comment",
  "request_changes",
  "submit_review"
];

describe("MCP server", () => {
  const closeables: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((item) => item.close()));
  });

  it("boots and registers the complete tool contract", async () => {
    const service = new GitHubService({
      permissionMode: "read",
      baseUrl: "https://api.github.com",
      pat: "github_pat_test"
    });
    const server = createServer(service);
    const client = new Client({
      name: "github-pr-review-mcp-test",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name).sort()).toEqual(
      REQUIRED_TOOLS
    );
  });
});
