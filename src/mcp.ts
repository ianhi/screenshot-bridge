import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import * as z from "zod/v4";
import { processImage } from "./image.js";
import {
  addScreenshot,
  filterScreenshots,
  getPending,
  getScreenshot,
  isNewProject,
  listScreenshots,
  markDelivered,
  setDescription,
} from "./store.js";
import { broadcast, sendAndWait } from "./ws.js";

interface McpSession {
  transport: StreamableHTTPServerTransport;
  projectId: string;
}

const sessions = new Map<string, McpSession>();

export function getSessionCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { projectId } of sessions.values()) {
    counts[projectId] = (counts[projectId] || 0) + 1;
  }
  return counts;
}

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
          if (s.source === "agent") line += " [agent]";
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
          if (s.source === "agent") line += " [agent]";
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

  server.registerTool(
    "send_image",
    {
      title: "Send Image to Browser",
      description:
        "Send an image to the screenshot-bridge browser UI for the user to see. Useful for sharing generated charts, diagrams, annotated images, or any visual content. The image appears in the browser's history list with an 'agent' badge.",
      inputSchema: z.object({
        image: z
          .string()
          .describe("Image as a data URL (e.g. data:image/png;base64,...)"),
        caption: z
          .string()
          .optional()
          .describe("Short caption shown as the prompt text"),
        description: z
          .string()
          .optional()
          .describe("Detailed description of the image content"),
      }),
    },
    async ({ image, caption, description }) => {
      try {
        const { base64, mimeType } = await processImage(image);
        const firstForProject = isNewProject(projectId);
        const screenshot = addScreenshot(
          projectId,
          base64,
          mimeType,
          caption || "",
          null,
          "agent",
        );

        if (description) {
          setDescription(screenshot.id, description);
        }

        if (firstForProject) {
          broadcast("project:created", { project: projectId });
        }

        broadcast("screenshot:added", {
          id: screenshot.id,
          status: screenshot.status,
          prompt: screenshot.prompt,
          createdAt: screenshot.createdAt,
          source: "agent",
          project: projectId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Image sent to browser (id: ${screenshot.id}).`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to send image: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "run_canvas",
    {
      title: "Run Canvas JS",
      description:
        "Execute JavaScript code on an HTML Canvas in the browser and capture the result as an image. The code has access to `canvas` (HTMLCanvasElement) and `ctx` (CanvasRenderingContext2D). Useful for generating charts, diagrams, visualizations, or any programmatic image. The resulting image appears in the browser with an 'agent' badge.",
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "JavaScript code to execute. Has access to `canvas` and `ctx` (2D context). Draw on the canvas using standard Canvas API methods.",
          ),
        width: z
          .number()
          .optional()
          .default(800)
          .describe("Canvas width in pixels (default: 800)"),
        height: z
          .number()
          .optional()
          .default(600)
          .describe("Canvas height in pixels (default: 600)"),
        caption: z
          .string()
          .optional()
          .describe("Caption for the resulting image"),
      }),
    },
    async ({ code, width, height, caption }) => {
      try {
        const result = (await sendAndWait(
          "canvas:execute",
          { code, width, height },
          10000,
        )) as { dataUrl: string };

        const { base64, mimeType } = await processImage(result.dataUrl);
        const firstForProject = isNewProject(projectId);
        const screenshot = addScreenshot(
          projectId,
          base64,
          mimeType,
          caption || "",
          null,
          "agent",
        );

        if (firstForProject) {
          broadcast("project:created", { project: projectId });
        }

        broadcast("screenshot:added", {
          id: screenshot.id,
          status: screenshot.status,
          prompt: screenshot.prompt,
          createdAt: screenshot.createdAt,
          source: "agent",
          project: projectId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Canvas image rendered and saved (id: ${screenshot.id}).`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Canvas execution failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

export async function handleMcpRequest(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    if (!session) return;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const projectId = (req.query.project as string | undefined) || "default";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, projectId });
        broadcast("session:connected", {
          project: projectId,
          count:
            Object.fromEntries(
              Object.entries(getSessionCounts()).filter(
                ([p]) => p === projectId,
              ),
            )[projectId] ?? 1,
        });
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
      const counts = getSessionCounts();
      broadcast("session:disconnected", {
        project: projectId,
        count: counts[projectId] ?? 0,
      });
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
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions.get(sessionId)?.transport.handleRequest(req, res);
}

export async function handleMcpDelete(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions.get(sessionId)?.transport.handleRequest(req, res);
}
