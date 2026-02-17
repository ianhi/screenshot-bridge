# Screenshot Bridge

A web-based bridge that lets you paste screenshots in a browser and retrieve them in Claude Code via MCP. Designed for remote workflows where you're SSH'd into a desktop and can't paste images through the terminal.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm run dev
```

The server starts on `http://0.0.0.0:3456`. Open it in your browser to paste screenshots.

## Setup Guide

### 1. Install and Run

```bash
git clone <this-repo>
cd screenshot-bridge
npm install
npm run dev
```

### 2. Configure Claude Code

Add the MCP server to your Claude Code configuration. Copy `.mcp.json` to your project root, or add this to your existing `.mcp.json`:

```json
{
  "mcpServers": {
    "screenshot-bridge": {
      "type": "http",
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

If accessing over Tailscale or a different host, replace `localhost` with the appropriate hostname.

### 3. Use It

1. **Open the web UI** at `http://<your-host>:3456` in a browser on the machine where you can paste screenshots
2. **Paste a screenshot** using `Ctrl+V`, drag-and-drop, or click to select a file
3. **Add an optional prompt** describing what you want Claude to do with the image
4. **Click Send** (or press Enter)
5. **In Claude Code**, the screenshot is now available via the MCP tools

### 4. Retrieve Screenshots in Claude Code

Claude Code has access to these MCP tools:

| Tool | Description |
|------|-------------|
| `get_pending_screenshots` | Fetches all undelivered screenshots (images + prompt) and marks them delivered. If a screenshot already has a description, returns the text instead of the image to save context. |
| `get_screenshot` | Fetches a specific screenshot by ID with full image data. |
| `list_screenshots` | Lists all screenshots with metadata, git context, and descriptions (no image data). |
| `search_screenshots` | Filter by git branch, commit hash, time range, or delivery status. |
| `describe_screenshot` | Save a text description for a screenshot. Cached descriptions replace image data in future retrievals. |

### 5. Context-Efficient Usage

Screenshots consume significant context window space. For best results:

1. **Use a subagent** to analyze screenshots. Delegate image analysis to a subagent (via the Task tool) that describes the content back as text. This keeps your main conversation lean.
2. **Save descriptions** after analyzing an image with `describe_screenshot`. The next time `get_pending_screenshots` encounters a described image, it returns the text description instead of the raw image, saving context.
3. **Use `list_screenshots` first** to check what's pending before fetching full image data.
4. **Include descriptive prompts** when pasting screenshots so Claude has text context even before viewing the image.
5. **Edit descriptions** in the browser UI by clicking on the description text under any screenshot in the history.

Example workflow in Claude Code:
```
User: Check the screenshot bridge for new screenshots and describe what you see

Claude: I'll use a subagent to analyze the pending screenshots...
[Uses Task tool to spawn an agent that calls get_pending_screenshots,
 analyzes the image, calls describe_screenshot to cache the description,
 and returns a text summary]
```

### 6. Git Integration

When the server runs inside a git repository, it automatically records the current branch and commit hash with each screenshot. This lets you:

- **Filter by branch**: `search_screenshots` with `branch: "feature/my-branch"`
- **Filter by commit**: `search_screenshots` with `commit: "abc1234"`
- **Filter by time**: `search_screenshots` with `since: "2024-01-15T00:00:00Z"`
- **Combine filters**: Find all pending screenshots on a specific branch

Git context (branch name and short commit hash) is also shown in the browser UI as purple badges.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `data` | Directory for persisted screenshots |

## Architecture

Single Node.js process serving:
- **Web UI** -- Static HTML/CSS/JS frontend for pasting screenshots
- **REST API** -- CRUD operations for screenshots (`/api/screenshots`)
- **MCP Server** -- Streamable HTTP transport on `/mcp` with 5 tools
- **WebSocket** -- Real-time status updates to the browser

Screenshots are stored in-memory with disk backup in the `data/` directory. Images are automatically resized and compressed to JPEG (max 750KB base64) to stay within MCP's content limits.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/screenshots` | Upload screenshot (`{ dataUrl, prompt }`) |
| `GET` | `/api/screenshots` | List all (metadata only) |
| `GET` | `/api/screenshots/:id/image` | Get image binary |
| `PATCH` | `/api/screenshots/:id` | Update description (`{ description }`) |
| `DELETE` | `/api/screenshots/:id` | Delete one |
| `DELETE` | `/api/screenshots` | Clear all |
| `GET` | `/api/health` | Health check |
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |

## Development

```bash
npm run dev      # Start with tsx (auto-reload)
npm run build    # Compile TypeScript
npm run lint     # Biome check
npm run format   # Biome format
```
