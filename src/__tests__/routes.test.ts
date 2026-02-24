import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config to use a temp directory
const tmpDir = path.join(os.tmpdir(), `sb-routes-test-${Date.now()}`);
vi.mock("../config.js", () => ({
  config: {
    dataDir: tmpDir,
    maxImageBase64KB: 750,
    maxImageDimension: 1920,
    jpegQualityStart: 85,
    jpegQualityMin: 30,
    jpegQualityStep: 10,
  },
}));

vi.mock("../git.js", () => ({
  getGitContext: () => ({
    branch: "main",
    commit: "abc123",
    commitShort: "abc1",
    repoRoot: "/tmp/repo",
  }),
}));

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
  sendAndWait: vi.fn(),
}));

vi.mock("../mcp.js", () => ({
  getSessionCounts: () => ({}),
}));

const { loadFromDisk, addScreenshot, _resetStore } = await import(
  "../store.js"
);
const { apiRouter } = await import("../routes.js");

// Create a test Express app
function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", apiRouter);
  return app;
}

describe("routes", () => {
  beforeEach(() => {
    _resetStore();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
    loadFromDisk();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe("GET /api/screenshots", () => {
    it("returns array without pagination params", async () => {
      addScreenshot("default", "aW1hZ2U=", "image/png", "test");
      const app = createApp();

      const res = await makeRequest(app, "/api/screenshots?project=default");
      const body = JSON.parse(res.body);

      expect(res.status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
    });

    it("returns paginated envelope with limit param", async () => {
      for (let i = 0; i < 5; i++) {
        addScreenshot("default", "aW1hZ2U=", "image/png", `shot${i}`);
      }
      const app = createApp();

      const res = await makeRequest(
        app,
        "/api/screenshots?project=default&limit=2",
      );
      const body = JSON.parse(res.body);

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
    });

    it("supports offset for pagination", async () => {
      for (let i = 0; i < 5; i++) {
        addScreenshot("default", "aW1hZ2U=", "image/png", `shot${i}`);
      }
      const app = createApp();

      const res = await makeRequest(
        app,
        "/api/screenshots?project=default&limit=2&offset=4",
      );
      const body = JSON.parse(res.body);

      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(5);
    });

    it("filters by text query with pagination", async () => {
      addScreenshot("default", "aW1hZ2U=", "image/png", "login bug");
      addScreenshot("default", "aW1hZ2U=", "image/png", "login fix");
      addScreenshot("default", "aW1hZ2U=", "image/png", "dashboard");
      const app = createApp();

      const res = await makeRequest(
        app,
        "/api/screenshots?project=default&q=login&limit=10",
      );
      const body = JSON.parse(res.body);

      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2); // filtered total, not project total
    });

    it("filters by status", async () => {
      addScreenshot("default", "aW1hZ2U=", "image/png", "pending");
      addScreenshot("default", "aW1hZ2U=", "image/png", "", null, "agent"); // agent = delivered
      const app = createApp();

      const res = await makeRequest(
        app,
        "/api/screenshots?project=default&status=pending",
      );
      const body = JSON.parse(res.body);

      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].status).toBe("pending");
    });
  });

  describe("GET /api/projects", () => {
    it("returns project list", async () => {
      addScreenshot("alpha", "aW1hZ2U=", "image/png", "test");
      addScreenshot("beta", "aW1hZ2U=", "image/png", "test");
      const app = createApp();

      const res = await makeRequest(app, "/api/projects");
      const body = JSON.parse(res.body);

      expect(body).toContain("alpha");
      expect(body).toContain("beta");
    });
  });

  describe("GET /api/health", () => {
    it("returns ok status", async () => {
      const app = createApp();

      const res = await makeRequest(app, "/api/health");
      const body = JSON.parse(res.body);

      expect(body.status).toBe("ok");
    });
  });
});

// Helper to make requests without starting a real server
function makeRequest(
  app: express.Express,
  url: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        resolve({ status: 500, body: "Failed to get address" });
        return;
      }

      fetch(`http://localhost:${addr.port}${url}`)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: err.message });
        });
    });
  });
}
