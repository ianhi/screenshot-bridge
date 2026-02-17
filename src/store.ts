// In-memory screenshot store with disk persistence.
// All screenshots are loaded into memory at startup for fast access.
// Disk files (data/<projectId>/<id>.json) are for persistence across restarts.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { type GitContext, getGitContext } from "./git.js";

export interface Screenshot {
  id: string;
  projectId: string;
  prompt: string;
  description: string | null;
  imageBase64: string;
  mimeType: string;
  status: "pending" | "delivered";
  createdAt: string;
  deliveredAt: string | null;
  git: GitContext | null;
}

const screenshots = new Map<string, Screenshot>();

// Tracks all projects that have at least one screenshot. Serves two purposes:
// 1. Powers GET /api/projects for the frontend tab bar
// 2. Enables isNewProject() to detect first screenshot for a project (triggers project:created broadcast)
const knownProjects = new Set<string>();

export function getProjects(): string[] {
  return [...knownProjects].sort();
}

// Must be called BEFORE addScreenshot() since addScreenshot registers the project in knownProjects
export function isNewProject(projectId: string): boolean {
  return !knownProjects.has(projectId);
}

function diskPath(projectId: string, id: string): string {
  return path.join(config.dataDir, projectId, `${id}.json`);
}

function ensureProjectDir(projectId: string): void {
  const dir = path.join(config.dataDir, projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveToDisk(s: Screenshot): void {
  ensureProjectDir(s.projectId);
  fs.writeFileSync(diskPath(s.projectId, s.id), JSON.stringify(s));
}

function removeFromDisk(s: Screenshot): void {
  const p = diskPath(s.projectId, s.id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function migrateLegacyFiles(): void {
  // Migrate flat data/*.json files into data/default/
  const dataDir = config.dataDir;
  if (!fs.existsSync(dataDir)) return;

  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) return;

  const defaultDir = path.join(dataDir, "default");
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  let migrated = 0;
  for (const file of files) {
    const src = path.join(dataDir, file);
    const stat = fs.statSync(src);
    if (!stat.isFile()) continue;

    try {
      const data = JSON.parse(fs.readFileSync(src, "utf-8"));
      data.projectId = "default";
      const dest = path.join(defaultDir, file);
      fs.writeFileSync(dest, JSON.stringify(data));
      fs.unlinkSync(src);
      migrated++;
    } catch {
      // Skip malformed files
    }
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} legacy screenshots to data/default/`);
  }
}

export function loadFromDisk(): void {
  const dataDir = config.dataDir;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Migrate legacy flat files first
  migrateLegacyFiles();

  // Scan subdirectories
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    const projectDir = path.join(dataDir, projectId);
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(projectDir, file), "utf-8"),
        );
        data.projectId = projectId;
        screenshots.set(data.id, data);
        knownProjects.add(projectId);
        total++;
      } catch {
        // Skip malformed files
      }
    }
  }

  console.log(
    `Loaded ${total} screenshots from disk (${knownProjects.size} project(s))`,
  );
}

export function addScreenshot(
  projectId: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Screenshot {
  const gitCtx = getGitContext();
  const s: Screenshot = {
    id: randomUUID(),
    projectId,
    prompt,
    description: null,
    imageBase64,
    mimeType,
    status: "pending",
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    git: gitCtx.branch || gitCtx.commit ? gitCtx : null,
  };
  screenshots.set(s.id, s);
  knownProjects.add(projectId);
  saveToDisk(s);
  return s;
}

export function getScreenshot(id: string): Screenshot | undefined {
  return screenshots.get(id);
}

export function listScreenshots(
  projectId: string,
): Omit<Screenshot, "imageBase64">[] {
  return [...screenshots.values()]
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ imageBase64: _, ...rest }) => rest);
}

export function getPending(projectId: string): Screenshot[] {
  return [...screenshots.values()]
    .filter((s) => s.projectId === projectId && s.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function markDelivered(id: string): void {
  const s = screenshots.get(id);
  if (s) {
    s.status = "delivered";
    s.deliveredAt = new Date().toISOString();
    saveToDisk(s);
  }
}

export function setDescription(id: string, description: string): boolean {
  const s = screenshots.get(id);
  if (!s) return false;
  s.description = description;
  saveToDisk(s);
  return true;
}

export interface FilterOptions {
  branch?: string;
  commit?: string;
  since?: string;
  until?: string;
  status?: "pending" | "delivered";
}

export function filterScreenshots(
  projectId: string,
  opts: FilterOptions,
): Omit<Screenshot, "imageBase64">[] {
  let items = [...screenshots.values()].filter(
    (s) => s.projectId === projectId,
  );

  if (opts.branch) {
    items = items.filter((s) => s.git?.branch === opts.branch);
  }
  if (opts.commit) {
    items = items.filter(
      (s) =>
        s.git?.commit === opts.commit || s.git?.commitShort === opts.commit,
    );
  }
  if (opts.since) {
    const since = new Date(opts.since).getTime();
    items = items.filter((s) => new Date(s.createdAt).getTime() >= since);
  }
  if (opts.until) {
    const until = new Date(opts.until).getTime();
    items = items.filter((s) => new Date(s.createdAt).getTime() <= until);
  }
  if (opts.status) {
    items = items.filter((s) => s.status === opts.status);
  }

  return items
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ imageBase64: _, ...rest }) => rest);
}

export function deleteScreenshot(id: string): boolean {
  const s = screenshots.get(id);
  if (!s) return false;
  screenshots.delete(id);
  removeFromDisk(s);
  return true;
}

export function clearAll(projectId: string): number {
  const toRemove = [...screenshots.values()].filter(
    (s) => s.projectId === projectId,
  );
  for (const s of toRemove) {
    screenshots.delete(s.id);
    removeFromDisk(s);
  }
  return toRemove.length;
}
