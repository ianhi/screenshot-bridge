import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

let wss: WebSocketServer;

const pendingRequests = new Map<
  string,
  {
    resolve: (data: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => console.error("WebSocket error:", err));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.event === "canvas:result" && msg.data?.requestId) {
          const pending = pendingRequests.get(msg.data.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(msg.data.requestId);
            if (msg.data.error) {
              pending.reject(new Error(msg.data.error));
            } else {
              pending.resolve(msg.data);
            }
          }
        }
      } catch {
        /* ignore malformed messages */
      }
    });
  });
}

export function sendAndWait(
  event: string,
  data: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!wss || wss.clients.size === 0) {
      reject(new Error("No browser connected"));
      return;
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error("Canvas execution timed out (no response from browser)"),
      );
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });
    broadcast(event, { ...data, requestId });
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
