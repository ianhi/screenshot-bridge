import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import * as z from "zod/v4";
import {
  filterScreenshots,
  getPending,
  getScreenshot,
  listScreenshots,
  markDelivered,
  setDescription,
} from "./store.js";
import { broadcast } from "./ws.js";

const transports = new Map<string, StreamableHTTPServerTransport>();

// Each MCP session gets its own McpServer instance because tool handlers
// close over the session's projectId (captured from ?project= at init time).
function createServer(projectId: string): McpServer {
  const server = new McpServer({
    name: "screenshot-bridge",
    version: "1.0.0",
  });

  server.registerTool(
    "get_pending_screenshots",
    {
      title: "Get Pending Screenshots",
      description:
        "Returns all undelivered screenshots as image content with optional prompt text. Marks them as delivered. IMPORTANT: Images consume significant context. To preserve your context window, consider using a subagent (via the Task tool) to analyze and describe the image content, then work with the text description instead of keeping the raw image in your main conversation. Set include_images to false to skip image data and only return text metadata (id, prompt, annotations, description).",
      inputSchema: z.object({
        include_images: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to include image data in the response. Set to false to only return text metadata (id, prompt, annotations, description). Default: true",
          ),
      }),
    },
    async ({ include_images }) => {
      const pending = getPending(projectId);
      if (pending.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No pending screenshots." }],
        };
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];

      for (const s of pending) {
        content.push({
          type: "text" as const,
          text: `Screenshot ${s.id}:`,
        });
        if (s.prompt) {
          content.push({ type: "text" as const, text: `Prompt: ${s.prompt}` });
        }
        if (s.annotations) {
          content.push({
            type: "text" as const,
            text: `Annotations:\n${s.annotations}`,
          });
        }
        if (s.description) {
          content.push({
            type: "text" as const,
            text: `[Previously described] ${s.description}`,
          });
        } else if (include_images) {
          content.push({
            type: "image" as const,
            data: s.imageBase64,
            mimeType: s.mimeType,
          });
          content.push({
            type: "text" as const,
            text: "TIP: Use describe_screenshot to save a description so this image won't need to be re-sent next time.",
          });
        }
        markDelivered(s.id);
        broadcast("screenshot:updated", {
          id: s.id,
          status: "delivered",
          project: projectId,
        });
      }

      content.push({
        type: "text" as const,
        text: `Delivered ${pending.length} screenshot(s).`,
      });

      return { content };
    },
  );

  server.registerTool(
    "get_screenshot",
    {
      title: "Get Screenshot",
      description:
        "Retrieve a specific screenshot by ID, including image data. TIP: To preserve context, delegate image analysis to a subagent that can describe the screenshot content back as text.",
      inputSchema: z.object({
        id: z.string().describe("Screenshot ID"),
      }),
    },
    async ({ id }) => {
      const s = getScreenshot(id);
      if (!s) {
        return {
          content: [
            { type: "text" as const, text: `Screenshot ${id} not found.` },
          ],
        };
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];

      if (s.prompt) {
        content.push({ type: "text" as const, text: `Prompt: ${s.prompt}` });
      }
      if (s.annotations) {
        content.push({
          type: "text" as const,
          text: `Annotations:\n${s.annotations}`,
        });
      }
      if (s.description) {
        content.push({
          type: "text" as const,
          text: `Description: ${s.description}`,
        });
      }
      content.push({
        type: "image" as const,
        data: s.imageBase64,
        mimeType: s.mimeType,
      });
      content.push({
        type: "text" as const,
        text: `Status: ${s.status} | Created: ${s.createdAt}`,
      });

      return { content };
    },
  );

  server.registerTool(
    "list_screenshots",
    {
      title: "List Screenshots",
      description:
        "List all screenshots with metadata (no image data). Shows IDs, status, prompt, and timestamps. Use this first to check what's available before fetching full image data with get_screenshot.",
      inputSchema: z.object({}),
    },
    async () => {
      const items = listScreenshots(projectId);
      if (items.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No screenshots stored." }],
        };
      }

      const text = items
        .map((s) => {
          let line = `- [${s.status}] ${s.id} (${s.createdAt})`;
          if (s.git?.branch) line += ` branch:${s.git.branch}`;
          if (s.git?.commitShort) line += ` commit:${s.git.commitShort}`;
          if (s.prompt) line += ` prompt: "${s.prompt}"`;
          if (s.description) line += ` description: "${s.description}"`;
          if (s.annotations) line += " [has annotations]";
          return line;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${items.length} screenshot(s):\n${text}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_screenshots",
    {
      title: "Search Screenshots",
      description:
        "Filter screenshots by git branch, commit, time range, or status. Returns metadata (no image data). Useful for finding screenshots from a specific branch or time period.",
      inputSchema: z.object({
        branch: z.string().optional().describe("Filter by git branch name"),
        commit: z
          .string()
          .optional()
          .describe("Filter by commit hash (full or short)"),
        since: z
          .string()
          .optional()
          .describe("Only screenshots after this ISO timestamp"),
        until: z
          .string()
          .optional()
          .describe("Only screenshots before this ISO timestamp"),
        status: z
          .enum(["pending", "delivered"])
          .optional()
          .describe("Filter by delivery status"),
      }),
    },
    async (opts) => {
      const items = filterScreenshots(projectId, opts);
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No screenshots match the given filters.",
            },
          ],
        };
      }

      const text = items
        .map((s) => {
          let line = `- [${s.status}] ${s.id} (${s.createdAt})`;
          if (s.git?.branch) line += ` branch:${s.git.branch}`;
          if (s.git?.commitShort) line += ` commit:${s.git.commitShort}`;
          if (s.prompt) line += ` prompt: "${s.prompt}"`;
          if (s.description) line += ` description: "${s.description}"`;
          if (s.annotations) line += " [has annotations]";
          return line;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${items.length} matching screenshot(s):\n${text}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "describe_screenshot",
    {
      title: "Describe Screenshot",
      description:
        "Save a text description for a screenshot. Use this after analyzing an image (ideally via a subagent) to cache the description so the image doesn't need to be re-analyzed. The description is visible in list_screenshots and in the browser UI where users can also edit it.",
      inputSchema: z.object({
        id: z.string().describe("Screenshot ID"),
        description: z
          .string()
          .describe(
            "A detailed text description of the screenshot content, suitable for understanding the image without viewing it",
          ),
      }),
    },
    async ({ id, description }) => {
      const updated = setDescription(id, description);
      if (!updated) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Screenshot ${id} not found.`,
            },
          ],
        };
      }
      broadcast("screenshot:updated", { id, description, project: projectId });
      return {
        content: [
          {
            type: "text" as const,
            text: `Description saved for screenshot ${id}.`,
          },
        ],
      };
    },
  );

  return server;
}

export async function handleMcpRequest(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    if (!transport) return;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const projectId = (req.query.project as string | undefined) || "default";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    const server = createServer(projectId);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session ID" },
    id: null,
  });
}

export async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports.get(sessionId)?.handleRequest(req, res);
}

export async function handleMcpDelete(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports.get(sessionId)?.handleRequest(req, res);
}
