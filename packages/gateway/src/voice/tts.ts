/**
 * Text-to-Speech module using multiple providers (including free options)
 */
import { spawn } from "node:child_process";
import { createChildLogger } from "../logger/index.js";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const log = createChildLogger("tts");

export interface TtsOptions {
  provider: "elevenlabs" | "openai" | "google" | "polly" | "coqui" | "piper" | "gtts";
  voice?: string;
  model?: string;
}

export interface TtsResult {
  audio: Buffer;
  format: string;
}

/**
 * Convert text to speech using the configured provider
 */
export async function textToSpeech(
  text: string,
  apiKey: string,
  options: TtsOptions
): Promise<TtsResult> {
  switch (options.provider) {
    case "elevenlabs":
      return textToSpeechElevenLabs(text, apiKey, options.voice);
    case "openai":
      return textToSpeechOpenAI(text, apiKey, options.model);
    case "coqui":
      return textToSpeechCoqui(text, options.voice);
    case "piper":
      return textToSpeechPiper(text, options.voice);
    case "gtts":
      return textToSpeechGTTS(text, options.voice);
    case "google":
      return textToSpeechGoogle(text, apiKey);
    case "polly":
      return textToSpeechPolly(text, apiKey);
    default:
      throw new Error(`Unknown TTS provider: ${options.provider}`);
  }
}

/**
 * ElevenLabs TTS
 */
async function textToSpeechElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string = "rachel"
): Promise<TtsResult> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${error}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return { audio, format: "mp3" };
}

/**
 * OpenAI TTS
 */
async function textToSpeechOpenAI(
  text: string,
  apiKey: string,
  model: string = "tts-1"
): Promise<TtsResult> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      voice: "alloy",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI TTS failed: ${error}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return { audio, format: "mp3" };
}

/**
 * Coqui TTS (Free, open source) - runs locally
 * Requires Coqui TTS to be installed: pip install TTS
 */
async function textToSpeechCoqui(
  text: string,
  voiceModel: string = "tts_models/en/ljspeech/glow-tts"
): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const tempDir = mkdtempSync("/tmp/tts-");
    const outputPath = join(tempDir, "output.wav");

    const process = spawn("tts", [
      "--text", text,
      "--model_name", voiceModel,
      "--output_path", outputPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        try {
          const { readFileSync } = require("node:fs");
          const audio = readFileSync(outputPath);
          unlinkSync(outputPath);
          resolve({ audio, format: "wav" });
        } catch (err) {
          reject(new Error(`Failed to read Coqui output: ${err}`));
        }
      } else {
        log.error({ stderr, code }, "Coqui TTS failed");
        reject(new Error(`Coqui TTS failed: ${stderr}`));
      }
    });

    process.on("error", (err) => {
      log.error({ err }, "Failed to start Coqui TTS");
      reject(err);
    });
  });
}

/**
 * Piper TTS (Free, fast neural TTS) - runs locally
 * Requires Piper to be installed and downloaded models
 */
async function textToSpeechPiper(
  text: string,
  voiceModel: string = "en_US-lessac-medium"
): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const tempDir = mkdtempSync("/tmp/tts-");
    const outputPath = join(tempDir, "output.wav");

    // Simple text file for piper input
    const inputPath = join(tempDir, "input.txt");
    writeFileSync(inputPath, text);

    const process = spawn("piper", [
      "--model", voiceModel,
      "--output_file", outputPath,
      "--input_file", inputPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      try {
        unlinkSync(inputPath);
      } catch {}

      if (code === 0) {
        try {
          const { readFileSync } = require("node:fs");
          const audio = readFileSync(outputPath);
          unlinkSync(outputPath);
          resolve({ audio, format: "wav" });
        } catch (err) {
          reject(new Error(`Failed to read Piper output: ${err}`));
        }
      } else {
        log.error({ stderr, code }, "Piper TTS failed");
        reject(new Error(`Piper TTS failed: ${stderr}`));
      }
    });

    process.on("error", (err) => {
      log.error({ err }, "Failed to start Piper TTS");
      reject(err);
    });
  });
}

/**
 * Google Cloud TTS (using basic auth)
 */
async function textToSpeechGoogle(text: string, _apiKey: string): Promise<TtsResult> {
  // Google Cloud TTS requires service account - simplified for now
  log.warn("Google TTS not fully implemented - requires service account");
  throw new Error("Google TTS requires service account setup");
}

/**
 * Google Translate TTS (free, uses gTTS library)
 */
async function textToSpeechGTTS(text: string, lang: string = "en"): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("node:child_process");
    const tempDir = mkdtempSync("/tmp/tts-");
    const outputPath = join(tempDir, "output.mp3");

    const process = spawn("python3", [
      "-c",
      `
from gtts import gTTS
tts = gTTS(text=${JSON.stringify(text)}, lang=${JSON.stringify(lang)})
tts.save(${JSON.stringify(outputPath)})
`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    process.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    process.on("close", (code: number) => {
      if (code === 0) {
        try {
          const { readFileSync } = require("node:fs");
          const audio = readFileSync(outputPath);
          unlinkSync(outputPath);
          resolve({ audio, format: "mp3" });
        } catch (err) {
          reject(new Error(`Failed to read gTTS output: ${err}`));
        }
      } else {
        log.error({ stderr, code }, "gTTS failed");
        reject(new Error(`gTTS failed: ${stderr}`));
      }
    });
    process.on("error", (err: Error) => {
      log.error({ err }, "Failed to start gTTS");
      reject(err);
    });
  });
}

/**
 * AWS Polly TTS
 */
async function textToSpeechPolly(text: string, _apiKey: string): Promise<TtsResult> {
  // AWS Polly requires AWS SDK - simplified for now
  log.warn("AWS Polly TTS not fully implemented");
  throw new Error("AWS Polly TTS requires AWS credentials");
}

/**
 * Get available voices for a provider
 */
export async function getVoices(provider: string, apiKey: string): Promise<string[]> {
  switch (provider) {
    case "elevenlabs": {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch ElevenLabs voices");
      }
      const data = await response.json() as { voices: Array<{ voice_id: string; name: string }> };
      return data.voices.map((v) => v.name || v.voice_id);
    }
    case "openai":
      // OpenAI uses fixed voices
      return ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    case "coqui":
      // Popular Coqui models
      return [
        "tts_models/en/ljspeech/glow-tts",
        "tts_models/en/ljspeech/fast_pitch",
        "tts_models/multilingual/multi-dataset/xtts_v2",
      ];
    case "piper":
      // Piper English voices (need to be downloaded separately)
      return ["en_US-lessac-medium", "en_US-lessac-medium.onnx"];
    case "gtts":
      // gTTS languages
      return ["en", "en-us", "fr", "de", "es", "it", "ja", "ko", "pt", "ru"];
    default:
      return [];
  }
}
