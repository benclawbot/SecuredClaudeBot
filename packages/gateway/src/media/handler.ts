/**
 * Media Handler — processes images, PDFs, and other file attachments.
 * Handles resizing, format conversion, and text extraction.
 */
import { createChildLogger } from "../logger/index.js";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { MEDIA_DIR } from "../config/defaults.js";

const log = createChildLogger("media");

export interface MediaFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  createdAt: number;
}

/** Allowed MIME types for upload */
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  // Videos
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-msvideo",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp3",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/xml",
  "text/xml",
  // Compressed
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-tar",
  "application/x-rar-compressed",
  "application/7z",
]);

/** Max file size: 25 MB */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Media file manager with storage, validation, and metadata tracking.
 */
export class MediaHandler {
  private storageDir: string;

  constructor(storageDir = MEDIA_DIR) {
    this.storageDir = storageDir;
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    log.info({ dir: this.storageDir }, "Media handler initialized");
  }

  /**
   * Store a file from a Buffer.
   */
  store(
    data: Buffer,
    originalName: string,
    mimeType: string
  ): MediaFile {
    // Validate mime type
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Validate size
    if (data.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${data.length} bytes (max ${MAX_FILE_SIZE})`);
    }

    // Generate safe filename
    const id = randomBytes(12).toString("hex");
    const ext = extname(originalName) || this.mimeToExt(mimeType);
    const filename = `${id}${ext}`;
    const path = resolve(this.storageDir, filename);

    writeFileSync(path, data);

    const file: MediaFile = {
      id,
      filename,
      originalName,
      mimeType,
      sizeBytes: data.length,
      path,
      createdAt: Date.now(),
    };

    log.info(
      { id, originalName, mimeType, sizeBytes: data.length },
      "File stored"
    );

    return file;
  }

  /**
   * Read a stored file by ID or filename.
   */
  read(filenameOrId: string): Buffer | null {
    const path = this.resolvePath(filenameOrId);
    if (!path || !existsSync(path)) return null;
    return readFileSync(path);
  }

  /**
   * Search files by query (matches filename)
   */
  search(query: string): MediaFile[] {
    const allFiles = this.list();
    if (!query) return allFiles;

    const lowerQuery = query.toLowerCase();
    return allFiles.filter(f =>
      f.originalName.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get a stored file with its data by ID.
   */
  get(filenameOrId: string): MediaFile & { data: Buffer } | null {
    const path = this.resolvePath(filenameOrId);
    if (!path || !existsSync(path)) return null;

    const stat = statSync(path);
    const ext = extname(path);
    const id = filenameOrId;
    const data = readFileSync(path);

    return {
      id,
      filename: `${id}${ext}`,
      originalName: id,
      mimeType: this.extToMime(ext),
      sizeBytes: stat.size,
      path,
      createdAt: stat.mtimeMs,
      data,
    };
  }

  /**
   * Delete a stored file.
   */
  delete(filenameOrId: string): boolean {
    const path = this.resolvePath(filenameOrId);
    if (!path || !existsSync(path)) return false;

    unlinkSync(path);
    log.info({ file: filenameOrId }, "File deleted");
    return true;
  }

  /**
   * List all stored files.
   */
  list(): MediaFile[] {
    if (!existsSync(this.storageDir)) return [];

    return readdirSync(this.storageDir)
      .map((filename) => {
        const path = resolve(this.storageDir, filename);
        const stat = statSync(path);
        const id = filename.replace(extname(filename), "");
        const ext = extname(filename);

        return {
          id,
          filename,
          originalName: filename,
          mimeType: this.extToMime(ext),
          sizeBytes: stat.size,
          path,
          createdAt: stat.mtimeMs,
        };
      });
  }

  /**
   * Get storage usage stats.
   */
  stats(): { fileCount: number; totalBytes: number } {
    const files = this.list();
    return {
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    };
  }

  /**
   * Validate a file upload before storing.
   */
  validate(
    data: Buffer,
    mimeType: string
  ): { valid: boolean; reason?: string } {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return { valid: false, reason: `Unsupported file type: ${mimeType}` };
    }
    if (data.length > MAX_FILE_SIZE) {
      return { valid: false, reason: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` };
    }
    if (data.length === 0) {
      return { valid: false, reason: "Empty file" };
    }
    return { valid: true };
  }

  // ── Private ──

  private resolvePath(filenameOrId: string): string | null {
    // Direct filename
    const direct = resolve(this.storageDir, basename(filenameOrId));
    if (existsSync(direct)) return direct;

    // Try to find by ID prefix
    if (!existsSync(this.storageDir)) return null;
    const files = readdirSync(this.storageDir);
    const match = files.find((f) => f.startsWith(filenameOrId));
    return match ? resolve(this.storageDir, match) : null;
  }

  private mimeToExt(mime: string): string {
    const map: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
      "text/markdown": ".md",
      "text/csv": ".csv",
      "application/json": ".json",
    };
    return map[mime] ?? ".bin";
  }

  private extToMime(ext: string): string {
    const map: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".csv": "text/csv",
      ".json": "application/json",
    };
    return map[ext.toLowerCase()] ?? "application/octet-stream";
  }
}
