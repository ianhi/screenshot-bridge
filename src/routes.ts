import type { Request } from "express";
import { Router } from "express";
import { processImage } from "./image.js";
import { getSessionCounts } from "./mcp.js";
import {
  addScreenshot,
  clearAll,
  countScreenshots,
  deleteScreenshot,
  filterScreenshots,
  getProjects,
  getScreenshot,
  isNewProject,
  listScreenshots,
  setDescription,
} from "./store.js";
import { broadcast } from "./ws.js";

export const apiRouter = Router();

function getProject(req: Request): string {
  return (req.query.project as string | undefined) || "default";
}

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", sessions: getSessionCounts() });
});

apiRouter.get("/sessions", (_req, res) => {
  res.json(getSessionCounts());
});

apiRouter.get("/projects", (_req, res) => {
  res.json(getProjects());
});

apiRouter.post("/screenshots", async (req, res) => {
  try {
    const { dataUrl, prompt = "", annotations = null } = req.body;
    if (!dataUrl || typeof dataUrl !== "string") {
      res.status(400).json({ error: "dataUrl is required" });
      return;
    }

    const projectId = getProject(req);
    // Check before addScreenshot() which registers the project in knownProjects
    const firstForProject = isNewProject(projectId);

    const { base64, mimeType } = await processImage(dataUrl);
    const screenshot = addScreenshot(
      projectId,
      base64,
      mimeType,
      prompt,
      annotations,
    );

    if (firstForProject) {
      broadcast("project:created", { project: projectId });
    }

    broadcast("screenshot:added", {
      id: screenshot.id,
      status: screenshot.status,
      prompt: screenshot.prompt,
      createdAt: screenshot.createdAt,
      source: screenshot.source,
      project: projectId,
    });

    res.status(201).json({
      id: screenshot.id,
      status: screenshot.status,
      createdAt: screenshot.createdAt,
    });
  } catch (err) {
    console.error("Error processing screenshot:", err);
    res.status(500).json({ error: "Failed to process screenshot" });
  }
});

apiRouter.get("/screenshots", (req, res) => {
  const projectId = getProject(req);
  const { branch, commit, since, until, status, q } = req.query as Record<
    string,
    string | undefined
  >;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;

  const hasFilter = branch || commit || since || until || status || q;
  const filterOpts = {
    branch,
    commit,
    since,
    until,
    status: status as "pending" | "delivered" | undefined,
    q,
  };

  let items: ReturnType<typeof listScreenshots>;
  let total: number;

  if (hasFilter) {
    items = filterScreenshots(projectId, filterOpts, limit, offset);
    total =
      limit !== undefined
        ? filterScreenshots(projectId, filterOpts).length
        : items.length;
  } else {
    items = listScreenshots(projectId, limit, offset);
    total = limit !== undefined ? countScreenshots(projectId) : items.length;
  }

  // Return paginated envelope when limit is specified
  if (limit !== undefined) {
    res.json({ items, total });
  } else {
    res.json(items);
  }
});

apiRouter.delete("/screenshots/:id", (req, res) => {
  const screenshot = getScreenshot(req.params.id);
  const deleted = deleteScreenshot(req.params.id);
  if (deleted) {
    broadcast("screenshot:deleted", {
      id: req.params.id,
      project: screenshot?.projectId || "default",
    });
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

apiRouter.delete("/screenshots", (req, res) => {
  const projectId = getProject(req);
  const count = clearAll(projectId);
  broadcast("screenshots:cleared", { count, project: projectId });
  res.json({ cleared: count });
});

// Update description
apiRouter.patch("/screenshots/:id", (req, res) => {
  const { description } = req.body;
  if (typeof description !== "string") {
    res.status(400).json({ error: "description is required" });
    return;
  }
  const screenshot = getScreenshot(req.params.id);
  const updated = setDescription(req.params.id, description);
  if (updated) {
    broadcast("screenshot:updated", {
      id: req.params.id,
      description,
      project: screenshot?.projectId || "default",
    });
    res.json({ updated: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// Serve full screenshot image binary (displayed as thumbnail in frontend via CSS constraints)
apiRouter.get("/screenshots/:id/image", (req, res) => {
  const screenshot = getScreenshot(req.params.id);
  if (!screenshot) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const buffer = Buffer.from(screenshot.imageBase64, "base64");
  res.set("Content-Type", screenshot.mimeType);
  res.set("Cache-Control", "public, max-age=3600");
  res.send(buffer);
});
