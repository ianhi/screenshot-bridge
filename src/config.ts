export const config = {
  port: Number.parseInt(process.env.PORT || "3456", 10),
  host: process.env.HOST || "0.0.0.0",
  dataDir: process.env.DATA_DIR || "data",
  maxImageBase64KB: 750,
  maxImageDimension: 1920,
  jpegQualityStart: 85,
  jpegQualityMin: 30,
  jpegQualityStep: 10,
};
