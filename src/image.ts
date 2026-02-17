import sharp from "sharp";
import { config } from "./config.js";

const MAX_BASE64_BYTES = config.maxImageBase64KB * 1024;

export async function processImage(
  dataUrl: string,
): Promise<{ base64: string; mimeType: string }> {
  // Parse data URL: data:image/png;base64,iVBOR...
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const inputBuffer = Buffer.from(match[1], "base64");
  let pipeline = sharp(inputBuffer);
  const metadata = await pipeline.metadata();

  // Resize if too large
  const maxDim = config.maxImageDimension;
  if (metadata.width && metadata.height) {
    if (metadata.width > maxDim || metadata.height > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }
  }

  // Try JPEG at decreasing quality
  let quality = config.jpegQualityStart;
  let outputBuffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  let base64 = outputBuffer.toString("base64");

  while (base64.length > MAX_BASE64_BYTES && quality > config.jpegQualityMin) {
    quality -= config.jpegQualityStep;
    outputBuffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    base64 = outputBuffer.toString("base64");
  }

  // If still too large, scale down dimensions progressively
  if (base64.length > MAX_BASE64_BYTES && metadata.width && metadata.height) {
    let scale = 0.8;
    while (base64.length > MAX_BASE64_BYTES && scale > 0.2) {
      const w = Math.round(
        (metadata.width > maxDim ? maxDim : metadata.width) * scale,
      );
      const h = Math.round(
        (metadata.height > maxDim ? maxDim : metadata.height) * scale,
      );
      outputBuffer = await sharp(inputBuffer)
        .resize(w, h, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: config.jpegQualityMin, mozjpeg: true })
        .toBuffer();
      base64 = outputBuffer.toString("base64");
      scale -= 0.1;
    }
  }

  return { base64, mimeType: "image/jpeg" };
}
