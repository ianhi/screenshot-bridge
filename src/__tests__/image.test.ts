import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    maxImageBase64KB: 750,
    maxImageDimension: 1920,
    jpegQualityStart: 85,
    jpegQualityMin: 30,
    jpegQualityStep: 10,
  },
}));

const { processImage } = await import("../image.js");

// Create a tiny valid PNG data URL for testing
async function makePngDataUrl(
  width = 10,
  height = 10,
  channels: 3 | 4 = 3,
): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

describe("processImage", () => {
  it("processes a valid small PNG and returns JPEG", async () => {
    const dataUrl = await makePngDataUrl(10, 10);
    const result = await processImage(dataUrl);

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64).toBeTruthy();
    // Should be valid base64
    expect(() => Buffer.from(result.base64, "base64")).not.toThrow();
  });

  it("rejects invalid data URL format", async () => {
    await expect(processImage("not-a-data-url")).rejects.toThrow(
      "Invalid data URL format",
    );
  });

  it("rejects data URL with wrong format", async () => {
    await expect(
      processImage("data:text/plain;base64,aGVsbG8="),
    ).rejects.toThrow("Invalid data URL format");
  });

  it("outputs base64 within size limits", async () => {
    const dataUrl = await makePngDataUrl(100, 100);
    const result = await processImage(dataUrl);

    const sizeKB = Buffer.from(result.base64, "base64").length / 1024;
    expect(sizeKB).toBeLessThan(750);
  });

  it("resizes images larger than maxImageDimension", async () => {
    // Create a 2000x2000 image (exceeds 1920 max)
    const dataUrl = await makePngDataUrl(2000, 2000);
    const result = await processImage(dataUrl);

    // Decode the output to check dimensions
    const outBuf = Buffer.from(result.base64, "base64");
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBeLessThanOrEqual(1920);
    expect(meta.height).toBeLessThanOrEqual(1920);
  });

  it("handles various image sizes", async () => {
    for (const size of [1, 50, 500]) {
      const dataUrl = await makePngDataUrl(size, size);
      const result = await processImage(dataUrl);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });

  it("always outputs JPEG regardless of input format", async () => {
    const dataUrl = await makePngDataUrl(20, 20, 4);
    const result = await processImage(dataUrl);
    expect(result.mimeType).toBe("image/jpeg");

    // Verify it's actually JPEG by checking the buffer
    const buf = Buffer.from(result.base64, "base64");
    // JPEG magic bytes: FF D8
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });
});
