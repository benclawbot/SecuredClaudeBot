/**
 * OCR Image Processing - Extract text from images using Tesseract.js
 */
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("ocr");

// Lazy-loaded Tesseract worker
let worker: any = null;

/**
 * Extract text from an image buffer using Tesseract.js OCR
 */
export async function extractTextFromImage(
  imageBuffer: Buffer,
  mimeType: string
): Promise<string> {
  try {
    // Lazy initialize worker
    if (!worker) {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng");
      log.info("Tesseract OCR worker initialized");
    }

    // Convert buffer to base64 for Tesseract
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const result = await worker.recognize(dataUrl);
    const text = result.data.text.trim();

    log.info(
      { textLength: text.length, confidence: result.data.confidence },
      "OCR completed successfully"
    );

    return text;
  } catch (err) {
    log.error({ err, mimeType }, "OCR failed");
    throw new Error(`OCR failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Check if a MIME type is supported for OCR
 */
export function isImageOcrSupported(mimeType: string): boolean {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/tiff",
    "image/tif",
  ];
  return supportedTypes.includes(mimeType.toLowerCase());
}

