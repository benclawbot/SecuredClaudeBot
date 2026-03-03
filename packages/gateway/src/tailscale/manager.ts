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

  constructor(private opts?: TailscaleConfig) {
    this.config = opts ?? null;
  }

  /**
   * Start Tailscale connection
   */
  async start(): Promise<boolean> {
    if (!this.config?.enabled) {
      log.info("Tailscale not enabled in config");
      return false;
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
        // If output contains "tailscale0" or "Tailscale is running", it's connected
        const isConnected = output.includes("tailscale0") ||
          output.toLowerCase().includes("tailscale is running") ||
          output.toLowerCase().includes("health:");

        resolve(code === 0 && isConnected);
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
   * Get current status
   */
  getStatus(): { enabled: boolean; connected: boolean } {
    return {
      enabled: this.config?.enabled ?? false,
      connected: this.connected,
    };
  }

  /**
   * Update config
   */
  updateConfig(opts: TailscaleConfig): void {
    this.config = opts;
  }
}
