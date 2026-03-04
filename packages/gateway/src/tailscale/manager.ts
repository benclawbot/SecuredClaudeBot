/**
 * Tailscale Manager — handles Tailscale connection for remote access
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createChildLogger } from "../logger/index.js";
import type { TailscaleConfig } from "../config/schema.js";

const log = createChildLogger("tailscale");

export class TailscaleManager {
  private process: ChildProcess | null = null;
  private connected = false;
  private config: TailscaleConfig | null = null;
  private statusCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private opts?: TailscaleConfig) {
    this.config = opts ?? null;
  }

  /**
   * Start periodic status checker (runs every hour)
   */
  startStatusChecker(): void {
    if (this.statusCheckInterval) return;

    // Check every hour
    this.statusCheckInterval = setInterval(async () => {
      const isConnected = await this.checkStatus();
      this.connected = isConnected;
      log.info({ connected: isConnected }, "Periodic Tailscale status check");
    }, 60 * 60 * 1000);

    log.info("Tailscale status checker started");
  }

  /**
   * Stop periodic status checker
   */
  stopStatusChecker(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
      log.info("Tailscale status checker stopped");
    }
  }

  /**
   * Start Tailscale connection
   */
  async start(): Promise<boolean> {
    if (!this.config?.enabled) {
      log.info("Tailscale not enabled in config");
      return false;
    }

    // Check if already connected at system level
    const alreadyConnected = await this.checkStatus();
    if (alreadyConnected) {
      log.info("Tailscale already running at system level");
      this.connected = true;
      return true;
    }

    if (this.connected) {
      log.info("Tailscale already connected");
      return true;
    }

    return new Promise((resolve) => {
      const args = ["up"];

      if (this.config?.authKey) {
        args.push("--authkey", this.config.authKey);
      }

      if (this.config?.advertiseExitNode) {
        args.push("--advertise-exit-node");
      }

      if (this.config?.args) {
        args.push(...this.config.args);
      }

      log.info({ args }, "Starting Tailscale...");

      this.process = spawn("tailscale", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      this.process.stdout?.on("data", (data) => {
        output += data.toString();
        log.info({ data: data.toString() }, "Tailscale output");
      });

      this.process.stderr?.on("data", (data) => {
        log.info({ data: data.toString() }, "Tailscale status");
      });

      this.process.on("close", (code) => {
        log.info({ code }, "Tailscale process closed");
        this.connected = false;
        this.process = null;
      });

      this.process.on("error", (err) => {
        log.error({ err }, "Tailscale process error");
        resolve(false);
      });

      // Wait a bit and check if connected
      setTimeout(() => {
        this.checkStatus().then((status) => {
          this.connected = status;
          if (status) {
            log.info("Tailscale connected successfully");
          }
          resolve(status);
        });
      }, 3000);
    });
  }

  /**
   * Stop Tailscale connection
   */
  async stop(): Promise<void> {
    if (!this.connected && !this.process) {
      log.info("Tailscale not running");
      return;
    }

    return new Promise((resolve) => {
      log.info("Stopping Tailscale...");

      const down = spawn("tailscale", ["down"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      down.on("close", () => {
        this.connected = false;
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
        log.info("Tailscale disconnected");
        resolve();
      });

      down.on("error", (err) => {
        log.error({ err }, "Error stopping Tailscale");
        resolve();
      });
    });
  }

  /**
   * Check Tailscale status
   */
  async checkStatus(): Promise<boolean> {
    return new Promise((resolve) => {
      const status = spawn("tailscale", ["status"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      status.stdout?.on("data", (data) => {
        output += data.toString();
      });

      status.on("close", (code) => {
        // Tailscale is connected if:
        // - Exit code is 0 AND there's output (shows peers)
        // - Output contains "tailscale0" interface
        // - Output contains health indicators or backend state
        const isConnected = code === 0 && output.length > 0 &&
          (output.includes("tailscale0") ||
           output.toLowerCase().includes("tailscale is running") ||
           output.toLowerCase().includes("health:") ||
           output.toLowerCase().includes("backendstate") ||
           output.includes("linux"));

        resolve(isConnected);
      });

      status.on("error", () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        status.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Get Tailscale IP address
   */
  async getTailscaleIp(): Promise<string | null> {
    return new Promise((resolve) => {
      const status = spawn("tailscale", ["ip", "-4"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      status.stdout?.on("data", (data) => {
        output += data.toString();
      });

      status.on("close", () => {
        const ip = output.trim();
        if (ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
          resolve(ip);
        } else {
          resolve(null);
        }
      });

      status.on("error", () => {
        resolve(null);
      });

      setTimeout(() => {
        status.kill();
        resolve(null);
      }, 5000);
    });
  }

  /**
   * Get current status - checks actual system status
   */
  async getStatus(): Promise<{ enabled: boolean; connected: boolean }> {
    const isConnected = await this.checkStatus();
    return {
      enabled: this.config?.enabled ?? false,
      connected: isConnected,
    };
  }

  /**
   * Update config
   */
  updateConfig(opts: TailscaleConfig): void {
    this.config = opts;
  }
}
