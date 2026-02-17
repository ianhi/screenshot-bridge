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
  console.log(
    `Screenshot Bridge running at http://${config.host}:${config.port}`,
  );
  console.log(`MCP endpoint: http://localhost:${config.port}/mcp`);
});
