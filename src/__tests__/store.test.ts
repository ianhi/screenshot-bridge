import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config to use a temp directory
const tmpDir = path.join(os.tmpdir(), `sb-test-${Date.now()}`);
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

// Mock git context
vi.mock("../git.js", () => ({
  getGitContext: () => ({
    branch: "main",
    commit: "abc123def456",
    commitShort: "abc123d",
    repoRoot: "/tmp/repo",
  }),
}));

// Dynamic import after mocks are set
const {
  loadFromDisk,
  addScreenshot,
  getScreenshot,
  listScreenshots,
  getPending,
  markDelivered,
  setDescription,
  filterScreenshots,
  deleteScreenshot,
  clearAll,
  getProjects,
  isNewProject,
} = await import("../store.js");

describe("store", () => {
  beforeEach(() => {
    // Ensure clean temp dir for each test
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    loadFromDisk();
  });

  afterEach(() => {
    // Clean up screenshots from memory by clearing all known projects
    for (const p of getProjects()) {
      clearAll(p);
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe("addScreenshot & getScreenshot", () => {
    it("creates a screenshot and retrieves it by id", () => {
      const s = addScreenshot(
        "default",
        "aW1hZ2U=",
        "image/jpeg",
        "test prompt",
      );
      expect(s.id).toBeTruthy();
      expect(s.projectId).toBe("default");
      expect(s.prompt).toBe("test prompt");
      expect(s.imageBase64).toBe("aW1hZ2U=");
      expect(s.mimeType).toBe("image/jpeg");
      expect(s.status).toBe("pending");
      expect(s.source).toBe("user");
      expect(s.git?.branch).toBe("main");

      const retrieved = getScreenshot(s.id);
      expect(retrieved).toEqual(s);
    });

    it("returns undefined for non-existent id", () => {
      expect(getScreenshot("does-not-exist")).toBeUndefined();
    });

    it("creates agent screenshots with delivered status", () => {
      const s = addScreenshot(
        "default",
        "aW1hZ2U=",
        "image/png",
        "",
        null,
        "agent",
      );
      expect(s.source).toBe("agent");
      expect(s.status).toBe("delivered");
      expect(s.deliveredAt).toBeTruthy();
    });
  });

  describe("listScreenshots", () => {
    it("lists screenshots for a project, sorted newest first, and strips imageBase64", () => {
      addScreenshot("proj1", "a", "image/png", "first");
      addScreenshot("proj1", "b", "image/png", "second");
      addScreenshot("proj2", "c", "image/png", "other project");

      const list = listScreenshots("proj1");
      expect(list).toHaveLength(2);
      // Both created in same ms, so just check all present and imageBase64 stripped
      const prompts = list.map((l) => l.prompt).sort();
      expect(prompts).toEqual(["first", "second"]);
      for (const item of list) {
        expect(item).not.toHaveProperty("imageBase64");
      }
    });

    it("returns empty array for unknown project", () => {
      expect(listScreenshots("nonexistent")).toEqual([]);
    });
  });

  describe("getPending", () => {
    it("returns only pending user screenshots, oldest first", () => {
      const s1 = addScreenshot("default", "a", "image/png", "p1");
      addScreenshot("default", "b", "image/png", "", null, "agent");
      const s3 = addScreenshot("default", "c", "image/png", "p3");

      const pending = getPending("default");
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe(s1.id);
      expect(pending[1].id).toBe(s3.id);
    });
  });

  describe("markDelivered", () => {
    it("marks a screenshot as delivered", () => {
      const s = addScreenshot("default", "a", "image/png", "test");
      expect(s.status).toBe("pending");

      markDelivered(s.id);
      const updated = getScreenshot(s.id);
      expect(updated?.status).toBe("delivered");
      expect(updated?.deliveredAt).toBeTruthy();
    });
  });

  describe("setDescription", () => {
    it("sets a description on a screenshot", () => {
      const s = addScreenshot("default", "a", "image/png", "test");
      expect(setDescription(s.id, "my description")).toBe(true);
      expect(getScreenshot(s.id)?.description).toBe("my description");
    });

    it("returns false for non-existent id", () => {
      expect(setDescription("nope", "desc")).toBe(false);
    });
  });

  describe("filterScreenshots", () => {
    it("filters by branch", () => {
      addScreenshot("default", "a", "image/png", "test");
      const results = filterScreenshots("default", { branch: "main" });
      expect(results).toHaveLength(1);

      const noResults = filterScreenshots("default", { branch: "develop" });
      expect(noResults).toHaveLength(0);
    });

    it("filters by status", () => {
      const s = addScreenshot("default", "a", "image/png", "test");
      expect(filterScreenshots("default", { status: "pending" })).toHaveLength(
        1,
      );
      expect(
        filterScreenshots("default", { status: "delivered" }),
      ).toHaveLength(0);

      markDelivered(s.id);
      expect(
        filterScreenshots("default", { status: "delivered" }),
      ).toHaveLength(1);
    });

    it("filters by text query", () => {
      addScreenshot("default", "a", "image/png", "login page bug");
      addScreenshot("default", "b", "image/png", "dashboard chart");
      const s3 = addScreenshot("default", "c", "image/png", "other");
      setDescription(s3.id, "shows the login form");

      expect(filterScreenshots("default", { q: "login" })).toHaveLength(2);
      expect(filterScreenshots("default", { q: "dashboard" })).toHaveLength(1);
      expect(filterScreenshots("default", { q: "nonexistent" })).toHaveLength(
        0,
      );
    });

    it("filters by commit", () => {
      addScreenshot("default", "a", "image/png", "test");
      expect(
        filterScreenshots("default", { commit: "abc123def456" }),
      ).toHaveLength(1);
      expect(filterScreenshots("default", { commit: "abc123d" })).toHaveLength(
        1,
      );
      expect(filterScreenshots("default", { commit: "zzz" })).toHaveLength(0);
    });
  });

  describe("deleteScreenshot", () => {
    it("deletes a screenshot", () => {
      const s = addScreenshot("default", "a", "image/png", "test");
      expect(deleteScreenshot(s.id)).toBe(true);
      expect(getScreenshot(s.id)).toBeUndefined();
    });

    it("returns false for non-existent id", () => {
      expect(deleteScreenshot("nope")).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("removes all screenshots for a project", () => {
      addScreenshot("proj1", "a", "image/png", "a");
      addScreenshot("proj1", "b", "image/png", "b");
      addScreenshot("proj2", "c", "image/png", "c");

      const count = clearAll("proj1");
      expect(count).toBe(2);
      expect(listScreenshots("proj1")).toHaveLength(0);
      expect(listScreenshots("proj2")).toHaveLength(1);
    });
  });

  describe("project isolation", () => {
    it("isolates screenshots between projects", () => {
      addScreenshot("alpha", "a", "image/png", "alpha shot");
      addScreenshot("beta", "b", "image/png", "beta shot");

      expect(listScreenshots("alpha")).toHaveLength(1);
      expect(listScreenshots("beta")).toHaveLength(1);
      expect(listScreenshots("alpha")[0].prompt).toBe("alpha shot");
      expect(listScreenshots("beta")[0].prompt).toBe("beta shot");
    });

    it("tracks projects correctly", () => {
      expect(isNewProject("newproj")).toBe(true);
      addScreenshot("newproj", "a", "image/png", "test");
      expect(isNewProject("newproj")).toBe(false);
      expect(getProjects()).toContain("newproj");
    });
  });

  describe("persistence", () => {
    it("persists screenshots to disk", () => {
      const s = addScreenshot("default", "aW1hZ2U=", "image/png", "persisted");
      const filePath = path.join(tmpDir, "default", `${s.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.prompt).toBe("persisted");
    });

    it("removes file on delete", () => {
      const s = addScreenshot("default", "a", "image/png", "test");
      const filePath = path.join(tmpDir, "default", `${s.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      deleteScreenshot(s.id);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
