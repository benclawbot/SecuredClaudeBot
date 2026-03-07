/**
 * Voice module using Whisper for transcription
 */
import { spawn } from "node:child_process";
import { createChildLogger } from "../logger/index.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";

const log = createChildLogger("voice");

/**
 * Validate that a path doesn't contain shell special characters
 */
function validateAudioPath(audioPath: string): void {
  const dangerousChars = /[;&|`$()<>]/;
  if (dangerousChars.test(audioPath)) {
    throw new Error("Audio path contains invalid characters");
  }
}

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
  // Validate path doesn't contain dangerous characters
  validateAudioPath(audioPath);

  return new Promise((resolve, reject) => {
    const tempDir = mkdtempSync("/tmp/whisper-");
    const outputPath = join(tempDir, "transcription.json");
    const inputPath = join(tempDir, "audio_path.txt");

    // Write audio path to temp file to avoid command injection
    writeFileSync(inputPath, audioPath);

    const process = spawn("python3", [
      "-c",
      `
import sys
import json
from faster_whisper import WhisperModel

# Read audio path from temp file to avoid command injection
with open("${inputPath.replace(/\\/g, "\\\\")}", "r") as f:
    audio_path = f.read().strip()

model_size = "${model}"
model = WhisperModel(model_size, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio_path, beam_size=5)

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
      // Cleanup temp files
      try { unlinkSync(inputPath); } catch {}
      try { unlinkSync(outputPath); } catch {}

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
      // Cleanup on error
      try { unlinkSync(inputPath); } catch {}
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
