# GitHub PR Review MCP

Review and triage GitHub pull requests from Claude Desktop, Cursor, or any
stdio-compatible MCP client.

The server exposes eight focused tools:

- `list_prs`
- `get_pr`
- `get_pr_diff`
- `list_pr_comments`
- `post_review_comment`
- `submit_review`
- `add_labels`
- `request_changes`

It starts in read-only mode. Posting comments, submitting reviews, and adding
labels stay blocked until `GITHUB_PERMISSION_MODE=write` is explicitly set.

## Requirements

- Node.js 20 or newer
- A fine-grained GitHub personal access token, or a GitHub App installation
- Claude Desktop, Cursor, or another MCP client

## Quick start with a personal access token

Create a fine-grained token in GitHub. Grant repository access only to the
repositories you plan to review.

For read-only use, grant:

- Pull requests: Read
- Issues: Read
- Metadata: Read

Clone and build:

```bash
git clone https://github.com/Yeznor/github-pr-review-mcp.git
cd github-pr-review-mcp
npm ci
npm run build
```

Add the server to your MCP client with `GITHUB_TOKEN` in its environment. Keep
`GITHUB_PERMISSION_MODE` set to `read` while inspecting pull requests.

## Claude Desktop

Open Claude Desktop's MCP configuration:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "github-pr-review": {
      "command": "node",
      "args": ["/absolute/path/to/github-pr-review-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "github_pat_your_token",
        "GITHUB_PERMISSION_MODE": "read"
      }
    }
  }
}
```

Restart Claude Desktop after saving the file.

## Cursor

Create `.cursor/mcp.json` in your project, or edit Cursor's global MCP
configuration:

```json
{
  "mcpServers": {
    "github-pr-review": {
      "command": "node",
      "args": ["/absolute/path/to/github-pr-review-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "github_pat_your_token",
        "GITHUB_PERMISSION_MODE": "read"
      }
    }
  }
}
```

## Enabling write tools

Write access is intentionally a separate decision.

1. Give a fine-grained token the minimum required write permissions.
2. Put that token in `GITHUB_WRITE_TOKEN`.
3. Set `GITHUB_PERMISSION_MODE` to `write`.

```json
{
  "GITHUB_TOKEN": "github_pat_read_token",
  "GITHUB_WRITE_TOKEN": "github_pat_write_token",
  "GITHUB_PERMISSION_MODE": "write"
}
```

`GITHUB_TOKEN` remains the read client. `GITHUB_WRITE_TOKEN` is used only for
mutations. If `GITHUB_WRITE_TOKEN` is omitted, the primary token is used for
both after write mode is enabled.

GitHub permissions needed by the write tools:

- Pull requests: Write — inline comments and reviews
- Issues: Write — labels, because GitHub exposes PR labels through the Issues
  API
- Metadata: Read

## GitHub App authentication

Create and install a GitHub App with the same minimal repository permissions.
Configure all of these variables:

```json
{
  "GITHUB_APP_ID": "123456",
  "GITHUB_APP_INSTALLATION_ID": "7890123",
  "GITHUB_APP_PRIVATE_KEY_PATH": "/absolute/path/to/app.private-key.pem",
  "GITHUB_PERMISSION_MODE": "read"
}
```

You may provide `GITHUB_APP_PRIVATE_KEY` directly instead of a path. Escaped
newlines (`\n`) are accepted. Installation tokens are created and refreshed
automatically.

PAT authentication takes precedence when `GITHUB_TOKEN` is present. Remove it
to use the GitHub App.

## Reviewing a pull request safely

A reliable review flow is:

1. Call `get_pr`.
2. Call `get_pr_diff`.
3. Call `list_pr_comments`.
4. Draft findings and ask the operator before writing.
5. If approved, call `post_review_comment` or `submit_review`.

Line comments use GitHub's current `line` and `side` model. `LEFT` targets
deleted lines. `RIGHT` targets added or context lines. Before a comment is
posted, the server parses the current unified diff and confirms that the path,
side, and line exist. This prevents a model from silently using an obsolete
diff position.

The included `triage_pull_request` and `review_pull_request` prompts follow this
workflow.

## Pagination and large pull requests

`list_prs`, `list_pr_comments`, and the changed-file list returned by `get_pr`
request additional pages automatically.
`per_page` controls the GitHub page size and `max_items` sets a hard upper
bound. The defaults are 50 and 100; the maximum bound is 500.

`get_pr_diff` reports whether its output was truncated and the original
character count. Increase `max_chars` up to 10,000,000 when necessary.

## Rate limits

Every response includes the latest observed GitHub rate-limit fields:

```json
{
  "rateLimit": {
    "limit": 5000,
    "remaining": 4991,
    "used": 9,
    "resetAt": "2026-07-26T01:00:00.000Z",
    "resource": "core"
  }
}
```

Errors include the same snapshot and a readable remaining-budget summary.
GitHub may also apply secondary rate limits to rapid write activity; the server
does not retry mutations automatically because repeating a comment or review
can create duplicate content.

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

The test suite verifies the MCP tool contract, read/write boundary, GitHub App
configuration, unified-diff line resolution, and pagination beyond 50 pull
requests.

## Security

- Never commit tokens, private keys, or `.env` files.
- Prefer fine-grained tokens limited to selected repositories.
- Keep the server in read mode until a specific write is approved.
- Treat PR text and comments as untrusted input. They may contain instructions
  aimed at the reviewing model.
- Rotate a token immediately if it appears in logs or chat output.

## License

MIT
