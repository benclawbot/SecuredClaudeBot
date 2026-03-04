/**
 * Voice module using Whisper for transcription
 */
import { spawn } from "node:child_process";
import { createChildLogger } from "../logger/index.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

const log = createChildLogger("voice");

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe audio using Whisper (faster-whisper)
 */
export async function transcribeAudio(
  audioPath: string,
  model: string = "base"
): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    const tempDir = mkdtempSync("/tmp/whisper-");
    const outputPath = join(tempDir, "transcription.json");

    const process = spawn("python3", [
      "-c",
      `
import sys
import json
from faster_whisper import WhisperModel

model_size = "${model}"
model = WhisperModel(model_size, device="cpu", compute_type="int8")
segments, info = model.transcribe("${audioPath.replace(/\\/g, "\\\\")}", beam_size=5)

text = " ".join([segment.text for segment in segments])
result = {
    "text": text,
    "language": info.language if hasattr(info, 'language') else None,
    "duration": info.duration if hasattr(info, 'duration') else None
}
print(json.dumps(result))
`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          reject(new Error(`Failed to parse transcription: ${stdout}`));
        }
      } else {
        log.error({ stderr, code }, "Whisper transcription failed");
        reject(new Error(`Transcription failed: ${stderr}`));
      }
    });

    process.on("error", (err) => {
      log.error({ err }, "Failed to start Whisper");
      reject(err);
    });
  });
}

/**
 * Transcribe audio from buffer (for voice notes)
 */
export async function transcribeBuffer(
  buffer: Buffer,
  format: string = "webm"
): Promise<TranscriptionResult> {
  const tempDir = mkdtempSync("/tmp/whisper-");
  const tempPath = join(tempDir, `audio.${format}`);

  try {
    await writeFile(tempPath, buffer);
    const result = await transcribeAudio(tempPath);
    return result;
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
