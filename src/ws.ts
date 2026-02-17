import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

let wss: WebSocketServer;

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => console.error("WebSocket error:", err));
  });
}

export function broadcast(event: string, data: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
