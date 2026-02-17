import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { type GitContext, getGitContext } from "./git.js";

export interface Screenshot {
  id: string;
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

function diskPath(id: string): string {
  return path.join(config.dataDir, `${id}.json`);
}

function ensureDataDir(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function saveToDisk(s: Screenshot): void {
  ensureDataDir();
  fs.writeFileSync(diskPath(s.id), JSON.stringify(s));
}

function removeFromDisk(id: string): void {
  const p = diskPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function loadFromDisk(): void {
  ensureDataDir();
  const files = fs
    .readdirSync(config.dataDir)
    .filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(config.dataDir, file), "utf-8"),
    );
    screenshots.set(data.id, data);
  }
  console.log(`Loaded ${files.length} screenshots from disk`);
}

export function addScreenshot(
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Screenshot {
  const gitCtx = getGitContext();
  const s: Screenshot = {
    id: randomUUID(),
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
  saveToDisk(s);
  return s;
}

export function getScreenshot(id: string): Screenshot | undefined {
  return screenshots.get(id);
}

export function listScreenshots(): Omit<Screenshot, "imageBase64">[] {
  return [...screenshots.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ imageBase64: _, ...rest }) => rest);
}

export function getPending(): Screenshot[] {
  return [...screenshots.values()]
    .filter((s) => s.status === "pending")
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
  opts: FilterOptions,
): Omit<Screenshot, "imageBase64">[] {
  let items = [...screenshots.values()];

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
  const existed = screenshots.delete(id);
  if (existed) removeFromDisk(id);
  return existed;
}

export function clearAll(): number {
  const count = screenshots.size;
  for (const id of screenshots.keys()) {
    removeFromDisk(id);
  }
  screenshots.clear();
  return count;
}
