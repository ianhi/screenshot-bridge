# Screenshot Bridge

Web-based screenshot bridge: paste screenshots in browser, retrieve them via MCP in Claude Code.

## Commands

- `npm run dev` -- start dev server with tsx
- `npm run build` -- compile TypeScript
- `npm run lint` -- biome check
- `npm run format` -- biome format

## Architecture

Single Node.js process: Express (static + REST API) + MCP (Streamable HTTP on /mcp) + WebSocket.

- `src/config.ts` -- env-based config
- `src/store.ts` -- in-memory screenshot store with disk backup
- `src/image.ts` -- sharp resize/compress pipeline
- `src/mcp.ts` -- MCP server with 3 tools
- `src/routes.ts` -- REST API
- `src/ws.ts` -- WebSocket broadcast
- `src/index.ts` -- entry point
- `src/public/` -- vanilla HTML/CSS/JS frontend

## Key Conventions

- MCP SDK v2: use `registerTool()` with `z.object()` schemas (zod/v4)
- Images returned as `{ type: 'image', data: base64, mimeType: 'image/jpeg' }`
- Target max 750KB base64 per image (under MCP 1MB limit)
- Port 3456 by default (configurable via PORT env var)
