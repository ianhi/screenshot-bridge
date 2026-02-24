#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { handleMcpDelete, handleMcpGet, handleMcpRequest } from "./mcp.js";
import { apiRouter } from "./routes.js";
import { loadFromDisk } from "./store.js";
import { setupWebSocket } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
  // Health-check: if the server is already running, exit cleanly
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${config.port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const body = await res.json();
      if (body.status === "ok") {
        console.log(
          `Screenshot Bridge already running on port ${config.port}, exiting.`,
        );
        process.exit(0);
      }
    }
  } catch {
    // Not running — proceed with startup
  }

  const app = express();
  app.use(express.json({ limit: "50mb" }));

  // Static frontend
  app.use(express.static(path.join(__dirname, "public")));

  // REST API
  app.use("/api", apiRouter);

  // MCP Streamable HTTP
  app.post("/mcp", (req, res) => {
    handleMcpRequest(req, res).catch((err) => {
      console.error("MCP POST error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
  });
  app.get("/mcp", (req, res) => {
    handleMcpGet(req, res).catch((err) => {
      console.error("MCP GET error:", err);
      if (!res.headersSent) res.status(500).send("Internal error");
    });
  });
  app.delete("/mcp", (req, res) => {
    handleMcpDelete(req, res).catch((err) => {
      console.error("MCP DELETE error:", err);
      if (!res.headersSent) res.status(500).send("Internal error");
    });
  });

  // Load persisted screenshots
  loadFromDisk();

  // Create HTTP server and attach WebSocket
  const server = createServer(app);
  setupWebSocket(server);

  server.listen(config.port, config.host, () => {
    const url = `http://localhost:${config.port}`;
    console.log(
      `Screenshot Bridge running at http://${config.host}:${config.port}`,
    );
    console.log(`MCP endpoint: ${url}/mcp`);

    // Auto-open browser
    if (config.openBrowser) {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      execFile(cmd, [url], (err) => {
        if (err) {
          // Silently ignore — headless server or no display
        }
      });
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use by another process.`,
      );
      process.exit(1);
    }
    throw err;
  });

  // Graceful shutdown
  function shutdown() {
    console.log("Shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
