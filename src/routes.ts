import { Router } from "express";
import { processImage } from "./image.js";
import {
  addScreenshot,
  clearAll,
  deleteScreenshot,
  getScreenshot,
  listScreenshots,
  setDescription,
} from "./store.js";
import { broadcast } from "./ws.js";

export const apiRouter = Router();

apiRouter.use((req, res, next) => {
  // JSON body size limit for base64 images
  if (req.headers["content-type"]?.includes("application/json")) {
    next();
  } else {
    next();
  }
});

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.post("/screenshots", async (req, res) => {
  try {
    const { dataUrl, prompt = "" } = req.body;
    if (!dataUrl || typeof dataUrl !== "string") {
      res.status(400).json({ error: "dataUrl is required" });
      return;
    }

    const { base64, mimeType } = await processImage(dataUrl);
    const screenshot = addScreenshot(base64, mimeType, prompt);

    broadcast("screenshot:added", {
      id: screenshot.id,
      status: screenshot.status,
      prompt: screenshot.prompt,
      createdAt: screenshot.createdAt,
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

apiRouter.get("/screenshots", (_req, res) => {
  res.json(listScreenshots());
});

apiRouter.delete("/screenshots/:id", (req, res) => {
  const deleted = deleteScreenshot(req.params.id);
  if (deleted) {
    broadcast("screenshot:deleted", { id: req.params.id });
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

apiRouter.delete("/screenshots", (_req, res) => {
  const count = clearAll();
  broadcast("screenshots:cleared", { count });
  res.json({ cleared: count });
});

// Update description
apiRouter.patch("/screenshots/:id", (req, res) => {
  const { description } = req.body;
  if (typeof description !== "string") {
    res.status(400).json({ error: "description is required" });
    return;
  }
  const updated = setDescription(req.params.id, description);
  if (updated) {
    broadcast("screenshot:updated", { id: req.params.id, description });
    res.json({ updated: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// Serve thumbnail for frontend
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
