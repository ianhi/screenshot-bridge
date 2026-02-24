# Screenshot Bridge

Web-based screenshot bridge: paste screenshots in browser, retrieve them via MCP in Claude Code.

## Commands

- `npm run dev` -- start dev server with tsx
- `npm run build` -- compile TypeScript
- `npm run lint` -- biome check
- `npm run format` -- biome format

## Architecture

Single Node.js process: Express 5 (static + REST API) + MCP (Streamable HTTP on /mcp) + WebSocket.

- `src/config.ts` -- env-based config
- `src/store.ts` -- in-memory screenshot store with disk persistence (`~/.screenshot-bridge/data/<projectId>/<id>.json`)
- `src/image.ts` -- sharp resize/compress pipeline (always outputs JPEG to stay under MCP 1MB limit)
- `src/git.ts` -- captures git branch/commit from the server process's working directory
- `src/mcp.ts` -- MCP server with 7 tools (one McpServer instance per session, scoped to a project)
- `src/routes.ts` -- REST API endpoints
- `src/ws.ts` -- WebSocket broadcast + request/response (`sendAndWait` for canvas execution); unscoped: all clients receive all events, frontend filters by project
- `src/index.ts` -- entry point
- `src/public/` -- vanilla HTML/CSS/JS frontend

## Multi-Project Isolation

Screenshots are scoped by project. Each project has isolated storage and MCP tool results.

- **Disk layout**: `~/.screenshot-bridge/data/<projectId>/<uuid>.json` -- one subdirectory per project (override with `DATA_DIR` env var)
- **Default project**: When no project is specified, `"default"` is used
- **Legacy migration**: On startup, any flat `*.json` files in the data dir are auto-migrated into the `default/` subdirectory
- **MCP scoping**: The `?project=` query param on the MCP URL is read at session initialization and bound for the session's lifetime. All tool calls in that session are automatically scoped.
- **REST scoping**: Pass `?project=<name>` on REST endpoints to scope operations
- **WebSocket**: All events broadcast to all clients with a `project` field; frontend filters client-side
- **Frontend tabs**: Tab bar appears when >1 project exists; auto-discovered via `GET /api/projects` + WS `project:created` events

### Per-Project MCP Configuration

In each project's `.mcp.json`:
```json
{
  "mcpServers": {
    "screenshot-bridge": {
      "type": "http",
      "url": "http://localhost:3456/mcp?project=my-project-name"
    }
  }
}
```

## MCP Tools

7 tools registered per session, all auto-scoped to the session's project:

- `get_pending_screenshots` -- returns undelivered screenshots as image content, marks them delivered (excludes agent-sent images)
- `get_screenshot` -- retrieve a specific screenshot by ID (includes image data)
- `list_screenshots` -- list all screenshots with metadata (no image data); agent-sent images show `[agent]` marker
- `search_screenshots` -- filter by git branch, commit, time range, or status; agent-sent images show `[agent]` marker
- `describe_screenshot` -- save a text description for a screenshot (cached so subsequent `get_pending_screenshots` calls return text instead of image data, saving context window)
- `send_image` -- send an image (data URL) to the browser UI for the user to see; supports optional caption and description; images appear with "agent" badge
- `run_canvas` -- execute JavaScript on an HTML Canvas in the browser and capture the result as an image; code has access to `canvas` and `ctx` (2D context); supports width/height/caption params; 10s timeout

## REST API

All screenshot endpoints accept `?project=<name>` (defaults to `"default"`).

- `GET /api/health` -- health check
- `GET /api/projects` -- list known project names
- `POST /api/screenshots` -- upload (`{ dataUrl, prompt }`)
- `GET /api/screenshots` -- list screenshots (metadata only); supports `?q=`, `?status=`, `?branch=`, `?commit=`, `?since=`, `?until=` filters and `?limit=`/`?offset=` pagination (returns `{ items, total }` envelope when `limit` is set)
- `GET /api/screenshots/:id/image` -- serve image binary
- `PATCH /api/screenshots/:id` -- update description (`{ description }`)
- `DELETE /api/screenshots/:id` -- delete one screenshot
- `DELETE /api/screenshots` -- clear all screenshots for the project

## WebSocket Events

All payloads include a `project` field. Events:

- `project:created` -- first screenshot added for a new project
- `screenshot:added` -- new screenshot uploaded
- `screenshot:updated` -- status or description changed
- `screenshot:deleted` -- single screenshot removed
- `screenshots:cleared` -- all screenshots cleared for a project
- `canvas:execute` -- server→browser: execute JS on a canvas (`{ requestId, code, width, height }`)
- `canvas:result` -- browser→server: canvas execution result (`{ requestId, dataUrl }` or `{ requestId, error }`)

## Key Conventions

- Express 5 (not v4 -- different error handling and route matching)
- MCP SDK v2: use `registerTool()` with `z.object()` schemas -- import from `"zod/v4"` (not `"zod"`)
- Images always converted to JPEG and compressed to stay under 750KB base64 (MCP 1MB limit)
- All screenshots held in memory for fast access; disk JSON (`~/.screenshot-bridge/data/`) is for persistence across restarts
- Port 3456 by default (configurable via PORT env var)
- No authentication -- designed as a local development tool
- Frontend supports light/dark theme toggle (persisted to localStorage, respects prefers-color-scheme)
- Package supports `npx screenshot-bridge` via `bin` field in package.json
