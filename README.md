# Screenshot Bridge

Claude Code is a terminal application. Terminals can't display images, and they can't receive paste events containing images. This creates two problems:

1. **You can't show Claude what you're seeing.** UI bugs, design references, error dialogs, chart outputs — anything visual requires a way to get an image from your eyes to Claude's context window. If you're SSH'd into a remote machine, there's no clipboard path at all.

2. **Claude can't show you what it's generated.** When Claude creates a visualization, chart, or diagram, it has no way to render it. The image data exists but there's no display surface in a terminal.

Screenshot Bridge solves both directions. It runs a small web server that you open in a browser — paste screenshots in, and Claude retrieves them via MCP. Claude can also push images back to the browser, or execute Canvas drawing code in the browser and capture the result.

## Quick Start

```bash
git clone https://github.com/ianhi/screenshot-bridge.git
cd screenshot-bridge
npm install
npm run dev
```

The server starts on `http://0.0.0.0:3456`. Open it in your browser.

Add to your project's `.mcp.json`:

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

Replace `localhost` with the appropriate hostname if accessing over Tailscale or a different network.

## Usage

### Sending Screenshots to Claude

1. Open the web UI at `http://<host>:3456`
2. Paste (`Ctrl/Cmd+V`), drag-and-drop, or click to select an image
3. Optionally annotate with the markup toolbar (arrows, boxes, text labels, numbered pins)
4. Add an optional text prompt for context
5. Click Send (or press Enter)

In Claude Code, the screenshot is now available via MCP tools.

### Annotation Tools

The markup toolbar appears when you have an image loaded. Each tool has a keyboard shortcut shown on the button:

| Tool | Key | Description |
|------|-----|-------------|
| Move | `M` | Drag existing annotations to reposition them |
| Arrow | `A` | Draw arrows to point at things |
| Box | `B` | Draw dashed rectangles to highlight regions |
| Text | `T` | Place text labels |
| Pin | `P` | Drop numbered pins with optional notes |

Press `Esc` to deselect the current tool. Hover over any annotation to reveal the delete handle.

Annotations are serialized as structured text (coordinates, percentages, labels) and sent alongside the image so Claude understands spatial context even from the text alone.

### Claude Sending Images Back

Claude has two tools for pushing visual content to your browser:

- **`send_image`** — Send a pre-existing image (data URL) to the browser. Useful for forwarding generated images or charts.
- **`run_canvas`** — Send JavaScript code to execute on an HTML Canvas in the browser. The code has access to `canvas` and `ctx` (2D rendering context). The rendered result is captured as a PNG and stored. Useful for programmatic visualizations, diagrams, and charts without needing any image generation library.

Images from Claude appear in the history with an "agent" badge.

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_pending_screenshots` | Fetch undelivered screenshots (images + prompts), mark them delivered. Returns cached descriptions instead of images when available. Supports `include_images: false` for metadata only. |
| `get_screenshot` | Fetch a specific screenshot by ID with full image data. |
| `list_screenshots` | List all screenshots with metadata (no image data). |
| `search_screenshots` | Filter by git branch, commit, time range, or delivery status. |
| `describe_screenshot` | Cache a text description for a screenshot. Future retrievals return text instead of image data. |
| `send_image` | Push an image to the browser UI. |
| `run_canvas` | Execute JS on a browser Canvas and capture the result (10s timeout). |

### Context-Efficient Workflow

Screenshots are large. A single image can consume a significant portion of Claude's context window. To keep conversations lean:

1. **Delegate to a subagent.** Use Claude Code's Task tool to spawn an agent that fetches and analyzes the screenshot, calls `describe_screenshot` to cache a text summary, and returns the description. The main conversation never sees the raw image bytes.
2. **Use `list_screenshots` first** to check what's available before pulling full image data.
3. **Write descriptive prompts** when pasting, so Claude has text context before even viewing the image.
4. **Edit descriptions** in the browser by clicking the description text under any history item.

## Multi-Project Support

Screenshots are scoped by project. Each project gets isolated storage and MCP tool results.

To scope an MCP session to a project, add `?project=<name>` to the URL:

```json
{
  "mcpServers": {
    "screenshot-bridge": {
      "type": "http",
      "url": "http://localhost:3456/mcp?project=my-project"
    }
  }
}
```

The browser UI shows project tabs when more than one project exists.

## Git Integration

When the server runs inside a git repository, it records the current branch and commit hash with each screenshot. Use `search_screenshots` to filter by `branch`, `commit`, `since`, or `until`. Git context appears as badges in the browser UI.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `~/.screenshot-bridge/data` | Persistent storage directory |

## Development

```bash
npm run dev      # Start with tsx
npm run build    # Compile TypeScript
npm run lint     # Biome check
npm run format   # Biome format
```

### Architecture

Single Node.js process: Express 5 (static files + REST API) + MCP (Streamable HTTP on `/mcp`) + WebSocket (real-time updates + canvas execution).

Images are automatically resized and compressed to JPEG (max 750KB base64) to stay within MCP's 1MB content limit.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/screenshots` | Upload (`{ dataUrl, prompt, annotations }`) |
| `GET` | `/api/screenshots` | List all (metadata only) |
| `GET` | `/api/screenshots/:id/image` | Image binary |
| `PATCH` | `/api/screenshots/:id` | Update description |
| `DELETE` | `/api/screenshots/:id` | Delete one |
| `DELETE` | `/api/screenshots` | Clear all |
| `GET` | `/api/projects` | List project names |
| `GET` | `/api/health` | Health check |
| `POST` | `/mcp` | MCP Streamable HTTP |
