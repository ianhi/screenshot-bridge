import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to the project root (one level up from src/),
// so data dir is stable regardless of the working directory the server is started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const config = {
  port: Number.parseInt(process.env.PORT || "3456", 10),
  host: process.env.HOST || "0.0.0.0",
  dataDir: process.env.DATA_DIR || path.join(projectRoot, "data"),

  // Image compression cascade (see image.ts):
  // 1. Resize to maxImageDimension if larger
  // 2. JPEG at jpegQualityStart, step down by jpegQualityStep until maxImageBase64KB or jpegQualityMin
  // 3. If still too large, progressively scale down dimensions
  // Target 750KB base64 to stay well under MCP's 1MB content limit
  maxImageBase64KB: 750,
  maxImageDimension: 1920,
  jpegQualityStart: 85,
  jpegQualityMin: 30,
  jpegQualityStep: 10,
};
